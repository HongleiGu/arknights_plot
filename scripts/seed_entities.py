"""
Seed the `entities` table with a grounded CHARACTER skeleton, derived from who
actually speaks in the plots (`nodes.speaker`) rather than scraped blind from
the wiki. This is the P1 skeleton for AP-22's world graph — names come straight
from canon dialogue, so every character is provably real.

Later phases enrich these rows (aliases, name_en, summary) and extract
relationships into `entity_relations`; this script only creates the nodes.

Strategy
--------
  - Read every speech node's speaker, tally line counts.
  - Drop non-characters: narrator, unknown markers (？？？ / ???), blanks, and
    pure-symbol speakers.
  - Upsert one entities row per speaker (type='character', UNIQUE(type,name)),
    storing the line count as mention_count for ranking. Idempotent.

Apply supabase/migrations/026_entities.sql before running.

Dependencies: pip install supabase python-dotenv
.env needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

Usage:
    python scripts/seed_entities.py              # upsert (idempotent)
    python scripts/seed_entities.py --min 2      # skip speakers with <2 lines
    python scripts/seed_entities.py --dry-run    # print, don't write
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(Path(__file__).parent.parent / ".env")

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# Speakers that are not characters.
EXCLUDE = {"narrator", "？？？", "???", "??？", "？？", ""}
PAGE = 1000
BATCH = 200


def _clean(speaker: str | None) -> str | None:
    s = (speaker or "").strip()
    if s in EXCLUDE:
        return None
    # pure punctuation / symbols → not a character
    if not any(ch.isalnum() for ch in s):
        return None
    return s


def collect_speakers() -> dict[str, int]:
    """speaker -> line count, over all speech nodes (paged)."""
    counts: dict[str, int] = {}
    start = 0
    while True:
        # No server-side null filter (supabase-py's .not_.is_ varies by version);
        # _clean() drops null/blank/non-character speakers instead.
        rows = (
            supabase.table("nodes")
            .select("speaker")
            .eq("type", "speech")
            .range(start, start + PAGE - 1)
            .execute()
            .data
        )
        if not rows:
            break
        for r in rows:
            name = _clean(r.get("speaker"))
            if name:
                counts[name] = counts.get(name, 0) + 1
        if len(rows) < PAGE:
            break
        start += PAGE
    log.info(f"scanned speakers; {len(counts)} distinct after cleaning")
    return counts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=int, default=1, help="minimum line count to include")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    counts = collect_speakers()
    chosen = {name: c for name, c in counts.items() if c >= args.min}
    log.info(f"{len(counts)} distinct speakers, {len(chosen)} kept (min={args.min})")

    # Only seed-owned fields go in the payload — omit summary/summary_status/
    # aliases so a re-run never clobbers later enrichment (ON CONFLICT DO UPDATE
    # only touches provided columns; the rest keep their defaults on insert).
    rows = [
        {
            "type": "character",
            "name": name,
            "mention_count": c,
            "raw": {"source": "speaker", "line_count": c},
        }
        for name, c in sorted(chosen.items(), key=lambda kv: -kv[1])
    ]

    if args.dry_run:
        for r in rows[:40]:
            log.info(f"  {r['mention_count']:>5}  {r['name']}")
        log.info(f"(dry-run) would upsert {len(rows)} character entities")
        return

    # Upsert in batches on the (type, name) unique key. Don't clobber
    # mention_count downward if a row was later enriched — but for the seed
    # we always refresh the count.
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        for attempt in range(5):
            try:
                supabase.table("entities").upsert(chunk, on_conflict="type,name").execute()
                break
            except Exception as exc:  # noqa: BLE001
                if attempt == 4:
                    raise
                wait = 2.0 * (2 ** attempt)
                log.warning(f"batch {i//BATCH}: retry after {wait:.0f}s ({exc})")
                time.sleep(wait)
        log.info(f"upserted {min(i + BATCH, len(rows))}/{len(rows)}")

    log.info("done.")


if __name__ == "__main__":
    main()
