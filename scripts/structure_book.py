"""
Turn the per-page OCR (scripts/ocr_book.py) into a chapter/section outline with
text, ready for scripts/import_book.py to load as stories/chapters/nodes.

    data/book_ocr/p*.json  ->  data/book_sections.json

Why the book's own numbering is the backbone
--------------------------------------------
Each section opens with a printed `CHAPTER <n>[.<m>[.<k>]]` marker followed by
its Chinese and English titles. That numbering is not decoration: 泰拉年表
cites this book as 「大地巡旅：6.Extra 罗德岛」 — section numbers — so keeping
it is what lets those 155 timeline citations resolve later.

Markers are read from the OCR's own body blocks (57 of them, plus 6 more on the
contents spread, which is skipped by page number). Titles are the blocks that
follow, with two OCR artefacts filtered: a bare page-number fragment sometimes
lands between the marker and the title (`CHAPTER 6.6` -> `38` -> `太阳谷机械工业`),
and the English title is a separate block from the Chinese one.

Everything between one marker and the next belongs to that section, one chunk
per PARAGRAPH, each tagged with the printed page it began on — the page number
is how a claim gets checked against a physical copy, and nothing else records it.

The six top-level chapters come from the contents spread (`find_toc`), so the
book maps onto the existing content model with no new schema: chapter -> story,
section -> chapter, paragraph -> node.

This pass is deliberately still deterministic. No model is involved: the OCR's
remaining character errors (mostly proper nouns in 凯尔希's handwritten 批注)
are fixed later, so re-running the cheap structural pass never re-spends tokens.

Usage:
    conda run -n study python scripts/structure_book.py
"""

from __future__ import annotations

import argparse
import json
import logging
import re
from pathlib import Path

ROOT     = Path(__file__).parent.parent
OCR_DIR  = ROOT / "data" / "book_ocr"
OUT_JSON = ROOT / "data" / "book_sections.json"

BOOK_TITLE    = "大地巡旅"
BOOK_TITLE_EN = "Terra: A Journey"
# The contents spread lists every chapter, so its markers are a table of
# contents rather than section starts. Skipped by page rather than by heuristic
# because it is a fixed, verified property of this edition.
TOC_PAGES = {6, 7}

# Sections the book sets differently and gives NO printed CHAPTER marker, so
# nothing in the OCR announces them. Without these, 6.8 (鲤氏侦探事务所, normally
# ~4k chars) silently swallows all 16 pages of the Rhodes Island section and
# reports 18k.
#
# Found by looking for runs of text pages carrying no rotated chapter tab —
# that absence is what distinguishes an interlude from a numbered chapter —
# and then reading the heading off each run's first page. The numbering follows
# 泰拉年表's own citations, which call the first of these 「6.Extra 罗德岛」.
# (number, title, title_en, page, owning chapter). 6.Extra sits inside chapter
# 6 the way the wiki cites it; the closing three belong to no numbered chapter,
# so they become one section each under a synthetic 附录.
EXTRA_SECTIONS = [
    ("6.Extra", "罗德岛生活指南", "RHODES ISLAND",  401, "6"),
    ("后记",     "后记",          "POSTFACE",       431, "附录"),
    ("档案归档", "档案归档",       None,             443, "附录"),
    ("感谢名单", "感谢名单",       "SPECIAL THANKS", 450, "附录"),
]

# The book's six top-level chapters, read off the contents spread. Each becomes
# a `stories` row; every section under it becomes a `chapters` row.
APPENDIX = {"number": "附录", "title": "附录", "title_en": "APPENDIX"}

