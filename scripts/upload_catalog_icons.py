"""
Upload scraped enemy / item icons to Cloudflare R2.

    data/enemy-icons/<file>  ->  enemy-icons/<sha1>.png
    data/item-icons/<file>   ->  item-icons/<sha1>.png

Same convention as upload_gadget_icons.py: the key is the sha1 of the
data/-relative path (NOT of the file contents), which is exactly what the
scrapers stamped into enemies.icon_sha1 / items.icon_sha1. So no DB writes are
needed here — the rows already point at these keys, and this just puts the
bytes where src/lib/storage.ts will look for them.

Non-PNG sources are converted to PNG so the bucket stays PNG-only, matching
`enemyIconUrl` / `itemIconUrl`, which append a hard-coded `.png`.

Idempotent: put_object overwrites, so re-running is harmless.

Prereqs:
  • .env with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  • pip install boto3 pillow python-dotenv   (already in the `study` env)

Usage:
    conda run -n study python scripts/upload_catalog_icons.py
    conda run -n study python scripts/upload_catalog_icons.py --dry-run
    conda run -n study python scripts/upload_catalog_icons.py --only enemies
"""

import argparse
import hashlib
import io
import logging
import os
from pathlib import Path

import boto3
from dotenv import load_dotenv
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
load_dotenv(ROOT / ".env")

log = logging.getLogger("icons")

# alias -> (local dir, R2 key prefix)
KINDS = {
    "enemies": (DATA / "enemy-icons", "enemy-icons"),
    "items":   (DATA / "item-icons",  "item-icons"),
}


def sha1_for(rel: Path) -> str:
    """sha1 of the data/-relative path — identical to the scrapers' stamp."""
    return hashlib.sha1("/".join(rel.parts).encode("utf-8")).hexdigest()


def as_png(path: Path) -> bytes:
    if path.suffix.lower() == ".png":
        return path.read_bytes()
    buf = io.BytesIO()
    Image.open(path).convert("RGBA").save(buf, format="PNG")
    return buf.getvalue()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", choices=sorted(KINDS))
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")

    bucket = os.environ.get("R2_BUCKET", "arknights-assets")
    r2 = None
    if not args.dry_run:
        missing = [k for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
                   if not os.environ.get(k)]
        if missing:
            raise SystemExit("missing in .env: " + ", ".join(missing))
        r2 = boto3.client(
            "s3",
            endpoint_url=f'https://{os.environ["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )

    total = 0
    for alias in ([args.only] if args.only else list(KINDS)):
        src, prefix = KINDS[alias]
        if not src.is_dir():
            log.info(f"{alias}: {src.relative_to(ROOT)} absent — nothing to upload")
            continue
        files = [f for f in sorted(src.rglob("*")) if f.is_file()]
        log.info(f"{alias}: {len(files)} file(s) in {src.relative_to(ROOT)}")
        for i, f in enumerate(files, 1):
            key = f"{prefix}/{sha1_for(f.relative_to(DATA))}.png"
            if args.dry_run:
                if i <= 3:
                    log.info(f"    {f.name} -> {key}")
                continue
            try:
                r2.put_object(Bucket=bucket, Key=key, Body=as_png(f),
                              ContentType="image/png",
                              CacheControl="public, max-age=31536000, immutable")
            except Exception as e:                    # noqa: BLE001
                log.warning(f"    failed {f.name}: {type(e).__name__}: {e}")
                continue
            total += 1
            if total % 100 == 0:
                log.info(f"    uploaded {total} …")

    log.info(f"dry run — nothing uploaded" if args.dry_run else f"uploaded {total} icon(s) to {bucket}")


if __name__ == "__main__":
    main()
