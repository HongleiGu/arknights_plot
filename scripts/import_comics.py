"""
Load data/comics.json (scripts/scrape_comics.py) into `stories` + `chapters`
as category 漫画 (AP-32).

Shape decision
--------------
A comic series is a `stories` row and an episode is a `chapters` row. No new
table: an episode really is a chapter of the series, it just has no imported
text yet — AP-33 adds panel text later, and when it does it attaches to a
chapter that already exists rather than forcing a migration.

`chapters.file_path` is NOT NULL UNIQUE and there is no file on disk here, so
it carries a synthetic key in the same backslash-separated shape parse_plots.py
writes. That key is what makes the import idempotent: chapters upsert on
file_path rather than being deleted and re-inserted, so a re-run cannot destroy
panel text AP-33 has attached, and stories upsert on (category, name).

`arc` is the series prefix before the full-width colon (循途漫录：大将军，出击！
-> 循途漫录). That is the grouping the site itself uses, it costs nothing, and
the field already exists for exactly this.

Covers are not uploaded: every other image in this project is a sha1 of a
data/-relative path pushed to R2 by an upload_*.py script, and doing it here
inconsistently would be worse than not doing it. The cover URL is preserved in
comics.json for whenever that script is written.

A missing data/comics.json is a no-op, not an error, matching every other
importer.

Usage:
    conda run -n study python scripts/import_comics.py
    conda run -n study python scripts/import_comics.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

try:
    from postgrest.exceptions import APIError
except Exception:                       # import path varies across versions
    APIError = None                     # type: ignore[assignment,misc]

ROOT        = Path(__file__).parent.parent
COMICS_JSON = ROOT / "data" / "comics.json"
CATEGORY    = "漫画"

load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

MAX_RETRIES   = 5
RETRY_BACKOFF = 2.0
CHUNK         = 200


def _execute(query, what: str):
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return query.execute()
        except Exception as e:                       # noqa: BLE001
            if APIError is not None and isinstance(e, APIError):
                raise
            last = e
            if attempt == MAX_RETRIES - 1:
                break
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"  retry {attempt+1}/{MAX_RETRIES} for {what} after {wait:.0f}s")
            time.sleep(wait)
    raise RuntimeError(f"{what} failed after {MAX_RETRIES} attempts") from last


def arc_of(title: str) -> str | None:
    """循途漫录：大将军，出击！ -> 循途漫录 (the site's own series grouping)."""
    for sep in ("：", ":"):
        if sep in title:
            head = title.split(sep, 1)[0].strip()
            if head:
                return head
    # 罗德岛源石记事——黑钢 uses a dash instead of a colon.
    for sep in ("——", "—"):
        if sep in title:
            head = title.split(sep, 1)[0].strip()
            if head:
                return head
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Import 泰拉记事社 comics.")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    if not COMICS_JSON.exists():
        log.info(f"{COMICS_JSON.relative_to(ROOT)} not found — nothing to import")
        return
    series = json.loads(COMICS_JSON.read_text(encoding="utf-8")).get("series") or []
    if not series:
        log.info("comics.json has no series — nothing to import")
        return

    db: Client = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    story_rows = []
    for i, s in enumerate(series):
        title = s["title"]
        story_rows.append({
            "category": CATEGORY,
            "name": title,
            # NOT NULL; the Chinese name is the placeholder parse_plots.py uses
            # when there is no English subtitle to put here.
            "name_en": s.get("subtitle") or title,
            "description": s.get("introduction"),
            "arc": arc_of(title),
            "seq": i + 1,
        })

    total_eps = sum(len(s.get("episodes") or []) for s in series)
    log.info(f"{len(story_rows)} series / {total_eps} episodes")
    if args.dry_run:
        for r in story_rows[:5]:
            log.info(f"  {r['arc'] or '-':<12} {r['name']}")
        log.info("--dry-run: nothing written")
        return

    _execute(db.table("stories").upsert(story_rows, on_conflict="category,name"),
             "upsert stories")

    # Read the ids back: upsert does not reliably return them across
    # postgrest-py versions, and a second read is cheap next to guessing.
    ids = {}
    got = _execute(db.table("stories").select("id, name").eq("category", CATEGORY),
                   "select stories").data or []
    for r in got:
        ids[r["name"]] = r["id"]

    chapter_rows = []
    for s in series:
        sid = ids.get(s["title"])
        if not sid:
            log.warning(f"  {s['title']}: no story id after upsert")
            continue
        for i, e in enumerate(s.get("episodes") or [], 1):
            ep_title = e.get("title") or e.get("shortTitle") or f"#{i}"
            chapter_rows.append({
                "story_id": sid,
                "level_code": e.get("shortTitle"),
                "level_name": ep_title,
                "stage": None,
                "file_path": f"{CATEGORY}\\{s['title']}\\{i}_{ep_title}.comic",
                "order_in_story": i,
            })

    done = 0
    for i in range(0, len(chapter_rows), CHUNK):
        batch = chapter_rows[i:i + CHUNK]
        _execute(db.table("chapters").upsert(batch, on_conflict="file_path"),
                 "upsert chapters")
        done += len(batch)
        log.info(f"    upserted {done}/{len(chapter_rows)} episodes")
    log.info("done")


if __name__ == "__main__":
    main()
