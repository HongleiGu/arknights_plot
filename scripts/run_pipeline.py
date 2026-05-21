"""
End-to-end bootstrap pipeline. Run after Supabase migrations 001-005 are
applied and the local data files are in place.

Without --force (default — fast, additive):
  1. parse_plots.py            — populates stories + chapters + nodes/etc.
                                  Skips chapters already in DB.
  2. import_gadgets.py         — upserts the gadget catalog from
                                  data/gadgets.json (no-op if absent).
  2e. import_events.py         — replaces the IS event catalog from
                                  data/events.json (no-op if absent).
  2f. import_is_text.py        — replaces IS ending supplements +
                                  character records from the hand-kept
                                  data/is_text.json (no-op if absent).
                                  scrape_gadgets.py / scrape_events.py are
                                  force-only, so a default run just imports
                                  whatever the JSON files already hold.
  3. import_wiki_descriptions  — upserts chapter_descriptions from wiki JSON.
  4. upload_story_icons        — uploads icons; skips stories already stamped.

With --force (full rebuild of plot text data):
  0a. rm -rf data/plots/        — wipe local plot files
  0b. scrape_plots.py           — re-scrape every plot from prts.wiki
  1.  parse_plots.py --force    — wipe content tables, re-import everything
  1a. scrape_gadgets.py --force — re-scrape IS gadget catalogs into
                                  data/gadgets.json (runs before import)
  1b. import_gadgets.py --force — wipe + re-import the gadget catalog
  1c. scrape_events.py --force  — re-scrape IS event trees into
                                  data/events.json (runs before import)
  1d. import_events.py --force  — replace-per-theme the event catalog
  2.  import_wiki_descriptions  — re-fills chapter_descriptions
  3.  upload_story_icons        — already-uploaded icons are skipped (image_path
                                  was wiped along with stories rows, so the
                                  storage upsert refreshes the DB mapping)

First-time gadget / event population on a fast run:
  python scripts/run_pipeline.py --only sgad,gadgets   # --only bypasses
  python scripts/run_pipeline.py --only sevt,events    # force-only gating

Assets that --force does NOT touch:
  • data/story_icons/           — wiki icons (re-scrape via scrape_story_descriptions.py)
  • data/story_descriptions.json
  • data/img/, data/imgs/       — other image assets

Prereqs:
  • .env has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  • Migrations 001_core.sql … 007_events.sql applied
  • Public bucket named 'data' exists in Supabase Storage

Usage:
    python scripts/run_pipeline.py
    python scripts/run_pipeline.py --force
    python scripts/run_pipeline.py --only parse,upload
    python scripts/run_pipeline.py --only sgad,gadgets   # scrape + import gadgets
    python scripts/run_pipeline.py --only sevt,events    # scrape + import events
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
    ("omilv",   "scrape_operator_milv.py",     lambda a: ["--force"] if a.force else [],    True),
    ("parse",    "parse_plots.py",              lambda a: ["--force"] if a.force else [],    False),
    ("sgad",     "scrape_gadgets.py",           lambda a: ["--force"] if a.force else [],    True),
    ("gadgets",  "import_gadgets.py",           lambda a: ["--force"] if a.force else [],    False),
    ("sevt",     "scrape_events.py",            lambda a: ["--force"] if a.force else [],    True),
    ("events",   "import_events.py",            lambda a: ["--force"] if a.force else [],    False),
    ("istext",   "import_is_text.py",           lambda a: ["--force"] if a.force else [],    False),
    ("sopf",     "scrape_operator_profile.py",  lambda a: ["--force"] if a.force else [],    True),
    ("opf",      "import_operator_profiles.py", lambda a: [],                                False),
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
