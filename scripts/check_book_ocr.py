"""
Find likely OCR errors in the 大地巡旅 text by self-consistency (AP-31).

    data/book_ocr/p*.json  ->  data/book_ocr_review.json

Why not the two obvious detectors — both were tried and measured:

* **Recognition confidence is useless here.** The 267 body lines scoring under
  0.8 hold 1,013 characters between them: they are 1-3 character folio
  fragments and stray marks, not damaged prose. Meanwhile the errors that
  matter came back CONFIDENTLY WRONG — 凯尔希's handwritten 为维多利亚辩护
  scored high as 为缠多利业辨辩护. Sorting by confidence surfaces junk and
  hides the real damage.

* **An external gazetteer does not fit.** `entities` (026) is character-only,
  because seed_entities.py derives it from `nodes.speaker`. This book is mostly
  about places — 维多利亚, 乌萨斯, 谢拉格, 卡兹戴尔 are simply not in it — so
  matching against it produced 18,135 false positives.

What works is the book's own table of contents. Frequency alone does not: an
n-gram sliding over running text crosses word boundaries, so 他们后 looks like
a one-character corruption of the very common 他们的 when it is simply a
different phrase. That version produced 104,970 findings — it caught both known
errors and buried them.

The 61 section titles ARE the canonical spelling of every country, faction and
concept the book covers (维多利亚, 乌萨斯, 谢拉格, 卡兹戴尔, 米诺斯 …), and
`entities` supplies the characters. Restricting comparison to that vocabulary
is what makes the output short enough to work through by hand, and it targets
exactly the errors that would corrupt the knowledge graph.

The trade, stated plainly: a typo in an ordinary word (究竟 -> 究竞) is NOT
caught, because no gazetteer contains it. That class of error hurts reading
slightly and the entity graph not at all, so it is the right thing to give up.

Same-length comparison only (substitutions, not insertions or deletions): OCR
mistakes a character far more often than it invents or loses one, and allowing
length changes floods the output with ordinary substrings.

Read the output in two tiers, which `substitutions` marks:

* **1 substitution (~250 rows) is the working list.** Nearly every row is a real
  misread of a name the book uses constantly — 谁多利亚/雅多利亚 for 维多利亚,
  乌申斯/克萨斯 for 乌萨斯, 案塔尼亚 for 莱塔尼亚, 庐比利亚 for 伊比利亚.
* **2 substitutions is a lower-precision tail** worth skimming, not trusting.
  It is where the handwritten 批注 errors live (缠多利业 for 维多利亚), because
  handwriting rarely fails on just one character — which is also why
  `--stop-chars` is not raised further: at 300 the tail gets cleaner and loses
  that class entirely.

Usage:
    conda run -n study python scripts/check_book_ocr.py
    conda run -n study python scripts/check_book_ocr.py --stop-chars 300   # tighter
"""

from __future__ import annotations

import argparse
import collections
import json
import logging
import re
from pathlib import Path

ROOT     = Path(__file__).parent.parent
OCR_DIR  = ROOT / "data" / "book_ocr"
OUT_JSON = ROOT / "data" / "book_ocr_review.json"

CJK = re.compile(r"[一-鿿]+")

