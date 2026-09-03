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
    头像 敌人 <名称>.png     → the portrait icon (see icon_candidates)

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
BATCH    = 50          # MediaWiki caps a multi-title query at 50 for normal users
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


def _unnormalize(d: dict) -> dict[str, str]:
    """MediaWiki rewrites some titles (underscores, capitalisation) and reports
    the mapping in `normalized`. Without it a batch reply can't be matched back
    to the title we asked for."""
    return {n["to"]: n["from"] for n in d.get("query", {}).get("normalized", [])}


def wikitext_batch(titles: list[str]) -> dict[str, str]:
    """{title: wikitext} for up to BATCH titles per request.

    The API takes 50 titles at a time, so fetching pages one by one costs ~1783
    round trips against a host that is often seconds-slow — measured at ~5
    enemies/minute, i.e. about five hours. Batching makes it ~36 requests.
    """
    out: dict[str, str] = {}
    for i in range(0, len(titles), BATCH):
        chunk = titles[i:i + BATCH]
        d = api({"action": "query", "prop": "revisions", "titles": "|".join(chunk),
                 "rvprop": "content", "rvslots": "main"})
        back = _unnormalize(d)
        for p in d.get("query", {}).get("pages", {}).values():
            if "revisions" in p:
                t = p["title"]
                out[back.get(t, t)] = p["revisions"][0]["slots"]["main"]["*"]
        log.info(f"  wikitext {min(i + BATCH, len(titles))}/{len(titles)}")
        time.sleep(DELAY)
    return out


def icon_urls_batch(filenames: list[str]) -> dict[str, str]:
    """{filename: url} for the ones that exist. Same batching argument."""
    out: dict[str, str] = {}
    uniq = list(dict.fromkeys(filenames))
    for i in range(0, len(uniq), BATCH):
        chunk = uniq[i:i + BATCH]
        d = api({"action": "query", "titles": "|".join(f"文件:{f}" for f in chunk),
                 "prop": "imageinfo", "iiprop": "url"})
        back = _unnormalize(d)
        for p in d.get("query", {}).get("pages", {}).values():
            info = p.get("imageinfo")
            if not info:
                continue
            t = back.get(p["title"], p["title"])
            out[t.split(":", 1)[1] if ":" in t else t] = info[0].get("url")
        log.info(f"  icon lookup {min(i + BATCH, len(uniq))}/{len(uniq)}")
        time.sleep(DELAY)
    return out


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


def icon_candidates(title: str, box: dict, wt: str) -> list[str]:
    """Filenames to try for this enemy's icon, best first.

    The portrait is `头像 敌人 <name>.png` and is NOT linked from the page —
    it has to be constructed. Measured at ~95% coverage over a sample of
    Category:敌人; the misses are odd names (curly quotes) and NPCs with no
    portrait at all.

    Both the infobox 名称 and the page title are tried, since they can differ.

    Last resort is the first image actually on the page that is NOT `Avg…` —
    those are AVG story CGs, not icons, and taking them was the original bug:
    源石虫's only [[文件:]] is `Avg avg npc 1431 1$1.png`, a full CG.
    """
    cands: list[str] = []
    for n in ((box.get("名称") or "").strip(), title.strip()):
        if n:
            f = f"头像 敌人 {n}.png"
            if f not in cands:
                cands.append(f)
    for m in re.finditer(r"\[\[文件:([^|\]]+\.(?:png|jpg|jpeg))", wt, re.I):
        fn = m.group(1).strip()
        if not fn.lower().startswith("avg") and fn not in cands:
            cands.append(fn)
            break
    return cands


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


def download_icon(candidates: list[str], urls: dict[str, str] | None = None) -> str | None:
    """First candidate that exists on the wiki, downloaded. Returns icon_sha1.

    Checks the local cache before any network work, so a resumed run costs
    nothing for enemies already fetched. `urls` is the pre-resolved batch map;
    without it each candidate is looked up individually (the resume path, where
    only a handful are left).
    """
    for filename in candidates:
        dst = ICON_DIR / safe(filename)
        if dst.exists():
            return sha1_for(dst.relative_to(DATA))
    for filename in candidates:
        url = urls.get(filename) if urls is not None else icon_url(filename)
        if not url:
            continue
        # Retry the image fetch itself: icon_url() goes through api() and so is
        # already retried, but the media host times out on its own and a single
        # ConnectTimeout would otherwise silently cost this enemy its icon.
        r = None
        for attempt in range(3):
            try:
                r = requests.get(url, timeout=TIMEOUT)
                r.raise_for_status()
                break
            except Exception as e:                    # noqa: BLE001
                log.warning(f"  icon fetch retry {attempt+1}/3 for {filename} ({type(e).__name__})")
                r = None
                time.sleep(2.0 * (attempt + 1))
        if r is None:
            continue
        dst = ICON_DIR / safe(filename)
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(r.content)
        return sha1_for(dst.relative_to(DATA))
    return None


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

    # Three phases rather than one loop. Doing everything per-enemy meant three
    # sequential round trips each against a host that is often seconds-slow —
    # measured at ~5 enemies/minute, about five hours for the full category.
    # Batching the two lookup phases (50 titles per request) leaves only the
    # image downloads as per-enemy work.
    todo = [t for t in titles if args.force or t not in existing]
    log.info(f"{len(todo)} to fetch, {len(titles) - len(todo)} already known")

    pages = wikitext_batch(todo) if todo else {}

    boxes: dict[str, dict] = {}
    cands: dict[str, list[str]] = {}
    for title in todo:
        wt = pages.get(title)
        if wt is None:
            continue
        boxes[title] = parse_infobox(wt)
        cands[title] = icon_candidates(title, boxes[title], wt)

    urls: dict[str, str] = {}
    if not args.no_icons:
        # Resume also needs lookups for records that never got an icon.
        retry = [t for t in titles
                 if t in existing and not args.force
                 and existing[t].get("icon_sha1") is None]
        for t in retry:
            cands.setdefault(t, icon_candidates(t, existing[t].get("raw") or {}, ""))
        wanted = [f for t in (list(cands.keys())) for f in cands[t]]
        urls = icon_urls_batch(wanted)

    out: list[dict] = []
    new = failed = icons = 0
    for i, title in enumerate(titles, 1):
        if title in existing and not args.force:
            prev = existing[title]
            # Self-healing resume: a transient timeout leaves icon_sha1 null,
            # and without this the record would be skipped forever and that
            # enemy would silently never get an icon. Retrying is cheap — the
            # local cache is checked before any request.
            if prev.get("icon_sha1") is None and not args.no_icons:
                found = download_icon(cands.get(title, []), urls)
                if found:
                    prev["icon_sha1"] = found
                    icons += 1
            out.append(prev)
            continue
        if title not in boxes:
            log.warning(f"[{i}/{len(titles)}] {title}: no wikitext")
            failed += 1
            continue
        box = boxes[title]
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
        if not args.no_icons:
            rec["icon_sha1"] = download_icon(cands.get(title, []), urls)
            if rec["icon_sha1"]:
                icons += 1
        if rec["raw"] is None:
            log.warning(f"[{i}/{len(titles)}] {title}: no 敌人信息/common2 infobox")
        out.append(rec)
        new += 1
        if new % 100 == 0:
            log.info(f"  [{i}/{len(titles)}] {new} fetched, {icons} icon(s) …")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info(f"wrote {len(out)} enemy(ies) to {OUT_JSON.relative_to(ROOT)} "
             f"({new} new, {icons} icon(s), {failed} failed)")
    log.info("next: conda run -n study python scripts/import_catalog.py --only enemies")


if __name__ == "__main__":
    main()
