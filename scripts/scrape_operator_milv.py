"""
Scrape 干员密录 (operator secret record) stories from prts.wiki and write
them as plot .txt files so the existing parse_plots.py pipeline can import
them into `stories` + `chapters` + `scenes` + `nodes`.

Data source
-----------
Each operator that has 密录 content has a `==干员密录==` section on their
main wiki page. The section contains one or two `{{干员密录/list}}` template
blocks, each with a `storySetName` title and a `storyTxt1` subpage pointer
like `{{FULLPAGENAME}}/干员密录/1`. The actual AVG script lives at that
subpage, embedded in `{{剧情模板实验|...|文本内容=\n<AVG>\n}}`.

Output
------
data/plots/干员/<operator>/<N>_<storySetName>.txt  — raw AVG text, same
    format as every other story under data/plots/.

data/operator_milv.json — metadata list
    [{op, sets: [{seq, name, intro, page}]}]
    The intro text per story set is preserved here for future use (e.g. as
    a chapter description field once that column exists).

Idempotency
-----------
Skips operators whose target .txt files already exist (use --force to redo).
A per-operator marker file `data/plots/干员/<op>/.done` is NOT used — just
check file presence. The JSON is always re-written in full.

Usage
-----
    python scripts/scrape_operator_milv.py
    python scripts/scrape_operator_milv.py --force
    python scripts/scrape_operator_milv.py --op 能天使
    python scripts/scrape_operator_milv.py --limit 20
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT       = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
PLOTS_DIR  = DATA_DIR / "plots" / "干员"
OUTPUT_JSON = DATA_DIR / "operator_milv.json"

API_URL      = "https://prts.wiki/api.php"
SSL_CTX      = ssl._create_unverified_context()
MAX_RETRIES  = 4
RETRY_BACKOFF = 2.0
DELAY        = 0.4   # between API calls
TIMEOUT      = 60

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

CATEGORY = "干员"


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
# Helpers
# ---------------------------------------------------------------------------

_ILLEGAL = str.maketrans(':*?"<>|\\/', '_________')

def safe_name(s: str) -> str:
    return s.translate(_ILLEGAL).strip('.')


RE_MILV_BLOCK = re.compile(
    r'\{\{干员密录/list([\s\S]*?)\n\}\}', re.MULTILINE)


def parse_milv_section(wikitext: str, op_name: str) -> list[dict]:
    """Extract list of {seq, name, intro, page} from the 干员密录 section."""
    sets = []
    for i, m in enumerate(RE_MILV_BLOCK.finditer(wikitext), start=1):
        block = m.group(1)
        params: dict[str, str] = {}
        for line in block.splitlines():
            line = line.strip()
            if line.startswith('|'):
                key, _, val = line[1:].partition('=')
                params[key.strip()] = val.strip()
        name  = params.get('storySetName', '').strip()
        intro = params.get('storyIntro1',  '').strip()
        page  = params.get('storyTxt1',    '').strip()
        if not name or not page:
            continue
        page = page.replace('{{FULLPAGENAME}}', op_name)
        sets.append({'seq': i, 'name': name, 'intro': intro, 'page': page})
    return sets


def extract_avg_text(wikitext: str) -> str | None:
    """Pull the raw AVG script out of {{剧情模板实验|...|文本内容=\n<text>\n}}.

    The parameter name contains Chinese so we locate the AVG body via its
    content: it always starts with a [ command. We find the first occurrence
    of '\\n[' after the opening template line, then clip at the closing '\\n}}'
    that terminates the template (followed by a newline or end-of-string).
    """
    # AVG commands start with '['; find the first newline+bracket after the
    # template preamble (all param lines are on one line: {{...|p=v|p=v|...).
    start = wikitext.find('\n[')
    if start < 0:
        return None
    content = wikitext[start + 1:]   # skip the leading \n

    # Template closes at the FIRST \n}} not preceded by another {{
    # (AVG content uses only [] commands, not {{ }}). Find \n}} followed by
    # newline or end-of-string or [[.
    import re as _re
    m = _re.search(r'\n\}\}(\n|\Z|\[\[)', content)
    if m:
        content = content[:m.start()]
    return content.strip()


def get_section_wikitext(page: str, section_name: str) -> str | None:
    """Fetch wikitext of a named section. Returns None if not found."""
    d = api({'action': 'parse', 'page': page, 'prop': 'sections',
             'format': 'json', 'formatversion': '2'})
    if 'error' in d:
        return None
    secs = d.get('parse', {}).get('sections', [])
    sec = next((s for s in secs if section_name in s.get('line', '')), None)
    if not sec:
        return None
    d2 = api({'action': 'parse', 'page': page, 'prop': 'wikitext',
              'section': sec['index'], 'format': 'json', 'formatversion': '2'})
    if 'error' in d2:
        return None
    return d2.get('parse', {}).get('wikitext')


def get_page_wikitext(page: str) -> str | None:
    """Fetch full wikitext of a page. Returns None if missing."""
    d = api({'action': 'parse', 'page': page, 'prop': 'wikitext',
             'format': 'json', 'formatversion': '2'})
    if 'error' in d:
        return None
    return d.get('parse', {}).get('wikitext')


# ---------------------------------------------------------------------------
# Operator list
# ---------------------------------------------------------------------------

def get_operator_list() -> list[str]:
    """All main-namespace pages that transclude {{干员密录/list}}."""
    pages: list[str] = []
    eicontinue: str | None = None
    while True:
        params: dict = {
            'action': 'query', 'list': 'embeddedin',
            'eititle': 'Template:干员密录/list',
            'einamespace': '0', 'eilimit': '500', 'format': 'json',
        }
        if eicontinue:
            params['eicontinue'] = eicontinue
        d = api(params)
        for p in d.get('query', {}).get('embeddedin', []):
            pages.append(p['title'])
        cont = d.get('continue', {})
        eicontinue = cont.get('eicontinue')
        if not eicontinue:
            break
        time.sleep(DELAY)
    return pages


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def scrape_operator(op: str, *, force: bool) -> dict | None:
    """Scrape one operator. Returns metadata dict or None on total failure."""
    op_dir = PLOTS_DIR / safe_name(op)

    # Get 干员密录 section wikitext
    section_wt = get_section_wikitext(op, '干员密录')
    if not section_wt:
        log.warning(f"  [{op}] no 干员密录 section")
        return None
    time.sleep(DELAY)

    sets = parse_milv_section(section_wt, op)
    if not sets:
        log.warning(f"  [{op}] no parseable story sets")
        return None

    result_sets = []
    for s in sets:
        fname = f"{s['seq']}_{safe_name(s['name'])}.txt"
        dst = op_dir / fname

        if dst.exists() and not force:
            log.info(f"  [{op}] skip (exists): {fname}")
            result_sets.append({**s, 'file': str(dst.relative_to(ROOT))})
            continue

        # Fetch subpage AVG text
        page_wt = get_page_wikitext(s['page'])
        time.sleep(DELAY)
        if not page_wt:
            log.warning(f"  [{op}] subpage missing: {s['page']!r}")
            continue

        avg = extract_avg_text(page_wt)
        if not avg:
            log.warning(f"  [{op}] could not extract text from {s['page']!r}")
            continue

        op_dir.mkdir(parents=True, exist_ok=True)
        dst.write_text(avg, encoding='utf-8')
        log.info(f"  [{op}] wrote {fname} ({len(avg)} chars)")
        result_sets.append({**s, 'file': str(dst.relative_to(ROOT))})

    if not result_sets:
        return None
    return {'op': op, 'sets': result_sets}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--force',  action='store_true',
                   help='Re-download even if .txt already exists')
    p.add_argument('--op',    help='Scrape a single operator')
    p.add_argument('--limit', type=int,
                   help='Process only the first N operators (for testing)')
    args = p.parse_args()

    if args.op:
        ops = [args.op]
    else:
        log.info('Fetching operator list...')
        ops = get_operator_list()
        log.info(f'{len(ops)} operators with 干员密录')
        if args.limit:
            ops = ops[:args.limit]

    PLOTS_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    ok = skipped = failed = 0

    for op in ops:
        log.info(f'→ {op}')
        meta = scrape_operator(op, force=args.force)
        if meta:
            results.append(meta)
            # Count how many sets were newly written vs already existed
            new = sum(1 for s in meta['sets'] if 'file' in s)
            ok += 1
        else:
            failed += 1
        time.sleep(DELAY)

    OUTPUT_JSON.write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8')

    log.info('---')
    log.info(f'operators processed = {ok}, failed = {failed}')
    log.info(f'wrote → {OUTPUT_JSON.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
