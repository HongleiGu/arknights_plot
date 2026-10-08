"""
Import the official 关卡描述 (stage briefing) for every game stage (AP-37).

WHAT THIS IS, AND IS NOT
------------------------
The game shows two official texts per stage, and they are different things:

  关卡描述   the TACTICAL briefing on the level page —
             "已在战场上确认了敌方穿着迷彩的术师单位。请优先清除此部分威胁较高的敌军。"
             Sometimes it is narrative instead ("每个人都有自己的路，你选择你的…"),
             but it describes the fight, not the story.

  the skip-dialog brief, which IS a plot summary. For 支线 that is already
  scraped from 情报处理室 (973 rows). For 主线 it is nowhere we have found:
  the 情报处理室 wikitext contains zero occurrences of 二次呼吸, 黑暗时代,
  异卵同生 or even the word 主线.

So this fills a real gap but does not replace the plot brief. 043's view ranks
sources explicitly for exactly that reason — manual, then 情报处理室, then this
— because ranking by recency would have promoted the tactical text over the
plot summary for all 973 chapters that have both.

WHAT IT FETCHES
---------------
One request per distinct level PAGE, not per chapter: 行动前 and 行动后 are two
`chapters` rows sharing one stage, so fetching per chapter would double the
requests for the same text. Measured: 2,672 chapters collapse to ~1,700 pages.

漫画 and 大地巡旅 are excluded. Their `chapters` rows carry synthetic codes
(`10 堡垒山城大逃亡①`, `「魔王」篇 魔王`) that are not stage pages, so every one
would be a wasted request and a 404.

RESUMABILITY
------------
prts.wiki times out under GFW throttling, so the cache (data/level_descriptions
.json) is written after every page and re-read on startup. An interrupted run
resumes instead of restarting, the same reason scrape_plots.py skips files that
already exist.

Usage:
    conda run -n study python scripts/scrape_level_descriptions.py
    conda run -n study python scripts/scrape_level_descriptions.py --limit 20
    conda run -n study python scripts/scrape_level_descriptions.py --no-import
    conda run -n study python scripts/scrape_level_descriptions.py --import-only
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import ssl
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

ROOT = Path(__file__).parent.parent
CACHE = ROOT / "data" / "level_descriptions.json"

API = "https://prts.wiki/api.php"
SOURCE = "prts.wiki/关卡描述"

# Categories whose chapters correspond to real game stages with a wiki page.
STAGE_CATEGORIES = {"主线", "支线", "故事集", "集成战略", "四月辑录", "生息演算", "特殊"}

DELAY = 0.6          # polite, and the wiki throttles anyway
TIMEOUT = 45
RETRIES = 4

# prts.wiki's cert does not verify from here — same posture as the other
# scrapers in this repo.
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# --- wikitext -> plain text -------------------------------------------------
# 关卡描述 is not plain: it carries <br/> line breaks and {{color|#FFFFFF|<侦测器>}}
# wrappers around the names of stage mechanics. Stored raw it would render as
# literal markup, so it is flattened here rather than in the reader — the
# database should hold text, not one source's markup dialect.
COLOR  = re.compile(r"\{\{\s*color\s*\|[^|]*\|([\s\S]*?)\}\}", re.I)
TMPL   = re.compile(r"\{\{[\s\S]*?\}\}")
LINK   = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]")
BR     = re.compile(r"<\s*br\s*/?\s*>", re.I)
TAG    = re.compile(r"<[^>]+>")
BOLD   = re.compile(r"'{2,}")


def clean(text: str) -> str:
    t = BR.sub("\n", text)
    for _ in range(3):                      # nested {{color}} inside templates
        new = COLOR.sub(r"\1", t)
        if new == t:
            break
        t = new
    t = TMPL.sub("", t)
    t = LINK.sub(r"\1", t)
    t = TAG.sub("", t)
    t = BOLD.sub("", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def fetch(title: str) -> str | None:
    """The page's wikitext, or None when there is no such page."""
    q = urllib.parse.urlencode({
        "action": "query", "prop": "revisions", "titles": title,
        "rvprop": "content", "rvslots": "main",
        "format": "json", "formatversion": "2", "redirects": "1",
    })
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(
                f"{API}?{q}", headers={"User-Agent": "arknights-plot/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
                d = json.loads(r.read())
            p = (d.get("query", {}).get("pages") or [{}])[0]
            if p.get("missing"):
                return None
            return p["revisions"][0]["slots"]["main"]["content"]
        except Exception as e:                                   # noqa: BLE001
            last = e
            if attempt < RETRIES - 1:
                wait = 3 * (2 ** attempt)
                log.warning(f"  retry {attempt+1}/{RETRIES} for {title} in {wait}s "
                            f"({type(e).__name__})")
                time.sleep(wait)
    raise RuntimeError(f"{title}: {last}")


DESC = re.compile(r"\|\s*关卡描述\s*=\s*([\s\S]*?)(?=\n\s*[|}])")


def main() -> None:
    ap = argparse.ArgumentParser(description="Scrape 关卡描述 into chapter_descriptions.")
    ap.add_argument("--limit", type=int, help="stop after N pages (for a trial run)")
    ap.add_argument("--no-import", action="store_true", help="scrape to the cache only")
    ap.add_argument("--import-only", action="store_true", help="load the cache, no network")
    ap.add_argument("--force", action="store_true", help="re-fetch pages already cached")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    db: Client = create_client(os.environ["SUPABASE_URL"],
                               os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    stories = {s["id"]: s for s in
               db.table("stories").select("id, category").execute().data}
    chapters, start = [], 0
    while True:
        r = (db.table("chapters").select("id, story_id, level_code, level_name")
             .range(start, start + 999).execute())
        chapters += r.data
        if len(r.data) < 1000:
            break
        start += 1000

    pages: dict[str, list[int]] = defaultdict(list)
    for c in chapters:
        cat = stories.get(c["story_id"], {}).get("category")
        if cat not in STAGE_CATEGORIES:
            continue
        code, name = c.get("level_code"), c.get("level_name")
        if not code or not name:
            continue
        pages[f"{code} {name}"].append(c["id"])
    log.info(f"{len(chapters):,} chapters -> {len(pages):,} distinct stage pages "
             f"in {len(STAGE_CATEGORIES)} categories")

    cache: dict[str, str | None] = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
        log.info(f"{len(cache):,} page(s) already in {CACHE.name}")

    if not args.import_only:
        todo = [t for t in sorted(pages) if args.force or t not in cache]
        if args.limit:
            todo = todo[:args.limit]
        log.info(f"fetching {len(todo):,} page(s)")
        for i, title in enumerate(todo, 1):
            txt = fetch(title)
            m = DESC.search(txt) if txt else None
            cache[title] = clean(m.group(1)) if m else None
            if i % 25 == 0 or i == len(todo):
                CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1),
                                 encoding="utf-8")
                got = sum(1 for v in cache.values() if v)
                log.info(f"  {i}/{len(todo)}  cached={len(cache)} with-text={got}")
            time.sleep(DELAY)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1),
                         encoding="utf-8")

    if args.no_import:
        log.info("--no-import: cache written, nothing loaded")
        return

    rows = []
    for title, body in cache.items():
        if not body:
            continue
        for cid in pages.get(title, []):
            rows.append({"chapter_id": cid, "source": SOURCE, "body": body})
    log.info(f"upserting {len(rows):,} chapter description(s)")
    for i in range(0, len(rows), 500):
        db.table("chapter_descriptions").upsert(
            rows[i:i + 500], on_conflict="chapter_id,source").execute()
        log.info(f"  {min(i+500, len(rows)):,}/{len(rows):,}")

    missing = [t for t, v in cache.items() if not v]
    log.info(f"done. {len(cache) - len(missing):,} pages had 关卡描述, "
             f"{len(missing):,} did not")


if __name__ == "__main__":
    main()
