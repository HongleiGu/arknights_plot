"""
Set `entities.identity` where it is known, and flag the rest for review (044).

6,889 distinct speakers became `character` rows and `044` defaults every one of
them to `identity = 'unverified'`, because nothing had vouched for any of them.
This fills in what IS known and routes the genuinely ambiguous into
`/admin/entities` — it does not guess the hard cases, because which of named /
scoped / device a name is, is a judgement about what the text means.

WHAT IT CLAIMS TO KNOW, AND ON WHAT GROUNDS
-------------------------------------------
- **`named`, the 432 operators**: each has an official 客观履历 in their 人员档案,
  which is the game describing a specific person. Identified by
  `raw.source = 'personnel_file/客观履历'`, not by having a summary, so a later
  model-written summary cannot be mistaken for this evidence.
- **`named`, the 83 world rows**: a nation, race, place, event, organisation or
  concept named by 大地巡旅's own table of contents, each carrying a
  `@chapter/<id>` citation. These are not speakers at all, so speaker ambiguity
  cannot apply to them.

WHAT IT REFUSES TO DECIDE
-------------------------
Everything else stays `unverified`. The ones worth a human's time are flagged
`review = 'suspicious'` with the measured evidence in `review_note`, so the queue
is a few hundred rows rather than 6,889:

    stories >= 5  or  lines >= 100,  and not an operator

Measured: 5,633 of the 6,889 speakers appear in exactly ONE story, and those are
overwhelmingly one-off NPCs that no graph needs — flagging them would bury the
real decisions. `044`'s trigger allows edges onto an `unverified` vertex for
exactly that reason; it only refuses `device` and `suspicious`.

PATTERN HINTS ARE SUGGESTIONS, NEVER DECISIONS
----------------------------------------------
A name ending in 的声音, or being 众人 / 广播, is good evidence of a device, and a
name containing 干员 / 士兵 / 成员 is good evidence of a role descriptor. But
医疗干员 and 耀骑士临光 are both "names containing a role word", and 父亲 matches
nothing at all while being the clearest device in the data. So a match writes a
**hint into `review_note`** and never touches `identity`. The project's rule
about heuristics applies: produce a candidate list for a human, do not act on it.

IDEMPOTENT, AND CANNOT UNDO A HUMAN
-----------------------------------
A row with `review = 'reviewed'` is never touched — that is a decision already
made in the UI, and a re-run after a review pass must not reopen it.

Usage:
    python scripts/classify_entities.py --dry-run
    python scripts/classify_entities.py
"""

from __future__ import annotations

import argparse
import logging
import os
import re
from collections import Counter, defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

ROOT = Path(__file__).parent.parent

OPERATOR_SOURCE = "personnel_file/客观履历"
MIN_STORIES = 5
MIN_LINES = 100

# Hints only. Each writes a note; none sets `identity`.
HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(的声音|的声响|之声)$"), "疑似「非人物」：名字是一种声音"),
    (re.compile(r"^(众人|所有人|全体|广播|通讯|公告|系统|旁白)$"), "疑似「非人物」"),
    (re.compile(r"(干员|士兵|成员|术师|队员|卫兵|警卫|护卫|工作人员|研究员|医生|护士|"
                r"商人|村民|居民|路人|学生|记者|司机|店主|老板|侍从|仆人)$"),
     "疑似「泛指」：名字是一种身份而非人名"),
    (re.compile(r"^(父亲|母亲|爸爸|妈妈|儿子|女儿|哥哥|姐姐|弟弟|妹妹|老师|同学)$"),
     "疑似「非人物」：称谓，每次所指的人都不同"),
]

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def page(db: Client, table: str, cols: str) -> list[dict]:
    """PostgREST caps a response at 1000 rows whatever range is asked for."""
    rows, start = [], 0
    while True:
        r = db.table(table).select(cols).range(start, start + 999).execute()
        rows += r.data
        if len(r.data) < 1000:
            return rows
        start += 1000


