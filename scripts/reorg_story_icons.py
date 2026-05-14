"""
Move icons from data/story_icons/情报处理室_<X>.png into the per-story
folders already populated under data/img/, renaming to <X>_icon.png so
they sit alongside the existing <X>.png (title) and <X>_cover.png files.

Authoritative source for each story name is data/story_descriptions.json
(the `story_name` field). The scraped icon filename was sanitized
(Chinese punctuation → underscore, " 不可用" suffix preserved as "_不可用"),
so matching directly on the icon filename misses ~6 stories.

For each unmatched story, retry by replacing any leftover '_' in the
candidate name with English punctuation (':') before giving up.

This is a one-shot. Re-running is safe: it only moves files that still
exist in data/story_icons/.

Usage:
    python scripts/reorg_story_icons.py            # dry-run
    python scripts/reorg_story_icons.py --apply    # actually move files
"""

from __future__ import annotations
import argparse
import json
import re
import shutil
from pathlib import Path

ROOT       = Path(__file__).parent.parent
ICONS_DIR  = ROOT / "data" / "story_icons"
IMG_ROOT   = ROOT / "data" / "img"
INPUT_JSON = ROOT / "data" / "story_descriptions.json"


def find_target_dir(story_name: str) -> Path | None:
    """Search data/img/ for a directory containing <story_name>.png."""
    matches = [
        p.parent for p in IMG_ROOT.rglob(f"{story_name}.png")
        if p.name == f"{story_name}.png"
    ]
    return matches[0] if matches else None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true",
                   help="actually move files (default is dry-run)")
    args = p.parse_args()

    data = json.loads(INPUT_JSON.read_text(encoding="utf-8"))

    moved:     list[tuple[str, Path, Path]] = []
    unmatched: list[str] = []
    no_local:  list[str] = []

    for s in data:
        if not s.get("icon_path"):
            continue
        local_name = Path(s["icon_path"]).name           # 情报处理室_X.png
        src = ICONS_DIR / local_name
        if not src.exists():
            # Already moved on a previous run, or icon never downloaded.
            continue

        story = s["story_name"]
        target_dir = find_target_dir(story)

        # Fallback: try English punctuation for stories whose Chinese name
        # contains ':' / '"' etc. that may have been transcribed differently
        # on disk.
        if target_dir is None and any(ch in story for ch in '：""，'):
            ascii_name = (
                story.replace('：', ':')
                     .replace('"', '"').replace('"', '"')
                     .replace('，', ',')
            )
            target_dir = find_target_dir(ascii_name)

        if target_dir is None:
            unmatched.append(story)
            continue

        dst = target_dir / f"{story}_icon.png"
        moved.append((story, src.relative_to(ROOT), dst.relative_to(ROOT)))
        if args.apply:
            shutil.move(str(src), str(dst))

    print(f"to move      : {len(moved)}")
    print(f"unmatched    : {len(unmatched)}")
    print(f"already-gone : {sum(1 for s in data if s.get('icon_path') and not (ICONS_DIR / Path(s['icon_path']).name).exists())}")
    print()
    print("Sample moves (first 10):")
    for story, src, dst in moved[:10]:
        print(f"  {src}  →  {dst}")
    if unmatched:
        print()
        print("Unmatched stories (need a folder under data/img/ to land in):")
        for s in unmatched:
            print(f"  {s}")

    if not args.apply:
        print("\nDry run. Re-run with --apply to actually move files.")
    else:
        print(f"\nDone — {len(moved)} files moved.")


if __name__ == "__main__":
    main()
