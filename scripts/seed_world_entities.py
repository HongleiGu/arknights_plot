"""
Seed the non-character entities from the book's own table of contents (AP-35).

`entities` held 6,984 rows and every one was a `character`, so the graph was a
cast list: it could answer "who spoke" and nothing else, which is why AP-38 had
nothing to traverse. The missing half is the world — nations, places, events,
organisations, concepts.

DERIVED FROM AN AUTHORED STRUCTURE, NOT EXTRACTED
-------------------------------------------------
大地巡旅 is the official setting book and its sections *are* the world's index:
one `chapters` row per section, each with a `level_code`, a title and a body of
prose. So every entity here gets a name, a type and a citation
(`@chapter/<id>`) with no model call and nothing invented — the same posture as
`seed_entities.py` (characters from who actually speaks) and
`seed_entity_profiles.py` (summaries from the game's own 客观履历).

WHY THE TABLE IS WRITTEN OUT INSTEAD OF PARSED
----------------------------------------------
AP-35 sketched a mapping from `level_code` depth to type. The real tree does not
support it, which only reading it showed:

- **`4 泰拉种族` is ONE chapter, not `4.x` per race.** Races are inside its prose,
  so the TOC cannot yield them. They come from `entities.raw.profile.种族`
  instead — 45 values already parsed from the operators' 基础档案.
- **A title is often an essay title, not a name.** `5.4 高卢的遗产 GAUL: LEGACY`,
  `5.17 大炎纵览 YAN: A FAIR GLANCE`, `5.18 极东来信 HIGASHI: LETTERS FROM THE
  FARTHEST`. Splitting on the first Latin run would name the entity 高卢的遗产.
- **`5.x.1` is not one type.** 切尔诺伯格 and 龙门 are cities, 四国战争 and
  沉默诏令 are events, 拉特兰信仰 is a concept. Depth does not say which.
- **Some sections are not entities at all** — `5.0 导论`, `6.9 组织名录`,
  `2.2.1 第一座现代移动城市由谁建成？`. They are listed in SKIP with a reason, so
  an omission is a decision on the record rather than an oversight.

Each row is traceable to a printed section; what is editorial is the *type* and
the choice of name, which is exactly why they are written down and reviewable.

NAMES COME FROM THE BOOK'S PROSE, NOT ITS TITLES OR FROM LORE
-------------------------------------------------------------
Where the title disagrees with usage, usage wins, measured over the book's own
paragraphs: **炎国 appears in 104, 大炎 in 2** — so the section titled 大炎纵览
yields the entity 炎国 with 大炎/炎 as aliases. **东国 in 35, 极东 in 10**, so
极东来信 yields 东国. The aliases matter beyond tidiness: operators report
出身地 = 炎 (27 of them) and 东国 (20), and an entity those cannot join to is an
entity AP-36 cannot use.

NO SCRAPED SUMMARY HERE, DELIBERATELY
-------------------------------------
AP-35 says to populate `summary` from the section's opening prose. Tested across
all 66 sections, that does not hold: the book is written as essays with literary
openings, and roughly a third open on an authorial aside about writing the book
rather than a description of the subject —

    2.3 武器与装备  "得知我在进行怎样的写作后，一位朋友写信给我，建议我在书中…"
    5.3 乌萨斯      "我的老朋友, 诗人奥列格·卢布列夫曾经与我在壁炉前促膝长谈…"
    1.4 矿石病      "1037 年，因为小李尔兰教授提供的机会，我结识了…"

The other two thirds are excellent (5.1 维多利亚, 6.7 企鹅物流). But a summary
field that is right 2/3 of the time and indistinguishable when wrong is worse
than an empty one — the project's own rule that a wrong citation reads as
grounded, applied to summaries. Epigraphs are skipped correctly
(`raw_params.aside` marks them, which is what the reader's `>>` blocks record);
the problem is the body paragraph itself.

So entities are created with their citation and **no summary**, and the first
body paragraph is parked in `raw.opening` — labelled as what it is, not as a
definition — for the model pass to work from. That pass writes `summary` with
`summary_status = 'ai_draft'`, which is the honest status for text a model wrote.

COLUMN OWNERSHIP
----------------
Writes `type`/`name`/`name_en`/`aliases`/`source_url`/`raw` for the types listed
here. It cannot collide with `seed_entities.py` or `seed_entity_profiles.py`:
`UNIQUE (type, name)` is per type, and both of those touch only `character`. So
`罗德岛` as an organisation and `罗德岛` as a speaker are different rows, which is
correct — one is the institution, the other is whoever the script credits.

Usage:
    python scripts/seed_world_entities.py --dry-run
    python scripts/seed_world_entities.py
"""

from __future__ import annotations

import argparse
import logging
import os
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

