"""
Scrape 集成战略 supplementary text from prts.wiki into data/is_text.json,
then run import_is_text.py to load it into the DB.

Two content kinds are extracted from each theme's archive sub-page:

  遐想交织录 (and theme-specific equivalents)  →  character_record clusters
      Structure: level-3 subsections, each = one monthly entry.
      Character name from: 奇遇讲述者：[[Name]] in wikitext; falls back to
      the section heading (works for themes where heading = character name).
      Content formats supported (auto-detected in order):
        1. '''PART N''' blocks with <poem> content (萨卡兹/水月/探索者/界园)
        2. bare <poem> blocks without PART markers
        3. <div> blocks with letter/document text (e.g. 背景故事)
        4. '''Part.N''' wikitable dialogue blocks (傀影 通讯记录仪)

  预言诗篇 (and theme-specific equivalents)    →  ending_supplement clusters
      Structure: level-3 subsections, one per ending.
      level_code derived from section heading:
        "Ending 0N：…"            → {prefix}-END-N   (standard)
        "结局·壹/贰/叁/肆/伍：…"  → {prefix}-END-1…5  (界园 format)
      Content: same PART block structure as character records.

Extra character sections (extra_char_indices on ThemeSpec) handle single
deep-nested sections outside the regular subsection structure —
e.g. 傀影与猩红孤钻's 背景故事 (toclevel 4 under 探索情报板/7.2.3).

THEMES config — add new entries as more archive sub-pages are confirmed.
`level_prefix` is the IS theme's chapter-code prefix (RO4 for IS5, RO5 for
IS6, etc.); it maps ending numbers to level_codes already in the DB.

Usage:
    python scripts/scrape_is_text.py
    python scripts/scrape_is_text.py --force   # re-scrape themes already in JSON
    python scripts/scrape_is_text.py --no-import  # write JSON only, skip DB import

The script is idempotent: without --force it skips themes whose story name is
already present in data/is_text.json.  Writes a debug file
data/is_text_scrape.json (per-theme counts, same idiom as events/gadgets).

Dependencies: stdlib only (no requests / BS4 needed).
.env not required — this script only writes files, not DB rows.
DB import happens via import_is_text.py at the end (unless --no-import).
"""

import argparse
import json
import logging
import re
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

DATA_DIR    = Path(__file__).parent.parent / "data"
OUT_JSON    = DATA_DIR / "is_text.json"
DEBUG_JSON  = DATA_DIR / "is_text_scrape.json"

API_URL      = "https://prts.wiki/api.php"
SSL_CTX      = ssl._create_unverified_context()
MAX_RETRIES  = 4
RETRY_BACKOFF = 2.0
TIMEOUT      = 60
DELAY        = 0.3   # courtesy gap between API calls

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# 界园 format uses Chinese ordinals in ending headings: 结局·壹：依律镇扬
_CHINESE_ORDINALS = {
    '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5,
    '陆': 6, '柒': 7, '捌': 8, '玖': 9, '十': 10,
}


# ---------------------------------------------------------------------------
# Theme registry — extend here when more archive sub-pages are confirmed.
# ---------------------------------------------------------------------------

@dataclass
class ThemeSpec:
    story:        str   # must match stories.name in DB
    page:         str   # wiki page title (not URL-encoded)
    level_prefix: str   # e.g. "RO4" → endings become RO4-END-1, RO4-END-2, …
    category:     str   = "集成战略"

    # Section-heading names on this wiki page (theme pages sometimes rename them).
    record_heading: str = "遐想交织录"
    ending_heading: str = "预言诗篇"   # empty string = no ending supplements

    # Section indices of individual sections to treat as extra character records.
    # Used for sections that don't fall under record_heading (e.g. 傀影 背景故事).
    extra_char_indices: list[int] = field(default_factory=list)


THEMES: list[ThemeSpec] = [
    ThemeSpec(
        story        = "萨卡兹的无终奇语",
        page         = "萨卡兹的无终奇语/巫仪档案库",
        level_prefix = "RO4",
    ),
    ThemeSpec(
        story              = "傀影与猩红孤钻",
        page               = "傀影与猩红孤钻/猩红珍藏",
        level_prefix       = "RO1",
        record_heading     = "通讯记录仪",
        ending_heading     = "",            # no ending supplement section
        extra_char_indices = [29],          # 背景故事 under 探索情报板/7.2.3
    ),
    ThemeSpec(
        story          = "水月与深蓝之树",
        page           = "水月与深蓝之树/深蓝记录仪",
        level_prefix   = "RO2",
        record_heading = "万象追忆录",
        ending_heading = "刻时碑林",
    ),
    ThemeSpec(
        story          = "探索者的银凇止境",
        page           = "探索者的银凇止境/冬夜展览馆",
        level_prefix   = "RO3",
        record_heading = "队员访谈录",
        ending_heading = "边缘历史集",
    ),
    ThemeSpec(
        story          = "岁的界园志异",
        page           = "岁的界园志异/见字图册",
        level_prefix   = "RO5",
        record_heading = "游园访谈",
        ending_heading = "界园秘辛",
    ),
    # NOTE: 刻俄柏的灰蕈迷境  — no character records (see CLAUDE.md)
]


