"""
Import per-stage descriptions scraped from prts.wiki/w/情报处理室
into the chapter_descriptions table.

Matching:
  wiki  (story_name, level_code, 行动前/行动后/幕间)
        ↓
  chapter (story.name, level_code, BEG/END/NBT)

For 幕间 entries that don't have a matching NBT chapter, falls back to
any chapter with the same level_code and one of {ENTRY, SP1, SP2,
剧情, 剧情1, 剧情2}.

Unmatched entries are written to data/wiki_import_unmatched.json for
manual review (e.g. 链接=story/剧情 entries on the wiki that point at
prologue-style files whose level_code doesn't line up).

Usage:
    python scripts/import_wiki_descriptions.py
"""

import os
import json
import logging
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(Path(__file__).parent.parent / ".env.local")

ROOT       = Path(__file__).parent.parent
INPUT_JSON = ROOT / "data" / "story_descriptions.json"
UNMATCHED  = ROOT / "data" / "wiki_import_unmatched.json"
SOURCE     = "prts.wiki/情报处理室"
BATCH_SIZE = 200

WIKI_TO_FILE_STAGE = {
    "行动前": "BEG",
    "行动后": "END",
    "幕间":   "NBT",
}
# When 幕间 doesn't match the NBT row exactly, try these alternates.
INTERLUDE_FALLBACK_STAGES = {"NBT", "ENTRY", "SP1", "SP2", "剧情", "剧情1", "剧情2"}


logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)


def fetch_all(table: str, columns: str) -> list[dict]:
    """Page through a Supabase table that may exceed the default 1000-row cap."""
    rows: list[dict] = []
    page = 0
    while True:
        res = (supabase.table(table)
               .select(columns)
               .range(page * 1000, (page + 1) * 1000 - 1)
               .execute())
        rows.extend(res.data)
        if len(res.data) < 1000:
            return rows
        page += 1


def main() -> None:
    data = json.loads(INPUT_JSON.read_text(encoding="utf-8"))
    log.info(f"Loaded {len(data)} wiki stories from {INPUT_JSON.name}")

    # ---- Index DB rows in memory ------------------------------------------
    stories  = fetch_all("stories", "id, category, name")
    chapters = fetch_all("chapters", "id, story_id, level_code, stage")
    log.info(f"DB has {len(stories)} stories, {len(chapters)} chapters")

    story_id_map: dict[tuple[str, str], int] = {
        (s["category"], s["name"]): s["id"] for s in stories
    }

    # Exact (story_id, level_code, stage) → chapter_id
    chapter_exact: dict[tuple[int, str, str], int] = {}
    # Fallback: (story_id, level_code) → list[chapter] for 幕间 lookups
    chapter_by_code: dict[tuple[int, str], list[dict]] = {}
    for c in chapters:
        key_exact = (c["story_id"], c["level_code"] or "", c["stage"] or "")
        chapter_exact[key_exact] = c["id"]
        chapter_by_code.setdefault(
            (c["story_id"], c["level_code"] or ""), []
        ).append(c)

    # ---- Resolve & batch upsert -------------------------------------------
    pending: list[dict] = []
    unmatched: list[dict] = []
    resolved = 0

    for s in data:
        story_id = story_id_map.get((s["category"], s["story_name"]))
        if story_id is None:
            for e in s["stages"]:
                unmatched.append({
                    "reason":      "story_not_in_db",
                    "category":    s["category"],
                    "story_name":  s["story_name"],
                    "level_code":  e["level_code"],
                    "level_name":  e["level_name"],
                    "stage":       e["stage"],
                })
            continue

        for e in s["stages"]:
            file_stage = WIKI_TO_FILE_STAGE.get(e["stage"])
            level_code = e["level_code"] or ""

            chapter_id = chapter_exact.get((story_id, level_code, file_stage))

            if chapter_id is None and e["stage"] == "幕间":
                for c in chapter_by_code.get((story_id, level_code), []):
                    if c["stage"] in INTERLUDE_FALLBACK_STAGES:
                        chapter_id = c["id"]
                        break

            # Last-resort fallback for wiki ENTRY entries — these are the
            # global prologues whose on-disk filename is `1_<story>_剧情.txt`,
            # so the chapter row has level_code='' (not 'ENTRY') and stage='剧情'.
            # Land them on any (level_code='', stage in INTERLUDE_FALLBACK) chapter
            # belonging to the same story.
            if chapter_id is None and level_code == "ENTRY":
                for c in chapter_by_code.get((story_id, ""), []):
                    if c["stage"] in INTERLUDE_FALLBACK_STAGES:
                        chapter_id = c["id"]
                        break

            if chapter_id is None:
                unmatched.append({
                    "reason":      "chapter_not_found",
                    "category":    s["category"],
                    "story_name":  s["story_name"],
                    "level_code":  e["level_code"],
                    "level_name":  e["level_name"],
                    "stage":       e["stage"],
                    "expected_db_stage": file_stage,
                })
                continue

            pending.append({
                "chapter_id": chapter_id,
                "source":     SOURCE,
                "body":       e["description"],
            })
            resolved += 1

            if len(pending) >= BATCH_SIZE:
                _flush(pending)

    if pending:
        _flush(pending)

    UNMATCHED.write_text(
        json.dumps(unmatched, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log.info(f"Upserted: {resolved}")
    log.info(f"Unmatched: {len(unmatched)}  →  {UNMATCHED}")
    if unmatched:
        log.info("First few unmatched:")
        for u in unmatched[:5]:
            log.info(f"  {u}")


def _flush(batch: list[dict]) -> None:
    """Bulk upsert one batch into chapter_descriptions."""
    (supabase.table("chapter_descriptions")
     .upsert(batch, on_conflict="chapter_id,source")
     .execute())
    batch.clear()


if __name__ == "__main__":
    main()