ROOT = Path(__file__).parent.parent
BOOK = "大地巡旅"
WIKI = "https://prts.wiki/w/"
MIN_PARA = 40
OPENING_CAP = 320

# level_code -> (type, name, name_en, aliases). One row per printed section.
SECTIONS: dict[str, tuple[str, str, str | None, tuple[str, ...]]] = {
    # chapter 1-4: the setting's load-bearing concepts
    "1.1":    ("concept", "源石", "ORIGINIUM", ()),
    "1.2":    ("concept", "源石技艺", "ORIGINIUM ARTS", ()),
    "1.3":    ("concept", "天灾", "CATASTROPHE", ()),
    "1.3.1":  ("concept", "天灾信使", "CATASTROPHE MESSENGERS", ()),
    "1.4":    ("concept", "矿石病", "ORIPATHY", ()),
    "2.1":    ("concept", "源石技术", "ORIGINIUM TECHNOLOGY", ()),
    "2.2":    ("concept", "移动城市", "NOMADIC CITIES", ()),
    "2.3":    ("concept", "武器与装备", "WEAPONRY", ()),
    "3":      ("concept", "泰拉生物", "BEASTS OF TERRA", ()),
    "4":      ("concept", "泰拉种族", "RACES OF TERRA", ()),
    "5.5.1":  ("concept", "拉特兰信仰", None, ()),
    # chapter 5: nations
    "5.1":    ("nation", "维多利亚", "VICTORIA", ()),
    "5.2":    ("nation", "莱塔尼亚", "LEITHANIEN", ()),
    "5.3":    ("nation", "乌萨斯", "URSUS", ()),
    "5.4":    ("nation", "高卢", "GAUL", ()),
    "5.5":    ("nation", "拉特兰", "LATERANO", ()),
    "5.6":    ("nation", "伊比利亚", "IBERIA", ()),
    "5.7":    ("nation", "阿戈尔", "AEGIR", ()),
    "5.8":    ("nation", "谢拉格", "KJERAG", ()),
    "5.9":    ("nation", "卡西米尔", "KAZIMIERZ", ()),
    "5.10":   ("nation", "哥伦比亚", "COLUMBIA", ()),
    "5.11":   ("nation", "玻利瓦尔", "BOLÍVAR", ()),
    "5.12":   ("nation", "叙拉古", "SIRACUSA", ()),
    "5.13":   ("nation", "萨尔贡", "SARGON", ()),
    "5.14":   ("nation", "米诺斯", "MINOS", ()),
    "5.15":   ("nation", "萨米", "SAMI", ()),
    "5.16":   ("nation", "雷姆必拓", "RIM BILLITON", ()),
    "5.17":   ("nation", "炎国", "YAN", ("炎", "大炎")),
    "5.18":   ("nation", "东国", "HIGASHI", ("极东",)),
    "5.19":   ("nation", "卡兹戴尔", "KAZDEL", ()),
    # chapter 5 sub-sections that name a place
    "5.1.1":  ("place", "塔拉", "TEAMHAIR", ()),
    "5.3.2":  ("place", "切尔诺伯格", "CHERNOBOG", ()),
    "5.10.2": ("place", "汐斯塔", "SIESTA", ()),
    "5.17.1": ("place", "龙门", None, ()),
    # chapter 5 sub-sections that name an event
    "5.3.1":  ("event", "乌萨斯建国", "FOUNDING OF THE URSUS EMPIRE", ()),
    "5.4.1":  ("event", "四国战争", "WAR OF THE FOUR NATIONS", ()),
    "5.6.1":  ("event", "沉默诏令", "THE SILENCED EDICT", ()),
    "5.13.1": ("event", "梦魔远征", "NIGHTZMORAN CONQUESTS", ()),
    # chapter 6: organisations
    "6.1":    ("organisation", "莱茵生命", "RHINE LAB LLC.", ()),
    "6.2":    ("organisation", "黑钢国际", "BLACKSTEEL WORLDWIDE", ()),
    "6.3":    ("organisation", "喀兰贸易", "KARLAN TRADE CO' LTD.", ()),
    "6.4":    ("organisation", "锈锤", "RUSTHAMMER", ()),
    "6.5":    ("organisation", "雷神工业", "RAYTHEAN INDUSTRIES", ()),
    "6.6":    ("organisation", "太阳谷机械工业", "SUNVALLEY INDUSTRIES", ()),
    "6.7":    ("organisation", "企鹅物流", "PENGUIN LOGISTICS", ()),
    "6.8":    ("organisation", "鲤氏侦探事务所", "LEE'S DETECTIVE AGENCY", ()),
    "6.Extra": ("organisation", "罗德岛", "RHODES ISLAND", ()),
}

