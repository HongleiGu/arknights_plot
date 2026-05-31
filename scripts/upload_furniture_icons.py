"""
Upload scraped furniture icons to Cloudflare R2 at furniture-icons/<sha1>.png.

scrape_furniture.py downloads icons to:

    data/furniture-icons/themes/<filename>            — collection-level icons
    data/furniture-icons/items/<safe_theme>/<file>    — per-theme item icons
    data/furniture-icons/standalone/<safe_cat>/<file> — standalone item icons

and stamps each entry's icon_sha1 = sha1_for(data/-relative path).  This
script pushes those local files to R2 under the same sha1 key —
import_furniture.py already wrote icon_sha1 from the JSON so no DB writes
are needed here.  URL construction lives in src/lib/storage.ts
(`furnitureIconUrl`).

Pure file → R2, idempotent (put_object overwrites).  Non-PNG sources are
converted to PNG via Pillow so the bucket stays PNG-only.

Prereqs:
  • .env with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  • data/furniture-icons/ populated (run scrape_furniture.py first)

Usage:
    python scripts/upload_furniture_icons.py
    python scripts/upload_furniture_icons.py --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import io
import logging
import os
from pathlib import Path

import boto3
from botocore.config import Config
from dotenv import load_dotenv
from PIL import Image

load_dotenv(Path(__file__).parent.parent / ".env")

ROOT      = Path(__file__).parent.parent
DATA_DIR  = ROOT / "data"
ICONS_DIR = DATA_DIR / "furniture-icons"
SUBDIR    = "furniture-icons"
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

R2_BUCKET = os.environ.get("R2_BUCKET", "arknights-assets")
r2 = boto3.client(
    "s3",
    endpoint_url=f'https://{os.environ["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
    config=Config(signature_version="s3v4"),
)


def sha1_for(rel: Path) -> str:
    """SHA1 of the data/-relative POSIX path.  Must match scrape_furniture.sha1_for."""
    return hashlib.sha1("/".join(rel.parts).encode("utf-8")).hexdigest()


def to_png_bytes(local: Path) -> bytes:
    if local.suffix.lower() == ".png":
        return local.read_bytes()
    with Image.open(local) as img:
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="show planned uploads without uploading")
    args = ap.parse_args()

    if not ICONS_DIR.exists():
        log.info(f"(no {ICONS_DIR.relative_to(ROOT)} — run scrape_furniture.py "
                 f"first; nothing to upload)")
        return

    files = [p for p in ICONS_DIR.rglob("*")
             if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    log.info(f"Found {len(files)} icon file(s) under "
             f"{ICONS_DIR.relative_to(ROOT)}")

    counts: dict[str, int] = {"uploaded": 0, "failed": 0}
    for local in sorted(files):
        rel  = local.relative_to(DATA_DIR)
        sha  = sha1_for(rel)
        key  = f"{SUBDIR}/{sha}.png"
        if args.dry_run:
            log.info(f"  would upload: {rel} → {key}")
            counts["uploaded"] += 1
            continue
        try:
            r2.put_object(Bucket=R2_BUCKET, Key=key,
                          Body=to_png_bytes(local), ContentType="image/png")
            counts["uploaded"] += 1
            log.info(f"uploaded {local.name}")

        except Exception as e:
            log.error(f"  upload failed for {local.name}: {e}")
            counts["failed"] += 1

    log.info("---")
    for k, v in counts.items():
        log.info(f"  {k:<10} = {v}")
    if args.dry_run:
        log.info("\nDRY RUN — no uploads happened.")


if __name__ == "__main__":
    main()
