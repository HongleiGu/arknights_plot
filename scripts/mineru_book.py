"""
Convert MinerU output for 大地巡旅 into data/book_sections.json, and crop the
book's illustrations out of the local PDF (AP-31 / AP-34).

    大地巡旅/MinerU_*.json  ->  data/book_sections.json
                            ->  data/book-images/p0120_01.png …

Why this replaces ocr_book.py + structure_book.py
-------------------------------------------------
Those two scripts spend most of their code compensating for RapidOCR having no
layout model: an XY-cut to undo top-to-bottom box sorting, a punctuation
heuristic to rebuild paragraphs, a hand-written table of the four sections that
carry no printed CHAPTER marker. MinerU emits reading order, paragraphs, titles
and image regions directly, so all of that becomes unnecessary.

It is also measurably more accurate on the same page. On p120, where the text
was checked against the scan by eye:

    敕封的头衔     RapidOCR: 救封          MinerU: correct
    挑衅行为       RapidOCR: 挑行为        MinerU: correct
    为维多利亚辩护  RapidOCR: 为缠多利业辨辩护  MinerU: correct

That last one is 凯尔希's handwriting, which is where RapidOCR failed worst and
most confidently.

Input quirks, both verified rather than assumed
-----------------------------------------------
* The export is split into three jobs and **each restarts `page_idx` at 0**, so
  a per-file offset is required. It is derived cumulatively from the page counts
  rather than parsed out of the filenames, because the third file is named
  `400-453` while actually holding pages 401-453 (53 pages, not 54). Verified
  against known anchors: file2 idx49 is p250 荒地拾遗 and file3 idx0 is p401
  罗德岛生活指南.
* `title` blocks are far more numerous (731) than the book's sections (61),
  because sub-headings inside a section are titles too. Sections are still
  identified by the printed `CHAPTER n.m` marker — MinerU merges the marker and
  its title into a single block, which is easier to read than before, not
  harder. Other titles become headings within the section.

Images are cropped from the PDF rather than downloaded from MinerU's CDN: the
CDN URLs expire, and the local scan is the higher-resolution source. `bbox` is
in the coordinate space `page_size` gives, so it is scaled to the render.

Usage:
    conda run -n study python scripts/mineru_book.py
    conda run -n study python scripts/mineru_book.py --no-images
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import tempfile
from pathlib import Path

ROOT       = Path(__file__).parent.parent
MINERU_DIR = ROOT / "大地巡旅"
OUT_JSON   = ROOT / "data" / "book_sections.json"
IMG_DIR    = ROOT / "data" / "book-images"

BOOK_TITLE    = "大地巡旅"
BOOK_TITLE_EN = "Terra: A Journey"
DPI = 150                     # the scan's own resolution

MARKER = re.compile(r"^CHAPTER\s*([0-9]+(?:\.[0-9A-Za-z]+)*)\s*(.*)$", re.I)
LATIN  = re.compile(r"^[A-Za-z0-9\s,.'&/:\-—()]+$")

# Sections the book sets without a printed CHAPTER marker. Still needed: MinerU
# recovers their heading as a title block, but nothing in the text says they
# begin a section rather than a sub-heading. Numbering follows 泰拉年表, which
# cites the first as 「大地巡旅：6.Extra 罗德岛」.
EXTRA_SECTIONS = [
    # Chapter 4's divider page is classified as an image by MinerU, so its
    # CHAPTER 4 marker appears nowhere in the export and section "3" silently
    # swallowed all 28 pages of 泰拉种族. Page 87 is where RapidOCR found the
    # printed marker, and it matches the contents spread (folio 079 + the 9-page
    # front-matter offset that folio 107 -> p116 also shows).
    ("4",       "泰拉种族",       "RACES OF TERRA", 87,  "4"),
    ("6.Extra", "罗德岛生活指南", "RHODES ISLAND",  401, "6"),
    ("后记",     "后记",          "POSTFACE",       431, "附录"),
    ("档案归档", "档案归档",       None,             443, "附录"),
    ("感谢名单", "感谢名单",       "SPECIAL THANKS", 450, "附录"),
]
APPENDIX = {"number": "附录", "title": "附录", "title_en": "APPENDIX"}
TOC_PAGES = {6, 7}

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def flat(b: dict) -> str:
    """Block text on one line. MinerU keeps the printed line breaks, and the
    marker regex is anchored with `$`, which `.` cannot reach across a newline —
    so the contents-spread entries silently never matched."""
    return re.sub(r"\s+", " ", block_text(b)).strip()


def block_text(b: dict) -> str:
    """Flatten a MinerU block's nested lines/spans into its text."""
    out = []
    for sub in (b.get("blocks") or [b]):
        for line in (sub.get("lines") or []):
            out.append("".join(s.get("content", "") for s in (line.get("spans") or [])))
    return "".join(out).strip()


