"""
Integrity check for the 大地巡旅 structure in the database (AP-31).

The book is no longer rebuilt from local files — import_book.py refuses once it
exists, because the text is proofread and the chapters are restructured by hand.
That makes the database the only copy of the structure, and nothing was checking
it. The failure this exists to catch already happened: a chapter row was deleted
by hand, and its 148 paragraphs stopped appearing anywhere. Nothing errored. The
pages simply were not in the book, and it went unnoticed for days.

So this asks the questions a person cannot ask by eye across 67 chapters:

  orphan pages      a printed page whose nodes belong to no chapter at all,
                    or that no chapter covers — the 417-430 failure
  split pages       one printed page whose nodes are spread over two chapters,
                    which makes the page editor's "replace this page" ambiguous
  empty chapters    a chapter with no nodes: usually the leftover of a move
  page gaps         a chapter whose pages are not contiguous. Legitimate for
                    泰拉纪年 (its chart is printed on the last page, 453), so
                    that one is expected and listed rather than flagged
  ordering          order_in_story duplicated or not 1..N — it is the URL
                    segment, so a duplicate makes one chapter unreachable
  seq collisions    two nodes at the same (chapter_id, seq). Only an index, not
                    a constraint, so Postgres will not complain; the reader just
                    shows them in an arbitrary order
  missing assets    a cgitem node whose image_sha1 is absent (the plate would
                    render as a broken image)

Exit code is 1 when anything is flagged, so it can gate a deploy.

Usage:
    conda run -n study python scripts/check_book_structure.py
    conda run -n study python scripts/check_book_structure.py --json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Every chapter name in this report is Chinese, and a Windows console defaults
# to a codepage that cannot encode it — so --json produced bytes that were not
# valid UTF-8 and could not be read back.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")            # type: ignore[union-attr]
    except (AttributeError, OSError):                    # not a real tty / already set
        pass

from dotenv import load_dotenv
from supabase import create_client, Client

ROOT = Path(__file__).parent.parent
CATEGORY = "大地巡旅"

# The one page that is deliberately away from its chapter's run: 泰拉纪年 covers
# 428-430, but the chart it refers to is printed on the last page of the book,
# behind the colophon. See PAGE_MOVES in mineru_book.py.
EXPECTED_GAPS = {"泰拉纪年": {453}}

# Printed pages that carry nothing at all — blank leaves and full-bleed plates
# the OCR produced no block for. Checked against book_sections.json when this
# list was written: none of them has a single chunk in the source, so they are
# absent from the database because there is nothing to store, not because
# something was lost. A page NOT on this list that belongs to no chapter is the
# 417-430 failure and is flagged.
EXPECTED_BLANK = {41, 115, 244, 451}

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)


def _all(db: Client, table: str, select: str, **eq):
    rows, start = [], 0
    while True:
        q = db.table(table).select(select)
        for k, v in eq.items():
            q = q.eq(k, v)
        r = q.range(start, start + 999).execute()
        rows += r.data
        if len(r.data) < 1000:
            break
        start += 1000
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Check the book's structure in the DB.")
    ap.add_argument("--json", action="store_true", help="machine-readable report")
    ap.add_argument("--out", metavar="PATH",
                    help="write the report to a file as UTF-8. Worth preferring on "
                         "Windows: every chapter name here is Chinese and `conda run` "
                         "re-encodes captured output with the system codepage, so a "
                         "piped --json is not necessarily valid UTF-8.")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    db: Client = create_client(os.environ["SUPABASE_URL"],
                               os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    stories = _all(db, "stories", "id, name, seq", category=CATEGORY)
    if not stories:
        log.error(f"no {CATEGORY} stories — the book is not imported")
        raise SystemExit(1)
    sid_name = {s["id"]: s["name"] for s in stories}

    chapters, start = [], 0
    while True:
        r = (db.table("chapters")
             .select("id, story_id, level_code, level_name, order_in_story")
             .in_("story_id", list(sid_name)).range(start, start + 999).execute())
        chapters += r.data
        if len(r.data) < 1000:
            break
        start += 1000
    cid_ch = {c["id"]: c for c in chapters}

    nodes, start = [], 0
    while True:
        r = (db.table("nodes").select("id, chapter_id, seq, type, raw_params")
             .in_("chapter_id", list(cid_ch)).range(start, start + 999).execute())
        nodes += r.data
        if len(r.data) < 1000:
            break
        start += 1000

    problems: list[tuple[str, str]] = []
    notes: list[str] = []

    pages_of: dict[int, set[int]] = defaultdict(set)
    page_owners: dict[int, set[int]] = defaultdict(set)
    seqs_of: dict[int, list[int]] = defaultdict(list)
    for n in nodes:
        rp = n["raw_params"] or {}
        seqs_of[n["chapter_id"]].append(n["seq"])
        pg = rp.get("page")
        if pg is None:
            problems.append(("no-page", f"node {n['id']} in chapter "
                                        f"{n['chapter_id']} has no raw_params.page"))
            continue
        pages_of[n["chapter_id"]].add(pg)
        page_owners[pg].add(n["chapter_id"])

    # --- pages claimed by more than one chapter ------------------------------
    for pg, owners in sorted(page_owners.items()):
        if len(owners) > 1:
            where = ", ".join(f"{cid_ch[c]['level_code']}" for c in sorted(owners))
            problems.append(("split-page", f"page {pg} is spread over {len(owners)} "
                                           f"chapters: {where}"))

    # --- pages in no chapter at all ------------------------------------------
    covered = set(page_owners)
    if covered:
        lo, hi = min(covered), max(covered)
        missing = [p for p in range(lo, hi + 1)
                   if p not in covered and p not in EXPECTED_BLANK]
        if missing:
            problems.append(("orphan-pages",
                             f"{len(missing)} printed page(s) between {lo} and {hi} "
                             f"belong to no chapter: {missing}"))
        blank = sorted(EXPECTED_BLANK & set(range(lo, hi + 1)) - covered)
        if blank:
            notes.append(f"{len(blank)} known-blank page(s) carry no content: {blank}")

    # --- empty chapters ------------------------------------------------------
    for c in chapters:
        if not pages_of.get(c["id"]):
            problems.append(("empty-chapter",
                             f"chapter {c['id']} ({c['level_code']} "
                             f"{c['level_name']}) has no nodes"))

    # --- non-contiguous chapters --------------------------------------------
    for c in chapters:
        pgs = sorted(pages_of.get(c["id"], ()))
        if len(pgs) < 2:
            continue
        # A blank leaf between two pages is not a gap in the chapter — there is
        # simply nothing on it to store. Without this, 5.10 (blank p244) and
        # 感谢名单 (blank p451) were reported as broken every run, which is the
        # fastest way to teach someone to ignore the checker.
        present = set(pgs) | EXPECTED_BLANK
        gaps = {p for p in pgs if p - 1 not in present and p != pgs[0]}
        expected = EXPECTED_GAPS.get(c["level_code"], set())
        unexpected = gaps - expected
        if unexpected:
            problems.append(("page-gap",
                             f"{c['level_code']} {c['level_name']}: pages "
                             f"{pgs[0]}-{pgs[-1]} but not contiguous — "
                             f"restarts at {sorted(unexpected)}"))
        elif gaps:
            notes.append(f"{c['level_code']}: expected gap at {sorted(gaps)} (documented)")

    # --- ordering ------------------------------------------------------------
    for sid, name in sid_name.items():
        orders = sorted(c["order_in_story"] for c in chapters if c["story_id"] == sid)
        dupes = [o for o, n in Counter(orders).items() if n > 1]
        if dupes:
            problems.append(("dup-order", f"story {name}: order_in_story repeated "
                                          f"{dupes} — the URL cannot address both"))
        if orders and orders != list(range(1, len(orders) + 1)):
            problems.append(("order-gap", f"story {name}: order_in_story is "
                                          f"{orders[0]}..{orders[-1]} over "
                                          f"{len(orders)} chapters, not 1..N"))

    # --- seq collisions ------------------------------------------------------
    for cid, seqs in seqs_of.items():
        dupes = [s for s, n in Counter(seqs).items() if n > 1]
        if dupes:
            c = cid_ch[cid]
            problems.append(("dup-seq", f"{c['level_code']} {c['level_name']}: "
                                        f"{len(dupes)} duplicated seq value(s) "
                                        f"{sorted(dupes)[:8]} — reading order is arbitrary"))

    # --- plates without an asset --------------------------------------------
    noasset = [n["id"] for n in nodes
               if n["type"] == "cgitem" and not (n["raw_params"] or {}).get("image_sha1")]
    if noasset:
        problems.append(("no-asset", f"{len(noasset)} cgitem node(s) carry no "
                                     f"image_sha1: {noasset[:8]}"))

    # --- report --------------------------------------------------------------
    total_pages = len(covered)
    sink = open(args.out, "w", encoding="utf-8") if args.out else None

    def emit(line: str, bad: bool = False) -> None:
        if sink:
            sink.write(line + "\n")
        else:
            (log.error if bad else log.info)(line)

    if args.json:
        emit(json.dumps({
            "stories": len(stories), "chapters": len(chapters), "nodes": len(nodes),
            "pages": total_pages,
            "problems": [{"kind": k, "detail": d} for k, d in problems],
            "notes": notes,
        }, ensure_ascii=False, indent=2))
    else:
        emit(f"{len(stories)} stories / {len(chapters)} chapters / "
             f"{len(nodes):,} nodes / {total_pages} printed pages")
        for n in notes:
            emit(f"  note: {n}")
        if not problems:
            emit("no structural problems")
        else:
            by_kind = Counter(k for k, _ in problems)
            emit(f"\n{len(problems)} problem(s): "
                 + ", ".join(f"{k}×{v}" for k, v in by_kind.items()), bad=True)
            for kind, detail in problems:
                emit(f"  [{kind}] {detail}", bad=True)
    if sink:
        sink.close()
        log.info(f"report written to {args.out}")
    raise SystemExit(1 if problems else 0)


if __name__ == "__main__":
    main()
