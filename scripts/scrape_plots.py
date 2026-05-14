"""
Arknights plot scraper for prts.wiki

Fixes:
- Proper handling of || table cells
- Correct swap logic: rowspan cell is always the section, never just a category label
- Rowspan-aware: section+subsection appear on the same logical row; continuations carry
- colspan structural headers parsed for ambient category (e.g. "活动剧情一览" → 活动)
- Self-categorising sections (特殊, 集成战略, 生息演算) use their own name as category
  without polluting the ambient category for subsequent plain-section blocks
- Preview mode

Usage:
    python scrape_plots.py --preview
    python scrape_plots.py --limit 20
    python scrape_plots.py
"""

import re
import os
import time
import json
import argparse
import requests

API_URL = "https://prts.wiki/api.php"
NAV_TEMPLATE = "Template:剧情导航"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "plots")
DELAY_SECONDS = 0.5
REQUEST_TIMEOUT = 60          # seconds — prts.wiki sometimes takes 30+s on cold pages
MAX_RETRIES = 5
RETRY_BACKOFF = 2.0           # seconds, doubled each retry → 2, 4, 8, 16, 32


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _get_with_retries(url: str, params: dict) -> requests.Response:
    """GET with retry/backoff for transient network errors (timeouts, 5xx).

    Re-raises on the final attempt so the caller's traceback still points
    at the real failure.
    """
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return resp
        except (requests.exceptions.Timeout,
                requests.exceptions.ConnectionError,
                requests.exceptions.HTTPError) as e:
            last_exc = e
            wait = RETRY_BACKOFF * (2 ** attempt)
            print(f"    retry {attempt+1}/{MAX_RETRIES} after {wait:.0f}s ({type(e).__name__}: {e})")
            time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def get_wikitext(title: str) -> str | None:
    params = {
        "action": "query",
        "prop": "revisions",
        "titles": title,
        "rvprop": "content",
        "rvslots": "main",
        "format": "json",
    }
    resp = _get_with_retries(API_URL, params)
    data = resp.json()
    for page in data.get("query", {}).get("pages", {}).values():
        if "revisions" in page:
            return page["revisions"][0]["slots"]["main"]["*"]
    return None


# ---------------------------------------------------------------------------
# Navigation template parser
# ---------------------------------------------------------------------------

def strip_wikilinks(text: str) -> str:
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    return text


