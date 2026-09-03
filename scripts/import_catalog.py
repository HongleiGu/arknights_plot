"""
Import the enemy / item catalogs into Supabase (037).

One script for both because they are the same operation over two flat,
global catalogs — upsert on `name`, which is the UNIQUE key 037 gives each
table. Idempotent: re-running refreshes fields and never duplicates, so it is
safe on every --sync.

    data/enemies.json  ->  enemies   (scripts/scrape_enemies.py)
    data/items.json    ->  items     (scripts/scrape_items.py)

A missing JSON file is a no-op, not an error — the same convention
import_gadgets.py / import_events.py use, so the pipeline can run before
anything has been scraped.

Dependencies:
    pip install supabase python-dotenv     (already in the `study` conda env)

.env at the project root needs:
    SUPABASE_URL=https://[ref].supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...

Usage:
    conda run -n study python scripts/import_catalog.py            # both
    conda run -n study python scripts/import_catalog.py --only enemies
    conda run -n study python scripts/import_catalog.py --dry-run
"""

import argparse
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

log = logging.getLogger("catalog")
CHUNK = 200

# (alias, json file, table, columns to write)
CATALOGS = {
    "enemies": (
        ROOT / "data" / "enemies.json",
        "enemies",
        ("name", "code", "description", "kind", "rank", "debut",
         "icon_sha1", "wiki_href", "seq", "raw"),
    ),
    "items": (
        ROOT / "data" / "items.json",
        "items",
        ("name", "description", "usage_text", "obtain_method", "rarity", "category",
         "item_group", "item_key", "icon_sha1", "wiki_href", "seq", "raw"),
    ),
}

# ---- item_group (038) ------------------------------------------------------
# Cargo's category1 has 29 values with a long tail (信物 420 … 其他干员道具 2):
# fine as data, useless as a filter row. This folds them into buckets a reader
# would actually pick from.
#
# It needs a NAME fallback, not just category1: 103 items have no category1 at
# all, and nearly all of them are class tokens (近卫信物原件) or vouchers
# (寻访数据契约（…）) that clearly belong somewhere.
#
# Measured over the current 1359 items:
#   信物 690 · 活动道具 164 · 干员养成 155 · 寻访凭证 131 · 消耗品 119
#   建造材料 58 · 其他道具 42
# 活动道具 is its own bucket on purpose — folded into 其他道具 it made that 15%
# and a dumping ground; split out, 其他道具 is a real 3% residual.
DEV_CATS   = {"材料", "基础道具", "养成材料组合", "芯片", "双芯片", "芯片组",
              "作战记录", "技巧概要", "技巧集", "其他干员道具"}
BUILD_CATS = {"建材", "建材原材料", "家具收藏包"}
USE_CATS   = {"理智回复道具", "消耗道具", "物资补给", "食物"}


def item_group(name: str, category1: str | None) -> str:
    c1 = (category1 or "").strip()
    # 信物 first: it also catches 中坚信物/通用信物 and the class-token variants
    # that carry no category at all.
    if "信物" in c1 or "信物" in name or c1 in ("私人信件", "纪念物"):
        return "信物"
    if c1 in DEV_CATS:
        return "干员养成"
    if c1 in BUILD_CATS:
        return "建造材料"
    if "寻访" in c1 or "凭证" in c1 or any(k in name for k in ("寻访", "凭证", "契约")):
        return "寻访凭证"
    if c1 in USE_CATS:
        return "消耗品"
    if c1 == "活动道具":
        return "活动道具"
    return "其他道具"


def client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env")
    return create_client(url, key)


def load(path: Path) -> list[dict]:
    if not path.exists():
        log.info(f"{path.relative_to(ROOT)} absent — skipping")
        return []
    rows = json.loads(path.read_text(encoding="utf-8"))
    return rows if isinstance(rows, list) else []


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", choices=sorted(CATALOGS), help="import just one catalog")
    p.add_argument("--dry-run", action="store_true", help="report without writing")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")

    wanted = [args.only] if args.only else list(CATALOGS)
    db = None if args.dry_run else client()

    for alias in wanted:
        path, table, cols = CATALOGS[alias]
        rows = load(path)
        if not rows:
            continue

        # Last one wins on a duplicate name: upserting a batch that repeats a
        # conflict key in the same statement is an error in Postgres, and a
        # hand-edited JSON can easily contain one.
        by_name: dict[str, dict] = {}
        for r in rows:
            name = (r.get("name") or "").strip()
            if not name:
                continue
            row = {c: r.get(c) for c in cols} | {"name": name}
            if alias == "items":
                # Derived, not scraped — recomputed on every import so changing
                # the mapping is one edit plus a re-run.
                row["item_group"] = item_group(name, (r.get("raw") or {}).get("category1"))
            by_name[name] = row
        payload = list(by_name.values())
        dropped = len(rows) - len(payload)

        log.info(f"{alias}: {len(payload)} row(s) to upsert into {table}"
                 + (f" ({dropped} skipped: blank or duplicate name)" if dropped else ""))
        if args.dry_run:
            for r in payload[:3]:
                log.info(f"    {json.dumps(r, ensure_ascii=False)[:160]}")
            continue

        done = 0
        for i in range(0, len(payload), CHUNK):
            batch = payload[i:i + CHUNK]
            db.table(table).upsert(batch, on_conflict="name").execute()
            done += len(batch)
            log.info(f"    upserted {done}/{len(payload)}")

    if args.dry_run:
        log.info("dry run — nothing written")
    else:
        log.info("done. icons: conda run -n study python scripts/upload_catalog_icons.py")


if __name__ == "__main__":
    main()
