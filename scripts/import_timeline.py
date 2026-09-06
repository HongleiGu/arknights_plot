"""
Load data/timeline.json (scripts/scrape_terra_timeline.py) into `timeline_events`
(migration 039).

Replace-all, not upsert: the rows are wholly scrape-sourced with no hand-edits
to preserve, and `seq` — the source page's own ordering — shifts whenever the
wiki inserts an event in the middle. Upserting on `seq` would quietly
mis-attribute every row after an insertion. This is the import_events.py idiom
(replace-per-theme) applied to a single-source table.

A missing data/timeline.json is a no-op, not an error, matching every other
importer so the pipeline can run before anything is scraped.

Reference resolution
--------------------
Citations are matched on the **plot file basename**, not on
(level_code, level_name, stage) separately. `chapters.file_path` is UNIQUE and
already encodes the exact on-disk convention, so one normalised key covers:

  * ordinary levels          [[GT-1 日正当中/BEG]]      -> GT-1 日正当中_BEG
  * compound stages          [[15-17 “她”/END/SP2]]     -> 15-17 “她”_END_SP2
  * safe_name()-sanitised    [[7-1 32:00:00/NBT]]       -> 7-1 32_00_00_NBT

That last case is why this beats matching the columns: scrape_plots.py strips
Windows-illegal characters, so four 主线 levels carry colons on the wiki and
underscores in the DB. Normalising `:` to `_` resolves them, taking chapter
coverage from 98.9% to 100% of what exists locally.

干员密录 refs ([[凛冬/干员密录/1]]) resolve by (story name, order_in_story)
under category 干员. Plain page / anchor refs resolve to a story when the page
title is a story name; otherwise they are kept unresolved rather than guessed.

Unresolved citations are NOT dropped — `refs` keeps every one. An event whose
citations point at an operator dossier we have not imported is still an event
with evidence, and dropping the citation would make it look unsourced.

Dependencies:
    pip install supabase python-dotenv     (already in the `study` conda env)

.env at the project root needs:
    SUPABASE_URL=https://[ref].supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...

Usage:
    conda run -n study python scripts/import_timeline.py
    conda run -n study python scripts/import_timeline.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
from collections import Counter, defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

try:
    from postgrest.exceptions import APIError
except Exception:                       # import path varies across versions
    APIError = None                     # type: ignore[assignment,misc]

ROOT          = Path(__file__).parent.parent
TIMELINE_JSON = ROOT / "data" / "timeline.json"

load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

MAX_RETRIES   = 5
RETRY_BACKOFF = 2.0
CHUNK         = 200
# PostgREST caps a response at 1000 rows and says nothing about it, so every
# full-table read here pages explicitly. Silently truncating the chapter index
# would look like a wiki layout change instead of a paging bug.
PAGE          = 1000


def _execute(query, what: str):
    """`query.execute()` with retry/backoff; a server rejection re-raises."""
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return query.execute()
        except Exception as e:                      # noqa: BLE001
            if APIError is not None and isinstance(e, APIError):
                raise
            last = e
            if attempt == MAX_RETRIES - 1:
                break
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"  retry {attempt+1}/{MAX_RETRIES} for {what} "
                        f"after {wait:.0f}s ({type(e).__name__})")
            time.sleep(wait)
    raise RuntimeError(f"{what} failed after {MAX_RETRIES} attempts") from last


def fetch_all(db: Client, table: str, cols: str) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        got = _execute(db.table(table).select(cols).range(start, start + PAGE - 1),
                       f"select {table}").data or []
        rows.extend(got)
        if len(got) < PAGE:
            return rows
        start += PAGE


# ---------------------------------------------------------------------------
# Key normalisation
# ---------------------------------------------------------------------------

# The characters scrape_plots.py:safe_name() strips for Windows. Mapping them
# to '_' makes a wiki title and its on-disk form converge.
ILLEGAL = str.maketrans({c: "_" for c in ':*?"<>|：'})


def norm_key(s: str) -> str:
    s = s.translate(ILLEGAL)
    return re.sub(r"\s+", " ", s.replace("_", " ")).strip().lower()


def basename_key(file_path: str) -> str:
    """`支线\\骑兵与猎人\\1_GT-1 日正当中_BEG.txt` -> normalised `GT-1 日正当中_BEG`.

    Separator is a BACKSLASH — parse_plots.py stores the path as Windows built
    it, so splitting on '/' alone silently matches nothing.
    """
    return norm_key(_stem(file_path))


def _stem(file_path: str) -> str:
    stem = re.split(r"[\\/]", file_path)[-1]
    stem = re.sub(r"\.txt$", "", stem)
    return re.sub(r"^\d+_", "", stem)


STAGE_TOKENS = re.compile(r"_(?:BEG|END|NBT|ENTRY|SP\d|剧情\d?)$")

# "序章 黑暗时代·上" -> "黑暗时代·上". The wiki writes the chapter designation
# into the link text; the story name is what follows it.
CHAPTER_PREFIX = re.compile(r"^(?:序章|终章|第[一二三四五六七八九十百零〇\d]+章)\s*")


def level_key(file_path: str) -> str:
    """
    Basename with the stage suffix removed: `PA-ST-1 群氓_NBT` -> `PA-ST-1 群氓`.

    Stripped from the END, repeatedly, rather than by splitting on the first
    `_`: a sanitised level name can itself contain underscores
    (`7-1 32_00_00_NBT`), and compound stages append two (`…_END_SP2`).
    """
    stem = _stem(file_path)
    while True:
        stripped = STAGE_TOKENS.sub("", stem)
        if stripped == stem:
            return norm_key(stem)
        stem = stripped


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def build_index(db: Client):
    log.info("indexing chapters + stories …")
    stories = fetch_all(db, "stories", "id, name, category")
    chapters = fetch_all(db, "chapters", "id, story_id, file_path, order_in_story")
    log.info(f"  {len(stories)} stories, {len(chapters)} chapters")

    story_by_id = {s["id"]: s for s in stories}
    # A story name can repeat across categories; keep every candidate and let
    # the citation's own hint choose.
    story_by_name: dict[str, list[dict]] = defaultdict(list)
    for s in stories:
        story_by_name[norm_key(s["name"])].append(s)

    by_basename: dict[str, list[dict]] = defaultdict(list)
    # Stage-less: the wiki also links bare level pages ([[PA-ST-1 群氓]]) for
    # levels that only ship one stage.
    by_level: dict[str, list[dict]] = defaultdict(list)
    by_milv: dict[tuple[str, int], dict] = {}
    for c in chapters:
        fp = c.get("file_path") or ""
        by_basename[basename_key(fp)].append(c)
        by_level[level_key(fp)].append(c)
        s = story_by_id.get(c["story_id"])
        if s and s.get("category") == "干员":
            by_milv[(norm_key(s["name"]), c["order_in_story"])] = c
    return story_by_id, story_by_name, by_basename, by_level, by_milv


def resolve(ev: dict, story_by_id, story_by_name, by_basename, by_level, by_milv,
            stats: Counter) -> list[str]:
    """Citations to `@type/id` tokens, in first-seen order, de-duplicated."""
    tokens: list[str] = []

    def add(tok: str) -> None:
        if tok not in tokens:
            tokens.append(tok)

    def pick_chapter(cands: list[dict], hint: str | None) -> dict | None:
        if len(cands) == 1:
            return cands[0]
        if hint:
            h = norm_key(hint)
            for c in cands:
                s = story_by_id.get(c["story_id"])
                if s and norm_key(s["name"]) == h:
                    return c
        return None

    for r in ev.get("refs") or []:
        kind, page, hint = r.get("kind"), r.get("page"), r.get("story_hint")

        if kind == "chapter":
            key = norm_key(f"{page}_{r.get('stage')}")
            cands = by_basename.get(key, [])
            c = pick_chapter(cands, hint)
            if c:
                add(f"@chapter/{c['id']}")
                stats["chapter_ok"] += 1
            else:
                stats["chapter_ambiguous" if cands else "chapter_missing"] += 1

        elif kind == "milv":
            c = by_milv.get((norm_key(page or ""), r.get("ordinal") or -1))
            if c:
                add(f"@chapter/{c['id']}")
                stats["milv_ok"] += 1
            else:
                stats["milv_missing"] += 1

        elif kind in ("page", "anchor"):
            p = page or ""
            # 1. the page IS a story        [[孤星]]
            cands = story_by_name.get(norm_key(p), [])
            # 2. a story's sub-page          [[孤星/综合调查数据库#邮件]]
            if not cands and "/" in p:
                cands = story_by_name.get(norm_key(p.split("/", 1)[0]), [])
            if len(cands) == 1:
                add(f"@story/{cands[0]['id']}")
                stats[f"{kind}_ok"] += 1
            else:
                # 3. a bare level page with no stage suffix  [[PA-ST-1 群氓]]
                ch = pick_chapter(by_level.get(norm_key(p), []), hint)
                # 4. the LINK TEXT names a story even though the target is a
                #    wiki index page: [[剧情一览|序章 黑暗时代·上]]. Worth the
                #    extra step — that idiom carries the 切尔诺伯格 arc, some of
                #    the most-cited events on the page. Exact match only, after
                #    dropping a chapter designation; no fuzzy matching, since a
                #    wrong link reads as grounded.
                lab_cands = story_by_name.get(norm_key(CHAPTER_PREFIX.sub("", r.get("label") or "")), [])
                if ch:
                    add(f"@chapter/{ch['id']}")
                    stats["level_ok"] += 1
                elif len(lab_cands) == 1:
                    add(f"@story/{lab_cands[0]['id']}")
                    stats["label_ok"] += 1
                else:
                    stats[f"{kind}_ambiguous" if cands else f"{kind}_missing"] += 1

        else:
            stats[f"{kind}_kept"] += 1

        # The story named before the colon is evidence in its own right, and it
        # is what makes an unresolvable level still point somewhere useful.
        if hint:
            cands = story_by_name.get(norm_key(hint), [])
            if len(cands) == 1:
                add(f"@story/{cands[0]['id']}")

    return tokens


def main() -> None:
    ap = argparse.ArgumentParser(description="Import 泰拉年表 into timeline_events.")
    ap.add_argument("--dry-run", action="store_true",
                    help="resolve and report, but write nothing")
    args = ap.parse_args()

    if not TIMELINE_JSON.exists():
        log.info(f"{TIMELINE_JSON.relative_to(ROOT)} not found — nothing to import")
        return

    payload = json.loads(TIMELINE_JSON.read_text(encoding="utf-8"))
    events = payload.get("events") or []
    if not events:
        log.info("timeline.json has no events — nothing to import")
        return

    db: Client = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    idx = build_index(db)

    stats: Counter = Counter()
    rows = []
    for ev in events:
        refs = resolve(ev, *idx, stats)
        rows.append({
            "seq": ev["seq"],
            "era": ev.get("era"), "section": ev.get("section"),
            "period": ev.get("period"), "date_label": ev.get("date_label"),
            "year": ev.get("year"), "month": ev.get("month"), "day": ev.get("day"),
            "precision": ev.get("precision") or "era",
            "approx": bool(ev.get("approx")),
            "calendar": ev.get("calendar") or "terra",
            "description": ev["description"],
            "source_refs": refs,
            "refs": ev.get("refs") or [],
        })

    cited = sum(1 for r in rows if r["source_refs"])
    log.info(f"{len(rows)} event(s); {cited} with at least one resolved citation "
             f"({cited/len(rows)*100:.1f}%)")
    for k, v in sorted(stats.items()):
        log.info(f"  {k}: {v}")

    if args.dry_run:
        log.info("--dry-run: nothing written")
        return

    # Replace-all. `seq` is UNIQUE, so a stale row left behind would collide
    # with the new one occupying that slot — delete first, no partial states.
    log.info("clearing timeline_events …")
    _execute(db.table("timeline_events").delete().neq("id", 0), "delete timeline_events")

    done = 0
    for i in range(0, len(rows), CHUNK):
        batch = rows[i:i + CHUNK]
        _execute(db.table("timeline_events").insert(batch), "insert timeline_events")
        done += len(batch)
        log.info(f"    inserted {done}/{len(rows)}")
    log.info("done")


if __name__ == "__main__":
    main()