def main() -> None:
    ap = argparse.ArgumentParser(description="Classify entity identity (044).")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--min-stories", type=int, default=MIN_STORIES)
    ap.add_argument("--min-lines", type=int, default=MIN_LINES)
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    db: Client = create_client(os.environ["SUPABASE_URL"],
                               os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    ents = page(db, "entities", "id, type, name, identity, review, mention_count, raw")
    log.info(f"{len(ents):,} entities")

    # Story spread, grouped in the database by scope_speakers() (034) — one row
    # per speaker per story rather than one per line.
    stories = page(db, "stories", "id, name")
    spread: dict[str, set[int]] = defaultdict(set)
    for i, s in enumerate(stories, 1):
        for r in (db.rpc("scope_speakers", {"p_story": s["id"]}).execute().data or []):
            spread[r["speaker"]].add(s["id"])
        if i % 200 == 0:
            log.info(f"  speakers: {i}/{len(stories)} stories")
    log.info(f"{len(spread):,} distinct speakers across {len(stories)} stories")

    named_ids: list[int] = []
    flagged: list[tuple[int, str]] = []
    skipped_reviewed = 0
    hint_counts: Counter[str] = Counter()

    for e in ents:
        if e["review"] == "reviewed":
            skipped_reviewed += 1
            continue
        raw = e["raw"] or {}

        if e["type"] != "character":
            named_ids.append(e["id"])                 # a book-named world thing
            continue
        if raw.get("source") == OPERATOR_SOURCE:
            named_ids.append(e["id"])                 # has an official 客观履历
            continue

        n_stories = len(spread.get(e["name"], ()))
        n_lines = e["mention_count"] or 0
        if n_stories < args.min_stories and n_lines < args.min_lines:
            continue                                  # the long tail; left alone

        per = n_lines / n_stories if n_stories else n_lines
        bits = [f"{n_stories} 个故事 · {n_lines} 行台词 · 每个故事约 {per:.0f} 行"]
        for rx, hint in HINTS:
            if rx.search(e["name"]):
                bits.append(hint)
                hint_counts[hint] += 1
                break
        # NOT "appears in many stories, so probably a descriptor" — that was the
        # first version and it is simply false: 凯尔希 appears in 51 stories and
        # 塔露拉 in 17, both one person. What separates them from 医疗干员 (44
        # stories) is lines PER story: a descriptor says a few lines each time it
        # is used, a recurring character carries scenes. 医疗干员 averages 14,
        # 塔露拉 94, 特蕾西娅 115. Still a hint, and still wrong sometimes
        # (文月 averages 29 and is a real person), which is why it only ever
        # writes a note.
        if n_stories >= args.min_stories and per < 35:
            hint = "出现在多个故事但每次只有几句，像是泛指身份"
            bits.append(hint)
            hint_counts[hint] += 1
        flagged.append((e["id"], "；".join(bits)))

    log.info(f"identity='named': {len(named_ids):,}  "
             f"(world rows + operators with an official 客观履历)")
    log.info(f"review='suspicious': {len(flagged):,}  "
             f"(>= {args.min_stories} stories or >= {args.min_lines} lines, not an operator)")
    log.info(f"left untouched: "
             f"{len(ents) - len(named_ids) - len(flagged) - skipped_reviewed:,} "
             f"(the one-story long tail)")
    if skipped_reviewed:
        log.info(f"already reviewed by hand, not touched: {skipped_reviewed:,}")
    for h, c in hint_counts.most_common():
        log.info(f"  hint · {h}: {c}")

    if args.dry_run:
        log.info("--dry-run: nothing written. Sample flags:")
        for eid, note in flagged[:10]:
            name = next(x["name"] for x in ents if x["id"] == eid)
            log.info(f"    {name} — {note}")
        return

    for i in range(0, len(named_ids), 200):
        chunk = named_ids[i:i + 200]
        db.table("entities").update({"identity": "named", "review": "reviewed"}) \
          .in_("id", chunk).execute()
    log.info(f"  named: {len(named_ids):,} written")

    # One update each, because the note differs per row and carries the evidence
    # a human needs to decide without re-deriving it.
    for n, (eid, note) in enumerate(flagged, 1):
        db.table("entities").update({"review": "suspicious", "review_note": note}) \
          .eq("id", eid).execute()
        if n % 50 == 0:
            log.info(f"  flagged: {n}/{len(flagged)}")
    log.info(f"  flagged: {len(flagged):,} written")
    log.info("done — review at /admin/entities (identity=未判定 · review=待复核)")


if __name__ == "__main__":
    main()