# ---------------------------------------------------------------------------
# Network helpers (same retry/backoff idiom as scrape_gadgets.py)
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
            log.warning(f"  retry {attempt+1}/{MAX_RETRIES} after {wait:.0f}s "
                        f"({type(e).__name__}): {e}")
            time.sleep(wait)
    raise last  # type: ignore[misc]


def _api(params: dict) -> dict:
    qs  = urllib.parse.urlencode({**params, "format": "json"})
    url = f"{API_URL}?{qs}"
    return json.loads(_urlopen(url).decode("utf-8"))


def _get_sections(page: str) -> list[dict]:
    data = _api({"action": "parse", "page": page, "prop": "sections"})
    return data.get("parse", {}).get("sections", [])


def _get_wikitext(page: str, section_index: str | int) -> str:
    data = _api({"action": "parse", "page": page, "prop": "wikitext",
                 "section": str(section_index)})
    return data.get("parse", {}).get("wikitext", {}).get("*", "")


# ---------------------------------------------------------------------------
# Wikitext cleaning
# ---------------------------------------------------------------------------

def _clean(text: str) -> str:
    """Strip wikitext markup from prose, leaving clean readable text."""
    # [[File:...]] or [[Image:...]] → remove
    text = re.sub(r'\[\[(?:File|Image|文件):[^\]]*\]\]', '', text, flags=re.IGNORECASE)
    # [[Link|Display]] → Display
    text = re.sub(r'\[\[[^\]|]*\|([^\]]+)\]\]', r'\1', text)
    # [[Link]] → Link
    text = re.sub(r'\[\[([^\]]+)\]\]', r'\1', text)
    # '''bold''' → bold
    text = re.sub(r"'{3}(.*?)'{3}", r'\1', text)
    # ''italic'' → italic
    text = re.sub(r"'{2}(.*?)'{2}", r'\1', text)
    # <ref>…</ref> and <ref … />
    text = re.sub(r'<ref[^>]*/>', '', text)
    text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.DOTALL)
    # <br> → newline
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    # Remaining HTML/wiki tags
    text = re.sub(r'<[^>]+>', '', text)
    # Leading table-cell markers (| or !) at start of line
    text = re.sub(r'(?m)^\s*[|!]\s*', '', text)
    # Normalise whitespace: collapse multiple blank lines to one
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ---------------------------------------------------------------------------
# Content extraction — multiple format strategies
# ---------------------------------------------------------------------------

def _extract_parts(wikitext: str) -> list[dict]:
    """
    Return [{title, body}, …] for each '''PART N''' block in the wikitext.
    title — the italic sub-heading immediately after the PART header (may be None).
    body  — cleaned prose from the <poem> block.

    Fallback 1: bare <poem> blocks without PART markers.
    Fallback 2: <div> blocks with styled text (e.g. letter/document format).
    """
    chunks: list[dict] = []
    segments = re.split(r"'''PART\s+\d+'''", wikitext)
    for seg in segments[1:]:
        title_m = re.search(r"\|''(.*?)''", seg)
        title   = _clean(title_m.group(1)) if title_m else None
        poem_m  = re.search(r'<poem>(.*?)</poem>', seg, re.DOTALL)
        if not poem_m:
            continue
        body = _clean(poem_m.group(1))
        if not body:
            continue
        chunks.append({"title": title or None, "body": body})

    # Fallback 1: bare <poem> blocks
    if not chunks:
        for pm in re.finditer(r'<poem>(.*?)</poem>', wikitext, re.DOTALL):
            body = _clean(pm.group(1))
            if body:
                chunks.append({"title": None, "body": body})

    # Fallback 2: <div> blocks (letter/document format, e.g. 傀影 背景故事)
    if not chunks:
        for dm in re.finditer(r'<div[^>]*>(.*?)</div>', wikitext, re.DOTALL):
            body = _clean(dm.group(1))
            if body and len(body) > 20:
                chunks.append({"title": None, "body": body})

    return chunks


