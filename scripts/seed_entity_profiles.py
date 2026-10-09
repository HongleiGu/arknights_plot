"""
Give every operator entity its official summary, from the game's own 人员档案.

WHY THIS NEEDS NO MODEL
-----------------------
`entities` holds 6,885 rows, all `character`, and **zero** had a summary — so
"summarise the characters" looked like thousands of LLM calls. It is not: every
operator's档案 contains a chunk titled **客观履历**, which is an official
third-person career summary, 90-140 characters, written for exactly this purpose:

    阿米娅 — 罗德岛的公开领袖，在内部拥有最高执行权。虽然，从外表上看起来仅仅
            是个不成熟的少女，实际上，她却是深受大家信任的合格的领袖。…
    能天使 — 能天使，拉特兰公民，适用拉特兰一至十三项公民权益。企鹅物流公司成员。
            从事秘密联络，武装押运等非公开活动，推测身份：信使。…

All 432 operators with a `personnel_file` cluster have one. So this is the same
posture as `seed_entities.py` (characters from who actually speaks) and
`scrape_terra_timeline.py` (a curated chronology rather than inferred dates):
take what is already authored and grounded. `summary_status = 'scraped'`, not
`ai_draft` — it is transcribed, not written.

READS THE DATABASE, NOT THE JSON
--------------------------------
The text is already imported (`import_operator_profiles.py` → `text_clusters` /
`text_chunks`, 008), and the database is the authority. Sourcing from the DB also
means every summary can carry a **citation** — `@text/<chunk_id>`, a ref type
`lib/references.ts` already resolves — which `data/operator_profiles.json` could
not provide.

Side effect worth knowing: that JSON holds 456 operators but only 432 have a
`stories` row, so 24 operators' profiles were never imported for want of a story
to attach to. They are reported, not silently dropped, and are a gap in the
import rather than in this script.

STRUCTURED FACTS, AND WHY THEY MATTER LATER
-------------------------------------------
`基础档案` is a 【label】value block, so 出身地 / 种族 / 战斗经验 / 身高 /
矿石病感染情况 parse without heuristics and land in `entities.raw.profile`.

That is more valuable than it looks: once AP-35 creates `nation` and `race`
entities, 出身地 and 种族 are **grounded character→nation and character→race
edges needing no extraction at all** — a free slice of AP-36, the ticket costed
at thousands of calls. Not done here; this script only records the facts.

WHAT IT WILL NOT DO
-------------------
- Touch `mention_count`, `aliases` or `name_en`: `seed_entities.py` owns those,
  and the two scripts must stay disjoint or each will undo the other. This is the
  mirror of that script's own "only seed-owned fields go in the payload".
- Overwrite a row whose `summary_status` is `verified`. A human confirmed that
  text; re-running must not cost them the work.
- Merge alternate operator forms into their base character. 涤火杰西卡 and 杰西卡
  are separate operator records with separate 档案 and separate 客观履历, so each
  gets its row. CLAUDE.md already lists `同一人` as an `entity_relations` kind —
  an edge is the right home for that, not a silent merge here, and deriving the
  pairing from a name suffix would be a guess dressed as data.

Usage:
    python scripts/seed_entity_profiles.py --dry-run
    python scripts/seed_entity_profiles.py
    python scripts/seed_entity_profiles.py --only 阿米娅
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

ROOT = Path(__file__).parent.parent
PROFILES = ROOT / "data" / "operator_profiles.json"

CATEGORY = "干员"
KIND = "personnel_file"
SUMMARY_TITLE = "客观履历"
BASICS_TITLE = "基础档案"
STATUS = "scraped"
WIKI = "https://prts.wiki/w/"

# 【label】value, value running to the next 【 or the end. 矿石病感染情况 has its
# value on the following line rather than inline, which this handles for free.
FIELD_RE = re.compile(r"【([^】]+)】[\s]*([^【]*)")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def page(db: Client, table: str, cols: str) -> list[dict]:
    """PostgREST silently caps a response at 1000 rows, so always paginate."""
    rows: list[dict] = []
    start = 0
    while True:
        r = db.table(table).select(cols).range(start, start + 999).execute()
        rows += r.data
        if len(r.data) < 1000:
            return rows
        start += 1000


def parse_basics(body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for label, value in FIELD_RE.findall(body or ""):
        v = " ".join(value.split())
        if v:
            out[label.strip()] = v
    return out


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Seed character entity summaries from operator 人员档案.")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--only", metavar="OP", help="a single operator, for checking")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    db: Client = create_client(os.environ["SUPABASE_URL"],
                               os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    stories = {s["id"]: s["name"] for s in page(db, "stories", "id, name, category")
               if s["category"] == CATEGORY}
    clusters = [c for c in page(db, "text_clusters", "id, story_id, kind")
                if c["kind"] == KIND]
    chunks: dict[int, list[dict]] = {}
    for c in page(db, "text_chunks", "id, cluster_id, seq, title, body"):
        chunks.setdefault(c["cluster_id"], []).append(c)

    existing = {e["name"]: e for e in page(db, "entities", "id, name, type, summary, "
                                                           "summary_status, source_url")
                if e["type"] == "character"}
    log.info(f"{len(stories):,} {CATEGORY} stories · {len(clusters):,} {KIND} clusters "
             f"· {len(existing):,} character entities")

    rows: list[dict] = []
    created = updated = skipped_verified = 0
    no_summary: list[str] = []
    for cl in clusters:
        name = stories.get(cl["story_id"])
        if not name or (args.only and name != args.only):
            continue
        mine = chunks.get(cl["id"], [])
        body = next((c for c in mine if (c["title"] or "").strip() == SUMMARY_TITLE), None)
        if not body or not (body["body"] or "").strip():
            no_summary.append(name)
            continue
        basics = next((c for c in mine if (c["title"] or "").strip() == BASICS_TITLE), None)

        prev = existing.get(name)
        if prev and prev["summary_status"] == "verified":
            skipped_verified += 1
            continue

        refs = [f"@text/{body['id']}"]
        if basics:
            refs.append(f"@text/{basics['id']}")
        # source_url is carried through rather than recomputed when already set, so
        # the column stays uniform across the batch without clobbering anything.
        url = (prev or {}).get("source_url") or WIKI + urllib.parse.quote(name)
        rows.append({
            "type": "character",
            "name": name,
            "summary": " ".join((body["body"] or "").split()),
            "summary_status": STATUS,
            "source_url": url,
            "raw": {
                "source": "personnel_file/客观履历",
                "story_id": cl["story_id"],
                "refs": refs,
                "profile": parse_basics((basics or {}).get("body", "")),
            },
        })
        if prev:
            updated += 1
        else:
            created += 1

    log.info(f"{len(rows):,} row(s) to write — {created:,} new entity(ies), "
             f"{updated:,} existing enriched, {skipped_verified:,} verified left alone")
    if no_summary:
        log.warning(f"{len(no_summary)} operator(s) with no {SUMMARY_TITLE}: "
                    f"{no_summary[:8]}")

    # The import, not this script, is where these went missing — report and move on.
    if PROFILES.exists() and not args.only:
        js = {o["op"] for o in json.loads(PROFILES.read_text(encoding="utf-8"))}
        orphan = sorted(js - set(stories.values()))
        if orphan:
            log.warning(f"{len(orphan)} operator(s) in {PROFILES.name} have no "
                        f"{CATEGORY} story, so no imported 档案 and no entity here: "
                        f"{orphan[:8]}")

    got = sum(1 for r in rows if r["raw"]["profile"])
    log.info(f"基础档案 parsed for {got:,}/{len(rows):,}")
    if rows:
        ex = rows[0]
        log.info(f"  e.g. {ex['name']}: {ex['summary'][:70]}…")
        log.info(f"       profile {ex['raw']['profile']}")
        log.info(f"       refs {ex['raw']['refs']}")

    if args.dry_run:
        log.info("--dry-run: nothing written")
        return

    for i in range(0, len(rows), 200):
        db.table("entities").upsert(rows[i:i + 200], on_conflict="type,name").execute()
        log.info(f"  {min(i + 200, len(rows)):,}/{len(rows):,}")
    log.info("done")


if __name__ == "__main__":
    main()
