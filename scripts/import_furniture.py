"""
Import the furniture catalog from data/furniture.json into the
`stories` and `furniture_items` DB tables.

data/furniture.json is produced by scripts/scrape_furniture.py.  The schema
is defined in supabase/migrations/010_furniture.sql — apply that migration
before running this script.

Import strategy
---------------
  stories (category='家具') — upsert on UNIQUE (category, name).
      Each themed set and each standalone subcategory gets its own row.
      stories.arc = section label ('宿舍/活动室主题', '会客室主题', or '散件').
      stories.seq = ordering sequence.

  furniture_items — replace-per-story: delete the story's existing items,
      then bulk-insert fresh rows.  Same idiom as import_events.py.
      Theme-level metadata (atmo_total, date_added, acquisition) is stored
      per-item (same value for every piece in a themed set; NULL for
      standalone items).

Dependencies:
    pip install supabase python-dotenv

.env at the project root needs:
    SUPABASE_URL=https://[ref].supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...

Usage:
    python scripts/import_furniture.py            # idempotent upsert
    python scripts/import_furniture.py --force    # wipe all furniture first
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
except Exception:
    APIError = None  # type: ignore[assignment,misc]

load_dotenv(Path(__file__).parent.parent / ".env")

FURNITURE_JSON = Path(__file__).parent.parent / "data" / "furniture.json"

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

MAX_RETRIES   = 5
RETRY_BACKOFF = 2.0


def _execute(query, what: str):
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return query.execute()
        except Exception as exc:
            if APIError is not None and isinstance(exc, APIError):
                raise
            last_exc = exc
            if attempt == MAX_RETRIES - 1:
                break
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"{what}: retry {attempt+1}/{MAX_RETRIES} after "
                        f"{wait:.0f}s ({type(exc).__name__}: {exc})")
            time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def _upsert_story(name: str, arc: str, seq: int,
                  description: str | None, icon_sha1: str | None) -> int | None:
    """Upsert a stories row for a furniture entry and return its id."""
    _execute(
        supabase.table("stories")
                .upsert({
                    "category":    "家具",
                    "name":        name,
                    "name_en":     name,
                    "description": description,
                    "icon_sha1":   icon_sha1,
                    "arc":         arc,
                    "seq":         seq,
                }, on_conflict="category,name"),
        f"upsert story {name}")

    res = _execute(
        supabase.table("stories")
                .select("id")
                .eq("category", "家具")
                .eq("name", name)
                .limit(1),
        f"lookup story_id for {name}")
    if not res.data:
        log.warning(f"  could not retrieve story_id for {name} — skipping")
        return None
    return res.data[0]["id"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true",
                    help="delete ALL furniture data before importing")
    args = ap.parse_args()

    if not FURNITURE_JSON.exists():
        log.info(f"(no {FURNITURE_JSON.name} on disk — run scrape_furniture.py first)")
        return

    data = json.loads(FURNITURE_JSON.read_text(encoding="utf-8"))
    themes     = data.get("themes", [])
    standalone = data.get("standalone", [])

    if args.force:
        log.info("--force: wiping stories(category='家具') …")
        _execute(
            supabase.table("stories").delete().eq("category", "家具"),
            "wipe stories/家具")

    # ---- 1. Themed sets -------------------------------------------------------
    themes_upserted = 0
    items_inserted  = 0

    for t in themes:
        story_id = _upsert_story(
            name=t["name"],
            arc=t["section"],
            seq=t.get("seq", 0),
            description=t.get("description"),
            icon_sha1=t.get("icon_sha1"),
        )
        if story_id is None:
            continue
        themes_upserted += 1

        item_list = t.get("items", [])
        if not item_list:
            continue

        _execute(
            supabase.table("furniture_items").delete().eq("story_id", story_id),
            f"delete items for theme {t['name']}")

        rows = [
            {
                "story_id":    story_id,
                "name":        item["name"],
                "wiki_href":   item.get("wiki_href"),
                "description": item.get("description"),
                "atmo_value":  item.get("atmo_value"),
                "icon_sha1":   item.get("icon_sha1"),
                "seq":         item.get("seq", i),
                "raw":         item.get("raw"),
                "atmo_total":  t.get("atmo_total"),
                "date_added":  t.get("date_added"),
                "acquisition": t.get("acquisition"),
            }
            for i, item in enumerate(item_list)
        ]
        _execute(
            supabase.table("furniture_items").insert(rows),
            f"insert {len(rows)} items for theme {t['name']}")
        items_inserted += len(rows)
        log.info(f"  {t['section']}/{t['name']}: {len(rows)} items")

    log.info(f"themes upserted: {themes_upserted}")

    # ---- 2. Standalone subcategories -----------------------------------------
    subcats: dict[str, list[dict]] = {}
    for item in standalone:
        subcats.setdefault(item["subcategory"], []).append(item)

    standalone_inserted = 0
    for seq_i, (subcat, items) in enumerate(subcats.items()):
        story_name = f"散件/{subcat}"
        story_id = _upsert_story(
            name=story_name,
            arc="散件",
            seq=1000 + seq_i,
            description=None,
            icon_sha1=None,
        )
        if story_id is None:
            continue

        _execute(
            supabase.table("furniture_items").delete().eq("story_id", story_id),
            f"delete standalone/{subcat}")

        rows = [
            {
                "story_id":    story_id,
                "name":        item["name"],
                "wiki_href":   item.get("wiki_href"),
                "description": item.get("description"),
                "atmo_value":  item.get("atmo_value"),
                "icon_sha1":   item.get("icon_sha1"),
                "seq":         item.get("seq", i),
                "raw":         item.get("raw"),
                "atmo_total":  None,
                "date_added":  None,
                "acquisition": None,
            }
            for i, item in enumerate(items)
        ]
        _execute(
            supabase.table("furniture_items").insert(rows),
            f"insert {len(rows)} standalone/{subcat}")
        standalone_inserted += len(rows)
        log.info(f"  standalone/{subcat}: {len(rows)} items")

    log.info(f"Done. themes={themes_upserted}  "
             f"themed_items={items_inserted}  "
             f"standalone_items={standalone_inserted}")


if __name__ == "__main__":
    main()
