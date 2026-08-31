"""
Delete plot .txt files that the CURRENT nav parse no longer claims.

Why this exists: before the `{|`/`|}` depth fix in scrape_plots.py, the parser
ran off the end of the wikitable and swept the trailing
`<div class="nomobile">{{Navbox …}}` catalogue into whichever section was the
last table row. Those pages scraped fine and landed in a plausible-looking
folder, so the damage is invisible until you notice a story with 89 chapters
that should have 6 (故事集/十字路口), or a brand-new event that has absorbed
四月辑录 (故事集/丛林症结).

Fixing the parser stops new pollution but leaves the old files on disk, and
parse_plots.py imports whatever is on disk — so without this they'd be
re-imported.

Method: re-parse the nav template, compute the exact set of file paths
scrape_plots.py would write today, and delete anything else. Deliberately
conservative:
  • only prunes INSIDE directories the nav parse actually claims, so folders
    scrape_plots.py doesn't own (data/plots/干员/, anything hand-added) are
    never touched;
  • dry-run by default — pass --apply to delete.

Usage:
    conda run -n study python scripts/prune_plots.py            # dry run
    conda run -n study python scripts/prune_plots.py --apply
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from scrape_plots import (            # noqa: E402  (path set above)
    OUTPUT_DIR,
    get_wikitext,
    NAV_TEMPLATE,
    parse_nav_template,
    safe_name,
)

PLOTS = Path(OUTPUT_DIR).resolve()


def expected_paths() -> tuple[set[Path], set[Path]]:
    """(files, dirs) that the current parse claims. Mirrors scrape_plots.main()."""
    wikitext = get_wikitext(NAV_TEMPLATE)
    if not wikitext:
        sys.exit("could not fetch the nav template")
    entries = parse_nav_template(wikitext)

    files: set[Path] = set()
    dirs: set[Path] = set()
    for entry in entries:
        category   = safe_name(entry["category"])
        section    = safe_name(entry["section"])
        subsection = safe_name(entry.get("subsection", ""))

        # Same folder rewrites as the scraper, or the two would disagree about
        # which files are expected.
        if category == section:
            section = ""
        if category == "活动":
            category = ""
        if subsection and subsection == "剧情":
            subsection = ""
            category = "故事集"

        d = (PLOTS / category / section / subsection) if subsection else (PLOTS / category / section)
        dirs.add(d.resolve())
        for i, page_title in enumerate(entry["pages"], start=1):
            files.add((d / f"{i}_{safe_name(page_title)}.txt").resolve())
    return files, dirs


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    args = p.parse_args()

    if not PLOTS.exists():
        sys.exit(f"no plots directory at {PLOTS}")

    print(f"Fetching {NAV_TEMPLATE} …")
    keep, owned_dirs = expected_paths()
    print(f"current parse claims {len(keep)} files across {len(owned_dirs)} directories\n")

    stale: list[Path] = []
    for d in sorted(owned_dirs):
        if not d.is_dir():
            continue
        for f in sorted(d.iterdir()):
            if f.is_file() and f.suffix == ".txt" and f.resolve() not in keep:
                stale.append(f)

    if not stale:
        print("Nothing to prune — every file on disk is claimed by the current parse.")
        return

    by_dir: dict[Path, int] = {}
    for f in stale:
        by_dir[f.parent] = by_dir.get(f.parent, 0) + 1
    print(f"{len(stale)} stale file(s) in {len(by_dir)} directory(ies):\n")
    for d, n in sorted(by_dir.items(), key=lambda kv: -kv[1]):
        rel = d.relative_to(PLOTS)
        kept = sum(1 for f in d.iterdir() if f.is_file() and f.resolve() in keep)
        print(f"  {str(rel):<40} {n:>4} stale, {kept:>3} kept")
    print("\n  examples:")
    for f in stale[:8]:
        print(f"    {f.relative_to(PLOTS)}")

    if not args.apply:
        print(f"\nDry run. Re-run with --apply to delete these {len(stale)} file(s).")
        return

    for f in stale:
        f.unlink()
    print(f"\nDeleted {len(stale)} file(s).")
    print("Now re-import: conda run -n study python scripts/run_pipeline.py --sync")


if __name__ == "__main__":
    main()
