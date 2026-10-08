"""
Import the game's own skip-confirmation briefs (AP-37).

WHERE THEY COME FROM
--------------------
These are the summaries the game shows when it asks whether to skip a story
section, and they are the plot briefs this project wanted all along. They are
not reproduced in bulk on any wiki — prts.wiki's 情报处理室 carries 973 of them
and **none** of 主线 (its wikitext has zero occurrences of 二次呼吸, 黑暗时代 or
even the word 主线). They are in the game's data files, which the community
publishes:

    Kengxxiao/ArknightsGameData
      zh_CN/gamedata/excel/story_review_table.json   the index
      zh_CN/gamedata/story/[uc]info/<storyInfo>.txt  the briefs

The index is the mapping, so none of it has to be guessed. Each section carries
`storyCode` (our level_code), `storyName` (our level_name), `avgTag`
(行动前/行动后/幕间, which CLAUDE.md already maps to BEG/END/NBT) and
`storyInfo`, the path to its brief. Deriving the path from filenames instead
was tried first and matched only 59% — nbt sections, `level_spst_08-*` for
chapter 8's R8-/M8-/JT8- codes, and EG-/TR- stages all failed. Via the index it
is 96% (1,986 of 2,080 game chapters): every one of 主线 (427), 干员密录 (384)
and 故事集 (132), and 1,045 of 1,046 支线.

The remaining 94 are 集成战略 (35) / 四月辑录 (23) / 特殊 (17) / 生息演算 (16) and
多索雷斯假日's DH-TR-1, whose sections are not in this table at all (their codes
look like `RO1-END-1`, `RA-END-2`). They would need obt/roguelike and the
activity tables, which is a separate job.

RANKING
-------
Loaded as `gamedata/storyInfo`, which 043's view ranks ABOVE
`prts.wiki/情报处理室`. Checked on 8 overlapping chapters: the two are identical
every time, so the wiki rows are a transcription of this same text — the game
file is the source and ranks higher, and the wiki copy stays as a fallback.

PROVENANCE
----------
This text belongs to Hypergryph. The posture is the same as the 大地巡旅 book
already in this repo: importing it makes the archive searchable and does not
publish it wholesale, and the source is recorded on every row so it is never
mistaken for something this project wrote.

Usage:
    conda run -n study python scripts/import_story_briefs.py --dry-run
    conda run -n study python scripts/import_story_briefs.py
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
from collections import Counter, defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

ROOT = Path(__file__).parent.parent
CACHE = ROOT / "data" / "story_briefs.json"
TABLE_CACHE = ROOT / "data" / "story_review_table.json"

REPO = ("https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/"
        "zh_CN/gamedata/")
SOURCE = "gamedata/storyInfo"

# CLAUDE.md's wiki->DB stage mapping, which the game data uses the same words for.
TAG = {"行动前": "beg", "行动后": "end", "幕间": "nbt"}

# Fourteen chapters no key can reach, resolved once by hand and VERIFIED AGAINST THE
# GAME'S OWN SCRIPT rather than guessed.
#
# Twelve are 干员密录: a record section is keyed by operator CODE
# (story_melan_1_1), which the game data never writes in Chinese, so 玫兰莎's
# 小队长 and 伊芙利特's 小队长 are indistinguishable by name — and three more are
# two halves of one record that share a single title (story_rope_1_1 / _1_2),
# which no name lookup can ever split. Two are 黑暗时代·上's W2G / G2H, where the
# "level code" is an abbreviation of the script filename
# (0_welcome_to_guide, 2_guide_to_home), not a stage code.
#
# How each was decided: fetch the candidate's script and count how many of the
# chapter's stored `nodes.content` lines appear in it verbatim. The proposed
# match scored 44-88% and every rival scored 0.0-1.8%, so the SEPARATION is the
# evidence — a correct match is never 100% because the wiki transcription renders
# narration differently, which is exactly why an absolute threshold would have
# rejected all ten.
#
# The alternative was character_table.json (~25MB) for a code->name map, which
# still would not have split the two-part records. Keyed by
# (story name, level name) and NOT by chapter id, because `parse_plots.py --force`
# re-inserts every scraped chapter and renumbers the ids.
RESOLVED = {
    ("能天使", "来信"):              "info/obt/memory/story_angel_1_1",
    ("调香师", "树犹如此"):          "info/obt/memory/story_flower_2_1",
    ("铅踝", "归乡"):               "info/obt/memory/story_totter_2_1",
    ("锡兰", "留下的人"):            "info/obt/memory/story_ceylon_2_1",
    ("伊芙利特", "小队长"):          "info/obt/memory/story_ifrit_1_1",
    ("玫兰莎", "小队长"):            "info/obt/memory/story_melan_1_1",
    ("灵知", "起点"):               "info/obt/memory/story_gnosis_1_1",
    ("耀骑士临光", "起点"):          "info/obt/memory/story_nearl2_1_1",
    ("烈夏", "捉迷藏"):             "info/obt/memory/story_leto_1_1",
    ("安洁莉娜", "没写收件人的包裹"):   "info/obt/memory/story_aglina_1_1",
    ("暗索", "鲜花香水"):            "info/obt/memory/story_rope_1_1",
    ("暴行", "自有一“派”"):          "info/obt/memory/story_savage_2_1",
    ("黑暗时代·上", "W2G"):          "info/obt/guide/beg/0_welcome_to_guide",
    ("黑暗时代·上", "G2H"):          "info/obt/guide/beg/2_guide_to_home",
}

DELAY = 0.15
TIMEOUT = 45
RETRIES = 4

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def fetch(url: str) -> bytes:
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "arknights-plot/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
                return r.read()
        except Exception as e:                                   # noqa: BLE001
            last = e
            if attempt < RETRIES - 1:
                time.sleep(2 * (2 ** attempt))
    raise RuntimeError(f"{url}: {last}")


def stage_of(path: str | None) -> str | None:
    m = re.search(r"_([^_\\/]+)\.txt$", str(path or ""))
    return m.group(1).lower() if m else None


def main() -> None:
    ap = argparse.ArgumentParser(description="Import the game's skip briefs.")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--no-import", action="store_true",
                    help="fetch into the cache only; load nothing")
    ap.add_argument("--refresh-table", action="store_true",
                    help="re-download story_review_table.json")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    db: Client = create_client(os.environ["SUPABASE_URL"],
                               os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    if args.refresh_table or not TABLE_CACHE.exists():
        log.info("downloading story_review_table.json")
        TABLE_CACHE.write_bytes(fetch(REPO + "excel/story_review_table.json"))
    table = json.loads(TABLE_CACHE.read_text(encoding="utf-8"))

    by_code_tag: dict[tuple[str, str], str] = {}
    by_code_name: dict[tuple[str, str], str] = {}
    # (entry name, section name) — the table groups sections under an entry whose
    # `name` is the story, and that name matches ours for 主线/支线/故事集. It is the
    # scope a bare name lacks: 归乡 is three different sections across the game,
    # but only one inside 眠于树影之中.
    by_story_name: dict[tuple[str, str], str] = {}
    by_name: dict[str, list[str]] = defaultdict(list)
    for e in table.values():
        entry = (e.get("name") or "").strip()
        for u in (e.get("infoUnlockDatas") or []):
            info = u.get("storyInfo")
            if not info:
                continue
            code = (u.get("storyCode") or "").strip()
            name = (u.get("storyName") or "").strip()
            tag = TAG.get((u.get("avgTag") or "").strip())
            if code and tag:
                by_code_tag.setdefault((code, tag), info)
            if code and name:
                by_code_name.setdefault((code, name), info)
            if entry and name:
                by_story_name.setdefault((entry, name), info)
            if name:
                by_name[name].append(info)
    log.info(f"{sum(len(e.get('infoUnlockDatas') or []) for e in table.values()):,} "
             f"sections indexed")

    stories = {s["id"]: s for s in
               db.table("stories").select("id, category, name").execute().data}
    chapters, start = [], 0
    while True:
        r = (db.table("chapters").select("id, story_id, level_code, level_name, file_path")
             .range(start, start + 999).execute())
        chapters += r.data
        if len(r.data) < 1000:
            break
        start += 1000

    # chapter id -> storyInfo path
    want: dict[int, str] = {}
    unmatched = Counter()
    used_resolved: set[tuple[str, str]] = set()
    for c in chapters:
        story = stories.get(c["story_id"], {})
        cat, sname = story.get("category"), (story.get("name") or "").strip()
        if cat in ("漫画", "大地巡旅"):
            continue                       # not game stages
        code = (c["level_code"] or "").strip()
        name = (c["level_name"] or "").strip()
        st = stage_of(c["file_path"])
        if (sname, name) in RESOLVED:
            used_resolved.add((sname, name))
        info = (RESOLVED.get((sname, name))
                or by_code_tag.get((code, st))
                or by_code_name.get((code, name))
                or by_story_name.get((sname, name))
                or (by_name[name][0] if len(by_name.get(name, [])) == 1 else None))
        if info:
            want[c["id"]] = info
        else:
            unmatched[cat] += 1
    log.info(f"{len(want):,} chapters matched a brief; "
             f"unmatched {sum(unmatched.values()):,} {dict(unmatched)}")

    # A RESOLVED entry matching no chapter is reported, not ignored — the same
    # posture as SECTION_TITLES in mineru_book.py. It means the story or level was
    # renamed, so the override is now silently doing nothing.
    for key in sorted(set(RESOLVED) - used_resolved):
        log.warning(f"stale RESOLVED entry (matches no chapter): {key}")

    cache: dict[str, str] = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
        log.info(f"{len(cache):,} brief(s) already cached")

    todo = sorted({p for p in want.values() if p not in cache})
    if args.dry_run:
        log.info(f"--dry-run: would fetch {len(todo):,} brief(s) and write "
                 f"{len(want):,} row(s)")
        return

    log.info(f"fetching {len(todo):,} brief(s)")
    for i, info in enumerate(todo, 1):
        url = REPO + "story/" + urllib.parse.quote(f"[uc]{info}.txt")
        try:
            cache[info] = fetch(url).decode("utf-8").strip()
        except Exception as e:                                   # noqa: BLE001
            log.warning(f"  {info}: {e}")
            cache[info] = ""
        if i % 100 == 0 or i == len(todo):
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1),
                             encoding="utf-8")
            log.info(f"  {i}/{len(todo)}")
        time.sleep(DELAY)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1),
                     encoding="utf-8")

    if args.no_import:
        log.info("--no-import: cache written, nothing loaded")
        return

    rows = [{"chapter_id": cid, "source": SOURCE, "body": cache[info]}
            for cid, info in want.items() if cache.get(info)]
    log.info(f"upserting {len(rows):,} description(s)")
    for i in range(0, len(rows), 500):
        db.table("chapter_descriptions").upsert(
            rows[i:i + 500], on_conflict="chapter_id,source").execute()
        log.info(f"  {min(i + 500, len(rows)):,}/{len(rows):,}")
    log.info("done")


if __name__ == "__main__":
    main()