# A gazetteer term must actually appear this often in the book before its
# near-misses are worth reporting, and a candidate must be at most this rare to
# be suspected rather than being a legitimate rare word.
MIN_FREQ  = 8
MAX_RARE  = 2
LENGTHS   = (3, 4, 5)     # proper nouns here; 2 is far too noisy in Chinese
MAX_SUBS  = 2             # 维多利亚 -> 缠多利业 is two substitutions

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def load_text() -> list[tuple[int, str]]:
    out = []
    for f in sorted(OCR_DIR.glob("p*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for b in d["blocks"]:
            if b["tag"] == "body" and b["text"].strip():
                out.append((d["page"], b["text"].strip()))
    return out


def gazetteer() -> set[str]:
    """
    Canonical spellings: the book's own chapter and section titles, plus the
    character names in `entities` if the database is reachable.

    Titles are the high-value half — they are the proper nouns the whole book
    is organised around, so an OCR corruption of one is exactly the error that
    would poison an entity or a citation.
    """
    terms: set[str] = set()
    book = ROOT / "data" / "book_sections.json"
    if book.exists():
        doc = json.loads(book.read_text(encoding="utf-8"))
        for group in (doc.get("chapters") or [], doc.get("sections") or []):
            for x in group:
                t = (x.get("title") or "").strip()
                if t and CJK.fullmatch(t):
                    terms.add(t)
    try:
        import os
        from dotenv import load_dotenv
        from supabase import create_client
        load_dotenv(ROOT / ".env")
        db = create_client(os.environ["SUPABASE_URL"],
                           os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        for start in range(0, 20000, 1000):
            rows = db.table("entities").select("name").range(start, start + 999).execute().data or []
            for r in rows:
                n = (r["name"] or "").strip()
                if CJK.fullmatch(n):
                    terms.add(n)
            if len(rows) < 1000:
                break
    except Exception as e:                        # offline is fine
        log.warning(f"  entities unavailable ({type(e).__name__}); titles only")
    return {t for t in terms if min(LENGTHS) <= len(t) <= max(LENGTHS)}


def ngrams(text: str, n: int):
    for m in CJK.finditer(text):
        s = m.group()
        for i in range(len(s) - n + 1):
            yield s[i:i + n]


def main() -> None:
    ap = argparse.ArgumentParser(description="Self-consistency OCR check.")
    ap.add_argument("--min-freq", type=int, default=MIN_FREQ)
    ap.add_argument("--max-rare", type=int, default=MAX_RARE)
    ap.add_argument("--stop-chars", type=int, default=60,
                    help="treat the N most frequent characters as particles")
    ap.add_argument("--min-freq-2sub", type=int, default=100,
                    help="a 2-substitution match needs a term this common")
    ap.add_argument("--out", default=str(OUT_JSON))
    args = ap.parse_args()

    lines = load_text()
    if not lines:
        log.error(f"no OCR pages in {OCR_DIR}")
        return
    log.info(f"{len(lines)} lines, {sum(len(t) for _, t in lines):,} chars")

    gaz = gazetteer()
    log.info(f"gazetteer: {len(gaz)} canonical term(s)")

    # The most frequent characters in the book are particles and function words
    # (的, 会, 内, 及, 表 …). A "variant" that differs from a canonical term only
    # by one of those is a word boundary, not a misread: 矿石的 and 矿石会 are
    # ordinary phrases that sit one substitution from 矿石病.
    chars: collections.Counter[str] = collections.Counter()
    for _, t in lines:
        chars.update(c for c in t if CJK.fullmatch(c))
    common = {c for c, _ in chars.most_common(args.stop_chars)}

    findings = []
    for n in LENGTHS:
        freq: collections.Counter[str] = collections.Counter()
        for _, t in lines:
            freq.update(ngrams(t, n))
        # Only defend terms the book actually uses; a name that never appears
        # cannot have been misread here.
        canon = {g for g in gaz if len(g) == n and freq[g] >= args.min_freq}
        rare = {g for g, c in freq.items() if c <= args.max_rare and g not in gaz}
        if not canon or not rare:
            continue

        index: dict[tuple[int, str], set[str]] = collections.defaultdict(set)
        for g in canon:
            for i, ch in enumerate(g):
                index[(i, ch)].add(g)

        for g in rare:
            cands: collections.Counter[str] = collections.Counter()
            for i, ch in enumerate(g):
                for cand in index.get((i, ch), ()):
                    cands[cand] += 1
            for cand, shared in cands.items():
                subs = n - shared
                if not (1 <= subs <= MAX_SUBS):
                    continue
                differing = [a for a, b in zip(g, cand) if a != b]
                if any(c in common for c in differing):
                    continue        # word boundary, not a misread
                # Two substitutions is only credible for a term the book uses
                # constantly; otherwise it is coincidence.
                if subs == 2 and freq[cand] < args.min_freq_2sub:
                    continue
                if True:
                    findings.append({
                        "suspect": g, "likely": cand,
                        "suspect_count": freq[g], "likely_count": freq[cand],
                        "substitutions": subs, "length": n,
                    })

    # One row per suspect: keep its best explanation (fewest substitutions,
    # then the most frequent term), so a single error isn't reported five times.
    best: dict[str, dict] = {}
    for f in findings:
        cur = best.get(f["suspect"])
        if cur is None or (f["substitutions"], -f["likely_count"]) < \
                          (cur["substitutions"], -cur["likely_count"]):
            best[f["suspect"]] = f

    # Drop a suspect that is merely a substring of another, longer suspect —
    # one bad word otherwise reports once per n-gram length.
    keys = sorted(best, key=len, reverse=True)
    kept: list[dict] = []
    seen: list[str] = []
    for k in keys:
        if any(k in longer for longer in seen):
            continue
        seen.append(k)
        kept.append(best[k])

    # Where each suspect occurs, so a fix can be made in place.
    for f in kept:
        f["pages"] = sorted({p for p, t in lines if f["suspect"] in t})[:5]

    kept.sort(key=lambda f: (f["substitutions"], -f["likely_count"]))
    Path(args.out).write_text(json.dumps({
        "min_freq": args.min_freq, "max_rare": args.max_rare,
        "findings": kept,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    log.info(f"{len(kept)} suspect term(s) → {Path(args.out).relative_to(ROOT)}")
    for f in kept[:20]:
        log.info(f"  p{f['pages'][0] if f['pages'] else '?':<5} {f['suspect']} "
                 f"→ {f['likely']}  ({f['substitutions']} sub, "
                 f"{f['suspect_count']}x vs {f['likely_count']}x)")


if __name__ == "__main__":
    main()
