"""
Scrape operator profile data from prts.wiki:
  - Operator icon      (头像_<op>.png)
  - Cover art          (立绘_<op>_2.png, Elite-2 standing art)
  - 人员档案            (personnel file, from the 干员档案 wiki section)
  - 语音记录            (voice records, Chinese text only, from <op>/语音记录 subpage)

Output:
  data/operator_profiles.json                  — structured profile data
  data/img/干员/<op>/<op>_icon.png             — small avatar icon
  data/img/干员/<op>/<op>_cover.png            — Elite-2 standing art (cover)

Idempotency: skips operators already present in operator_profiles.json unless --force.
Run import_operator_profiles.py after this to load into the DB.

Usage:
    python scripts/scrape_operator_profile.py
    python scripts/scrape_operator_profile.py --force
    python scripts/scrape_operator_profile.py --op 凛御银灰
    python scripts/scrape_operator_profile.py --limit 10
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import logging
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT        = Path(__file__).parent.parent
DATA_DIR    = ROOT / "data"
OUTPUT_JSON = DATA_DIR / "operator_profiles.json"
ICONS_DIR   = DATA_DIR / "img" / "干员"

API_URL       = "https://prts.wiki/api.php"
SSL_CTX       = ssl._create_unverified_context()
MAX_RETRIES   = 4
RETRY_BACKOFF = 2.0
DELAY         = 0.5
TIMEOUT       = 60

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

_ILLEGAL = str.maketrans(':*?"<>|\\/', '_________')


def safe_name(s: str) -> str:
    return s.translate(_ILLEGAL).strip('.')


# ---------------------------------------------------------------------------
# Network
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
                        f"({type(e).__name__})")
            time.sleep(wait)
    raise last  # type: ignore[misc]


def api(params: dict) -> dict:
    url = API_URL + "?" + urllib.parse.urlencode(params)
    return json.loads(_urlopen(url).decode("utf-8"))


# ---------------------------------------------------------------------------
# HTML utilities
# ---------------------------------------------------------------------------

def clean_html(s: str) -> str:
    """Strip HTML tags, convert <br> to newlines, decode entities."""
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html_mod.unescape(s)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n[ \t]+', '\n', s)
    s = re.sub(r'[ \t]+\n', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


# ---------------------------------------------------------------------------
# Personnel file (干员档案 section)
# ---------------------------------------------------------------------------

ROW_RE   = re.compile(r'<tr(?:\s[^>]*)?>([\s\S]*?)</tr>', re.I)
DARK_RE  = re.compile(r'background[^;]*#424242', re.I)
SMALL_RE = re.compile(r'<small[^>]*>([\s\S]*?)</small>', re.I)
TD_RE    = re.compile(r'<td(?:\s[^>]*)?>', re.I)


def parse_personnel_file(section_html: str) -> list[dict]:
    """Extract {title, unlock, body} dicts from the personnel-file wikitable.

    Structure per section:
      <tr><th style="...background:#424242...">TITLE</th></tr>
      <tr><th><small>UNLOCK_CONDITION</small></th></tr>   ← optional
      <tr><td>BODY_HTML</td></tr>
    """
    rows = [m.group(1) for m in ROW_RE.finditer(section_html)]
    result: list[dict] = []
    i = 0
    while i < len(rows):
        row = rows[i]
        if DARK_RE.search(row):
            title = clean_html(row)
            if not title:
                i += 1
                continue
            unlock = ''
            body = ''
            i += 1
            # Optional next row: unlock condition (th containing <small>, no <td>)
            if i < len(rows):
                nxt = rows[i]
                ms = SMALL_RE.search(nxt)
                if ms and not TD_RE.search(nxt) and not DARK_RE.search(nxt):
                    unlock = clean_html(ms.group(1))
                    i += 1
            # Content row (must contain <td>)
            if i < len(rows) and TD_RE.search(rows[i]):
                body = clean_html(rows[i])
                i += 1
            if body:
                result.append({'title': title, 'unlock': unlock, 'body': body})
        else:
            i += 1
    return result


# ---------------------------------------------------------------------------
# Voice records (<op>/语音记录 subpage)
# ---------------------------------------------------------------------------

# Opening tag of each voice item — captures data-title
VOICE_ITEM_RE = re.compile(
    r'<div\s+class="voice-data-item"[^>]*\bdata-title="([^"]*)"[^>]*>',
    re.I,
)
# Detail div for a specific language — captures (language, text)
VOICE_DETAIL_RE = re.compile(
    r'<div\s+class="voice-item-detail"\s+data-kind-name="([^"]*)"[^>]*>'
    r'([\s\S]*?)</div>',
    re.I,
)


def parse_voice_records(page_html: str) -> list[dict]:
    """Extract {title, body} from voice-data-item divs (Chinese text only)."""
    items = list(VOICE_ITEM_RE.finditer(page_html))
    records: list[dict] = []
    for k, m in enumerate(items):
        title = m.group(1)
        start = m.end()
        end = items[k + 1].start() if k + 1 < len(items) else len(page_html)
        chunk = page_html[start:end]
        body = ''
        for dm in VOICE_DETAIL_RE.finditer(chunk):
            if dm.group(1) == '中文':
                body = clean_html(dm.group(2))
                break
        if title and body:
            records.append({'title': title, 'body': body})
    return records


# ---------------------------------------------------------------------------
# Image downloads  (per-operator folder layout)
# ---------------------------------------------------------------------------

def _op_dir(op: str) -> Path:
    """Return (and create) the per-operator image folder."""
    d = ICONS_DIR / safe_name(op)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _download_wiki_image(wiki_file: str, dst: Path, label: str) -> bool:
    """Download a wiki file page image to dst. Returns True on success."""
    d = api({
        'action': 'query',
        'titles': wiki_file,
        'prop': 'imageinfo',
        'iiprop': 'url',
        'format': 'json',
        'formatversion': '2',
    })
    for page in d.get('query', {}).get('pages', []):
        if page.get('missing'):
            log.warning(f"  {label} not found on wiki")
            return False
        for ii in page.get('imageinfo', []):
            url = ii.get('url')
            if url:
                data = _urlopen(url)
                dst.write_bytes(data)
                log.info(f"  {label} → {dst.name} ({len(data)} bytes)")
                return True
    return False


def download_icon(op: str, *, force: bool) -> str | None:
    """Download 头像_<op>.png into the per-operator folder.
    Returns path relative to data/, or None."""
    dst = _op_dir(op) / (safe_name(op) + '_icon.png')
    rel = str(dst.relative_to(DATA_DIR)).replace('\\', '/')
    if dst.exists() and not force:
        return rel
    ok = _download_wiki_image(f'文件:头像_{op}.png', dst, f'[{op}] icon')
    return rel if ok else None


def download_cover_art(op: str, *, force: bool) -> str | None:
    """Download 立绘_<op>_2.png (Elite-2) or 立绘_<op>_1.png (fallback).
    Returns path relative to data/, or None."""
    dst = _op_dir(op) / (safe_name(op) + '_cover.png')
    rel = str(dst.relative_to(DATA_DIR)).replace('\\', '/')
    if dst.exists() and not force:
        return rel
    for suffix in ('_2', '_1'):
        ok = _download_wiki_image(f'文件:立绘_{op}{suffix}.png', dst, f'[{op}] cover art ({suffix})')
        if ok:
            return rel
    return None


# ---------------------------------------------------------------------------
# Section helpers
# ---------------------------------------------------------------------------

def get_sections(op: str) -> dict[str, str]:
    """Return {section_title: index} for the operator's wiki page."""
    d = api({'action': 'parse', 'page': op, 'prop': 'sections',
             'format': 'json', 'formatversion': '2'})
    if 'error' in d:
        return {}
    return {
        s.get('line', ''): s.get('index', '')
        for s in d.get('parse', {}).get('sections', [])
    }