def load_pages() -> list[dict]:
    """
    Every page across the three exports, in book order, with real page numbers.

    Offsets are cumulative because the filenames cannot be trusted (see the
    module docstring); the files are ordered by the first number in their name.
    """
    files = sorted(MINERU_DIR.glob("MinerU_*.json"),
                   key=lambda f: int(re.search(r"_(\d+)-\d+\.json$", f.name).group(1)))
    if not files:
        log.error(f"no MinerU_*.json in {MINERU_DIR}")
        return []

    pages, offset = [], 1
    for f in files:
        doc = json.loads(f.read_text(encoding="utf-8"))
        info = sorted(doc["pdf_info"], key=lambda p: p.get("page_idx", 0))
        for p in info:
            pages.append({
                "page": offset + p["page_idx"],
                "page_size": p.get("page_size"),
                "blocks": p.get("para_blocks", []),
            })
        log.info(f"  {f.name[-18:]}: {len(info)} pages → {offset}..{offset + len(info) - 1}")
        offset += len(info)
    return pages


def crop_images(pages: list[dict], pdf: Path) -> dict[int, list[dict]]:
    """Crop every image/chart region out of the PDF; returns page -> [asset]."""
    from PIL import Image

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    out: dict[int, list[dict]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for p in pages:
            regions = [b for b in p["blocks"] if b.get("type") in ("image", "chart")]
            if not regions:
                continue
            prefix = Path(tmp) / "pg"
            subprocess.run(
                ["pdftoppm", "-f", str(p["page"]), "-l", str(p["page"]),
                 "-r", str(DPI), "-png", str(pdf), str(prefix)],
                check=True, capture_output=True)
            hits = sorted(prefix.parent.glob(prefix.name + "*.png"))
            if not hits:
                continue
            with Image.open(hits[0]) as im:
                pw, ph = p["page_size"] or [im.width, im.height]
                # bbox is in page_size units; scale it onto the render.
                sx, sy = im.width / pw, im.height / ph
                for i, b in enumerate(regions, 1):
                    x0, y0, x1, y1 = b["bbox"]
                    box = (max(0, int(x0 * sx)), max(0, int(y0 * sy)),
                           min(im.width, int(x1 * sx)), min(im.height, int(y1 * sy)))
                    if box[2] - box[0] < 8 or box[3] - box[1] < 8:
                        continue
                    name = f"p{p['page']:04d}_{i:02d}.png"
                    im.crop(box).save(IMG_DIR / name)
                    out.setdefault(p["page"], []).append({
                        "file": name, "kind": b["type"], "bbox": b["bbox"],
                    })
            hits[0].unlink(missing_ok=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="MinerU output -> book_sections.json")
    ap.add_argument("--pdf", help="path to the scan (default: the one in the project root)")
    ap.add_argument("--no-images", action="store_true", help="skip cropping illustrations")
    ap.add_argument("--out", default=str(OUT_JSON))
    args = ap.parse_args()

    pages = load_pages()
    if not pages:
        return
    log.info(f"{len(pages)} pages total")

    assets: dict[int, list[dict]] = {}
    if not args.no_images:
        pdf = Path(args.pdf) if args.pdf else next(iter(sorted(ROOT.glob("大地巡旅*.pdf"))), None)
        if pdf and pdf.exists():
            assets = crop_images(pages, pdf)
            log.info(f"cropped {sum(len(v) for v in assets.values())} illustration(s) "
                     f"→ {IMG_DIR.relative_to(ROOT)}")
        else:
            log.warning("PDF not found — skipping illustrations")

    # ---- section markers -----------------------------------------------
    markers = []
    for p in pages:
        if p["page"] in TOC_PAGES:
            continue
        for i, b in enumerate(p["blocks"]):
            # Markers land in `title` blocks (35) and `text` blocks (19) alike —
            # filtering on type alone loses a third of the sections.
            if b.get("type") not in ("title", "text"):
                continue
            m = MARKER.match(flat(b))
            if not m:
                continue
            rest = m.group(2).strip()
            if not rest:
                # A bare "CHAPTER 2.2": the titles are the blocks after it.
                nxt = [flat(x) for x in p["blocks"][i + 1:i + 4] if flat(x)]
                zh_n = next((t for t in nxt if not LATIN.match(t)), None)
                en_n = next((t for t in nxt if LATIN.match(t)), None)
                markers.append({"number": m.group(1), "title": zh_n,
                                "title_en": en_n, "page": p["page"], "block": i,
                                "chapter": m.group(1).split(".")[0]})
                continue
            # MinerU merges marker, Chinese title and English title into one
            # block; split the Latin tail off the end.
            zh, en = rest, None
            mm = re.match(r"^(.*?)\s*([A-Za-z][A-Za-z0-9\s,.'&/:\-—()]+)$", rest)
            if mm and mm.group(1).strip():
                zh, en = mm.group(1).strip(), mm.group(2).strip()
            markers.append({"number": m.group(1), "title": zh or None,
                            "title_en": en, "page": p["page"], "block": i,
                            "chapter": m.group(1).split(".")[0]})
    for number, title, title_en, page, chapter in EXTRA_SECTIONS:
        markers.append({"number": number, "title": title, "title_en": title_en,
                        "page": page, "block": -1, "chapter": chapter})
    markers.sort(key=lambda m: (m["page"], m["block"]))
    log.info(f"{len(markers)} section marker(s)")

    by_page = {p["page"]: p for p in pages}
    sections = []
    for idx, mk in enumerate(markers):
        start = mk["page"]
        end = markers[idx + 1]["page"] - 1 if idx + 1 < len(markers) else pages[-1]["page"]
        end = max(end, start)

        chunks = []
        for pno in range(start, end + 1):
            p = by_page.get(pno)
            if not p:
                continue
            for i, b in enumerate(p["blocks"]):
                if pno == start and i == mk["block"]:
                    continue                       # the heading itself
                kind = b.get("type")
                if kind in ("text", "title", "table"):
                    t = block_text(b)
                    if t:
                        chunks.append({"page": pno, "text": t,
                                       "heading": kind == "title"})
            for a in assets.get(pno, []):
                chunks.append({"page": pno, "image": a["file"], "kind": a["kind"]})

        sections.append({
            "number": mk["number"], "chapter": mk["chapter"],
            "depth": mk["number"].count(".") + 1,
            "title": mk["title"], "title_en": mk["title_en"],
            "page_start": start, "page_end": end,
            "chars": sum(len(c.get("text", "")) for c in chunks),
            "chunks": chunks,
        })

    # ---- top-level chapters from the contents spread ---------------------
    toc = []
    for p in pages:
        if p["page"] not in TOC_PAGES:
            continue
        for b in p["blocks"]:
            # Contents entries are prefixed with the page they point at
            # ("033 CHAPTER 2 泰拉科技"), so this searches rather than anchors.
            m = re.search(r"CHAPTER\s*([0-9]+)\s+(.*)$", flat(b), re.I)
            if m and "." not in m.group(1):
                rest = m.group(2).strip()
                mm = re.match(r"^(.*?)\s*([A-Za-z][A-Za-z0-9\s,.'&/:\-—()]+)$", rest)
                toc.append({"number": m.group(1),
                            "title": (mm.group(1).strip() if mm else rest) or None,
                            "title_en": mm.group(2).strip() if mm else None})
    used = {s["chapter"] for s in sections}
    chapters = [c for c in toc if c["number"] in used]
    if "附录" in used:
        chapters.append(APPENDIX)
    missing = used - {c["number"] for c in chapters}
    if missing:
        log.warning(f"  chapters not in the contents spread: {sorted(missing)}")
        chapters += [{"number": n, "title": n, "title_en": None} for n in sorted(missing)]

    covered = {c["page"] for s in sections for c in s["chunks"]}
    orphan = [p["page"] for p in pages if p["page"] not in covered
              and sum(len(block_text(b)) for b in p["blocks"]) > 30]

    Path(args.out).write_text(json.dumps({
        "title": BOOK_TITLE, "title_en": BOOK_TITLE_EN,
        "source": "MinerU hybrid/medium 3.4.4",
        "pages": len(pages), "chapters": chapters, "sections": sections,
        "orphan_pages": orphan,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    text_chunks = sum(1 for s in sections for c in s["chunks"] if c.get("text"))
    img_chunks = sum(1 for s in sections for c in s["chunks"] if c.get("image"))
    log.info(f"{len(chapters)} chapters / {len(sections)} sections / "
             f"{text_chunks} paragraphs / {img_chunks} images / "
             f"{sum(s['chars'] for s in sections):,} chars")
    log.info(f"{len(orphan)} page(s) before the first section")
    log.info(f"wrote {Path(args.out).relative_to(ROOT)}")


if __name__ == "__main__":
    main()
