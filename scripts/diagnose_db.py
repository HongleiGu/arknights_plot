"""
Read-only diagnostic snapshot of the live Supabase tables.

Probes:
  • stories row count + per-category breakdown
  • whether stories has the expected columns (name_en, *_sha1, etc.)
  • whether chapters has a `stage` column (current 002 has it commented out)
  • chapter_descriptions row count
  • specific look-up for 喧闹法则 (the story flagged as 'story_not_in_db')
"""

import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent / ".env.local")

sb = create_client(os.environ["SUPABASE_URL"],
                   os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def hr(title: str) -> None:
    print(f"\n=== {title} ===")


def safe_select(table: str, cols: str, **filters):
    """Returns (data, error message). None data → query failed."""
    try:
        q = sb.table(table).select(cols)
        for k, v in filters.items():
            q = q.eq(k, v)
        return q.execute().data, None
    except Exception as e:
        return None, str(e)


# ---- stories shape ----

hr("stories — column probe")
# Issue one select per candidate column; if it errors, the column is missing.
candidate_cols = [
    "id", "category", "name", "name_en", "description",
    "icon_sha1", "title_sha1", "cover_sha1",
    "image_source_filename", "arc", "seq",
]
present, missing = [], []
for c in candidate_cols:
    _, err = safe_select("stories", c)
    (missing if err else present).append(c)
print(f"present : {present}")
print(f"missing : {missing}")

# ---- stories counts by category ----
hr("stories — counts")
rows, err = safe_select("stories", "id, category")
if err:
    print(f"ERROR: {err}")
else:
    from collections import Counter
    by_cat = Counter(r["category"] for r in (rows or []))
    print(f"total = {len(rows or [])}")
    for k, v in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"  {k:<10} {v}")

# ---- chapters shape ----

hr("chapters — column probe")
candidate_cols_c = ["id", "story_id", "level_code", "level_name", "stage",
                    "file_path", "order_in_story"]
present_c, missing_c = [], []
for c in candidate_cols_c:
    _, err = safe_select("chapters", c)
    (missing_c if err else present_c).append(c)
print(f"present : {present_c}")
print(f"missing : {missing_c}")

# ---- chapters counts ----
hr("chapters — counts")
rows, err = safe_select("chapters", "id, story_id")
if err:
    print(f"ERROR: {err}")
else:
    print(f"total chapters = {len(rows or [])}")
    distinct_stories = len({r["story_id"] for r in (rows or [])})
    print(f"chapters span {distinct_stories} distinct stories")

# ---- chapter_descriptions ----
hr("chapter_descriptions — counts")
rows, err = safe_select("chapter_descriptions", "id, source")
if err:
    print(f"ERROR: {err}")
else:
    from collections import Counter
    by_source = Counter(r["source"] for r in (rows or []))
    print(f"total = {len(rows or [])}")
    for k, v in by_source.items():
        print(f"  source={k}  → {v}")

# ---- focus: 喧闹法则 ----
hr("focus — 喧闹法则")
rows, err = safe_select("stories", "id, category, name, name_en",
                        name="喧闹法则")
if err:
    print(f"stories lookup error: {err}")
elif not rows:
    print("stories: NO ROW for 喧闹法则")
else:
    s = rows[0]
    print(f"stories: {s}")
    chs, e2 = safe_select("chapters", "id, level_code, level_name, file_path",
                          story_id=s["id"])
    if e2:
        print(f"chapters lookup error: {e2}")
    elif not chs:
        print("chapters: NO ROWS for this story (parse_plots never recorded any)")
    else:
        print(f"chapters: {len(chs)} rows")
        for c in chs[:5]:
            print(f"  {c}")
        if len(chs) > 5:
            print(f"  ... +{len(chs) - 5} more")