def fetch_section_html(op: str, index: str) -> str | None:
    d = api({'action': 'parse', 'page': op, 'prop': 'text',
             'section': index, 'format': 'json', 'formatversion': '2'})
    if 'error' in d:
        return None
    return d.get('parse', {}).get('text')


def fetch_page_html(page: str) -> str | None:
    d = api({'action': 'parse', 'page': page, 'prop': 'text',
             'format': 'json', 'formatversion': '2'})
    if 'error' in d or 'parse' not in d:
        return None
    return d.get('parse', {}).get('text')


# ---------------------------------------------------------------------------
# Operator list
# ---------------------------------------------------------------------------

def get_operator_list() -> list[str]:
    """All operator pages from Category:干员 (main namespace only).

    Excludes sub-pages (title contains '/') to keep only root operator
    pages. Covers all operators including alternate forms (e.g. 凛御银灰)
    that may not have 干员密录 stories yet.
    """
    pages: list[str] = []
    cmcontinue: str | None = None
    while True:
        params: dict = {
            'action': 'query',
            'list': 'categorymembers',
            'cmtitle': 'Category:干员',
            'cmnamespace': '0',
            'cmlimit': '500',
            'cmtype': 'page',
            'format': 'json',
        }
        if cmcontinue:
            params['cmcontinue'] = cmcontinue
        d = api(params)
        for p in d.get('query', {}).get('categorymembers', []):
            title = p['title']
            if '/' not in title:   # skip sub-pages like 银灰/模组
                pages.append(title)
        cont = d.get('continue', {})
        cmcontinue = cont.get('cmcontinue')
        if not cmcontinue:
            break
        time.sleep(DELAY)
    return pages


