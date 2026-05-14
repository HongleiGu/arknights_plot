"""
For each story in data/story_descriptions.json, fetch its individual
prts.wiki page and extract:

  • name_en    — '副标题' field in the {{活动信息}} wikitext template
  • description — first <div class="poem">…</div> in the rendered HTML
  • title image — '标题图文件名' field; downloaded to
                   data/img/<grouping>/<story_name>.<ext>

Then update the stories table (`name_en`, `description`). The title image's
SHA1 stamping into `title_sha1` is left to `upload_story_images.py`, which
walks `data/img/` and handles uploads consistently.

Idempotent. Re-running only re-fetches stories that don't yet have
`name_en` populated in the DB, unless `--force` is passed.

Failures and partial data are logged to `data/story_pages.json` for
review (covers we couldn't auto-detect end up here too — we'll handle
those manually for now).

Usage:
    python scripts/scrape_story_pages.py                       # all stories
    python scripts/scrape_story_pages.py --story 不义之财       # single
    python scripts/scrape_story_pages.py --force               # ignore DB cache
    python scripts/scrape_story_pages.py --no-images           # skip downloads
"""

from __future__ import annotations
import argparse
import json
import logging
import os
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(Path(__file__).parent.parent / ".env.local")

ROOT       = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
IMG_ROOT   = DATA_DIR / "img"
INPUT_JSON = DATA_DIR / "story_descriptions.json"
META_JSON  = DATA_DIR / "story_pages.json"

API_URL    = "https://prts.wiki/api.php"
PAGE_URL   = "https://prts.wiki/w/"
SSL_CTX    = ssl._create_unverified_context()

MAX_RETRIES   = 4
RETRY_BACKOFF = 2.0
DELAY         = 0.5
TIMEOUT       = 60


logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)


# ---------------------------------------------------------------------------
# HTTP with retry
# ---------------------------------------------------------------------------

def _urlopen(url: str) -> bytes:
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT, context=SSL_CTX) as r:
                return r.read()
        except Exception as e:
            last = e
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"  retry {attempt+1}/{MAX_RETRIES} after {wait:.0f}s ({type(e).__name__})")
            time.sleep(wait)
    raise last  # type: ignore[misc]


def api(params: dict) -> dict:
    url = API_URL + "?" + urllib.parse.urlencode(params)
    return json.loads(_urlopen(url).decode("utf-8"))


# ---------------------------------------------------------------------------
# Extractors
# ---------------------------------------------------------------------------

# Pulls the {{活动信息|...}} template, allowing nested templates inside via
# a brace-counter. Easier than a regex.
def parse_huodong_xinxi(wikitext: str) -> dict[str, str]:
    start = wikitext.find("{{活动信息")
    if start < 0:
        return {}
    depth = 0
    end = start
    for i in range(start, len(wikitext)):
        if wikitext[i:i+2] == "{{":
            depth += 1
        elif wikitext[i:i+2] == "}}":
            depth -= 1
            if depth == 0:
                end = i + 2
                break
    body = wikitext[start+2:end-2]  # strip outer {{ }}
    # First piece is the template name '活动信息', drop it.
    parts = body.split("|")[1:]
    result: dict[str, str] = {}
    for p in parts:
        if "=" in p:
            k, _, v = p.partition("=")
            result[k.strip()] = v.strip()
    return result


# Description sits in the first <div class="poem"><p>…</p></div> on the page.
# <br /> separates lines; tags inside are minimal.
RE_POEM = re.compile(r'<div class="poem">\s*<p>(.+?)</p>\s*</div>', re.DOTALL)
RE_TAG  = re.compile(r"<[^>]+>")


def parse_description(html: str) -> str | None:
    m = RE_POEM.search(html)
    if not m:
        return None
    raw = m.group(1)
    # <br /> in the source is usually followed by an actual newline → two
    # line breaks. Normalize to single \n between non-empty lines.
    text = re.sub(r"<br\s*/?>", "\n", raw)
    text = RE_TAG.sub("", text)
    lines = [line.strip() for line in text.splitlines()]
    text = "\n".join(line for line in lines if line)
    return text or None


# Just in case 副标题 isn't in the {{活动信息}} template, scrape the
# fnameheader script tag in the HTML as a backup.
RE_FNAMEHEADER = re.compile(
    r"fnameheader[^>]*>([^<\\]+)\\<", re.IGNORECASE
)


def parse_name_en_from_html(html: str) -> str | None:
    m = RE_FNAMEHEADER.search(html)
    return m.group(1).strip() if m else None


# ---------------------------------------------------------------------------
# Image download
# ---------------------------------------------------------------------------

def resolve_file_url(filename: str) -> str | None:
    """filename e.g. '活动预告 不义之财 01.jpg' → full media.prts.wiki URL."""
    d = api({
        "action": "query", "titles": f"File:{filename}",
        "prop": "imageinfo", "iiprop": "url", "format": "json",
    })
    for page in d.get("query", {}).get("pages", {}).values():
        ii = page.get("imageinfo", [])
        if ii:
            return ii[0]["url"]
    return None


def find_target_dir(story_name: str) -> Path | None:
    """Look up which data/img/<grouping>/ folder this story belongs in."""
    matches = [
        p.parent for p in IMG_ROOT.rglob(f"{story_name}.png")
        if p.name == f"{story_name}.png"
    ]
    if matches:
        return matches[0]
    # Also try matching by folder name (some stories have no PNG yet).
    matches = [p for p in IMG_ROOT.rglob("*") if p.is_dir() and p.name == story_name]
    return matches[0] if matches else None


