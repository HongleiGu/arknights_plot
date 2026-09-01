"""
Scrape the 敌人 (enemy) catalog from prts.wiki into data/enemies.json.

敌人一览 is a bare `{{#widget:EnemiesListV2}}` — its wikitext holds no data —
and there is no Cargo table for enemies (unlike 道具, see scrape_items.py). So
this uses the same shape as scrape_operator_profile.py: enumerate
`Category:敌人` with pagination, then read each page.

Per page we want only what the catalog needs:
    名称   → name          from {{敌人信息/common2}}
    描述   → description    ditto
    种类   → kind           ditto (感染生物 / 萨卡兹 / …)
    地位级别 → rank          ditto (普通 / 精英 / BOSS)
    index  → code           ditto (B1 …), the wiki's own ordering key
    [[文件:….png]]          → the thumbnail, downloaded as the asset

Level-by-level stat blocks ({{敌人信息/levelcontent}}) are deliberately NOT
parsed — this is a story archive, not a combat wiki, and those tables are large,
change every balance patch, and nothing in the app would read them. The whole
infobox is kept in `raw` if that ever changes.

Idempotent: enemies already in enemies.json are skipped unless --force, and an
icon already on disk is not re-downloaded — so an interrupted run resumes.

Usage:
    conda run -n study python scripts/scrape_enemies.py
    conda run -n study python scripts/scrape_enemies.py --force
    conda run -n study python scripts/scrape_enemies.py --limit 20
    conda run -n study python scripts/scrape_enemies.py --no-icons
"""

import argparse
import hashlib
import json
import logging
import re
import time
from pathlib import Path

import requests

ROOT     = Path(__file__).resolve().parent.parent
DATA     = ROOT / "data"
OUT_JSON = DATA / "enemies.json"
ICON_DIR = DATA / "enemy-icons"
API      = "https://prts.wiki/api.php"

CATEGORY = "Category:敌人"
DELAY    = 0.4
TIMEOUT  = 90
RETRIES  = 5

log = logging.getLogger("enemies")


def api(params: dict) -> dict:
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


def enemy_pages() -> list[str]:
    """Main-namespace members of Category:敌人, paginated."""
    titles: list[str] = []
    cont: str | None = None
    while True:
        p = {"action": "query", "list": "categorymembers", "cmtitle": CATEGORY,
             "cmnamespace": "0", "cmlimit": "500", "cmtype": "page"}
        if cont:
            p["cmcontinue"] = cont
        d = api(p)
        for m in d.get("query", {}).get("categorymembers", []):
            t = m["title"]
            if "/" not in t:                          # skip sub-pages
                titles.append(t)
        cont = d.get("continue", {}).get("cmcontinue")
        if not cont:
            return titles
        time.sleep(DELAY)


def wikitext(title: str) -> str | None:
    d = api({"action": "query", "prop": "revisions", "titles": title,
             "rvprop": "content", "rvslots": "main"})
    for p in d.get("query", {}).get("pages", {}).values():
        if "revisions" in p:
            return p["revisions"][0]["slots"]["main"]["*"]
    return None


def parse_infobox(wt: str) -> dict:
    """Fields of {{敌人信息/common2 …}} as a dict.

    Split on newline-pipe rather than every pipe: values contain wikilinks and
    templates that carry their own pipes, and splitting naively shreds them.
    """
    m = re.search(r"\{\{敌人信息/common2(.*?)\n\}\}", wt, re.S)
    if not m:
        return {}
    fields: dict[str, str] = {}
    for part in re.split(r"\n\s*\|", m.group(1)):
        if "=" not in part:
            continue
        k, _, v = part.partition("=")
        k = k.strip().lstrip("|").strip()
        v = v.strip()
        if k:
            fields[k] = v
    return fields


def image_filename(wt: str) -> str | None:
    """First [[文件:….png|…]] on the page — the enemy's artwork."""
    m = re.search(r"\[\[文件:([^|\]]+\.(?:png|jpg|jpeg))", wt, re.I)
    return m.group(1).strip() if m else None


def icon_url(filename: str) -> str | None:
    d = api({"action": "query", "titles": f"文件:{filename}",
             "prop": "imageinfo", "iiprop": "url"})
    for p in d.get("query", {}).get("pages", {}).values():
        info = p.get("imageinfo")
        if info:
            return info[0].get("url")
    return None


def safe(name: str) -> str:
    """Windows-safe filename (same characters scrape_plots.safe_name strips)."""
    return re.sub(r'[:*?"<>|/\\]', "_", name).strip()


def download_icon(filename: str) -> str | None:
    dst = ICON_DIR / safe(filename)
    rel = dst.relative_to(DATA)
    if dst.exists():
        return sha1_for(rel)
    url = icon_url(filename)
    if not url:
        return None
    try:
        r = requests.get(url, timeout=TIMEOUT)
        r.raise_for_status()
    except Exception as e:                            # noqa: BLE001
        log.warning(f"  icon download failed for {filename}: {type(e).__name__}")
        return None
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(r.content)
    return sha1_for(rel)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true", help="re-scrape enemies already in enemies.json")
    p.add_argument("--no-icons", action="store_true", help="skip artwork download")
    p.add_argument("--limit", type=int, help="stop after N enemies (debugging)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")

    existing: dict[str, dict] = {}
    if OUT_JSON.exists() and not args.force:
        existing = {r["name"]: r for r in json.loads(OUT_JSON.read_text(encoding="utf-8"))}
        log.info(f"{len(existing)} enemy(ies) already in enemies.json — skipping those")

    log.info(f"enumerating {CATEGORY} …")
    titles = enemy_pages()
    log.info(f"{len(titles)} enemy page(s)")
    if args.limit:
        titles = titles[:args.limit]

    out: list[dict] = []
    new = failed = icons = 0
    for i, title in enumerate(titles, 1):
        if title in existing and not args.force:
            out.append(existing[title])
            continue
        wt = wikitext(title)
        if not wt:
            log.warning(f"[{i}/{len(titles)}] {title}: no wikitext")
            failed += 1
            continue
        box = parse_infobox(wt)
        rec = {
            "name": (box.get("名称") or title).strip(),
            "code": (box.get("index") or "").strip() or None,
            "description": (box.get("描述") or "").strip() or None,
            "kind": (box.get("种类") or "").strip() or None,
            "rank": (box.get("地位级别") or "").strip() or None,
            "wiki_href": f"https://prts.wiki/w/{requests.utils.quote(title)}",
            "icon_sha1": None,
            "seq": i,
            "raw": box or None,
        }
        fn = image_filename(wt)
        if fn and not args.no_icons:
            rec["icon_sha1"] = download_icon(fn)
            if rec["icon_sha1"]:
                icons += 1
        if rec["raw"] is None:
            log.warning(f"[{i}/{len(titles)}] {title}: no 敌人信息/common2 infobox")
        out.append(rec)
        new += 1
        if new % 25 == 0:
            log.info(f"  [{i}/{len(titles)}] {new} new …")
        time.sleep(DELAY)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info(f"wrote {len(out)} enemy(ies) to {OUT_JSON.relative_to(ROOT)} "
             f"({new} new, {icons} icon(s), {failed} failed)")
    log.info("next: conda run -n study python scripts/import_catalog.py --only enemies")


if __name__ == "__main__":
    main()
