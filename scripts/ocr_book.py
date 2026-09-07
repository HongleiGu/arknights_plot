"""
OCR the 大地巡旅 settings-book scan into per-page JSON (AP-31).

    data/<book>.pdf  ->  data/book_ocr/p0001.json …  ->  (AP-31 next step) text_chunks

Why OCR at all: the scan has no text layer — `pdftotext` over five pages
returns five bytes. Measured on a 4-page pilot: RapidOCR runs ~10s/page on CPU
at mean confidence 0.98-0.99, and got 769 of 770 characters right on a
body-text page (究竟 -> 究竞). So the scan quality is fine; the hard part is
not recognition.

The hard part is READING ORDER
------------------------------
RapidOCR returns boxes sorted top-to-bottom with no layout model. On a
two-column page that interleaves the right-hand image caption into the middle
of a left-hand body paragraph — the text is all correct and the meaning is
destroyed. Pilot page 120 produced:

    …粗鄙用语以及使用暴力威胁使者的行为被维多利亚王室
    ■塔拉游牧民不理解，为何头戴这样一        <- right-column caption
    判断为表示宣战的挑衅行为。就这样…        <- body continues

So this script re-orders the boxes geometrically (`order_blocks`), which is
deterministic and needs no layout model: find the vertical gutters, then read
column by column. That is cheaper and more predictable than PP-Structure, and
far cheaper than sending 453 large images to a vision model.

What it does NOT do: fix characters. 凯尔希's handwritten 批注 come back
recognisable but wrong on proper nouns (为维多利亚辩护 -> 为缠多利业辨辩护).
That is the LLM cleanup pass's job, and `entities` (026) is the 6885-name
gazetteer it should check against. Keeping the two separate matters: this
step must stay re-runnable and deterministic, so the expensive, non-repeatable
LLM pass never re-does the cheap part.

Output is one JSON per page so a 75-minute run is resumable: an existing page
file is skipped, which makes Ctrl-C a pause rather than a loss (the same
posture as every scraper here).

Dependencies:  pip install rapidocr_onnxruntime   (in the `study` conda env)
               pdftoppm (poppler) on PATH — ships with Git for Windows

Usage:
    conda run -n study python scripts/ocr_book.py --pdf "<file>.pdf"
    conda run -n study python scripts/ocr_book.py --pages 118-122   # a range
    conda run -n study python scripts/ocr_book.py --force           # redo pages
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT    = Path(__file__).parent.parent
OUT_DIR = ROOT / "data" / "book_ocr"

DPI = 150               # the scan's own resolution; upscaling adds no detail

# Layout thresholds, as fractions of page width/height. Tuned on the pilot
# pages, but every one is a ratio rather than a pixel count so they survive a
# different DPI or a differently sized book.
SPAN_FRAC    = 0.60     # box wider than this spans columns (title, full-width line)
GUTTER_FRAC  = 0.025    # empty vertical band this wide separates two columns
MARGIN_FRAC  = 0.045    # top/bottom band that holds running heads and folios
VERT_RATIO   = 2.5      # height/width above this = rotated sidebar text
BRIDGE_TOL   = 0.10     # share of lines allowed to bridge a gutter and still count it

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def _bbox(poly) -> tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def order_blocks(boxes: list[dict], width: float, height: float) -> list[dict]:
    """
    Put OCR boxes into human reading order.

    A lightweight XY-cut. Full-width boxes (headings, rules) act as horizontal
    separators; between two of them the page is split into columns at its
    empty vertical gutters, and each column is read top-to-bottom before the
    next one starts. Single-column pages fall through to a plain y-sort, which
    is what RapidOCR already does — so this only changes pages that need it.
    """
    if not boxes:
        return []

    body = [b for b in boxes if b["tag"] == "body"]
    if not body:
        return sorted(boxes, key=lambda b: (b["y0"], b["x0"]))

    spanning = [b for b in body if (b["x1"] - b["x0"]) >= SPAN_FRAC * width]
    rest     = [b for b in body if b not in spanning]

    def columns_of(group: list[dict]) -> list[list[dict]]:
        """Split a set of boxes into columns at gutters wide enough to be real."""
        if len(group) < 2:
            return [group]
        # Coverage histogram over x: how many boxes cross each bin. A gutter is
        # a wide run of NEAR-zero coverage, not strictly-zero — on this book a
        # single line can bridge the gutter (page 120's handwritten annotation
        # runs from the body column into the caption column), and a binary
        # occupancy map lets that one box erase a gutter that 40 other lines
        # agree on.
        bins = 200
        cover = [0] * bins
        for b in group:
            lo = max(0, int(b["x0"] / width * bins))
            hi = min(bins - 1, int(b["x1"] / width * bins))
            for i in range(lo, hi + 1):
                cover[i] += 1
        peak = max(cover) or 1
        quiet = max(1, int(BRIDGE_TOL * peak))     # tolerated bridging boxes
        min_run = max(1, int(GUTTER_FRAC * bins))
        cuts, run = [], 0
        for i in range(bins + 1):
            if i < bins and cover[i] <= quiet:
                run += 1
                continue
            # A run touching either edge is a page margin, not a gutter.
            if run >= min_run and run != i and i - run > 0:
                cuts.append((i - run / 2) / bins * width)
            run = 0
        if not cuts:
            return [group]
        cols: list[list[dict]] = [[] for _ in range(len(cuts) + 1)]
        for b in group:
            mid = (b["x0"] + b["x1"]) / 2
            idx = sum(1 for c in cuts if mid > c)
            cols[idx].append(b)
        return [c for c in cols if c]

    # Horizontal bands, delimited by the full-width boxes.
    out: list[dict] = []
    seps = sorted(spanning, key=lambda b: b["y0"])
    edges = [0.0] + [b["y1"] for b in seps] + [height]
    sep_iter = iter(seps)
    for i in range(len(edges) - 1):
        top, bottom = edges[i], edges[i + 1]
        if i > 0:
            out.append(next(sep_iter))
        band = [b for b in rest if top <= (b["y0"] + b["y1"]) / 2 < bottom]
        for col in columns_of(band):
            out.extend(sorted(col, key=lambda b: (b["y0"], b["x0"])))

    # Running heads / folios / rotated sidebars are kept but pushed to the end,
    # tagged: they are not part of the prose, and dropping them outright would
    # throw away the page number, which is how a citation finds this page.
    out.extend(sorted((b for b in boxes if b["tag"] != "body"),
                      key=lambda b: (b["y0"], b["x0"])))
    return out


def classify(x0: float, y0: float, x1: float, y1: float,
             width: float, height: float) -> str:
    w, h = x1 - x0, y1 - y0
    if h > VERT_RATIO * w:
        return "vertical"          # rotated chapter tab down the page edge
    if y1 < MARGIN_FRAC * height:
        return "header"
    if y0 > (1 - MARGIN_FRAC) * height:
        return "footer"
    return "body"


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def render(pdf: Path, page: int, out_prefix: Path) -> Path | None:
    subprocess.run(
        ["pdftoppm", "-f", str(page), "-l", str(page), "-r", str(DPI), "-png",
         str(pdf), str(out_prefix)],
        check=True, capture_output=True,
    )
    hits = sorted(out_prefix.parent.glob(out_prefix.name + "*.png"))
    return hits[0] if hits else None


def parse_pages(spec: str | None, total: int) -> list[int]:
    if not spec:
        return list(range(1, total + 1))
    pages: list[int] = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-", 1)
            pages += list(range(int(a), int(b) + 1))
        else:
            pages.append(int(part))
    return [p for p in pages if 1 <= p <= total]


def page_count(pdf: Path) -> int:
    # Bytes, not text=True: pdfinfo echoes the PDF's own Title, which here is
    # Chinese in the Windows code page. Decoding that as UTF-8 fails and
    # subprocess hands back stdout=None rather than raising — which looks like
    # "poppler is missing" and is not. The Pages: line is pure ASCII.
    raw = subprocess.run(["pdfinfo", str(pdf)], capture_output=True).stdout or b""
    m = re.search(r"Pages:\s+(\d+)", raw.decode("utf-8", "replace"))
    return int(m.group(1)) if m else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="OCR the 大地巡旅 scan.")
    ap.add_argument("--pdf", help="path to the PDF (default: the one in the project root)")
    ap.add_argument("--pages", help="e.g. 118-122 or 40,120,250")
    ap.add_argument("--force", action="store_true", help="re-OCR pages already done")
    args = ap.parse_args()

    pdf = Path(args.pdf) if args.pdf else next(iter(sorted(ROOT.glob("大地巡旅*.pdf"))), None)
    if not pdf or not pdf.exists():
        log.error("PDF not found — pass --pdf")
        return 1

    total = page_count(pdf)
    if not total:
        log.error("could not read the page count (is pdfinfo on PATH?)")
        return 1
    pages = parse_pages(args.pages, total)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    todo = [p for p in pages if args.force or not (OUT_DIR / f"p{p:04d}.json").exists()]
    log.info(f"{pdf.name}: {total} pages; {len(pages)} selected, {len(todo)} to do")
    if not todo:
        log.info("nothing to do — all selected pages already OCR'd")
        return 0

    from rapidocr_onnxruntime import RapidOCR       # slow import; only when used
    ocr = RapidOCR()

    started = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        for n, page in enumerate(todo, 1):
            img = render(pdf, page, Path(tmp) / "pg")
            if img is None:
                log.warning(f"  page {page}: render produced nothing")
                continue
            res, _ = ocr(str(img))
            from PIL import Image
            with Image.open(img) as im:
                width, height = im.size

            boxes = []
            for poly, text, conf in (res or []):
                x0, y0, x1, y1 = _bbox(poly)
                boxes.append({
                    "text": text, "conf": round(float(conf), 3),
                    "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                    "tag": classify(x0, y0, x1, y1, width, height),
                })
            ordered = order_blocks(boxes, width, height)

            (OUT_DIR / f"p{page:04d}.json").write_text(json.dumps({
                "page": page, "width": width, "height": height, "dpi": DPI,
                "blocks": ordered,
            }, ensure_ascii=False), encoding="utf-8")
            img.unlink(missing_ok=True)

            body = [b for b in ordered if b["tag"] == "body"]
            rate = (time.time() - started) / n
            eta = (len(todo) - n) * rate / 60
            log.info(f"  p{page:04d}  {len(body):3d} lines  "
                     f"{sum(len(b['text']) for b in body):5d} chars  "
                     f"[{n}/{len(todo)}, ~{eta:.0f} min left]")

    log.info(f"done in {(time.time() - started) / 60:.1f} min → {OUT_DIR.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
