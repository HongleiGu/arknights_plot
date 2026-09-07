"""
Load data/book_sections.json (scripts/structure_book.py) into
`stories` + `text_clusters` + `text_chunks` as the 设定集 大地巡旅 (AP-31).

Shape decision
--------------
This is supplementary prose belonging to no story's script, which is exactly
what 008 exists for — so no migration. One `stories` row for the book, one
`text_clusters` row per section, one `text_chunks` row per printed page.

`level_code` carries the book's own section number (5.10.1, 6.Extra). That is
not cosmetic: 泰拉年表 cites this book as 「大地巡旅：6.Extra 罗德岛」, so the
number is the join key that lets those 155 timeline citations resolve to a
section rather than to the book as a whole.

A chunk per printed page rather than per paragraph keeps the page number, and
the page number is how a claim gets checked against a physical copy.

Idempotent by replace-per-kind: the book's clusters are deleted and re-inserted
(chunks cascade). That is the import_events.py idiom and it is safe here for
the same reason — the rows are wholly derived from the OCR, so there are no
hand-edits to preserve. Re-running after a better OCR pass is the intended way
to update.

NOTE ON PUBLICATION: this is a commercially published book (ISBN
978-7-5514-4726-3). Importing it makes it searchable by the assistant and the
entity graph; it does NOT put it on a public page. Whether any of it is
publicly readable is a frontend decision, deliberately not made here.

Usage:
    conda run -n study python scripts/import_book.py
    conda run -n study python scripts/import_book.py --dry-run
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

ROOT       = Path(__file__).parent.parent
BOOK_JSON  = ROOT / "data" / "book_sections.json"

CATEGORY   = "设定集"
KIND       = "lore_book"
DESCRIPTION = ("《大地巡旅：〈明日方舟〉官方世界观设定集》，2023 年 10 月，"
               "浙江摄影出版社。涵盖源石、天灾、矿石病、泰拉科技、生物、种族、"
               "国家地区与组织，并含凯尔希的批注。本站文本由扫描件 OCR 得到，"
               "可能存在识别错误。")

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


def main() -> None:
    ap = argparse.ArgumentParser(description="Import the 大地巡旅 settings book.")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    if not BOOK_JSON.exists():
        log.info(f"{BOOK_JSON.relative_to(ROOT)} not found — nothing to import")
        return
    doc = json.loads(BOOK_JSON.read_text(encoding="utf-8"))
    sections = doc.get("sections") or []
    if not sections:
        log.info("book_sections.json has no sections — nothing to import")
        return

    chunks_total = sum(len(s["chunks"]) for s in sections)
    chars_total = sum(s["chars"] for s in sections)
    log.info(f"{len(sections)} sections / {chunks_total} pages / {chars_total:,} chars")
    if args.dry_run:
        log.info("--dry-run: nothing written")
        return

    db: Client = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    _execute(db.table("stories").upsert({
        "category": CATEGORY,
        "name": doc["title"],
        "name_en": doc.get("title_en") or doc["title"],
        "description": DESCRIPTION,
        "seq": 1,
    }, on_conflict="category,name"), "upsert story")
    got = _execute(db.table("stories").select("id")
                   .eq("category", CATEGORY).eq("name", doc["title"]).limit(1),
                   "select story").data
    if not got:
        log.error("story row missing after upsert")
        return
    story_id = got[0]["id"]

    # Replace-per-kind. Chunks cascade, so this cannot leave orphans.
    log.info("clearing existing clusters …")
    _execute(db.table("text_clusters").delete()
             .eq("story_id", story_id).eq("kind", KIND), "delete clusters")

    cluster_rows = [{
        "story_id": story_id,
        "kind": KIND,
        "title": s["title"],
        "title_en": s["title_en"],
        "level_code": s["number"],
        "seq": i + 1,
        "raw": {"chapter": s["chapter"], "depth": s["depth"],
                "page_start": s["page_start"], "page_end": s["page_end"]},
    } for i, s in enumerate(sections)]
    inserted = _execute(db.table("text_clusters").insert(cluster_rows),
                        "insert clusters").data or []
    by_code = {r["level_code"]: r["id"] for r in inserted}
    log.info(f"  {len(inserted)} cluster(s)")

    chunk_rows = []
    for s in sections:
        cid = by_code.get(s["number"])
        if not cid:
            log.warning(f"  section {s['number']}: no cluster id")
            continue
        for c in s["chunks"]:
            chunk_rows.append({
                "cluster_id": cid,
                # The printed page number, not a running index — a citation to
                # a book is checked by page.
                "seq": c["page"],
                "title": f"P{c['page']}",
                "body": c["text"],
            })

    done = 0
    for i in range(0, len(chunk_rows), CHUNK):
        _execute(db.table("text_chunks").insert(chunk_rows[i:i + CHUNK]),
                 "insert chunks")
        done += len(chunk_rows[i:i + CHUNK])
        log.info(f"    inserted {done}/{len(chunk_rows)} page(s)")
    log.info("done")


if __name__ == "__main__":
    main()