# Sections that are deliberately not entities. Recorded so an omission is a
# decision rather than something nobody noticed.
SKIP: dict[str, str] = {
    "1": "chapter divider",
    "2": "chapter divider",
    "5.0": "导论 — an essay about the core-circle concept, not a named thing",
    "6": "chapter divider",
    "2.2.1": "an essay question; its subject 七城联邦 would have to be extracted "
             "from the prose, which is not what this script does",
    "5.1.2": "大发掘与疯王的移动城堡 — one section covering two subjects, neither "
             "cleanly the section's name",
    "5.10.1": "荒地拾遗 — an essay on Columbian pioneers, not a named entity",
    "扉页": "front matter", "献词": "front matter", "前言": "front matter",
    "目录": "front matter", "附录": "appendix divider",
    "泰拉纪年": "the chronology — already imported as timeline_events (039)",
    "后记": "afterword", "档案归档": "colophon", "感谢名单": "acknowledgements",
    "6.9": "组织名录 — a directory of many organisations; mining it is extraction",
    "6.1.1": "追记 — a further citation for 莱茵生命, see EXTRA_REFS",
    "6.1.2": "独家发布 — a further citation for 莱茵生命, see EXTRA_REFS",
}

# Sections that are more citations for an entity named elsewhere.
EXTRA_REFS: dict[str, tuple[str, ...]] = {
    "莱茵生命": ("6.1.1", "6.1.2"),
}

# --- races, from a second grounded source -----------------------------------
#
# Races cannot come from the TOC: `4 泰拉种族` is a single chapter covering all of
# them, and splitting its prose per race would be extraction. They come instead
# from `entities.raw.profile.种族`, parsed from each operator's own 基础档案 — so
# every race entity is attested by the operators who are of it, cited
# `@text/<chunk>`, with the book's 泰拉种族 chapter as context.
#
# Values that are not a race name are excluded rather than normalised:
RACE_NONVALUES = {"未公开", "未知", "不明", "因经纪公司要求不公开", "未知（疑似黎博利）"}
# A `（自称）` value is a self-description the game is making a point of — 长身人
# （自称）, 矮人（自称）, 半身人（自称）. Stripping the qualifier would assert the
# race as fact, which is the opposite of what the source says, so these are left
# out and reported. Deciding them is editorial and belongs in this table, not in
# a regex.
RACE_SELF_REPORTED_SUFFIX = "（自称）"
# 阿米娅's 卡特斯/奇美拉 is two races, and the slash is the game's own notation.
RACE_SPLIT = "/"
RACES_SECTION = "4"          # 泰拉种族, cited as context on every race

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def page(db: Client, table: str, cols: str, **filters) -> list[dict]:
    rows, start = [], 0
    while True:
        q = db.table(table).select(cols)
        for k, v in filters.items():
            q = q.in_(k, v) if isinstance(v, list) else q.eq(k, v)
        r = q.range(start, start + 999).execute()
        rows += r.data
        if len(r.data) < 1000:
            return rows
        start += 1000


