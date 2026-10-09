"""
Attach official-text evidence to each flagged speaker, so the review is one
glance per row instead of research (044).

WHAT THIS WAS GOING TO BE, AND WHY IT IS NOT
--------------------------------------------
The plan was to auto-promote flagged names that official text mentions —
塔露拉, 特蕾西娅, 魏彦吾 are obviously people, and confirming 383 of them by hand
is hundreds of pointless clicks. Measured, that rule does not hold: prose
contains common nouns, so "appears in official text" promoted **收音机 (a radio),
老人, 狱警, 安保人员, 主持人** as named people.

Occurrence count does not rescue it — 老人 appears 32 times, more than 曼弗雷德's
18 — and neither does a line-count threshold, because quality degrades smoothly
rather than cliffing:

    600+ 行   33 rows, every one a real person
    300-600   99 rows, but 萨卡兹战士 (553) is a role
    150-200   65 rows, with 天灾信使, 信使, 大长老
    100-120   37 rows, with 少女, 黑帮, 赏金猎人, 萨卡兹 (a RACE)
    <100       8 rows, all of them wrong

So there is no cut-off that separates them, and a wrong auto-label enters the
graph as a person and is never looked at again. The project's rule applies:
produce a candidate list for a human, do not act on the heuristic.

WHAT IT DOES INSTEAD
--------------------
Writes the evidence into `review_note` and `raw.name_evidence` and **does not
touch `identity`**: how many official passages mention the name, and one
citation to look at. The decision stays a click, but an informed one — and the
queue is ordered by line count already, so the 33 obvious rows come first.

Corpora, all official and all already local:
    timeline_events        泰拉年表, a cited chronology (039)   → @timeline/<id>
    chapter_descriptions   the game's own skip briefs (AP-37)  → @chapter/<id>
    大地巡旅 prose           the official setting book           → @node/<id>
    entities.summary       the operators' own 客观履历           → @entity/<id>

Skips single-character names (九, 陈 match every numeral and surname, and a
substring test cannot tell those occurrences apart) and never touches a row
already marked `reviewed`.

`--promote-above N` exists for an explicit opt-in: it will set `identity='named'`
for rows above N lines that have evidence. 600 is the only value verified row by
row. Default is no promotion at all.

Usage:
    python scripts/annotate_name_evidence.py --dry-run
    python scripts/annotate_name_evidence.py
    python scripts/annotate_name_evidence.py --promote-above 600
"""

from __future__ import annotations

import argparse
import logging
import os
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

ROOT = Path(__file__).parent.parent
BOOK = "大地巡旅"
MIN_NAME = 2

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def page(db: Client, table: str, cols: str, **eq) -> list[dict]:
    rows, start = [], 0
    while True:
        q = db.table(table).select(cols)
        for k, v in eq.items():
            q = q.in_(k, v) if isinstance(v, list) else q.eq(k, v)
        r = q.range(start, start + 999).execute()
        rows += r.data
        if len(r.data) < 1000:
            return rows
        start += 1000


def main() -> None:
    ap = argparse.ArgumentParser(description="Annotate flagged names with evidence.")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--promote-above", type=int, metavar="LINES",
                    help="also set identity='named' above this line count "
                         "(only 600 has been verified row by row)")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    db: Client = create_client(os.environ["SUPABASE_URL"],
                               os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    ents = page(db, "entities", "id, type, name, identity, review, review_note, "
                                "mention_count, raw")
    pending = [e for e in ents
               if e["type"] == "character" and e["review"] == "suspicious"
               and e["identity"] == "unverified"]
    log.info(f"{len(pending)} flagged row(s)")

    corpus: list[tuple[str, str]] = []
    # timeline_events has no `title`; the text is `description` (039).
    for t in page(db, "timeline_events", "id, section, description"):
        corpus.append((f"{t.get('section') or ''}\n{t.get('description') or ''}",
                       f"@timeline/{t['id']}"))
    for d in page(db, "chapter_descriptions", "chapter_id, body"):
        corpus.append((d.get("body") or "", f"@chapter/{d['chapter_id']}"))
    sids = [s["id"] for s in page(db, "stories", "id, category", category=BOOK)]
    bch = [c["id"] for c in page(db, "chapters", "id, story_id", story_id=sids)]
    for n in page(db, "nodes", "id, content", chapter_id=bch):
        corpus.append((n.get("content") or "", f"@node/{n['id']}"))
    for e in page(db, "entities", "id, summary"):
        if e.get("summary"):
            corpus.append((e["summary"], f"@entity/{e['id']}"))
    log.info(f"corpus: {len(corpus):,} passages, "
             f"{sum(len(t) for t, _ in corpus):,} characters")

    found: list[tuple[dict, str, int]] = []
    skipped = Counter()
    for e in pending:
        name = (e["name"] or "").strip()
        if len(name) < MIN_NAME:
            skipped["名字只有一个字，子串匹配不可信"] += 1
            continue
        hits = [c for text, c in corpus if name in text]
        if not hits:
            skipped["官方文本里没出现"] += 1
            continue
        found.append((e, hits[0], len(hits)))

    log.info(f"evidence found for {len(found)}; no evidence for "
             f"{skipped['官方文本里没出现']}; skipped "
             f"{skipped['名字只有一个字，子串匹配不可信']} single-character names")

    promote = ([f for f in found if f[0]["mention_count"] >= args.promote_above]
               if args.promote_above else [])
    if args.promote_above:
        log.warning(f"--promote-above {args.promote_above}: will set "
                    f"identity='named' on {len(promote)} row(s) WITHOUT a human "
                    f"looking. Only 600 was verified row by row.")

    if args.dry_run:
        log.info("--dry-run: nothing written. Sample:")
        for e, cite, n in sorted(found, key=lambda x: -x[0]["mention_count"])[:8]:
            log.info(f"    {e['name']:<16} {e['mention_count']:>5} 行 · "
                     f"{n} 处官方文本 · {cite}")
        return

    note_only = 0
    for e, cite, n in found:
        raw = dict(e["raw"] or {})
        raw["name_evidence"] = {"citation": cite, "occurrences": n}
        patch: dict[str, object] = {
            "raw": raw,
            "review_note": f"{(e['review_note'] or '').strip()}；"
                           f"官方文本 {n} 处提到此名（{cite}）".strip("；"),
        }
        if (e, cite, n) in promote:
            patch["identity"] = "named"
            patch["review"] = "reviewed"
        else:
            note_only += 1
        db.table("entities").update(patch).eq("id", e["id"]).execute()
    log.info(f"annotated {note_only}" +
             (f", promoted {len(promote)}" if promote else "") +
             " — review at /admin/entities")


if __name__ == "__main__":
    main()