def download_title_image(filename: str, target_dir: Path, story_name: str) -> Path | None:
    """Download the title image, save as <story>.<ext>. Returns the local path."""
    url = resolve_file_url(filename)
    if not url:
        log.warning(f"  no URL for {filename}")
        return None

    # Original extension from URL
    ext = Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"
    dst = target_dir / f"{story_name}{ext}"

    log.info(f"  downloading {url} → {dst.relative_to(ROOT)}")
    dst.write_bytes(_urlopen(url))
    time.sleep(DELAY)
    return dst


# ---------------------------------------------------------------------------
# Per-story handler
# ---------------------------------------------------------------------------

def get_wikitext(title: str) -> str | None:
    d = api({
        "action": "query", "prop": "revisions", "titles": title,
        "rvprop": "content", "rvslots": "main", "format": "json",
    })
    for page in d.get("query", {}).get("pages", {}).values():
        if "revisions" in page:
            return page["revisions"][0]["slots"]["main"]["*"]
    return None


def fetch_page_html(story_name: str) -> str:
    url = PAGE_URL + urllib.parse.quote(story_name)
    return _urlopen(url).decode("utf-8")


def process_story(story_name: str, *, download_images: bool) -> dict:
    """Returns a dict with the extracted fields."""
    out: dict = {"story_name": story_name, "name_en": None, "description": None,
                 "title_image_filename": None, "title_image_path": None,
                 "errors": []}

    wikitext = get_wikitext(story_name)
    if not wikitext:
        out["errors"].append("no wikitext")
        return out

    fields = parse_huodong_xinxi(wikitext)
    out["name_en"] = fields.get("副标题") or None
    out["title_image_filename"] = fields.get("标题图文件名") or None

    html = fetch_page_html(story_name)
    out["description"] = parse_description(html)
    if out["name_en"] is None:
        out["name_en"] = parse_name_en_from_html(html)

    if download_images and out["title_image_filename"]:
        target_dir = find_target_dir(story_name)
        if target_dir is None:
            out["errors"].append("no img/ folder to land the title image")
        else:
            try:
                local = download_title_image(out["title_image_filename"], target_dir, story_name)
                if local:
                    out["title_image_path"] = str(local.relative_to(ROOT))
            except Exception as e:
                out["errors"].append(f"download failed: {e}")

    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--story", help="process just this story (Chinese name)")
    p.add_argument("--force", action="store_true",
                   help="re-process stories already carrying name_en in DB")
    p.add_argument("--no-images", action="store_true",
                   help="don't download title images, only enrich DB metadata")
    p.add_argument("--dry-run", action="store_true",
                   help="scrape and write story_pages.json, but don't touch the DB")
    args = p.parse_args()

    targets = json.loads(INPUT_JSON.read_text(encoding="utf-8"))
    if args.story:
        targets = [t for t in targets if t["story_name"] == args.story]
        if not targets:
            raise SystemExit(f"story {args.story!r} not found in {INPUT_JSON.name}")

    # Map (category, name) → row. parse_plots.py sets name_en = name as a
    # NOT NULL placeholder, so we use `description` (which only this script
    # writes onto stories) as the "already scraped" marker.
    if args.dry_run:
        by_key: dict[tuple[str, str], dict] = {}
        log.info("DRY RUN — skipping DB select")
    else:
        rows = (supabase.table("stories")
                .select("id, category, name, name_en, description")
                .execute().data)
        by_key = {(r["category"], r["name"]): r for r in rows}

    pages_meta: dict = {}
    if META_JSON.exists():
        try:
            pages_meta = {p["story_name"]: p for p in
                          json.loads(META_JSON.read_text(encoding="utf-8"))}
        except Exception:
            pass

    processed = 0
    skipped   = 0
    failed    = 0

    for t in targets:
        sn = t["story_name"]
        cat = t["category"]
        row = by_key.get((cat, sn))

        if not args.dry_run:
            if row is None:
                log.warning(f"skip (no DB row): {cat} / {sn}")
                failed += 1
                continue
            # parse_plots inserts name_en = name as a NOT NULL placeholder,
            # so a row counts as "scraped already" once name_en differs
            # from name. This works for 故事集 stories too (where description
            # is genuinely NULL on the wiki) — their name_en gets overwritten
            # to the real English subtitle on first scrape.
            if row.get("name_en") and row.get("name_en") != row.get("name") and not args.force:
                log.info(f"skip (cached): {sn}")
                skipped += 1
                continue

        log.info(f"→ {sn}")
        try:
            data = process_story(sn, download_images=not args.no_images)
        except Exception as e:
            log.error(f"  FAILED: {e}")
            failed += 1
            continue

        if not args.dry_run and row is not None:
            # Stamp DB. title_sha1 is left to upload_story_images.py.
            update: dict = {}
            if data["name_en"]:
                update["name_en"] = data["name_en"]
            if data["description"]:
                update["description"] = data["description"]
            if update:
                supabase.table("stories").update(update).eq("id", row["id"]).execute()

        pages_meta[sn] = data
        processed += 1

    # Persist accumulated metadata for cover handling / debugging
    META_JSON.write_text(
        json.dumps(list(pages_meta.values()), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    log.info("---")
    log.info(f"processed = {processed}, skipped = {skipped}, failed = {failed}")
    log.info(f"metadata  → {META_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