# ---------------------------------------------------------------------------
# Per-operator scrape
# ---------------------------------------------------------------------------

def scrape_op(op: str, *, force: bool) -> dict:
    """Scrape one operator's profile. Always returns a dict (lists may be empty)."""
    result: dict = {
        'op': op,
        'icon_file': None,
        'cover_art_file': None,
        'personnel_file': [],
        'voice_records': [],
    }

    # Images — both go into data/img/干员/<op>/
    result['icon_file']      = download_icon(op, force=force)
    time.sleep(DELAY)
    result['cover_art_file'] = download_cover_art(op, force=force)
    time.sleep(DELAY)

    # Personnel file — locate 干員档案 section index first
    secs = get_sections(op)
    time.sleep(DELAY)
    pf_idx = secs.get('干员档案')
    if pf_idx:
        pf_html = fetch_section_html(op, pf_idx)
        time.sleep(DELAY)
        if pf_html:
            result['personnel_file'] = parse_personnel_file(pf_html)
            log.info(f"  [{op}] personnel_file: {len(result['personnel_file'])} sections")
    else:
        log.warning(f"  [{op}] no 干员档案 section")

    # Voice records — dedicated subpage <op>/语音记录
    vr_html = fetch_page_html(f'{op}/语音记录')
    time.sleep(DELAY)
    if vr_html:
        result['voice_records'] = parse_voice_records(vr_html)
        log.info(f"  [{op}] voice_records: {len(result['voice_records'])} lines")
    else:
        log.warning(f"  [{op}] no 语音记录 subpage")

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--force', action='store_true',
                   help='Re-scrape even if already present in JSON')
    p.add_argument('--op', help='Scrape a single operator by name')
    p.add_argument('--limit', type=int,
                   help='Process only the first N operators (for testing)')
    args = p.parse_args()

    if args.op:
        ops = [args.op]
    else:
        log.info('Fetching operator list from Template:干员档案...')
        ops = get_operator_list()
        log.info(f'{len(ops)} operators found')
        if args.limit:
            ops = ops[:args.limit]

    # Load existing profiles for incremental update
    existing: dict[str, dict] = {}
    if OUTPUT_JSON.exists() and not args.force:
        for entry in json.loads(OUTPUT_JSON.read_text('utf-8')):
            existing[entry['op']] = entry

    results: list[dict] = []
    ok = skipped = failed = 0

    for op in ops:
        if op in existing and not args.force:
            log.info(f'→ {op} (skip)')
            results.append(existing[op])
            skipped += 1
            continue

        log.info(f'→ {op}')
        try:
            profile = scrape_op(op, force=args.force)
            results.append(profile)
            ok += 1
        except Exception as e:
            log.error(f'  [{op}] FAILED: {e}')
            failed += 1
        time.sleep(DELAY)

    OUTPUT_JSON.write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    log.info('---')
    log.info(f'scraped={ok}  skipped={skipped}  failed={failed}')
    log.info(f'wrote → {OUTPUT_JSON.name}')


if __name__ == '__main__':
    main()