MARKER = re.compile(r"^CHAPTER\s*([0-9]+(?:\.[0-9A-Za-z]+)*)\s*(.*)$", re.I)
# A block that is only digits is a stray folio fragment, not a title.
FOLIO   = re.compile(r"^[\d\s.]+$")
LATIN   = re.compile(r"^[A-Za-z0-9\s,.'&/:\-—()]+$")
# Terminal punctuation: a line ending in one of these ends a paragraph.
SENTENCE_END = set("。！？；…”』」）》!?.")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def load_pages() -> list[dict]:
    pages = []
    for f in sorted(OCR_DIR.glob("p*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        d["blocks"] = [b for b in d["blocks"]
                       if b["tag"] == "body" and b["text"].strip()]
        d["body"] = [b["text"].strip() for b in d["blocks"]]
        pages.append(d)
    return pages


def paragraphs(blocks: list[dict]) -> list[str]:
    """
    Join typeset lines back into paragraphs.

    A typeset line break carries no meaning, so without this every line becomes
    its own paragraph and the prose reads as fragments.

    Terminal punctuation is the signal, not the printed indent. The indent is
    the obvious candidate — Chinese typography indents a first line by two
    characters — but it does not work in this book: the body indent lands at
    almost exactly the left edge of the indented pull-quote boxes, so an
    identical x0 means "new paragraph" in one place and "continuation" in
    another. A justified line that breaks mid-sentence, by contrast, always
    ends on no punctuation.

    Geometry is still used for one thing: a large horizontal jump is a hard
    break (a different column or text box) whatever the punctuation did.
    """
    out: list[str] = []
    prev_x0: float | None = None
    for b in blocks:
        text = b["text"].strip()
        if not text:
            continue
        cw = (b["x1"] - b["x0"]) / max(len(text), 1)
        prev = out[-1] if out else ""
        # A justified line that breaks mid-sentence ends on no punctuation, so
        # the punctuation is the paragraph marker. Geometry cannot do this job
        # in this book: the body's two-character indent lands at almost exactly
        # the left edge of the indented pull-quote boxes, so the same x0 means
        # "new paragraph" in one place and "same paragraph" in another.
        continues = bool(prev) and prev[-1] not in SENTENCE_END
        # A large horizontal jump is still a hard break — a different column or
        # text box, regardless of how the previous line happened to end.
        jumped = prev_x0 is not None and abs(b["x0"] - prev_x0) > cw * 6
        if continues and not jumped:
            out[-1] += text                      # continuation (no space: CJK)
        else:
            out.append(text)
        prev_x0 = b["x0"]
    return out


def find_markers(pages: list[dict]) -> list[dict]:
    """Every section start, with the titles that follow it on the page."""
    out = []
    for p in pages:
        if p["page"] in TOC_PAGES:
            continue
        for i, line in enumerate(p["body"]):
            m = MARKER.match(line)
            if not m:
                continue
            rest = [x for x in p["body"][i + 1:i + 6] if not FOLIO.match(x)]
            zh = next((x for x in rest if not LATIN.match(x)), None)
            en = next((x for x in rest if LATIN.match(x)), None)
            out.append({
                "number": m.group(1),
                "title": (m.group(2).strip() or zh or None),
                "title_en": en,
                "page": p["page"],
                "line": i,
            })

    by_page = {p["page"]: p for p in pages}
    for number, title, title_en, page, chapter in EXTRA_SECTIONS:
        p = by_page.get(page)
        if not p:
            log.warning(f"  extra section {number}: page {page} not OCR'd")
            continue
        # Drop the heading from the body the same way a marked section does.
        line = p["body"].index(title) if title in p["body"] else -1
        out.append({"number": number, "title": title, "title_en": title_en,
                    "page": page, "line": line, "chapter": chapter})

    out.sort(key=lambda m: (m["page"], m["line"]))
    return out


def find_toc(pages: list[dict]) -> list[dict]:
    """The six top-level chapters, from the contents spread."""
    out = []
    for p in pages:
        if p["page"] not in TOC_PAGES:
            continue
        for i, line in enumerate(p["body"]):
            m = MARKER.match(line)
            if not m or "." in m.group(1):
                continue
            rest = [x for x in p["body"][i + 1:i + 4] if not FOLIO.match(x)]
            out.append({
                "number": m.group(1),
                "title": m.group(2).strip() or None,
                "title_en": next((x for x in rest if LATIN.match(x)), None),
            })
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Structure the OCR'd book.")
    ap.add_argument("--out", default=str(OUT_JSON))
    args = ap.parse_args()

    pages = load_pages()
    if not pages:
        log.error(f"no OCR pages in {OCR_DIR} — run scripts/ocr_book.py first")
        return
    by_page = {p["page"]: p for p in pages}
    markers = find_markers(pages)
    log.info(f"{len(pages)} pages, {len(markers)} section markers")

    sections = []
    for idx, mk in enumerate(markers):
        start = mk["page"]
        end = markers[idx + 1]["page"] - 1 if idx + 1 < len(markers) else pages[-1]["page"]
        # A marker's own page belongs to it; the next marker's page starts the
        # next section even when both sit on the same spread.
        end = max(end, start)

        chunks = []
        for pno in range(start, end + 1):
            p = by_page.get(pno)
            if not p:
                continue
            blocks = list(p["blocks"])
            # Drop the marker and the two title lines from the opening page so
            # the section body doesn't repeat its own heading.
            if pno == start and mk["line"] >= 0:
                drop = {mk["line"]}
                for j in (mk["line"] + 1, mk["line"] + 2):
                    if j < len(blocks) and blocks[j]["text"].strip() in (
                            mk["title"], mk["title_en"]):
                        drop.add(j)
                blocks = [b for j, b in enumerate(blocks) if j not in drop]
            # One chunk per PARAGRAPH, each tagged with the printed page it
            # started on — the page number is the audit trail back to a
            # physical copy, and nothing else records it.
            for para in paragraphs(blocks):
                if para.strip():
                    chunks.append({"page": pno, "text": para.strip()})

        sections.append({
            "number": mk["number"],
            # Top-level ("5") vs a section within it ("5.10.1"). EXTRA_SECTIONS
            # carry their own, since 后记 has no number to split.
            "chapter": mk.get("chapter") or mk["number"].split(".")[0],
            "depth": mk["number"].count(".") + 1,
            "title": mk["title"],
            "title_en": mk["title_en"],
            "page_start": start,
            "page_end": end,
            "chars": sum(len(c["text"]) for c in chunks),
            "chunks": chunks,
        })

    covered = {c["page"] for s in sections for c in s["chunks"]}
    orphan = [p["page"] for p in pages
              if p["page"] not in covered and len("".join(p["body"])) > 30]

    # Top-level chapters, from the contents spread, plus the synthetic 附录 for
    # the closing sections that belong to no numbered chapter. Only chapters
    # that actually own a section are emitted, so a TOC misread can't create an
    # empty story.
    used = {s["chapter"] for s in sections}
    chapters = [c for c in find_toc(pages) if c["number"] in used]
    if "附录" in used:
        chapters.append(APPENDIX)
    missing = used - {c["number"] for c in chapters}
    if missing:
        log.warning(f"  sections whose chapter is not in the contents: {sorted(missing)}")
        chapters += [{"number": n, "title": n, "title_en": None} for n in sorted(missing)]

    Path(args.out).write_text(json.dumps({
        "title": BOOK_TITLE,
        "title_en": BOOK_TITLE_EN,
        "pages": len(pages),
        "chapters": chapters,
        "sections": sections,
        # Front matter before the first marker — kept visible rather than
        # silently dropped, so a coverage gap is a number you can look at.
        "orphan_pages": orphan,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(s["chars"] for s in sections)
    log.info(f"{len(sections)} sections, {total:,} chars, "
             f"{len(orphan)} page(s) before the first section")
    for s in sections[:8]:
        log.info(f"  {s['number']:<8} p{s['page_start']}-{s['page_end']:<4} "
                 f"{(s['title'] or '?')[:20]:<22} {s['chars']:>6} chars")
    log.info(f"wrote {Path(args.out).relative_to(ROOT)}")


if __name__ == "__main__":
    main()