def opening(db: Client, chapter_id: int) -> str:
    """
    First body paragraphs: not a definition, and not stored as one.

    Skips epigraphs and inserted blocks (`raw_params.aside` — what the reader's
    `>>` marker records), headings (`level`/`heading`), quoted passages
    (`quote`), illustrations (`type != 'subtitle'`) and attribution lines
    (`——…`).
    """
    picked: list[str] = []
    rows = (db.table("nodes").select("seq, type, content, raw_params")
            .eq("chapter_id", chapter_id).is_("branch_id", "null")
            .order("seq").limit(200).execute().data)
    for n in rows:
        rp = n["raw_params"] or {}
        if n["type"] != "subtitle" or rp.get("aside") or rp.get("quote"):
            continue
        if rp.get("level") or rp.get("heading"):
            continue
        t = " ".join((n["content"] or "").split())
        if len(t) < MIN_PARA or t.startswith("——"):
            continue
        picked.append(t)
        if len(" ".join(picked)) >= OPENING_CAP or len(picked) >= 2:
            break
    return " ".join(picked)[:OPENING_CAP]


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed world entities from the book's TOC.")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    db: Client = create_client(os.environ["SUPABASE_URL"],
                               os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    sids = [s["id"] for s in page(db, "stories", "id, category", category=BOOK)]
    chapters = page(db, "chapters", "id, level_code, level_name, story_id",
                    story_id=sids)
    by_code = {str(c["level_code"] or "").strip(): c for c in chapters}
    log.info(f"{len(chapters)} {BOOK} chapters · {len(SECTIONS)} mapped · "
             f"{len(SKIP)} skipped by name")

    # Anything in the book that is neither mapped nor skipped is new or renamed,
    # and silence would mean it is simply missing from the graph.
    unaccounted = sorted(set(by_code) - set(SECTIONS) - set(SKIP))
    if unaccounted:
        log.warning(f"{len(unaccounted)} section(s) neither mapped nor skipped: "
                    f"{[(c, by_code[c]['level_name']) for c in unaccounted]}")
    for code in sorted(set(SECTIONS) - set(by_code)):
        log.warning(f"stale SECTIONS entry — no chapter with level_code {code!r}")

    existing = {(e["type"], e["name"]) for e in page(db, "entities", "type, name")}
    rows, created, updated = [], 0, 0
    for code, (etype, name, name_en, aliases) in sorted(SECTIONS.items()):
        ch = by_code.get(code)
        if not ch:
            continue
        refs = [f"@chapter/{ch['id']}"]
        for extra in EXTRA_REFS.get(name, ()):
            if extra in by_code:
                refs.append(f"@chapter/{by_code[extra]['id']}")
        row = {
            "type": etype,
            "name": name,
            "name_en": name_en,
            "aliases": list(aliases),
            "source_url": WIKI + urllib.parse.quote(name),
            "raw": {
                "source": f"{BOOK}/{code}",
                "section": ch["level_name"],
                "level_code": code,
                "refs": refs,
                # NOT a summary: the first body paragraphs, kept for the model
                # pass to work from. See the module docstring.
                "opening": opening(db, ch["id"]),
            },
        }
        rows.append(row)
        if (etype, name) in existing:
            updated += 1
        else:
            created += 1

    kinds: dict[str, int] = {}
    for r in rows:
        kinds[r["type"]] = kinds.get(r["type"], 0) + 1
    log.info(f"{len(rows)} row(s): {created} new, {updated} existing · {kinds}")
    missing_open = [r["name"] for r in rows if not r["raw"]["opening"]]
    if missing_open:
        log.warning(f"{len(missing_open)} with no extractable opening: {missing_open}")

    # --- races, from the operators' own 基础档案 -----------------------------
    chars = [e for e in page(db, "entities", "name, type, raw") if e["type"] == "character"]
    races: dict[str, dict] = {}
    excluded: dict[str, list[str]] = {}
    for c in chars:
        prof = (c["raw"] or {}).get("profile") or {}
        value = (prof.get("种族") or "").strip()
        if not value:
            continue
        # The 基础档案 chunk is the citation; seed_entity_profiles.py put both
        # refs on the row and the second is 基础档案 when present.
        cite = [r for r in ((c["raw"] or {}).get("refs") or [])][-1:]
        for part in [p.strip() for p in value.split(RACE_SPLIT) if p.strip()]:
            why = None
            if part in RACE_NONVALUES:
                why = "not a race name"
            elif part.endswith(RACE_SELF_REPORTED_SUFFIX):
                why = "self-reported; the qualifier is the point"
            elif not all("一" <= ch <= "鿿" for ch in part):
                # One operator's 基础档案 is corrupted in the source and yields
                # 萨■卡訧譱瀫? +Z??高】16圁纮 cm. Reported, never written.
                why = "not plain Chinese — corrupted 基础档案"
            if why:
                excluded.setdefault(why, []).append(f"{c['name']}: {part[:28]}")
                continue
            r = races.setdefault(part, {"count": 0, "refs": [], "ops": []})
            r["count"] += 1
            r["ops"].append(c["name"])
            if len(r["refs"]) < 3:
                r["refs"] += cite

    ctx = by_code.get(RACES_SECTION)
    for name, info in sorted(races.items()):
        refs = list(info["refs"])
        if ctx:
            refs.append(f"@chapter/{ctx['id']}")
        rows.append({
            "type": "race",
            "name": name,
            "name_en": None,
            "aliases": [],
            "source_url": WIKI + urllib.parse.quote(name),
            "raw": {
                "source": "operator 基础档案",
                "refs": refs,
                "operator_count": info["count"],
                "operators": sorted(info["ops"])[:12],
            },
        })
    log.info(f"{len(races)} race(s) from {len(chars):,} character rows; "
             f"total rows now {len(rows)}")
    for why, items in sorted(excluded.items()):
        log.warning(f"  excluded ({why}): {len(items)} — {items[:4]}")

    if args.dry_run:
        for r in rows[:2] + [x for x in rows if x["type"] == "race"][:2]:
            log.info(f"  {r['type']}/{r['name']} ({r['name_en']}) "
                     f"refs={r['raw']['refs']}")
        log.info("--dry-run: nothing written")
        return

    for i in range(0, len(rows), 100):
        db.table("entities").upsert(rows[i:i + 100], on_conflict="type,name").execute()
    log.info(f"upserted {len(rows)}; next: the 出身地/种族 edges (see AP-36)")


if __name__ == "__main__":
    main()
