"""
Import operator profile data from data/operator_profiles.json into
`text_clusters` + `text_chunks` (migration 008).

Kinds imported per operator story:
  - 'personnel_file'  — 人员档案 subsections
  - 'voice_record'    — 语音记录 voice lines (Chinese text)

Replace-per-operator, idempotent: deletes existing clusters of these kinds
for each operator's story, then re-inserts from the JSON.

Usage:
    python scripts/import_operator_profiles.py
    python scripts/import_operator_profiles.py --op 凛御银灰
    python scripts/import_operator_profiles.py --force   # (alias — always replaces)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

try:
    from postgrest.exceptions import APIError
except Exception:
    APIError = None  # type: ignore[assignment,misc]

load_dotenv(Path(__file__).parent.parent / '.env')

ROOT       = Path(__file__).parent.parent
DATA_DIR   = ROOT / 'data'
INPUT_JSON = DATA_DIR / 'operator_profiles.json'
CATEGORY   = '干员'
PF_KIND    = 'personnel_file'
VR_KIND    = 'voice_record'

logging.basicConfig(level=logging.INFO, format='%(levelname)s  %(message)s')
log = logging.getLogger(__name__)

MAX_RETRIES   = 5
RETRY_BACKOFF = 2.0


def get_supabase() -> Client:
    url = os.environ.get('SUPABASE_URL', '')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        sys.exit('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
    return create_client(url, key)


def _execute(query, what: str):
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return query.execute()
        except Exception as e:
            if APIError is not None and isinstance(e, APIError):
                raise
            last = e
            if attempt == MAX_RETRIES - 1:
                break
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f'{what}: retry {attempt+1}/{MAX_RETRIES} after {wait:.0f}s')
            time.sleep(wait)
    raise last  # type: ignore[misc]


def import_profile(sb: Client, story_id: int, profile: dict) -> tuple[int, int]:
    """Import one operator. Returns (clusters_added, chunks_added)."""
    op          = profile['op']
    pf_sections = profile.get('personnel_file', [])
    vr_lines    = profile.get('voice_records', [])

    kinds_to_wipe = (
        ([PF_KIND] if pf_sections else []) +
        ([VR_KIND] if vr_lines    else [])
    )
    if not kinds_to_wipe:
        return 0, 0

    _execute(
        sb.from_('text_clusters').delete()
          .eq('story_id', story_id).in_('kind', kinds_to_wipe),
        f'wipe clusters for {op}',
    )

    n_clusters = n_chunks = 0

    def _insert(kind: str, chunks: list[dict]) -> None:
        nonlocal n_clusters, n_chunks
        if not chunks:
            return
        res = _execute(
            sb.from_('text_clusters').insert({
                'story_id': story_id,
                'kind':     kind,
                'title':    None,
                'title_en': None,
                'level_code': None,
                'seq':      1,
            }),
            f'insert {kind} cluster for {op}',
        )
        cluster_id = res.data[0]['id']
        rows = [
            {'cluster_id': cluster_id, 'seq': i + 1,
             'title': c.get('title'), 'body': c['body']}
            for i, c in enumerate(chunks)
        ]
        _execute(
            sb.from_('text_chunks').insert(rows),
            f'insert {len(rows)} chunks for {op}/{kind}',
        )
        n_clusters += 1
        n_chunks   += len(rows)

    _insert(PF_KIND, [
        {'title': s['title'], 'body': s['body']} for s in pf_sections
    ])
    _insert(VR_KIND, [
        {'title': v['title'], 'body': v['body']} for v in vr_lines
    ])

    return n_clusters, n_chunks


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--op', help='Import a single operator by name')
    p.add_argument('--force', action='store_true',
                   help='(alias — import is always replace-per-operator)')
    args = p.parse_args()

    if not INPUT_JSON.exists():
        log.info(f'(no {INPUT_JSON.name} — nothing to import, skipping)')
        return

    profiles: list[dict] = json.loads(INPUT_JSON.read_text('utf-8'))
    if args.op:
        profiles = [pr for pr in profiles if pr['op'] == args.op]
        if not profiles:
            sys.exit(f'Operator {args.op!r} not found in {INPUT_JSON.name}')

    sb = get_supabase()

    # Batch-fetch existing story IDs
    ops = [pr['op'] for pr in profiles]
    story_map: dict[str, int] = {}
    for i in range(0, len(ops), 200):
        batch = ops[i:i + 200]
        r = _execute(
            sb.from_('stories').select('id, name')
              .eq('category', CATEGORY).in_('name', batch),
            f'fetch story ids batch {i}',
        )
        for row in r.data or []:
            story_map[row['name']] = row['id']

    total_clusters = total_chunks = ok = skipped = created = failed = 0
    for pr in profiles:
        op = pr['op']
        sid = story_map.get(op)

        # Operators with only profile data (no 密录 stories) may not have a
        # stories row yet — create a bare one so the page is reachable.
        if sid is None:
            if not pr.get('personnel_file') and not pr.get('voice_records'):
                skipped += 1
                continue
            res = _execute(
                sb.from_('stories').insert({
                    'category': CATEGORY,
                    'name':     op,
                    'name_en':  op,   # placeholder; scrape_story_pages will update
                }),
                f'create stories row for {op}',
            )
            sid = res.data[0]['id']
            story_map[op] = sid
            created += 1
            log.info(f'  [{op}] created bare stories row id={sid}')

        if not pr.get('personnel_file') and not pr.get('voice_records'):
            skipped += 1
            continue

        nc, nk = import_profile(sb, sid, pr)
        total_clusters += nc
        total_chunks   += nk
        ok += 1
        if ok % 50 == 0:
            log.info(f'  {ok}/{len(profiles)} operators imported...')

    log.info(
        f'\nDone. operators={ok}  created={created}  skipped={skipped}  '
        f'failed={failed}  clusters={total_clusters}  chunks={total_chunks}'
    )


if __name__ == '__main__':
    main()