def extract_links_from_cell(cell: str) -> list[str]:
    return re.findall(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", cell)


def parse_cell(raw: str) -> tuple[str, int, bool]:
    """
    Returns (clean_text, rowspan, is_colspan_only).
    is_colspan_only flags structural headers (colspan > 1, rowspan == 1) to skip.
    """
    rowspan = 1
    colspan = 1
    if m := re.search(r"rowspan\s*=\s*[\"']?(\d+)[\"']?", raw, re.IGNORECASE):
        rowspan = int(m.group(1))
    if m := re.search(r"colspan\s*=\s*[\"']?(\d+)[\"']?", raw, re.IGNORECASE):
        colspan = int(m.group(1))
    if "|" in raw:
        raw = raw.split("|", 1)[1]
    return raw.strip(), rowspan, (colspan > 1 and rowspan == 1)


def split_logical_rows(wikitext: str) -> list[list[str]]:
    """Blank lines and |- markers both act as row separators."""
    text = re.sub(r"^\s*\|-.*$", "", wikitext, flags=re.MULTILINE)
    rows: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            if current:
                rows.append(current)
                current = []
        else:
            current.append(s)
    if current:
        rows.append(current)
    return rows


def parse_nav_template(wikitext: str) -> list[dict]:
    """
    Parse navigation template into a flat list of entries with keys:
        section, category, subsection (optional), pages

    Row shapes in the actual wikitext
    ───────────────────────────────────────────────────────────────────────
    Shape 0  structural colspan header — extract ambient category, then skip:
        ! colspan="3"|活动剧情一览
        Sets ambient_category = 活动 for subsequent rowspan blocks.

    Shape 1  simple row — section + category + data:
        ! SectionName  ! CategoryName  | pages
        Both cells have rowspan=1; one is in KNOWN_CATEGORIES (that's the category).

    Shape 2  first row of a rowspan block — section (rowspan>1) + subsection + data:
        ! rowspan="N"|SectionName  ! SubsectionName  | pages
        The rowspan cell is ALWAYS the section.
        - If SectionName ∈ KNOWN_CATEGORIES (特殊, 集成战略, 生息演算):
          category = SectionName  (self-categorising block)
        - Otherwise (四月辑录, etc.):
          category = ambient_category  (set by the most recent colspan header)
        ambient_category is NOT updated in either case.

    Shape 3  continuation row inside an active rowspan — subsection + data only:
        ! SubsectionName  | pages
        section_carry active; section and category both inherited from block start.
    """
    entries: list[dict] = []

    KNOWN_CATEGORIES = {
        "主线", "支线", "活动", "集成战略", "生息演算",
        "保全派驻", "危机合约", "故事集", "隐秘战线", "特殊",
    }

    # section_carry: (text, rows_remaining) — ticked down AFTER each row
    section_carry: tuple[str, int] | None = None

    current_section  = ""
    current_category = ""
    # ambient_category: set by colspan section headings ("活动剧情一览" → 活动).
    # Used as fallback for rowspan blocks whose section name is not a known category.
    # Never overwritten by row-level category resolutions.
    ambient_category = ""

    for row_lines in split_logical_rows(wikitext):
        raw_headers: list[tuple[str, int, bool]] = []
        data_cells:  list[str] = []

        for line in row_lines:
            if line.startswith("!"):
                content = re.sub(r"^!+", "", line).strip()
                for part in re.split(r"\s*!!\s*", content):
                    if part.strip():
                        raw_headers.append(parse_cell(part.strip()))
            elif line.startswith("|") and line not in ("|}", "{|"):
                content = re.sub(r"^\|+", "", line).strip()
                pre_pipe = content.split("|", 1)[0] if "|" in content else ""
                if "[[" not in pre_pipe and pre_pipe.strip():
                    content = content.split("|", 1)[1]
                data_cells.extend(
                    p.strip() for p in re.split(r"\s*\|\|\s*", content) if p.strip()
                )

        # Shape 0: colspan-only structural rows — extract ambient category and skip
        if all(is_cs for _, _, is_cs in raw_headers) and not data_cells:
            for text, _, _ in raw_headers:
                clean_text = strip_wikilinks(text).strip()
                for cat in KNOWN_CATEGORIES:
                    if cat in clean_text:
                        ambient_category = cat
                        break
            continue

        # Drop colspan-only cells; keep real header cells
        headers = [(text, rs) for text, rs, is_cs in raw_headers if not is_cs]

        pages: list[str] = []
        for cell in data_cells:
            pages.extend(extract_links_from_cell(cell))

        if not pages and not headers:
            continue

        clean = [(strip_wikilinks(h).strip(), rs) for h, rs in headers]
        clean = [(h, rs) for h, rs in clean if h]

        row_section    = current_section
        row_category   = current_category
        row_subsection = ""

        if section_carry:
            # Shape 3: section locked; first header is the subsection
            row_section = section_carry[0]
            if clean:
                row_subsection = clean[0][0]

        elif len(clean) == 0:
            pass  # fully inherit

        elif len(clean) == 1:
            val, rs = clean[0]
            if val in KNOWN_CATEGORIES and rs == 1:
                # Standalone category header
                row_category = val
            else:
                row_section = val
                if rs > 1:
                    section_carry = (val, rs)
                # Self-categorising if the section name is a known category
                if val in KNOWN_CATEGORIES:
                    row_category = val

        elif len(clean) == 2:
            first, first_rs   = clean[0]
            second, second_rs = clean[1]

            # KEY RULE: a cell with rowspan > 1 is ALWAYS the section dimension.
            if first_rs > 1:
                # Shape 2
                row_section    = first
                row_subsection = second
                section_carry  = (first, first_rs)
                # Category: self-categorising if section ∈ KNOWN_CATEGORIES,
                # otherwise fall back to ambient_category (from colspan header).
                row_category = first if first in KNOWN_CATEGORIES else ambient_category

            elif second_rs > 1:
                row_section    = second
                row_subsection = first
                section_carry  = (second, second_rs)
                row_category = second if second in KNOWN_CATEGORIES else ambient_category

            else:
                # Shape 1: no rowspan — one is section, one is category
                first_is_cat  = first  in KNOWN_CATEGORIES
                second_is_cat = second in KNOWN_CATEGORIES

                if first_is_cat and not second_is_cat:
                    row_section, row_category = second, first
                elif not first_is_cat and second_is_cat:
                    row_section, row_category = first, second
                else:
                    # Ambiguous — treat as section + subsection, inherit category
                    row_section    = first
                    row_subsection = second

        else:
            # 3+ headers
            first, first_rs   = clean[0]
            second, second_rs = clean[1]
            third, _          = clean[2]

            if first_rs > 1:
                row_section    = first
                row_subsection = third
                section_carry  = (first, first_rs)
                # second cell is the category when explicitly present
                row_category   = second if second in KNOWN_CATEGORIES else (
                    first if first in KNOWN_CATEGORIES else ambient_category
                )
            else:
                if first in KNOWN_CATEGORIES and second not in KNOWN_CATEGORIES:
                    row_section, row_category = second, first
                else:
                    row_section, row_category = first, second
                row_subsection = third

        # Emit
        if pages:
            entry: dict = {
                "section":  row_section,
                "category": row_category,
                "pages":    pages,
            }
            if row_subsection:
                entry["subsection"] = row_subsection
            entries.append(entry)

        current_section  = row_section
        current_category = row_category

        # Tick down carry AFTER the row is consumed
        if section_carry:
            val, remaining = section_carry
            section_carry = (val, remaining - 1) if remaining > 1 else None

    return entries


# ---------------------------------------------------------------------------
# Plot extractor (raw for now)
# ---------------------------------------------------------------------------

def extract_plot_text(wikitext: str) -> str | None:
    return wikitext


# ---------------------------------------------------------------------------
# FS helpers
# ---------------------------------------------------------------------------

def safe_name(s: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", s).strip()


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


# # ---------------------------------------------------------------------------
# # Preview helper
# # ---------------------------------------------------------------------------

# def preview_entries(entries: list[dict], max_sections: int = 15) -> None:
#     print("\n=== PREVIEW ===\n")
#     for i, e in enumerate(entries[:max_sections]):
#         subsection = f" / {e['subsection']}" if e.get("subsection") else ""
#         print(f"[{i+1}] {e['category']} / {e['section']}{subsection}")
#         for p in e["pages"][:5]:
#             print(f"   - {p}")
#         if len(e["pages"]) > 5:
#             print(f"   ... ({len(e['pages'])} pages total)")
#         print()
#     print("=== END PREVIEW ===\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    ensure_dir(OUTPUT_DIR)

    print(f"Fetching navigation template: {NAV_TEMPLATE} ...")
    nav_wikitext = get_wikitext(NAV_TEMPLATE)
    if not nav_wikitext:
        print("ERROR: could not fetch navigation template.")
        return

    entries = parse_nav_template(nav_wikitext)

    # if args.preview:
    #     preview_entries(entries, max_sections=args.limit or 10)
    #     return

    total_pages = sum(len(e["pages"]) for e in entries)
    print(f"Found {len(entries)} sections, {total_pages} pages.\n")

    index: list[dict] = []
    done    = 0
    skipped = 0

    for entry in entries:
        category   = safe_name(entry["category"])
        section    = safe_name(entry["section"])
        subsection = safe_name(entry.get("subsection", ""))

        if category == section:
            section = ""
        if category == "活动":
            category = ""
        if subsection and subsection == "剧情":
            subsection = ""
            category = "故事集"
        section_dir = (
            os.path.join(OUTPUT_DIR, category, section, subsection)
            if subsection else
            os.path.join(OUTPUT_DIR, category, section)
        )
        if args.preview:
            print(section_dir)
            continue
        ensure_dir(section_dir)

        for i, page_title in enumerate(entry["pages"], start=1):
            if args.limit and done >= args.limit:
                print("Reached limit, stopping early.")
                break

            done += 1
            filename = safe_name(page_title) + ".txt"
            filepath = os.path.join(section_dir, f"{i}_{filename}")

            label = f"{entry['category']}/{entry['section']}"
            if entry['category'] == entry['section']:
                label = entry['category']
            if entry.get("subsection"):
                label += f"/{entry['subsection']}"
            print(f"[{done}/{total_pages}] {label}: {page_title}")

            if os.path.exists(filepath):
                continue

            time.sleep(DELAY_SECONDS)

            wikitext = get_wikitext(page_title)
            if not wikitext:
                skipped += 1
                continue

            plot_text = extract_plot_text(wikitext)
            if not plot_text:
                skipped += 1
                continue
            
            with open(filepath, "w", encoding="utf-8") as f:
                    f.write(plot_text)

            index_entry: dict = {
                "category": entry["category"],
                "section":  entry["section"] if entry["section"] != entry["category"] else "",
                "title":    page_title,
                "file":     f"{category}/{section}/{filename}",
            }
            if entry.get("subsection"):
                index_entry["subsection"] = entry["subsection"]
            index.append(index_entry)

        if args.limit and done >= args.limit:
            break

    index_path = os.path.join(OUTPUT_DIR, "_index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"\nDone. {done - skipped} saved, {skipped} skipped.")


if __name__ == "__main__":
    main()