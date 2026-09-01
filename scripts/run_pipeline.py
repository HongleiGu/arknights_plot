"""
End-to-end bootstrap pipeline. Run after Supabase migrations are applied and
the local data files are in place.

--sync (incremental — "pull in whatever is new on the wiki"):
  Runs EVERY step, none of them with --force, and does not wipe anything.
  This is the mode to run when a new event/story/operator has shipped:

    python scripts/run_pipeline.py --sync

  It works because every scraper is already idempotent by a marker of its own,
  and re-reads the wiki index each time, so new entries appear on their own:
    • scrape_plots.py          skips plot .txt files already on disk;
                               re-reads Template:剧情导航 (what 剧情一览 renders)
    • scrape_operator_profile  skips operators already in operator_profiles.json;
                               enumerates Category:干员 with pagination
    • scrape_operator_milv     skips operators whose .txt already exist
    • scrape_gadgets / events  skip themes already recorded in their JSON
    • parse_plots.py           skips chapters already in the DB
    • seed_entities.py         upserts on (type, name)
  So --sync only fetches and imports the delta, and is safe to re-run at any
  time. It is slower than the default run (it does hit the wiki index pages)
  but does no destructive work.

Without --force or --sync (default — fast, import-only):
  Imports whatever the local data files already hold; no network scraping of
  plots/operators. Good for re-importing after a schema change.

With --force (full rebuild of plot text data — DESTRUCTIVE):
  0a. rm -rf data/plots/        — wipe local plot files
  0b. scrape_plots.py           — re-scrape every plot from prts.wiki
  1.  parse_plots.py --force    — wipe content tables, re-import everything
  …and the rest of the steps with --force, re-scraping catalogs from scratch.
  Use this only to rebuild from nothing; --sync is what you want for updates.

Assets that --force does NOT touch:
  • data/story_icons/           — wiki icons (re-scrape via scrape_story_descriptions.py)
  • data/story_descriptions.json
  • data/img/, data/imgs/       — other image assets

Prereqs:
  • .env has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  • Migrations applied
  • Public bucket named 'data' exists in Supabase Storage

Usage:
    python scripts/run_pipeline.py --sync          # pull in new wiki content
    python scripts/run_pipeline.py                 # import local files only
    python scripts/run_pipeline.py --force         # destructive full rebuild
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

# (alias, script-filename, args-fn, network)
#
# `network` marks a step that hits prts.wiki to DISCOVER new content. Those are
# skipped on a default run (which is import-only) and included by both --sync
# and --force. The difference is that --sync passes no --force to them, so each
# one skips what it already has and fetches only the delta.
STEPS = [
    ("scrape",   "scrape_plots.py",             lambda a: [],                             True),
    ("omilv",    "scrape_operator_milv.py",     lambda a: ["--force"] if a.force else [], True),
    ("parse",    "parse_plots.py",              lambda a: ["--force"] if a.force else [], False),
    ("sgad",     "scrape_gadgets.py",           lambda a: ["--force"] if a.force else [], True),
    ("gadgets",  "import_gadgets.py",           lambda a: ["--force"] if a.force else [], False),
    ("sevt",     "scrape_events.py",            lambda a: ["--force"] if a.force else [], True),
    ("events",   "import_events.py",            lambda a: ["--force"] if a.force else [], False),
    ("istext",   "import_is_text.py",           lambda a: ["--force"] if a.force else [], False),
    ("sopf",     "scrape_operator_profile.py",  lambda a: ["--force"] if a.force else [], True),
    ("opf",      "import_operator_profiles.py", lambda a: [],                             False),
    ("senemy",   "scrape_enemies.py",           lambda a: ["--force"] if a.force else [], True),
    ("sitem",    "scrape_items.py",             lambda a: ["--force"] if a.force else [], True),
    ("catalog",  "import_catalog.py",           lambda a: [],                             False),
    ("wiki",     "import_wiki_descriptions.py", lambda a: [],                             False),
    ("pages",    "scrape_story_pages.py",       lambda a: [],                             False),
    ("upload",   "upload_story_images.py",      lambda a: [],                             False),
    # Last: derives character entities from who actually speaks, so it has to
    # run after new dialogue is in. Idempotent upsert on (type, name).
    ("seed",     "seed_entities.py",            lambda a: [],                             False),
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
    p.add_argument("--sync", action="store_true",
                   help="incremental: run every step without --force and without "
                        "wiping, so only new wiki content is fetched and imported. "
                        "Safe to re-run; this is the update path.")
    p.add_argument("--force", action="store_true",
                   help="DESTRUCTIVE full rebuild: wipe data/plots/ + re-scrape, "
                        "then wipe content tables and re-import. Assets (icons, "
                        "JSON) are left alone.")
    p.add_argument("--only", default=None,
                   help="comma-separated step aliases to run "
                        f"(choices: {', '.join(a for a, _, _, _ in STEPS)}). "
                        "Overrides default ordering; bypasses the network-step "
                        "gating so you can re-run a single step.")
    args = p.parse_args()

    if args.sync and args.force:
        sys.exit("--sync and --force are mutually exclusive: --sync updates in "
                 "place, --force rebuilds from scratch.")

    if args.only:
        wanted = {x.strip() for x in args.only.split(",")}
        unknown = wanted - {a for a, _, _, _ in STEPS}
        if unknown:
            sys.exit(f"Unknown step(s): {', '.join(unknown)}")
        steps = [s for s in STEPS if s[0] in wanted]
    else:
        # Network discovery steps run for --sync and --force; a bare run is
        # import-only.
        steps = [s for s in STEPS if not s[3] or args.sync or args.force]

    mode = "sync (incremental)" if args.sync else "force (destructive rebuild)" if args.force else "import-only"
    print(f"Mode: {mode}")
    print(f"Running {len(steps)} step(s): {', '.join(s[0] for s in steps)}")

    if args.force and not args.only:
        wipe_local_plots()

    for _alias, script, args_fn, _network in steps:
        run(script, args_fn(args))

    print("\nPipeline finished.")
    if args.sync:
        print("Note: summaries (AP-23) and relation extraction (AP-22 P2) are "
              "admin actions in /admin/ai, not pipeline steps — run those "
              "separately for any newly imported content.")


if __name__ == "__main__":
    main()