def _extract_dialogue_parts(wikitext: str) -> list[dict]:
    """
    Parse the 傀影 wikitable dialogue format (通讯记录仪 sections).

    Parts use '''Part.N''' markers (period, not space like PART N).
    Each Part is a collapsible wikitable with rows:
      avatar cell:    |[[文件:头像 X.png|...]]  → sets current speaker
      dialogue cell:  |text                     → dialogue line
    Returns [{title, body}, …] where body is formatted as "Speaker：line\\n…".
    """
    chunks: list[dict] = []
    segments = re.split(r"'''Part\.\s*0*(\d+)'''", wikitext)
    # segments: [preamble, "1", content1, "2", content2, …]
    i = 1
    while i + 1 < len(segments):
        part_num = segments[i]
        content  = segments[i + 1]
        i += 2

        title_m = re.search(r'<small>(.*?)</small>', content, re.DOTALL)
        title = None
        if title_m:
            t = re.sub(r'<[^>]*>', '', title_m.group(1))   # strip HTML tags
            t = re.sub(r'\[\[.*?\]\]', '', t).strip()       # strip wiki links
            title = t or None

        lines: list[str] = []
        current_speaker: str | None = None
        for raw_line in content.split('\n'):
            ln = raw_line.strip()
            # Skip table structure markers
            if (not ln or ln == '|-'
                    or ln.startswith('{|') or ln.startswith('|}')
                    or ln.startswith('|+')):
                continue
            # Skip header cells (!) — always metadata (log IDs etc.)
            if ln.startswith('!'):
                continue
            # Skip special wikitext blocks we handle elsewhere
            if ln.startswith('<small>') or ln.startswith('<noinclude>'):
                continue
            # Strip leading cell marker |
            if ln.startswith('|'):
                ln = ln[1:].strip()
            if not ln:
                continue
            # Cell has formatting params (rowspan=N style="..."|content)
            if re.match(r'(?:rowspan|colspan|style|class)\s*=', ln):
                parts_of_cell = ln.rsplit('|', 1)
                ln = parts_of_cell[-1].strip() if len(parts_of_cell) > 1 else ''
                if not ln:
                    continue
            # Avatar cell → update current speaker
            av = re.search(r'\[\[文件:头像\s+(.+?)\.png', ln)
            if av:
                current_speaker = av.group(1).strip()
                continue
            # Skip other image links
            if re.search(r'\[\[(?:文件|File|Image):', ln, re.IGNORECASE):
                continue
            text = _clean(ln)
            if text and len(text) > 1:
                prefix = f"{current_speaker}：" if current_speaker else ""
                lines.append(f"{prefix}{text}")

        if lines:
            chunks.append({"title": title, "body": '\n'.join(lines)})

    return chunks


# ---------------------------------------------------------------------------
# Section-level parsers
# ---------------------------------------------------------------------------

def _parse_character(wikitext: str, fallback_name: str | None = None) -> dict | None:
    """
    Parse one character-record subsection → {name, name_en, chunks} or None.

    Character name comes from 奇遇讲述者：[[Name]] in the wikitext;
    falls back to fallback_name (typically the section heading).
    Content format is auto-detected: poem → div → dialogue (wikitable).
    """
    m = re.search(r'奇遇讲述者[：:]\s*\[\[([^\]|]+)', wikitext)
    if m:
        name = m.group(1).strip()
    elif fallback_name:
        name = fallback_name
    else:
        return None

    # Try poem/div format first, then wikitable dialogue format.
    chunks = _extract_parts(wikitext)
    if not chunks:
        chunks = _extract_dialogue_parts(wikitext)
    if not chunks:
        return None
    return {"name": name, "name_en": None, "chunks": chunks}


def _parse_ending(wikitext: str, level_prefix: str, section_title: str) -> dict | None:
    """Parse one ending-supplement subsection → {level_code, chunks} or None."""
    m = re.search(r'Ending\s+0*(\d+)', section_title, re.IGNORECASE)
    if m:
        num = int(m.group(1))
    else:
        # 界园 format: "结局·壹：依律镇扬" / "结局·贰：…" / …
        cm = re.search(r'结局[··]\s*([壹贰叁肆伍陆柒捌玖十])', section_title)
        if cm:
            num = _CHINESE_ORDINALS.get(cm.group(1), 0)
        else:
            log.warning(f"  can't extract ending number from {section_title!r} — skip")
            return None
    level_code = f"{level_prefix}-END-{num}"
    chunks     = _extract_parts(wikitext)
    if not chunks:
        return None
    return {"level_code": level_code, "chunks": chunks}


# ---------------------------------------------------------------------------
# Section discovery
# ---------------------------------------------------------------------------

def _child_sections(all_sections: list[dict], heading: str) -> list[dict]:
    """
    Return the toclevel-2 subsections directly under the named toclevel-1 heading.
    """
    inside = False
    result = []
    for s in all_sections:
        lvl = int(s["toclevel"])
        if lvl == 1:
            inside = (s["line"] == heading)
        elif inside and lvl == 2:
            result.append(s)
    return result


