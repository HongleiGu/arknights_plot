"""
Import hand-maintained 集成战略 supplementary text from data/is_text.json
into `text_clusters` + `text_chunks` (migration 008).

NOT scraped — maintain data/is_text.json by hand.  data/is_text.example.json
documents the shape.

Structure of each theme block:
    {
      "category": "集成战略",
      "story": "<theme name>",
      "endings": [
        { "level_code": "RO5-END-1", "seq": 0,
          "chunks": [ "<plain string>", {"title": "<opt>", "body": "<text>"} ] }
      ],
      "characters": [
        { "name": "<角色名>", "name_en": null, "seq": 0,
          "chunks": [ "<plain string>", {"title": "<opt>", "body": "<text>"} ] }
      ]
    }

A chunk may be:
  - a plain string  →  body=<string>, title=null
  - { "body": "...", "title": "..." }  →  both set

Replace-per-theme and idempotent: each listed theme's
text_clusters (of kinds 'ending_supplement' and 'character_record')
and their child text_chunks are deleted and re-inserted.

Dependencies: pip install supabase python-dotenv
.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Usage:
    python scripts/import_is_text.py
    python scripts/import_is_text.py --force   # (alias; always replace)
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
except Exception:
    APIError = None  # type: ignore[assignment,misc]

load_dotenv(Path(__file__).parent.parent / ".env")

IS_TEXT_JSON = Path(__file__).parent.parent / "data" / "is_text.json"

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


def _normalize_chunks(raw_chunks: list) -> list[dict]:
    """Accept chunk as plain string or {title?, body}; always return [{title, body}]."""
    out = []
    for c in raw_chunks:
        if isinstance(c, str):
            out.append({"title": None, "body": c})
        elif isinstance(c, dict):
            body = c.get("body") or ""
            if body:
                out.append({"title": c.get("title"), "body": body})
    return out


def _insert_cluster_with_chunks(
    story_id: int,
    kind: str,
    title: str | None,
    title_en: str | None,
    level_code: str | None,
    seq: int,
    raw: object,
    chunks: list[dict],
) -> int | None:
    if not chunks:
        return None
    res = _execute(
        supabase.table("text_clusters").insert({
            "story_id":   story_id,
            "kind":       kind,
            "title":      title,
            "title_en":   title_en,
            "level_code": level_code,
            "seq":        seq,
            "raw":        raw,
        }),
        f"insert text_cluster kind={kind} title={title!r}")
    cluster_id: int = res.data[0]["id"]

    chunk_rows = [
        {"cluster_id": cluster_id, "seq": i, "title": c["title"], "body": c["body"]}
        for i, c in enumerate(chunks)
    ]
    _execute(
        supabase.table("text_chunks").insert(chunk_rows),
        f"insert {len(chunk_rows)} chunks for cluster {cluster_id}")
    return cluster_id


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="(alias) import is always replace-per-theme")
    ap.parse_args()

    if not IS_TEXT_JSON.exists():
        log.info(f"(no {IS_TEXT_JSON.name} on disk — nothing to import, skipping)")
        return

    themes = json.loads(IS_TEXT_JSON.read_text(encoding="utf-8"))
    n_clusters = n_chunks = skipped = 0

    for theme in themes:
        category = theme["category"]
        story    = theme["story"]
        endings  = theme.get("endings", [])
        chars    = theme.get("characters", [])

        sid = story_id_for(category, story)
        if sid is None:
            log.warning(f"no stories row for {category}/{story} — run "
                        f"parse_plots first; skipping")
            skipped += 1
            continue

        # Replace-per-theme: delete this theme's ending_supplement +
        # character_record clusters (cascades to their text_chunks).
        _execute(
            supabase.table("text_clusters")
                    .delete()
                    .eq("story_id", sid)
                    .in_("kind", ["ending_supplement", "character_record"]),
            f"wipe text_clusters for {story}")

        # ---- Ending supplement clusters ----
        for i, e in enumerate(endings):
            code   = e.get("level_code")
            chunks = _normalize_chunks(e.get("chunks") or [])
            if not code or not chunks:
                log.warning(f"  {story}: ending entry missing level_code or chunks — skip")
                continue
            cid = _insert_cluster_with_chunks(
                story_id   = sid,
                kind       = "ending_supplement",
                title      = None,
                title_en   = None,
                level_code = code,
                seq        = e.get("seq", i),
                raw        = e.get("raw"),
                chunks     = chunks,
            )
            if cid:
                n_clusters += 1
                n_chunks   += len(chunks)

        # ---- Character record clusters ----
        for i, c in enumerate(chars):
            name   = c.get("name")
            chunks = _normalize_chunks(c.get("chunks") or [])
            if not name or not chunks:
                log.warning(f"  {story}: character entry missing name or chunks — skip")
                continue
            cid = _insert_cluster_with_chunks(
                story_id   = sid,
                kind       = "character_record",
                title      = name,
                title_en   = c.get("name_en"),
                level_code = None,
                seq        = c.get("seq", i),
                raw        = c.get("raw"),
                chunks     = chunks,
            )
            if cid:
                n_clusters += 1
                n_chunks   += len(chunks)

        log.info(f"{category}/{story}: {len(endings)} ending sets, "
                 f"{len(chars)} characters")

    log.info(f"Done. {n_clusters} clusters, {n_chunks} chunks"
             + (f", {skipped} themes skipped (missing story)" if skipped else ""))


if __name__ == "__main__":
    main()
