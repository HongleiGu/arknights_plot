"""
Import the 集成战略 event catalog from data/events.json into the `events` +
`event_options` tables (migration 007).

data/events.json is produced by scripts/scrape_events.py — a list of theme
blocks, each with a nested option tree:

    [ { "category": "集成战略", "story": "<theme>",
        "events": [ { "category", "name", "name_en", "intro", "image",
                      "seq", "raw",
                      "options": [ { "seq", "label", "description",
                                     "predicate", "note", "outcome", "raw",
                                     "options": [ …children… ] } ] } ] } ]

`events` rows are uniquely keyed (story_id, name, seq); `event_options` is a
self-referencing tree (parent_option_id NULL = a top-level choice). Because
the tree uses generated ids, this importer is **replace-per-theme**: every
listed theme's events are deleted (ON DELETE CASCADE clears event_options)
then re-inserted. That is idempotent — re-running yields the same DB state —
and matches events being wholly sourced from the scrape (no hand-edits).

Dependencies: pip install supabase python-dotenv
.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Usage:
    python scripts/import_events.py            # replace each listed theme
    python scripts/import_events.py --force     # (alias; same behaviour)

If data/events.json is absent the script logs and exits 0, so it is safe as
a pipeline step before the file exists.
"""

import os
import json
import time
import logging
import argparse
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

try:
    from postgrest.exceptions import APIError
except Exception:                       # import path varies across versions
    APIError = None                     # type: ignore[assignment,misc]

load_dotenv(Path(__file__).parent.parent / ".env")

EVENTS_JSON = Path(__file__).parent.parent / "data" / "events.json"

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

MAX_RETRIES   = 5
RETRY_BACKOFF = 2.0   # seconds, doubled each retry → 2, 4, 8, 16


def _execute(query, what: str):
    """`query.execute()` with retry/backoff for transient network failures.
    Re-raises a postgrest APIError immediately (server rejected it)."""
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return query.execute()
        except Exception as e:
            if APIError is not None and isinstance(e, APIError):
                raise
            last_exc = e
            if attempt == MAX_RETRIES - 1:
                break
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"{what}: retry {attempt+1}/{MAX_RETRIES} after "
                        f"{wait:.0f}s ({type(e).__name__}: {e})")
            time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def story_id_for(category: str, name: str) -> int | None:
    res = _execute(
        supabase.table("stories").select("id")
                .eq("category", category).eq("name", name).limit(1),
        f"lookup story {category}/{name}")
    return res.data[0]["id"] if res.data else None


def insert_options(event_id: int, parent_id: int | None,
                   options: list[dict]) -> int:
    """Insert one sibling level, then recurse into each child. Returns the
    total number of option rows written."""
    written = 0
    for o in options:
        row = {
            "event_id":         event_id,
            "parent_option_id": parent_id,
            "seq":              o.get("seq", 0),
            "label":            o.get("label"),
            "description":      o.get("description"),
            "predicate":        o.get("predicate"),
            "note":             o.get("note"),
            "outcome":          o.get("outcome"),
            "raw":              o.get("raw") or None,
        }
        res = _execute(
            supabase.table("event_options").insert(row),
            f"insert option (event {event_id}, parent {parent_id})")
        oid = res.data[0]["id"]
        written += 1
        children = o.get("options") or []
        if children:
            written += insert_options(event_id, oid, children)
    return written


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="(alias) import is always replace-per-theme")
    ap.parse_args()

    if not EVENTS_JSON.exists():
        log.info(f"(no {EVENTS_JSON.name} on disk — nothing to import, skipping)")
        return

    themes = json.loads(EVENTS_JSON.read_text(encoding="utf-8"))
    n_events = n_options = skipped = 0

    for theme in themes:
        category = theme["category"]
        story    = theme["story"]
        events   = theme.get("events", [])

        sid = story_id_for(category, story)
        if sid is None:
            log.warning(f"no stories row for {category}/{story} — run "
                        f"parse_plots first; skipping {len(events)} events")
            skipped += len(events)
            continue

        # Replace this theme's events wholesale (cascade clears options).
        _execute(supabase.table("events").delete().eq("story_id", sid),
                 f"wipe events for {story}")

        for ev in events:
            res = _execute(
                supabase.table("events").insert({
                    "story_id": sid,
                    "category": ev.get("category"),
                    "name":     ev["name"],
                    "name_en":  ev.get("name_en"),
                    "intro":    ev.get("intro"),
                    "image":    ev.get("image"),
                    "seq":      ev.get("seq", 0),
                    "raw":      ev.get("raw") or None,
                }),
                f"insert event {story}/{ev.get('name')}")
            eid = res.data[0]["id"]
            n_events += 1
            n_options += insert_options(eid, None, ev.get("options") or [])

        log.info(f"{category}/{story}: {len(events)} events")

    log.info(f"Done. {n_events} events, {n_options} options imported"
             + (f", {skipped} skipped (missing story)" if skipped else ""))


if __name__ == "__main__":
    main()