# ---------------------------------------------------------------------------
# Per-theme scrape
# ---------------------------------------------------------------------------

def scrape_theme(spec: ThemeSpec) -> dict:
    log.info(f"Fetching sections for {spec.story} ({spec.page})")
    all_secs = _get_sections(spec.page)

    record_subs = _child_sections(all_secs, spec.record_heading)
    ending_subs = _child_sections(all_secs, spec.ending_heading) if spec.ending_heading else []

    log.info(f"  found {len(record_subs)} {spec.record_heading!r} subsections, "
             f"{len(ending_subs)} {(spec.ending_heading or '—')!r} subsections")

    characters: list[dict] = []
    for i, sub in enumerate(record_subs):
        time.sleep(DELAY)
        wt = _get_wikitext(spec.page, sub["index"])
        result = _parse_character(wt, fallback_name=sub["line"])
        if result:
            result["seq"] = i
            characters.append(result)
            log.info(f"    [{i+1}/{len(record_subs)}] character: {result['name']!r} "
                     f"({len(result['chunks'])} chunks)")
        else:
            log.warning(f"    [{i+1}/{len(record_subs)}] could not parse {sub['line']!r}")

    # Extra single-section character records outside the standard heading structure.
    sec_by_index = {int(s["index"]): s for s in all_secs}
    for idx in spec.extra_char_indices:
        time.sleep(DELAY)
        wt = _get_wikitext(spec.page, idx)
        sec = sec_by_index.get(idx)
        section_name = _clean(sec["line"]) if sec else str(idx)
        result = _parse_character(wt, fallback_name=section_name)
        if result:
            result["seq"] = len(characters)
            characters.append(result)
            log.info(f"    extra[{idx}] character: {result['name']!r} "
                     f"({len(result['chunks'])} chunks)")
        else:
            log.warning(f"    extra[{idx}] could not parse {section_name!r}")

    endings: list[dict] = []
    for i, sub in enumerate(ending_subs):
        time.sleep(DELAY)
        wt = _get_wikitext(spec.page, sub["index"])
        result = _parse_ending(wt, spec.level_prefix, sub["line"])
        if result:
            result["seq"] = i
            endings.append(result)
            log.info(f"    [{i+1}/{len(ending_subs)}] ending: {result['level_code']!r} "
                     f"({len(result['chunks'])} chunks)")
        else:
            log.warning(f"    [{i+1}/{len(ending_subs)}] could not parse {sub['line']!r}")

    return {
        "category": spec.category,
        "story":    spec.story,
        "endings":  endings,
        "characters": characters,
        "_debug": {
            "characters": len(characters),
            "endings":    len(endings),
            "total_char_chunks": sum(len(c["chunks"]) for c in characters),
            "total_end_chunks":  sum(len(e["chunks"]) for e in endings),
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force",     action="store_true",
                    help="Re-scrape themes already present in is_text.json")
    ap.add_argument("--no-import", action="store_true",
                    help="Write JSON only; skip running import_is_text.py")
    args = ap.parse_args()

    existing: dict[str, dict] = {}
    if OUT_JSON.exists():
        for entry in json.loads(OUT_JSON.read_text(encoding="utf-8")):
            existing[entry["story"]] = entry

    debug_stats: dict[str, dict] = {}
    changed = False

    for spec in THEMES:
        if spec.story in existing and not args.force:
            log.info(f"Skipping {spec.story!r} (already in {OUT_JSON.name}; "
                     f"pass --force to re-scrape)")
            debug_stats[spec.story] = existing[spec.story].get("_debug", {})
            continue

        theme_data = scrape_theme(spec)
        debug_stats[spec.story] = theme_data.pop("_debug", {})
        existing[spec.story]    = theme_data
        changed = True

    if changed:
        out_list = list(existing.values())
        OUT_JSON.write_text(
            json.dumps(out_list, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        log.info(f"Wrote {OUT_JSON}  ({len(out_list)} theme(s))")
    else:
        log.info("Nothing changed (all themes already scraped; use --force to refresh)")

    DEBUG_JSON.write_text(
        json.dumps(debug_stats, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info(f"Debug counts → {DEBUG_JSON.name}: "
             + ", ".join(f"{s}: {v}" for s, d in debug_stats.items()
                         for k, v in d.items() if "chunks" in k))

    if not args.no_import and changed:
        log.info("Running import_is_text.py …")
        result = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "import_is_text.py")],
            check=False,
        )
        if result.returncode != 0:
            log.error("import_is_text.py exited non-zero — check output above")
            sys.exit(result.returncode)


if __name__ == "__main__":
    main()
