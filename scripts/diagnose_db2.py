"""Follow-up diagnostics: which categories have chapters; what 2 wiki entries
are still unmatched after a fresh import."""

import json
import os
from collections import Counter
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent / ".env.local")
sb = create_client(os.environ["SUPABASE_URL"],
                   os.environ["SUPABASE_SERVICE_ROLE_KEY"])

# ---- which categories have chapters? ----
def fetch_all(table: str, cols: str) -> list[dict]:
    out, page = [], 0
    while True:
        rows = (sb.table(table).select(cols)
                .range(page * 1000, (page + 1) * 1000 - 1)
                .execute().data)
        out.extend(rows)
        if len(rows) < 1000:
            return out
        page += 1


print("=== chapters by category (via stories join) ===")
stories = fetch_all("stories", "id, category, name")
story_cat = {s["id"]: s["category"] for s in stories}
chapters = fetch_all("chapters", "id, story_id")
by_cat = Counter(story_cat[c["story_id"]] for c in chapters)
print(f"(chapters: {len(chapters)} total)")
for k, v in sorted(by_cat.items(), key=lambda x: -x[1]):
    print(f"  {k:<10} {v}")

# stories with chapters vs without
chapter_story_ids = {c["story_id"] for c in chapters}
print()
print("=== stories with NO chapters (by category) ===")
no_ch = Counter(s["category"] for s in stories if s["id"] not in chapter_story_ids)
for k, v in sorted(no_ch.items(), key=lambda x: -x[1]):
    print(f"  {k:<10} {v}")

# ---- the 971 / 973 gap: re-run match logic against current DB ----
print()
print("=== still-unmatched wiki entries (live DB pass) ===")
data = json.loads(Path("data/story_descriptions.json").read_text(encoding="utf-8"))
story_id_map = {(s["category"], s["name"]): s["id"] for s in stories}

WIKI_TO_FILE = {"行动前": "BEG", "行动后": "END", "幕间": "NBT"}
FALLBACK = {"NBT", "ENTRY", "SP1", "SP2", "剧情", "剧情1", "剧情2"}

# Get all chapters with their (story_id, level_code, stage)
ch_index: dict[tuple[int, str], list[dict]] = {}
ch_exact: dict[tuple[int, str, str], int] = {}
for c in fetch_all("chapters", "id, story_id, level_code, stage"):
    lc = c.get("level_code") or ""
    st = c.get("stage") or ""
    ch_index.setdefault((c["story_id"], lc), []).append(c)
    ch_exact[(c["story_id"], lc, st)] = c["id"]

unmatched = []
matched = 0
for s in data:
    sid = story_id_map.get((s["category"], s["story_name"]))
    for e in s["stages"]:
        if sid is None:
            unmatched.append({"reason": "no_story", "story": s["story_name"], **e})
            continue
        lc = e.get("level_code", "") or ""
        mapped = WIKI_TO_FILE.get(e["stage"])
        cid = ch_exact.get((sid, lc, mapped))
        if cid is None and e["stage"] == "幕间":
            for c in ch_index.get((sid, lc), []):
                if (c.get("stage") or "") in FALLBACK:
                    cid = c["id"]
                    break
        if cid:
            matched += 1
        else:
            unmatched.append({
                "reason": "no_chapter",
                "story": s["story_name"],
                "level_code": lc,
                "level_name": e["level_name"],
                "stage": e["stage"],
                "expected_db_stage": mapped,
                "chapters_for_same_level_code": [
                    {"level_name": c.get("level_name"), "stage": c.get("stage")}
                    for c in ch_index.get((sid, lc), [])
                ],
            })

print(f"matched   : {matched}")
print(f"unmatched : {len(unmatched)}")
print()
for u in unmatched:
    print(json.dumps(u, ensure_ascii=False, indent=2))
