"""
Scrape section icons from prts.wiki/w/剧情角色一览.

The page is structured as:
  === group ===              e.g. 觉醒, 幻灭, 残阳, 那被祝福的, ...
  ==== section_name ====     e.g. 序章 黑暗时代·上, 第一章 黑暗时代·下, ...
  [[文件:章节名称 xxx.png|无框|100px]]   ← the section icon

This script:
  1. Parses all (group, section_name, icon_file) triples
  2. Downloads each icon to  data/section_icons/
  3. Writes data/section_icons.json  — full list for review
  4. Writes data/section_icons.sql   — INSERT INTO section_meta ... for manual review
     NOTE: section names on this page may differ slightly from the DB (e.g.
     "序章 黑暗时代·上" vs "黑暗时代·上"). Review the SQL before running.

Usage:
    pip install requests
    python scripts/scrape_section_icons.py
"""

import re
import time
import json
import requests
from pathlib import Path

API_URL   = "https://prts.wiki/api.php"
PAGE      = "剧情角色一览"
ICONS_DIR = Path(__file__).parent.parent / "data" / "section_icons"
OUT_JSON  = Path(__file__).parent.parent / "data" / "section_icons.json"
OUT_SQL   = Path(__file__).parent.parent / "data" / "section_icons.sql"
DELAY     = 0.4


# ---------------------------------------------------------------------------
# Fetch wikitext
# ---------------------------------------------------------------------------

def get_wikitext(title: str) -> str:
    resp = requests.get(API_URL, params={
        "action": "query", "prop": "revisions", "titles": title,
        "rvprop": "content", "rvslots": "main", "format": "json",
    }, timeout=30)
    resp.raise_for_status()
    for page in resp.json()["query"]["pages"].values():
        if "revisions" in page:
            return page["revisions"][0]["slots"]["main"]["*"]
    return ""


# ---------------------------------------------------------------------------
# Resolve wiki File: → direct download URL
# ---------------------------------------------------------------------------

def resolve_file_url(filename: str) -> str | None:
    """filename e.g. 'File:章节名称 序章.png'"""
    resp = requests.get(API_URL, params={
        "action": "query", "titles": filename,
        "prop": "imageinfo", "iiprop": "url",
        "format": "json",
    }, timeout=30)
    resp.raise_for_status()
    for page in resp.json()["query"]["pages"].values():
        ii = page.get("imageinfo", [])
        if ii:
            return ii[0]["url"]
    return None


# ---------------------------------------------------------------------------
# Parse wikitext
# ---------------------------------------------------------------------------

def parse_sections(wikitext: str) -> list[dict]:
    """
    Returns list of:
      { group, section_name, icon_file, icon_path (filled later) }
    """
    results = []
    current_group   = ""
    current_section = ""
    lines = wikitext.splitlines()

    for line in lines:
        s = line.strip()

        # === group === (level 3)
        m = re.match(r"^===([^=]+)===$", s)
        if m:
            current_group   = m.group(1).strip()
            current_section = ""
            continue

        # ==== section ==== (level 4)
        m = re.match(r"^====([^=]+)====$", s)
        if m:
            current_section = m.group(1).strip()
            continue

        # [[文件:xxx.png|...]] — icon line immediately after section header
        m = re.match(r"^\[\[(?:文件|File):([^\]|]+\.(?:png|jpg|jpeg|webp))\|", s, re.I)
        if m and current_section:
            icon_file = f"File:{m.group(1).strip()}"
            results.append({
                "group":        current_group,
                "section_name": current_section,
                "icon_file":    icon_file,
                "icon_path":    None,   # filled after download
            })

    return results


# ---------------------------------------------------------------------------
# Download icons
# ---------------------------------------------------------------------------

def download_icons(sections: list[dict]):
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    seen: dict[str, str | None] = {}  # icon_file → local relative path

    for sec in sections:
        icon_file = sec["icon_file"]

        if icon_file in seen:
            sec["icon_path"] = seen[icon_file]
            continue

        safe = re.sub(r"[^\w\-.]", "_", icon_file.removeprefix("File:"))
        local = ICONS_DIR / safe

        if local.exists():
            print(f"  cached:  {safe}")
            path = f"section_icons/{safe}"
            sec["icon_path"] = path
            seen[icon_file] = path
            continue

        print(f"  resolving: {icon_file}")
        url = resolve_file_url(icon_file)
        if not url:
            print(f"    WARNING: no URL for {icon_file}")
            seen[icon_file] = None
            continue

        print(f"  downloading: {url}")
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        local.write_bytes(r.content)

        path = f"section_icons/{safe}"
        sec["icon_path"] = path
        seen[icon_file] = path
        time.sleep(DELAY)


# ---------------------------------------------------------------------------
# Write outputs
# ---------------------------------------------------------------------------

def escape_sql(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def write_outputs(sections: list[dict]):
    # JSON
    OUT_JSON.write_text(
        json.dumps(sections, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Written {OUT_JSON}")

    # SQL — IMPORTANT: section_name from this page may not match DB exactly.
    # Each INSERT is commented with the raw wiki section name so you can verify.
    sql_lines = [
        "-- Auto-generated by scrape_section_icons.py",
        "-- REVIEW section names before running — wiki names may differ from DB.",
        "-- e.g. wiki '序章 黑暗时代·上' vs DB '黑暗时代·上'",
        "-- category is left as '' — fill in the correct value for each row.",
        "",
    ]
    for sec in sections:
        sql_lines.append(
            f"-- wiki section: {sec['section_name']} (group: {sec['group']})"
        )
        sql_lines.append(
            f"INSERT INTO section_meta (category, section, image_path)"
            f" VALUES ('',"
            f" {escape_sql(sec['section_name'])},"
            f" {escape_sql(sec['icon_path'])})"
            f" ON CONFLICT (category, section) DO UPDATE SET image_path = EXCLUDED.image_path;"
        )
        sql_lines.append("")

    OUT_SQL.write_text("\n".join(sql_lines), encoding="utf-8")
    print(f"Written {OUT_SQL}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Fetching {PAGE} …")
    wikitext = get_wikitext(PAGE)

    print("Parsing section icons …")
    sections = parse_sections(wikitext)
    print(f"Found {len(sections)} sections across "
          f"{len(set(s['group'] for s in sections))} groups.\n")

    for s in sections:
        print(f"  [{s['group']}] {s['section_name']}  →  {s['icon_file']}")

    print()
    print("Downloading icons …")
    download_icons(sections)

    write_outputs(sections)

    print(f"\nDone.")
    print(f"  Icons  → {ICONS_DIR}")
    print(f"  JSON   → {OUT_JSON}")
    print(f"  SQL    → {OUT_SQL}  (review section names before running!)")
    print()
    print("Next steps:")
    print("  1. Upload data/section_icons/ to Supabase Storage under 'section_icons/'")
    print("  2. Edit data/section_icons.sql: set correct category and section for each row")
    print("  3. Run the SQL in Supabase SQL editor")


if __name__ == "__main__":
    main()
