"""
Scrape the 道具 (item) catalog from prts.wiki into data/items.json.

Source: the wiki's **Cargo** table `item`. 道具一览 itself is only
`{{#cargo_query:}}` plus a JS widget, so there is nothing in its wikitext to
parse — but that cargo_query names the table and fields, and Cargo has a proper
API. One paged API call gives structured rows; no HTML parsing, and nothing to
re-break when the page layout changes.

Icons: each row carries `iconId`; the wiki file is `文件:<iconId>.png`. We ask
the API for the real URL (imageinfo) rather than guessing the upload path, then
download to data/item-icons/<iconId>.png and stamp icon_sha1 using the same
convention as every other asset — sha1 of the data/-relative path.

Idempotent: rows already in items.json are kept and skipped unless --force, and
an icon already on disk is not re-downloaded.

Usage:
    conda run -n study python scripts/scrape_items.py
    conda run -n study python scripts/scrape_items.py --force
    conda run -n study python scripts/scrape_items.py --no-icons
    conda run -n study python scripts/scrape_items.py --limit 50
"""

import argparse
import hashlib
import json
import logging
import time
from pathlib import Path

import requests

ROOT      = Path(__file__).resolve().parent.parent
DATA      = ROOT / "data"
OUT_JSON  = DATA / "items.json"
ICON_DIR  = DATA / "item-icons"
API       = "https://prts.wiki/api.php"

CARGO_TABLE  = "item"
CARGO_FIELDS = ("name,description,purpose,obtain_method,rarity,"
                "category1,category2,category3,itemId,sortId,iconId")
PAGE      = 500
DELAY     = 0.4
TIMEOUT   = 90
RETRIES   = 5

log = logging.getLogger("items")


def api(params: dict) -> dict:
    """GET with retry/backoff — prts.wiki times out often enough to matter."""
    params = {**params, "format": "json"}
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(API, params=params, timeout=TIMEOUT)
            r.raise_for_status()
            return r.json()
        except Exception as e:                       # noqa: BLE001 — retry anything
            last = e
            wait = 2.0 * (2 ** attempt)
            log.warning(f"  retry {attempt+1}/{RETRIES} in {wait:.0f}s ({type(e).__name__})")
            time.sleep(wait)
    raise last                                        # type: ignore[misc]


def sha1_for(rel: Path) -> str:
    """sha1 of the data/-relative path — matches upload_story_images.sha1_for."""
    return hashlib.sha1("/".join(rel.parts).encode("utf-8")).hexdigest()


def fetch_rows(limit: int | None) -> list[dict]:
    """Every row of the Cargo `item` table, paged."""
    rows: list[dict] = []
    offset = 0
    while True:
        d = api({"action": "cargoquery", "tables": CARGO_TABLE, "fields": CARGO_FIELDS,
                 "limit": PAGE, "offset": offset})
        batch = [x["title"] for x in d.get("cargoquery", [])]
        rows.extend(batch)
        log.info(f"  fetched {len(rows)} rows")
        if len(batch) < PAGE or (limit and len(rows) >= limit):
            break
        offset += PAGE
        time.sleep(DELAY)
    return rows[:limit] if limit else rows


def icon_url(icon_id: str) -> str | None:
    """Real upload URL for 文件:<iconId>.png (never guess the hash path)."""
    d = api({"action": "query", "titles": f"文件:{icon_id}.png",
             "prop": "imageinfo", "iiprop": "url"})
    for p in d.get("query", {}).get("pages", {}).values():
        info = p.get("imageinfo")
        if info:
            return info[0].get("url")
    return None


def download_icon(icon_id: str) -> str | None:
    """Download to data/item-icons/<iconId>.png; return icon_sha1."""
    dst = ICON_DIR / f"{icon_id}.png"
    rel = dst.relative_to(DATA)
    if dst.exists():
        return sha1_for(rel)
    url = icon_url(icon_id)
    if not url:
        return None
    try:
        r = requests.get(url, timeout=TIMEOUT)
        r.raise_for_status()
    except Exception as e:                            # noqa: BLE001
        log.warning(f"  icon download failed for {icon_id}: {type(e).__name__}")
        return None
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(r.content)
    return sha1_for(rel)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true", help="re-fetch even if items.json exists")
    p.add_argument("--no-icons", action="store_true", help="skip icon download")
    p.add_argument("--limit", type=int, help="stop after N items (debugging)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")

    existing: dict[str, dict] = {}
    if OUT_JSON.exists() and not args.force:
        existing = {r["name"]: r for r in json.loads(OUT_JSON.read_text(encoding="utf-8"))}
        log.info(f"{len(existing)} item(s) already in items.json — skipping those")

    log.info("querying Cargo table `item` …")
    rows = fetch_rows(args.limit)
    log.info(f"{len(rows)} row(s) from Cargo")

    out: list[dict] = []
    new = icons = 0
    for i, r in enumerate(rows):
        name = (r.get("name") or "").strip()
        if not name:
            continue
        if name in existing and not args.force:
            out.append(existing[name])
            continue
        # Cargo returns "obtain method" with a space; keep the raw row too.
        cats = [r.get(f"category{n}") for n in (1, 2, 3)]
        rarity = r.get("rarity")
        rec = {
            "name": name,
            "description": (r.get("description") or "").strip() or None,
            "usage_text": (r.get("purpose") or "").strip() or None,
            "obtain_method": (r.get("obtain method") or r.get("obtain_method") or "").strip() or None,
            "rarity": int(rarity) if str(rarity).isdigit() else None,
            "category": " / ".join(c for c in cats if c) or None,
            "item_key": (r.get("itemId") or "").strip() or None,
            "wiki_href": f"https://prts.wiki/w/{requests.utils.quote(name)}",
            "icon_sha1": None,
            "seq": i,
            "raw": r,
        }
        icon_id = (r.get("iconId") or "").strip()
        if icon_id and not args.no_icons:
            rec["icon_sha1"] = download_icon(icon_id)
            if rec["icon_sha1"]:
                icons += 1
            time.sleep(DELAY)
        out.append(rec)
        new += 1
        if new % 50 == 0:
            log.info(f"  {new} new item(s) …")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info(f"wrote {len(out)} item(s) to {OUT_JSON.relative_to(ROOT)} "
             f"({new} new, {icons} icon(s) fetched)")
    log.info("next: conda run -n study python scripts/import_catalog.py --only items")


if __name__ == "__main__":
    main()
