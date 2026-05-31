"""
Scrape the Arknights furniture catalog from prts.wiki/w/家具一览 and write
the result to data/furniture.json, which scripts/import_furniture.py then
loads into the `furniture_themes` + `furniture_items` DB tables.

Two content categories are scraped:

  主题 (themed sets) — parsed from the two main-page wikitables:
      '宿舍/活动室主题' and '会客室主题'.
      For each theme, the linked wiki subpage is fetched to collect
      individual furniture items with their descriptions (one HTTP
      request per theme; skipped when items are already cached unless
      --force is given).

  散件 (standalone pieces) — parsed from the tooltip blocks in every
      subsection of the '散件' section on the main page.

Architecture
------------
* Pure scrape → file.  No Supabase client; import_furniture.py is the
  sole DB writer so a scrape failure never touches the DB.
* sha1_for(rel_path): SHA1 of the data/-relative path string (the same
  convention used by upload_story_images.py / scrape_gadgets.py).  The
  matching uploader (upload_furniture_icons.py) pushes icons to Storage
  at furniture-icons/<sha1>.png.
* Idempotent: on re-runs without --force, theme metadata is refreshed
  from the main page (one request) while individual item sub-pages are
  skipped for themes that already carry raw.items_scraped = true.
  Standalone items are always re-parsed from the main page.

Local icon paths
----------------
  data/furniture-icons/themes/<filename>           — theme-level icon
  data/furniture-icons/items/<safe_theme>/<file>   — per-theme item icon
  data/furniture-icons/standalone/<safe_cat>/<file> — standalone icon

Usage
-----
    python scripts/scrape_furniture.py                  # all content
    python scripts/scrape_furniture.py --no-items       # skip item subpages
    python scripts/scrape_furniture.py --no-icons       # skip icon downloads
    python scripts/scrape_furniture.py --force          # ignore cache
    python scripts/scrape_furniture.py --dry-run        # no file writes
    python scripts/scrape_furniture.py --section 会客室主题  # one section only
    python scripts/scrape_furniture.py --theme 货运仓库  # one theme only

Dependencies: stdlib only — no bs4, matching the style of scrape_gadgets.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterator

ROOT     = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

FURNITURE_JSON = DATA_DIR / "furniture.json"
DEBUG_JSON     = DATA_DIR / "furniture_scrape.json"
ICON_DIR       = DATA_DIR / "furniture-icons"

MAIN_PAGE = "家具一览"
API_URL   = "https://prts.wiki/api.php"
SSL_CTX   = ssl._create_unverified_context()

MAX_RETRIES   = 4
RETRY_BACKOFF = 2.0
PAGE_DELAY    = 0.6    # between theme-page fetches
ICON_DELAY    = 0.15   # between icon downloads

THEME_SECTIONS = ["宿舍/活动室主题", "会客室主题"]

# Columns present in each section's wikitable (positional, 0-indexed).
SECTION_COLS: dict[str, list[str]] = {
    "宿舍/活动室主题": ["icon", "name", "desc", "date", "atmo", "acquisition", "parts"],
    "会客室主题":     ["icon", "name", "desc", "date", "acquisition"],
}

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Network helpers — identical retry/backoff idiom to scrape_gadgets.py
# ---------------------------------------------------------------------------

def _urlopen(url: str) -> bytes:
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=60, context=SSL_CTX) as r:
                return r.read()
        except Exception as e:
            last = e
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"  retry {attempt+1}/{MAX_RETRIES} after {wait:.0f}s "
                        f"({type(e).__name__})")
            time.sleep(wait)
    raise last  # type: ignore[misc]


def _api(params: dict) -> dict:
    url = API_URL + "?" + urllib.parse.urlencode(params)
    return json.loads(_urlopen(url).decode("utf-8"))


def fetch_html(page: str) -> str | None:
    """Return rendered HTML for a wiki page, or None if missing."""
    d = _api({"action": "parse", "page": page, "prop": "text",
               "format": "json", "formatversion": "2"})
    if "error" in d:
        return None
    return d.get("parse", {}).get("text")


# ---------------------------------------------------------------------------
# Text / HTML helpers
# ---------------------------------------------------------------------------

RE_TAG  = re.compile(r"<[^>]+>")
RE_NBSP = re.compile(r"&(?:nbsp|#160);")


def clean(html: str | None) -> str | None:
    """<br> → \\n, strip tags, decode common entities, trim whitespace.
    Returns None if the result is empty."""
    if html is None:
        return None
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = RE_TAG.sub("", text)
    text = RE_NBSP.sub(" ", text)
    text = (text.replace("&amp;", "&").replace("&lt;", "<")
                .replace("&gt;", ">").replace("&quot;", '"'))
    lines = [ln.strip() for ln in text.splitlines()]
    out = "\n".join(ln for ln in lines if ln)
    return out or None


def safe_name(name: str) -> str:
    """Sanitise a wiki name for use as a filesystem path component."""
    return re.sub(r'[/:*?"<>|\\]', "_", name).strip("_") or "unnamed"


def sha1_for(rel: Path) -> str:
    """SHA1 of the data/-relative POSIX path.  Must match upload_furniture_icons.sha1_for."""
    return hashlib.sha1("/".join(rel.parts).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Icon download
# ---------------------------------------------------------------------------

def _resolve_url(url: str) -> str:
    """Normalise protocol-relative URLs to https."""
    if url.startswith("//"):
        return "https:" + url
    return url


def _icon_filename(url: str) -> str | None:
    """Decode the basename of an icon URL, stripping any ?v= version query."""
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.unquote(Path(parsed.path).name) or None


def download_icon(url: str, subdir: Path, *, enabled: bool
                  ) -> tuple[str | None, str | None]:
    """Download an icon into DATA_DIR/subdir/<filename>, return (sha1, filename).

    Both items can be None on failure (non-fatal).  `subdir` is relative to
    DATA_DIR (e.g. Path("furniture-icons/themes")).
    """
    if not url:
        return None, None
    url = _resolve_url(url)
    filename = _icon_filename(url)
    if not filename:
        return None, None

    rel = subdir / filename
    if not enabled:
        return None, filename

    dst = DATA_DIR / rel
    try:
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            data = _urlopen(url)
            if not data:
                raise RuntimeError("empty response")
            dst.write_bytes(data)
            time.sleep(ICON_DELAY)
        return sha1_for(rel), filename
    except Exception as exc:
        log.warning(f"  icon download failed ({filename}): {exc}")
        return None, filename


# ---------------------------------------------------------------------------
# Tooltip block parser
# ---------------------------------------------------------------------------

# Every furniture item on the wiki is shown as one of these inline blocks.
# We split the HTML by the constant opening string and parse each chunk.
_TOOLTIP_MARKER = (
    '<div style="display:inline-block;position:relative">'
    '<span class="mc-tooltips">'
)

RE_A_TITLE = re.compile(r'<a\b[^>]*\btitle="([^"]+)"', re.I)
RE_A_HREF  = re.compile(r'<a\b[^>]*\bhref="(/w/[^"]+)"', re.I)
RE_ATMO_B  = re.compile(r'<b>(\d+)</b>')
RE_DESC_P  = re.compile(r'<p>\s*([\s\S]*?)\s*</p>', re.I)
# The item icon is the absolute-positioned overlay; match by style attribute.
RE_ABS_IMG = re.compile(
    r'<img\b(?=[^>]*style="[^"]*position:\s*absolute)[^>]*\bsrc="([^"]+)"[^>]*>',
    re.I)
# Fallback: first two <img> tags — take the second (background is first).
RE_IMG_SRC = re.compile(r'<img\b[^>]*\bsrc="([^"]+)"', re.I)


def _tooltip_blocks(section_html: str) -> Iterator[str]:
    """Yield individual tooltip block strings from a section of HTML."""
    parts = section_html.split(_TOOLTIP_MARKER)
    for chunk in parts[1:]:   # skip content before first block
        yield _TOOLTIP_MARKER + chunk


def _parse_tooltip(block: str) -> dict:
    """Extract name, wiki_href, icon_url, atmo_value, description from one block."""
    title_m = RE_A_TITLE.search(block)
    href_m  = RE_A_HREF.search(block)
    name    = title_m.group(1) if title_m else None
    href    = href_m.group(1)  if href_m  else None

    # Icon: prefer the absolute-positioned overlay img.
    icon_m   = RE_ABS_IMG.search(block)
    icon_url: str | None
    if icon_m:
        icon_url = icon_m.group(1)
    else:
        imgs = RE_IMG_SRC.findall(block)
        icon_url = imgs[1] if len(imgs) > 1 else None

    # Atmosphere value and description live inside the nomobile span.
    nm_start = block.find('<span class="nomobile"')
    atmo = desc = None
    if nm_start != -1:
        nm = block[nm_start:]
        b_m = RE_ATMO_B.search(nm)
        atmo = int(b_m.group(1)) if b_m else None
        p_m  = RE_DESC_P.search(nm)
        desc = clean(p_m.group(1)) if p_m else None

    return {
        "name":      name,
        "wiki_href": href,
        "icon_url":  icon_url,
        "atmo_value": atmo,
        "description": desc,
    }


# ---------------------------------------------------------------------------
# Main-page theme table parser
# ---------------------------------------------------------------------------

RE_TD = re.compile(r'<td\b[^>]*>([\s\S]*?)</td>', re.I)


def _section_html(html: str, section_id: str) -> str | None:
    """Return the HTML from a section heading to the next <h2>."""
    start = html.find(f'id="{section_id}"')
    if start == -1:
        return None
    nxt = re.search(r'<h2\b', html[start + 1:])
    end = (start + 1 + nxt.start()) if nxt else len(html)
    return html[start:end]


def _next_table(html: str, after: int) -> tuple[int, int] | None:
    """Return (start, end) of the first <table> block starting after `after`."""
    s = html.find("<table", after)
    if s == -1:
        return None
    e = html.find("</table>", s)
    if e == -1:
        return None
    return s, e + len("</table>")


def _parse_theme_table(html: str, section: str,
                       *, download_icons: bool) -> list[dict]:
    """Parse one wikitable of themes (宿舍/活动室主题 or 会客室主题)."""
    sec_html = _section_html(html, section)
    if sec_html is None:
        log.warning(f"section '{section}' not found in main page")
        return []

    sec_start = html.find(f'id="{section}"')
    tbl = _next_table(html, sec_start)
    if tbl is None:
        log.warning(f"no table found in section '{section}'")
        return []
    table_html = html[tbl[0]:tbl[1]]

    cols = SECTION_COLS[section]
    rows: list[dict] = []

    # Split on <tr to get row blocks; skip header rows (no <td>).
    row_parts = re.split(r'(?=<tr\b)', table_html, flags=re.I)
    seq = 0
    for part in row_parts:
        if "<td" not in part.lower():
            continue
        cells = RE_TD.findall(part)
        if not cells or len(cells) < len(cols) - 1:
            continue

        cell: dict[str, str] = {}
        for i, col in enumerate(cols):
            cell[col] = cells[i] if i < len(cells) else ""

        # Name + wiki link from the name cell.
        name_m    = RE_A_TITLE.search(cell["name"])
        href_m    = RE_A_HREF.search(cell["name"])
        disp_name = name_m.group(1) if name_m else clean(cell["name"])
        wiki_href = href_m.group(1)  if href_m  else None
        wiki_title = urllib.parse.unquote(
            wiki_href[3:] if wiki_href and wiki_href.startswith("/w/") else ""
        ) or disp_name

        if not disp_name:
            continue

        # Theme icon: first <img> in the icon cell.
        icon_imgs = RE_IMG_SRC.findall(cell.get("icon", ""))
        icon_url  = icon_imgs[0] if icon_imgs else None
        icon_sha1 = icon_filename = None
        if icon_url:
            icon_sha1, icon_filename = download_icon(
                _resolve_url(icon_url),
                Path("furniture-icons") / "themes",
                enabled=download_icons)

        atmo_total: int | None = None
        if "atmo" in cell:
            try:
                atmo_total = int(clean(cell["atmo"]) or "")
            except ValueError:
                pass

        raw: dict = {}
        if icon_filename:
            raw["icon_filename"] = icon_filename
        if "parts" in cell:
            raw["parts_needed"] = clean(cell["parts"])
        raw["items_scraped"] = False

        rows.append({
            "section":    section,
            "name":       disp_name,
            "wiki_title": wiki_title,
            "wiki_href":  wiki_href,
            "description": clean(cell.get("desc")),
            "date_added":  clean(cell.get("date")),
            "acquisition": clean(cell.get("acquisition")),
            "atmo_total":  atmo_total,
            "icon_sha1":   icon_sha1,
            "seq":         seq,
            "raw":         raw,
            "items":       [],
        })
        seq += 1
        log.debug(f"  theme: {disp_name}")

    return rows


# ---------------------------------------------------------------------------
# Standalone section parser
# ---------------------------------------------------------------------------

def _parse_standalone(html: str, *, download_icons: bool) -> list[dict]:
    """Parse all 散件 subcategory tooltip blocks from the main page."""
    sec_html = _section_html(html, "散件")
    if sec_html is None:
        log.warning("'散件' section not found in main page")
        return []

    # Find all H3 headings (subcategory boundaries) within the section.
    RE_H3_ID = re.compile(
        r'<h3\b[^>]*>.*?<span class="mw-headline" id="([^"]+)"', re.S | re.I)
    h3_matches = list(RE_H3_ID.finditer(sec_html))

    items: list[dict] = []
    for idx, m in enumerate(h3_matches):
        subcat   = urllib.parse.unquote(m.group(1))
        seg_start = m.start()
        seg_end   = h3_matches[idx + 1].start() if idx + 1 < len(h3_matches) else len(sec_html)
        segment   = sec_html[seg_start:seg_end]

        seq = 0
        for block in _tooltip_blocks(segment):
            info = _parse_tooltip(block)
            if not info["name"]:
                continue

            icon_sha1 = icon_filename = None
            if info["icon_url"]:
                subdir = Path("furniture-icons") / "standalone" / safe_name(subcat)
                icon_sha1, icon_filename = download_icon(
                    _resolve_url(info["icon_url"]), subdir,
                    enabled=download_icons)

            raw: dict = {}
            if icon_filename:
                raw["icon_filename"] = icon_filename
            if info["icon_url"]:
                raw["icon_url"] = info["icon_url"]

            items.append({
                "subcategory": subcat,
                "name":        info["name"],
                "wiki_href":   info["wiki_href"],
                "description": info["description"],
                "atmo_value":  info["atmo_value"],
                "icon_sha1":   icon_sha1,
                "seq":         seq,
                "raw":         raw,
            })
            seq += 1
        log.info(f"  standalone/{subcat}: {seq} items")

    return items


# ---------------------------------------------------------------------------
# Theme subpage item parser
# ---------------------------------------------------------------------------

def _parse_theme_items(theme_name: str, html: str,
                       *, download_icons: bool) -> list[dict]:
    """Parse all furniture item tooltips from a theme's wiki subpage."""
    safe = safe_name(theme_name)
    items = []
    seq   = 0
    for block in _tooltip_blocks(html):
        info = _parse_tooltip(block)
        if not info["name"]:
            continue
        icon_sha1 = icon_filename = None
        if info["icon_url"]:
            subdir = Path("furniture-icons") / "items" / safe
            icon_sha1, icon_filename = download_icon(
                _resolve_url(info["icon_url"]), subdir,
                enabled=download_icons)

        raw: dict = {}
        if icon_filename:
            raw["icon_filename"] = icon_filename
        if info["icon_url"]:
            raw["icon_url"] = info["icon_url"]

        items.append({
            "name":        info["name"],
            "wiki_href":   info["wiki_href"],
            "description": info["description"],
            "atmo_value":  info["atmo_value"],
            "icon_sha1":   icon_sha1,
            "seq":         seq,
            "raw":         raw,
        })
        seq += 1
    return items


