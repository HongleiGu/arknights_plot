"""
Upload scraped gadget icons to Supabase Storage at gadget-icons/<sha1>.png.

scrape_gadgets.py downloads each relic icon to

    data/gadget-icons/<theme>/<wiki-image-basename>

and stamps gadgets.icon_sha1 = sha1 of that data/-relative path (the exact
convention upload_story_images.sha1_for uses). This script just pushes those
local files to Storage under the same sha1 key — no DB writes needed, because
import_gadgets.py already wrote icon_sha1 from the scraped JSON. URL
construction lives in src/lib/storage.ts (`gadgetIconUrl`).

Pure file → Storage, idempotent (upsert). Non-PNG sources are converted to
PNG via Pillow so the bucket stays PNG-only, same as upload_story_images.py.

Prereqs:
  • .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  • Public bucket 'data' exists
  • data/gadget-icons/ populated (run scrape_gadgets.py first)

Usage:
    python scripts/upload_gadget_icons.py
    python scripts/upload_gadget_icons.py --dry-run
"""

from __future__ import annotations
import argparse
import hashlib
import io
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image
from supabase import create_client, Client

load_dotenv(Path(__file__).parent.parent / ".env")

ROOT      = Path(__file__).parent.parent
DATA_DIR  = ROOT / "data"
ICONS_DIR = DATA_DIR / "gadget-icons"
BUCKET    = "data"
SUBDIR    = "gadget-icons"
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)


def sha1_for(rel_path: Path) -> str:
    """SHA1 of the data/-relative path string, forward-slashed. Must match
    scrape_gadgets.sha1_for / upload_story_images.sha1_for exactly."""
    return hashlib.sha1("/".join(rel_path.parts).encode("utf-8")).hexdigest()


def file_bytes_as_png(local: Path) -> bytes:
    if local.suffix.lower() == ".png":
        return local.read_bytes()
    with Image.open(local) as img:
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        return buf.getvalue()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                   help="show planned uploads without uploading")
    args = p.parse_args()

    if not ICONS_DIR.exists():
        log.info(f"(no {ICONS_DIR.relative_to(ROOT)} — run scrape_gadgets.py "
                 f"first; nothing to upload)")
        return

    files = [p for p in ICONS_DIR.rglob("*")
             if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    log.info(f"Found {len(files)} icon file(s) under "
             f"{ICONS_DIR.relative_to(ROOT)}")

    counts = {"uploaded": 0, "failed": 0}
    for local in files:
        sha = sha1_for(local.relative_to(DATA_DIR))
        key = f"{SUBDIR}/{sha}.png"
        if args.dry_run:
            counts["uploaded"] += 1
            continue
        try:
            supabase.storage.from_(BUCKET).upload(
                path=key,
                file=file_bytes_as_png(local),
                file_options={"content-type": "image/png", "upsert": "true"},
            )
            counts["uploaded"] += 1
        except Exception as e:
            log.error(f"upload failed for {local.name}: {e}")
            counts["failed"] += 1

    log.info("---")
    for k, v in counts.items():
        log.info(f"  {k:<10} = {v}")
    if args.dry_run:
        log.info("\nDRY RUN — no uploads happened.")


if __name__ == "__main__":
    main()
