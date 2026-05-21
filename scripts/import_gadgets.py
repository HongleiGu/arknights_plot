"""
Import of the gadget catalog (集成战略 / 生息演算 relics, squads, endings,
tools, …) from data/gadgets.json into the `gadgets` table.

data/gadgets.json is produced by scripts/scrape_gadgets.py (relic catalogs for
all 6 集成战略 themes; squads/trader are registered parser slots). The catalog
per theme is fixed and finite, so this import is upsert-only and idempotent —
re-running refreshes fields, never duplicates. Manual hand-edits to
gadgets.json are still respected: re-running the scraper without --force skips
themes already populated for a given parser, so it won't clobber them.

Dependencies:
    pip install supabase python-dotenv

.env at the project root needs:
    SUPABASE_URL=https://[ref].supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...

Usage:
    python scripts/import_gadgets.py            # upsert (idempotent)
    python scripts/import_gadgets.py --force    # delete each theme's gadgets first, then insert

Input file: data/gadgets.json — a list of theme objects:

    [
      {
        "category": "集成战略",
        "story": "岁的界园志异",
        "gadgets": [
          {
            "kind": "relic",          // relic|squad|ending|tool|recruit|other
            "name": "...",
            "name_en": "...",         // optional
            "description": "...",     // flavour text, optional
            "effect": "...",          // mechanical effect, optional
            "icon_sha1": null,        // 40-hex storage key, optional
            "seq": 1,                 // display order within (story, kind), optional
            "raw": {                  // theme-specific extras, optional; the
              "price": "8",           //   scraper emits price/unlock/acquire/
              "unlock": "...",        //   wiki_no/icon_filename/parser. `parser`
              "acquire": "...",       //   is the incremental-fill / idempotency
              "wiki_no": 1,           //   marker — every parser must stamp it.
              "icon_filename": "收藏品_1.png",
              "parser": "modern-relic"
            }
          }
        ]
      }
    ]

If data/gadgets.json is absent the script logs and exits 0, so it's safe as
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

GADGETS_JSON = Path(__file__).parent.parent / "data" / "gadgets.json"

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# Same retry policy as parse_plots.py — the connection here is flaky.
MAX_RETRIES   = 5
RETRY_BACKOFF = 2.0   # seconds, doubled each retry → 2, 4, 8, 16


def _execute(query, what: str):
    """`query.execute()` with retry/backoff for transient network failures.

    Retries connection drops / timeouts; re-raises a postgrest APIError
    immediately (server received and rejected it — won't fix on retry).
    """
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="delete each listed theme's existing gadgets before inserting")
    args = ap.parse_args()

    if not GADGETS_JSON.exists():
        log.info(f"(no {GADGETS_JSON.name} on disk — nothing to import, skipping)")
        return

    themes = json.loads(GADGETS_JSON.read_text(encoding="utf-8"))
    total = skipped = 0

    for theme in themes:
        category = theme["category"]
        story    = theme["story"]
        items    = theme.get("gadgets", [])

        sid = story_id_for(category, story)
        if sid is None:
            log.warning(f"no stories row for {category}/{story} — run parse_plots "
                        f"first; skipping {len(items)} gadgets")
            skipped += len(items)
            continue

        if args.force:
            _execute(supabase.table("gadgets").delete().eq("story_id", sid),
                     f"wipe gadgets for {story}")

        rows = []
        for i, g in enumerate(items):
            rows.append({
                "story_id":    sid,
                "kind":        g["kind"],
                "name":        g["name"],
                "name_en":     g.get("name_en"),
                "description": g.get("description"),
                "effect":      g.get("effect"),
                "icon_sha1":   g.get("icon_sha1"),
                "seq":         g.get("seq", i),
                "raw":         g.get("raw"),
            })

        if not rows:
            continue

        # Idempotent without --force: UNIQUE (story_id, kind, name) makes this
        # an upsert; re-runs refresh fields instead of duplicating.
        _execute(
            supabase.table("gadgets").upsert(rows, on_conflict="story_id,kind,name"),
            f"upsert {len(rows)} gadgets for {story}")
        total += len(rows)
        log.info(f"{category}/{story}: {len(rows)} gadgets")

    log.info(f"Done. {total} gadgets imported"
             + (f", {skipped} skipped (missing story)" if skipped else ""))


if __name__ == "__main__":
    main()
