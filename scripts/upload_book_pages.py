"""
Render every page of the 大地巡旅 scan and upload it to R2 (AP-31 / AP-34).

    <book>.pdf  ->  data/book-pages/p0011.jpg  ->  book-pages/<sha1>.jpg

Why full pages as well as the crops
-----------------------------------
The imported text is OCR, and the plates are cropped regions — neither carries
the page's layout, and some information only exists there: a table's alignment,
which caption belongs to which plate, 凯尔希's handwriting sitting beside the
paragraph it argues with. The reader gets a per-page toggle to show the scan
next to the text, so a reader (not only a proofreader) can check the original.

JPEG, not PNG
-------------
The bucket is otherwise PNG-only, which is right for icons — flat art with few
colours, where PNG is both smaller and lossless. A photographic page scan is
the opposite case. Measured on p11 at 1400px wide: 222KB as JPEG q82 against
~2.4MB as PNG, i.e. 98MB versus roughly 1GB across 453 pages, for no visible
difference at reading size. So this kind is `.jpg` and `bookPageUrl()` in
storage.ts knows that.

1400px is chosen to be legible rather than faithful: the body text is readable
for checking a word, and the native 150dpi render (2182px) is available by
re-running with --width if a page ever needs more.

Idempotent: a page whose local JPEG already exists is neither re-rendered nor
re-uploaded unless --force, so this resumes after an interruption. The R2 key is
the sha1 of the data/-relative path — the same convention as every other asset,
so the reader can compute the URL from a page number with no database lookup.

Prereqs:
  • .env with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  • pdftoppm (poppler) on PATH; pip install boto3 pillow python-dotenv

Usage:
    conda run -n study python scripts/upload_book_pages.py
    conda run -n study python scripts/upload_book_pages.py --pages 1-20
    conda run -n study python scripts/upload_book_pages.py --no-upload   # render only
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import logging
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

import boto3
from dotenv import load_dotenv
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT_DIR = DATA / "book-pages"
PREFIX = "book-pages"

DPI = 150          # the scan's own resolution; rendering higher only upsamples
WIDTH = 1400       # legible for checking a word, ~222KB/page
QUALITY = 82

load_dotenv(ROOT / ".env")
logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")
log = logging.getLogger("pages")


def sha1_for(rel: str) -> str:
    """sha1 of the data/-relative path — the project-wide asset key."""
    return hashlib.sha1(rel.encode("utf-8")).hexdigest()


def page_count(pdf: Path) -> int:
    # Bytes, not text=True: pdfinfo echoes the PDF's Chinese Title in the
    # Windows code page, and decoding that as UTF-8 makes subprocess hand back
    # stdout=None, which looks like poppler being missing.
    raw = subprocess.run(["pdfinfo", str(pdf)], capture_output=True).stdout or b""
    m = re.search(r"Pages:\s+(\d+)", raw.decode("utf-8", "replace"))
    return int(m.group(1)) if m else 0


def parse_pages(spec: str | None, total: int) -> list[int]:
    if not spec:
        return list(range(1, total + 1))
    out: list[int] = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-", 1)
            out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return [p for p in out if 1 <= p <= total]


def render(pdf: Path, page: int, width: int, quality: int) -> Path:
    """One page -> a downscaled JPEG in data/book-pages/."""
    dest = OUT_DIR / f"p{page:04d}.jpg"
    with tempfile.TemporaryDirectory() as tmp:
        pre = str(Path(tmp) / "pg")
        subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page),
                        "-r", str(DPI), "-png", str(pdf), pre],
                       check=True, capture_output=True)
        hits = sorted(glob.glob(pre + "*.png"))
        if not hits:
            raise RuntimeError(f"page {page}: pdftoppm produced nothing")
        with Image.open(hits[0]) as im:
            h = int(im.height * width / im.width)
            im.resize((width, h), Image.LANCZOS).convert("RGB").save(
                dest, "JPEG", quality=quality, optimize=True)
    return dest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", help="path to the scan (default: the one in the project root)")
    ap.add_argument("--pages", help="e.g. 1-20 or 11,120")
    ap.add_argument("--width", type=int, default=WIDTH)
    ap.add_argument("--quality", type=int, default=QUALITY)
    ap.add_argument("--force", action="store_true", help="re-render and re-upload")
    ap.add_argument("--no-upload", action="store_true", help="render locally only")
    args = ap.parse_args()

    pdf = Path(args.pdf) if args.pdf else next(iter(sorted(ROOT.glob("大地巡旅*.pdf"))), None)
    if not pdf or not pdf.exists():
        log.error("PDF not found — pass --pdf")
        return
    total = page_count(pdf)
    if not total:
        log.error("could not read the page count (is pdfinfo on PATH?)")
        return
    pages = parse_pages(args.pages, total)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    r2 = None
    bucket = os.environ.get("R2_BUCKET", "arknights-assets")
    if not args.no_upload:
        missing = [k for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
                   if not os.environ.get(k)]
        if missing:
            log.error(f"missing in .env: {', '.join(missing)}")
            return
        r2 = boto3.client(
            "s3",
            endpoint_url=f'https://{os.environ["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )

    log.info(f"{pdf.name}: {total} pages; {len(pages)} selected, "
             f"{args.width}px jpeg q{args.quality}")
    done = skipped = failed = 0
    started = time.time()
    for n, page in enumerate(pages, 1):
        dest = OUT_DIR / f"p{page:04d}.jpg"
        if dest.exists() and not args.force:
            skipped += 1
            continue
        try:
            render(pdf, page, args.width, args.quality)
        except Exception as e:                            # noqa: BLE001
            log.warning(f"  p{page}: render failed ({type(e).__name__})")
            failed += 1
            continue
        if r2 is not None:
            key = f"{PREFIX}/{sha1_for(f'{PREFIX}/{dest.name}')}.jpg"
            try:
                r2.put_object(Bucket=bucket, Key=key, Body=dest.read_bytes(),
                              ContentType="image/jpeg",
                              CacheControl="public, max-age=31536000, immutable")
            except Exception as e:                        # noqa: BLE001
                log.warning(f"  p{page}: upload failed ({type(e).__name__}: {e})")
                failed += 1
                continue
        done += 1
        if done % 25 == 0:
            rate = (time.time() - started) / done
            log.info(f"    {done} page(s), ~{(len(pages) - n) * rate / 60:.0f} min left")

    log.info(f"done: {done} uploaded, {skipped} already present, {failed} failed "
             f"in {(time.time() - started) / 60:.1f} min")
    if skipped and not args.force:
        log.info("  (re-run with --force to re-render those)")


if __name__ == "__main__":
    main()
