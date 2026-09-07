"""
Load data/book_sections.json (scripts/structure_book.py) into the existing
content model as category 大地巡旅 (AP-31).

    book chapter  ->  stories   (6 numbered + a synthetic 附录)
    section       ->  chapters
    paragraph     ->  nodes     (type='subtitle', speaker='narrator')
    illustration  ->  nodes     (type='cgitem', raw_params) — AP-34

Why this shape and not 008's text_clusters/text_chunks
------------------------------------------------------
The first cut used text_clusters/text_chunks, which is what 008 exists for. The
deciding argument against it is that the alternative needs a migration and this
does not: to comment on a paragraph, `comment_anchors` would have to gain a
`text_chunk_id` column, whereas `chapter_id` and `node_id` are already there.
Reusing stories/chapters/nodes also inherits the chapter reader, `@chapter/N`
and `@node/N` citations, and CiteSearch — none of which text_chunks has.

There is a content-shape argument too. 008 is for short adjuncts appended to a
chapter (ending epilogues, character dossiers). This is 6 chapters × 61
sections × 441 pages of standalone hierarchical prose, and hierarchy plus
length is exactly what stories/chapters model.

The cost, worth stating because it is real: `nodes` is AVG-script shaped.
`scene_id`, `branch_id`, the `no_decision_in_branch` constraint and `speaker`
are all meaningless for book prose, and this is the table's first non-script
tenant — so 18k rows here are narration, not dialogue. The one thing that
actually reads `nodes.speaker` is seed_entities.py, which already excludes
'narrator', so it stays correct.

`raw_params.page` carries the printed page number. `nodes.seq` is paragraph
order, so without this the page — the only way to check a claim against a
physical copy — would be lost.

Idempotent: the category's chapters are deleted (nodes cascade) and re-inserted,
while stories are upserted on (category, name) so their ids survive. Rows are
wholly OCR-derived, so there are no hand-edits to preserve; re-running after a
better OCR pass is the intended way to update.

NOTE: this is a commercially published book (ISBN 978-7-5514-4726-3). Importing
makes it searchable by the assistant and the graph; whether any of it is
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

ROOT      = Path(__file__).parent.parent
BOOK_JSON = ROOT / "data" / "book_sections.json"

CATEGORY = "大地巡旅"
# The first cut of this import; removed so the book does not exist twice.
LEGACY_CATEGORY = "设定集"

load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

MAX_RETRIES   = 5
RETRY_BACKOFF = 2.0
CHUNK         = 500


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
    chapters = doc.get("chapters") or []
    if not sections or not chapters:
        log.info("book_sections.json has no chapters/sections — nothing to import")
        return

    paras = sum(len(s["chunks"]) for s in sections)
    log.info(f"{len(chapters)} chapters / {len(sections)} sections / {paras} paragraphs "
             f"/ {sum(s['chars'] for s in sections):,} chars")
    if args.dry_run:
        for c in chapters:
            n = sum(1 for s in sections if s["chapter"] == c["number"])
            log.info(f"  {c['number']:<6} {str(c['title'])[:18]:<20} {n} section(s)")
        log.info("--dry-run: nothing written")
        return

    db: Client = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Drop the earlier text_clusters shape (chunks cascade).
    legacy = _execute(db.table("stories").select("id")
                      .eq("category", LEGACY_CATEGORY), "select legacy").data or []
    if legacy:
        log.info(f"removing {len(legacy)} legacy {LEGACY_CATEGORY} story row(s)")
        _execute(db.table("stories").delete()
                 .in_("id", [r["id"] for r in legacy]), "delete legacy")

    story_rows = [{
        "category": CATEGORY,
        "name": c["title"] or c["number"],
        "name_en": c["title_en"] or c["title"] or c["number"],
        "description": None,
        "arc": doc["title"],
        "seq": i + 1,
    } for i, c in enumerate(chapters)]
    _execute(db.table("stories").upsert(story_rows, on_conflict="category,name"),
             "upsert stories")

    got = _execute(db.table("stories").select("id, name").eq("category", CATEGORY),
                   "select stories").data or []
    story_id = {r["name"]: r["id"] for r in got}
    by_number = {c["number"]: (c["title"] or c["number"]) for c in chapters}

    # Replace the chapters wholesale; nodes cascade, so no orphans are possible.
    log.info("clearing existing chapters …")
    _execute(db.table("chapters").delete().in_("story_id", list(story_id.values())),
             "delete chapters")

    chapter_rows, order = [], {}
    for s in sections:
        name = by_number.get(s["chapter"])
        sid = story_id.get(name) if name else None
        if not sid:
            log.warning(f"  section {s['number']}: no story for chapter {s['chapter']}")
            continue
        order[s["chapter"]] = order.get(s["chapter"], 0) + 1
        chapter_rows.append({
            "story_id": sid,
            "level_code": s["number"],
            "level_name": s["title"],
            "stage": None,
            "file_path": f"{CATEGORY}\\{name}\\{order[s['chapter']]}_{s['number']}.book",
            "order_in_story": order[s["chapter"]],
        })
    _execute(db.table("chapters").insert(chapter_rows), "insert chapters")

    made = _execute(db.table("chapters").select("id, level_code, story_id")
                    .in_("story_id", list(story_id.values())), "select chapters").data or []
    chapter_id = {r["level_code"]: r["id"] for r in made}
    log.info(f"  {len(made)} chapter(s)")

    node_rows = []
    for s in sections:
        cid = chapter_id.get(s["number"])
        if not cid:
            continue
        for i, c in enumerate(s["chunks"], 1):
            node_rows.append({
                "chapter_id": cid,
                "seq": i,
                "type": "subtitle",          # plain display text, not dialogue
                "speaker": "narrator",
                "content": c["text"],
                # seq is paragraph order; the printed page lives here or nowhere.
                "raw_params": {"page": c["page"], "source": "ocr"},
            })

    done = 0
    for i in range(0, len(node_rows), CHUNK):
        _execute(db.table("nodes").insert(node_rows[i:i + CHUNK]), "insert nodes")
        done += len(node_rows[i:i + CHUNK])
        log.info(f"    inserted {done}/{len(node_rows)} paragraph(s)")
    log.info("done")


if __name__ == "__main__":
    main()
