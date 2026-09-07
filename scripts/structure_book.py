"""
Turn the per-page OCR (scripts/ocr_book.py) into a chapter/section outline with
text, ready for scripts/import_book.py to load as text_clusters/text_chunks.

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
per printed page — which keeps the page number, and the page number is how a
citation to a physical book is checked.

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
EXTRA_SECTIONS = [
    ("6.Extra", "罗德岛生活指南", "RHODES ISLAND",  401),
    ("后记",     "后记",          "POSTFACE",       431),
    ("档案归档", "档案归档",       None,             443),
    ("感谢名单", "感谢名单",       "SPECIAL THANKS", 450),
]

MARKER = re.compile(r"^CHAPTER\s*([0-9]+(?:\.[0-9A-Za-z]+)*)\s*(.*)$", re.I)
# A block that is only digits is a stray folio fragment, not a title.
FOLIO   = re.compile(r"^[\d\s.]+$")
LATIN   = re.compile(r"^[A-Za-z0-9\s,.'&/:\-—()]+$")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def load_pages() -> list[dict]:
    pages = []
    for f in sorted(OCR_DIR.glob("p*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        d["body"] = [b["text"].strip() for b in d["blocks"]
                     if b["tag"] == "body" and b["text"].strip()]
        pages.append(d)
    return pages


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
    for number, title, title_en, page in EXTRA_SECTIONS:
        p = by_page.get(page)
        if not p:
            log.warning(f"  extra section {number}: page {page} not OCR'd")
            continue
        # Drop the heading from the body the same way a marked section does.
        line = p["body"].index(title) if title in p["body"] else -1
        out.append({"number": number, "title": title, "title_en": title_en,
                    "page": page, "line": line})

    out.sort(key=lambda m: (m["page"], m["line"]))
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
            lines = list(p["body"])
            # Drop the marker and the two title lines from the opening page so
            # the section body doesn't repeat its own heading.
            if pno == start and mk["line"] >= 0:
                drop = {mk["line"]}
                for j in (mk["line"] + 1, mk["line"] + 2):
                    if j < len(lines) and lines[j] in (mk["title"], mk["title_en"]):
                        drop.add(j)
                lines = [x for j, x in enumerate(lines) if j not in drop]
            text = "\n".join(lines).strip()
            if text:
                chunks.append({"page": pno, "text": text})

        sections.append({
            "number": mk["number"],
            # Top-level ("5") vs a section within it ("5.10.1").
            "chapter": mk["number"].split(".")[0],
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

    Path(args.out).write_text(json.dumps({
        "title": BOOK_TITLE,
        "title_en": BOOK_TITLE_EN,
        "pages": len(pages),
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