# ---------------------------------------------------------------------------
# JSON load / merge
# ---------------------------------------------------------------------------

def load_json() -> dict:
    if not FURNITURE_JSON.exists():
        return {"themes": [], "standalone": []}
    try:
        data = json.loads(FURNITURE_JSON.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "themes" in data:
            return data
    except json.JSONDecodeError:
        log.warning(f"{FURNITURE_JSON.name} is invalid JSON — starting fresh")
    return {"themes": [], "standalone": []}


def _theme_key(t: dict) -> tuple[str, str]:
    return (t.get("section", ""), t.get("name", ""))


def merge_themes(existing: list[dict], fresh: list[dict]) -> list[dict]:
    """Refresh theme metadata from `fresh` while preserving scraped items."""
    by_key = {_theme_key(t): t for t in existing}
    result = []
    for new_t in fresh:
        key = _theme_key(new_t)
        if key in by_key:
            old = by_key.pop(key)
            # Keep items and items_scraped flag from the previous run.
            new_t["items"] = old.get("items", [])
            new_t["raw"]["items_scraped"] = old.get("raw", {}).get("items_scraped", False)
        result.append(new_t)
    # Keep themes that were not in the fresh parse (e.g. page temporarily broken).
    result.extend(by_key.values())
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--section",
                    help="scrape only one theme section "
                         "(e.g. '宿舍/活动室主题' or '会客室主题')")
    ap.add_argument("--theme",
                    help="fetch items only for this named theme")
    ap.add_argument("--force", action="store_true",
                    help="re-scrape item subpages even if already cached")
    ap.add_argument("--no-items", action="store_true",
                    help="skip fetching theme subpages for individual items")
    ap.add_argument("--no-icons", action="store_true",
                    help="skip downloading icons (sha1 stays null)")
    ap.add_argument("--dry-run", action="store_true",
                    help="scrape everything but do NOT write furniture.json")
    args = ap.parse_args()

    dl_icons = not args.no_icons

    # ---- Phase 1: fetch main page ----------------------------------------
    log.info(f"→ {MAIN_PAGE} (main page)")
    main_html = fetch_html(MAIN_PAGE)
    if not main_html:
        raise SystemExit(f"Could not fetch '{MAIN_PAGE}'")

    # ---- Phase 2: parse theme tables from main page ----------------------
    fresh_themes: list[dict] = []
    sections = ([args.section] if args.section else THEME_SECTIONS)
    for section in sections:
        if section not in SECTION_COLS:
            log.warning(f"unknown section '{section}' — skipping")
            continue
        log.info(f"  parsing section: {section}")
        rows = _parse_theme_table(main_html, section, download_icons=dl_icons)
        log.info(f"  {section}: {len(rows)} theme(s)")
        fresh_themes.extend(rows)

    # ---- Phase 3: parse standalone items from main page ------------------
    log.info("  parsing standalone (散件) items")
    fresh_standalone = _parse_standalone(main_html, download_icons=dl_icons)

    # ---- Phase 4: merge with existing JSON (preserve cached items) ------
    data = load_json()
    data["themes"]     = merge_themes(data["themes"], fresh_themes)
    data["standalone"] = fresh_standalone   # always refreshed from main page

    # ---- Phase 5: fetch theme subpages for individual items -------------
    fetched = skipped = failed = 0
    if not args.no_items:
        themes_to_fetch = [
            t for t in data["themes"]
            if (args.theme is None or t["name"] == args.theme) and
               (args.force or not t.get("raw", {}).get("items_scraped"))
        ]
        log.info(f"\nFetching items for {len(themes_to_fetch)} theme(s) "
                 f"({len(data['themes']) - len(themes_to_fetch)} cached)…")

        for theme in themes_to_fetch:
            wiki_title = theme.get("wiki_title") or theme["name"]
            log.info(f"→ {wiki_title}")
            try:
                html = fetch_html(wiki_title)
                if not html:
                    raise RuntimeError("page missing or empty")
                items = _parse_theme_items(theme["name"], html,
                                           download_icons=dl_icons)
                theme["items"] = items
                theme["raw"]["items_scraped"] = True
                log.info(f"  {theme['name']}: {len(items)} item(s)")
                fetched += 1
            except Exception as exc:
                log.error(f"  FAILED ({wiki_title}): {exc}")
                failed += 1
            time.sleep(PAGE_DELAY)
    else:
        log.info("(--no-items: skipping theme subpage fetches)")

    # ---- Phase 6: write output -------------------------------------------
    if not args.dry_run:
        FURNITURE_JSON.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        log.info(f"\nwrote → {FURNITURE_JSON.relative_to(ROOT)}")

    # Debug summary
    theme_counts  = {s: sum(1 for t in data["themes"] if t["section"] == s)
                     for s in THEME_SECTIONS}
    item_counts   = {t["name"]: len(t.get("items", []))
                     for t in data["themes"]}
    standalone_ct = len(data["standalone"])
    debug = {
        "themes_by_section": theme_counts,
        "item_counts": item_counts,
        "standalone_count": standalone_ct,
        "fetched": fetched, "skipped": skipped, "failed": failed,
    }
    DEBUG_JSON.write_text(
        json.dumps(debug, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    log.info(f"meta  → {DEBUG_JSON.relative_to(ROOT)}")

    log.info("---")
    log.info(f"themes   = {sum(theme_counts.values())}  "
             f"({theme_counts})")
    log.info(f"items    fetched={fetched}  failed={failed}")
    log.info(f"standalone items = {standalone_ct}")
    if args.dry_run:
        log.info("DRY RUN — furniture.json untouched")


if __name__ == "__main__":
    main()
