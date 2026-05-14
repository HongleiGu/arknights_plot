"""
End-to-end bootstrap pipeline. Run after Supabase migrations 001-005 are
applied and the local data files are in place.

Without --force (default — fast, additive):
  1. parse_plots.py            — populates stories + chapters + nodes/etc.
                                  Skips chapters already in DB.
  2. import_wiki_descriptions  — upserts chapter_descriptions from wiki JSON.
  3. upload_story_icons        — uploads icons; skips stories already stamped.

With --force (full rebuild of plot text data):
  0a. rm -rf data/plots/        — wipe local plot files
  0b. scrape_plots.py           — re-scrape every plot from prts.wiki
  1.  parse_plots.py --force    — wipe content tables, re-import everything
  2.  import_wiki_descriptions  — re-fills chapter_descriptions
  3.  upload_story_icons        — already-uploaded icons are skipped (image_path
                                  was wiped along with stories rows, so the
                                  storage upsert refreshes the DB mapping)

Assets that --force does NOT touch:
  • data/story_icons/           — wiki icons (re-scrape via scrape_story_descriptions.py)
  • data/story_descriptions.json
  • data/img/, data/imgs/       — other image assets

Prereqs:
  • .env.local has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  • Migrations 001_core.sql … 005_rls.sql applied
  • Public bucket named 'data' exists in Supabase Storage

Usage:
    python scripts/run_pipeline.py
    python scripts/run_pipeline.py --force
    python scripts/run_pipeline.py --only parse,upload
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT       = Path(__file__).parent.parent
SCRIPTS    = Path(__file__).parent
PLOTS_DIR  = ROOT / "data" / "plots"

# (alias, script-filename, args-fn, force_only)
STEPS = [
    ("scrape",   "scrape_plots.py",             lambda a: [],                                True),
    ("parse",    "parse_plots.py",              lambda a: ["--force"] if a.force else [],    False),
    ("wiki",     "import_wiki_descriptions.py", lambda a: [],                                False),
    ("pages",    "scrape_story_pages.py",       lambda a: [],                                False),
    ("upload",   "upload_story_images.py",      lambda a: [],                                False),
]


def run(script: str, extra: list[str]) -> None:
    cmd = [sys.executable, str(SCRIPTS / script), *extra]
    print(f"\n===> {' '.join(cmd)}\n", flush=True)
    r = subprocess.run(cmd)
    if r.returncode != 0:
        sys.exit(f"FAILED: {script} exited with code {r.returncode}")


def wipe_local_plots() -> None:
    if PLOTS_DIR.exists():
        print(f"--force: removing {PLOTS_DIR} …", flush=True)
        shutil.rmtree(PLOTS_DIR)
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--force", action="store_true",
                   help="wipe data/plots/ + re-scrape, then wipe content tables "
                        "and re-import. Assets (icons, JSON) are left alone.")
    p.add_argument("--only", default=None,
                   help="comma-separated step aliases to run "
                        f"(choices: {', '.join(a for a, _, _, _ in STEPS)}). "
                        "Overrides default ordering; bypasses --force-only "
                        "gating so you can re-run a single step.")
    args = p.parse_args()

    if args.only:
        wanted = {x.strip() for x in args.only.split(",")}
        unknown = wanted - {a for a, _, _, _ in STEPS}
        if unknown:
            sys.exit(f"Unknown step(s): {', '.join(unknown)}")
        steps = [s for s in STEPS if s[0] in wanted]
    else:
        steps = [s for s in STEPS if not s[3] or args.force]

    print(f"Running {len(steps)} step(s): {', '.join(s[0] for s in steps)}")

    if args.force and not args.only:
        wipe_local_plots()

    for _alias, script, args_fn, _force_only in steps:
        run(script, args_fn(args))

    print("\nPipeline finished.")


if __name__ == "__main__":
    main()
