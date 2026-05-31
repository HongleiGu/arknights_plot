"""
Upload all story image assets (icon / title / cover) to Cloudflare R2 and
stamp the corresponding SHA1 into stories.{icon,title,cover}_sha1.

Discovery: walks data/img/ for files in one of three name patterns:
    <story>_icon.png      → kind=icon,  column=icon_sha1
    <story>_cover.png     → kind=cover, column=cover_sha1
    <story>.png           → kind=title, column=title_sha1   (catch-all bare name)

The story name is the filename stem with the kind-suffix stripped, and is
matched against stories.name. If no row matches, the file is logged as
unmatched. If multiple rows share the same name across categories (rare),
all are stamped with the same SHA1.

  storage key  :  <subdir>/<sha1>.png
                  subdir ∈ {story-icons, story-titles, story-covers}
  SHA1 input   :  the path relative to data/   (e.g. 'img/乐章/夏日律动/火蓝之心_icon.png')

The subdirectory is implicit per kind; the DB only holds the SHA1.
URL construction lives in src/lib/storage.ts.

Idempotent: rows already carrying the matching SHA1 are skipped, and
storage uploads upsert (R2 put_object always overwrites).

Prereqs:
  • Migrations 001-005 applied.
  • stories registry populated (run parse_plots.py first).
  • .env with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.

Usage:
    python scripts/upload_story_images.py
    python scripts/upload_story_images.py --kinds icon,title
    python scripts/upload_story_images.py --dry-run
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
from supabase import create_client, Client

load_dotenv(Path(__file__).parent.parent / ".env")

ROOT     = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
IMG_ROOT = DATA_DIR / "img"
R2_BUCKET = os.environ.get("R2_BUCKET", "arknights-assets")

# Extensions we recognize as image source files. Non-PNG files are
# converted to PNG on upload via Pillow so storage stays PNG-only.
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")

# kind → (storage subdir, DB column)
KIND_META = {
    "icon":  ("story-icons",  "icon_sha1"),
    "cover": ("story-covers", "cover_sha1"),
    "title": ("story-titles", "title_sha1"),
}

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

r2 = boto3.client(
    "s3",
    endpoint_url=f'https://{os.environ["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
    config=Config(signature_version="s3v4"),
)


def sha1_for(rel_path: Path) -> str:
    """SHA1 of the relative path string (forward-slashed for stability across OSes)."""
    key = "/".join(rel_path.parts)
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def classify(path: Path) -> tuple[str, str] | None:
    """Return (kind, story_name) for an image file, or None if not applicable.

    Suffixed forms (icon, cover) are checked first; bare names fall through
    to the title kind. Extension doesn't affect kind.
    """
    if path.suffix.lower() not in IMAGE_EXTS:
        return None
    stem = path.stem
    if stem.endswith("_icon"):
        return "icon", stem[:-len("_icon")]
    if stem.endswith("_cover"):
        return "cover", stem[:-len("_cover")]
    return "title", stem


def collect_files() -> list[tuple[str, str, Path]]:
    """Return list of (kind, story_name, full_path), deduplicated.

    When multiple files match the same (kind, story_name) — e.g. both
    `不义之财.png` (local) and `不义之财.jpg` (wiki-downloaded) — the most
    recently modified one wins. This keeps the wiki scraper authoritative
    when it lands a newer version, but lets local-only files keep working.
    """
    candidates: dict[tuple[str, str], Path] = {}
    for p in IMG_ROOT.rglob("*"):
        if not p.is_file():
            continue
        c = classify(p)
        if not c:
            continue
        key = c
        prev = candidates.get(key)
        if prev is None or p.stat().st_mtime > prev.stat().st_mtime:
            candidates[key] = p
    return [(kind, name, path) for (kind, name), path in candidates.items()]


def file_bytes_as_png(local: Path) -> bytes:
    """Return the file's bytes, converted to PNG if it isn't already."""
    if local.suffix.lower() == ".png":
        return local.read_bytes()
    with Image.open(local) as img:
        # Some sources are JPEG with no alpha; some webp are RGBA. RGB is
        # safe for all-PNG output.
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        return buf.getvalue()


def upload_file(local: Path, key: str, dry: bool) -> bool:
    if dry:
        return True
    try:
        r2.put_object(Bucket=R2_BUCKET, Key=key,
                      Body=file_bytes_as_png(local), ContentType="image/png")
        return True
    except Exception as e:
        log.error(f"upload failed for {local.name}: {e}")
        return False


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--kinds", default="icon,title,cover",
                   help="comma-separated kinds to upload (default: all)")
    p.add_argument("--dry-run", action="store_true",
                   help="show planned actions without uploading or writing")
    args = p.parse_args()

    wanted = {k.strip() for k in args.kinds.split(",")}
    unknown = wanted - set(KIND_META)
    if unknown:
        raise SystemExit(f"unknown kinds: {unknown}")

    stories = (supabase.table("stories")
               .select("id, category, name, icon_sha1, title_sha1, cover_sha1")
               .execute().data)
    by_name: dict[str, list[dict]] = {}
    for s in stories:
        by_name.setdefault(s["name"], []).append(s)
    print(list(by_name.keys())[:5])
    files = collect_files()
    log.info(f"Found {len(files)} png files under {IMG_ROOT.relative_to(ROOT)}")
    log.info(f"DB has {len(stories)} stories")

    counts = {"uploaded": 0, "stamped": 0, "skipped": 0,
              "unmatched_name": 0, "failed": 0}

    for kind, story_name, local in files:
        print(story_name)
        print(by_name.get(story_name))
        if kind not in wanted:
            continue

        subdir, col = KIND_META[kind]
        # Filenames sometimes use '_' where the DB uses '·' (middle dot).
        rows = by_name.get(story_name) or by_name.get(story_name.replace("_", "·"), [])
        if not rows:
            log.warning(f"[{kind}] no stories.name = {story_name!r}  ({local.relative_to(ROOT)})")
            counts["unmatched_name"] += 1
            continue

        rel = local.relative_to(DATA_DIR)
        sha = sha1_for(rel)
        key = f"{subdir}/{sha}.png"

# disabling this as this is surely uploaded before
        # # Skip if every matching row already has this SHA1.
        # if all(r.get(col) == sha for r in rows):
        #     counts["skipped"] += 1
        #     continue

        if not upload_file(local, key, args.dry_run):
            counts["failed"] += 1
            continue
        counts["uploaded"] += 1

        for row in rows:
            if row.get(col) == sha:
                continue
            if not args.dry_run:
                (supabase.table("stories")
                 .update({col: sha})
                 .eq("id", row["id"])
                 .execute())
            counts["stamped"] += 1

        log.info(f"[{kind:>5}] {story_name}  →  {R2_BUCKET}/{key}")

    log.info("---")
    for k, v in counts.items():
        log.info(f"  {k:<16} = {v}")
    if args.dry_run:
        log.info("\nDRY RUN — no uploads or DB writes happened.")


if __name__ == "__main__":
    main()
