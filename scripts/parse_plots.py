"""
Parse all scraped plot .txt files and insert into Supabase.

Dependencies:
    pip install supabase python-dotenv

Add to .env.local at the project root:
    SUPABASE_URL=https://[ref].supabase.co
    SUPABASE_KEY=your-service-role-key-here

Usage:
    python scripts/parse_plots.py            # insert all, skip already-inserted
    python scripts/parse_plots.py --force    # delete all content and re-insert
"""

import os
import re
import json
import logging
import argparse
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(Path(__file__).parent.parent / ".env.local")

DATA_DIR    = Path(__file__).parent.parent / "data" / "plots"
DESCR_JSON  = Path(__file__).parent.parent / "data" / "story_descriptions.json"

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Original-name lookup from data/story_descriptions.json
#
# scrape_plots.py sanitizes filenames for Windows (':' → '_' etc.), so on-disk
# level names like '6_44P.M.' lose their original punctuation. The 情报处理室
# scrape, however, keeps the wiki originals intact in story_descriptions.json
# ('6:44P.M.', etc.). We load that mapping here so chapters.level_name in the
# DB holds the real wiki name, not the file-safe one.
#
# Lookup key: (category, story_name, level_code) → original level_name.
# Only covers categories the index page lists (支线, 故事集); 主线 and others
# fall through to the on-disk name (which is fine — their level names usually
# don't contain ASCII punctuation in the first place).
# ---------------------------------------------------------------------------

_orig_level_lookup: dict[tuple[str, str, str], str] = {}


def _load_orig_levels() -> None:
    if not DESCR_JSON.exists():
        log.info(f"(no {DESCR_JSON.name} on disk — original level-name "
                 "lookup disabled, falling back to on-disk names)")
        return
    for s in json.loads(DESCR_JSON.read_text(encoding="utf-8")):
        for entry in s.get("stages", []):
            key = (s["category"], s["story_name"], entry.get("level_code", "") or "")
            _orig_level_lookup[key] = entry.get("level_name", "")
    log.info(f"loaded {len(_orig_level_lookup)} original-name aliases from "
             f"{DESCR_JSON.name}")


_load_orig_levels()


# ---------------------------------------------------------------------------
# Tag / line parsing
# ---------------------------------------------------------------------------

TAG_RE = re.compile(r'^\[([A-Za-z_][A-Za-z0-9_]*)([^\]]*)\](.*)', re.DOTALL)


def parse_tag_attr(attr: str) -> dict:
    """Turn the attribute portion of a tag into a plain dict."""
    attr = attr.strip()
    if not attr:
        return {}
    # [name="speaker"] form
    if attr.startswith('="'):
        m = re.match(r'^="([^"]*)"', attr)
        return {"name": m.group(1)} if m else {}
    # (key="val", key2=val2, ...) form
    if attr.startswith("("):
        inner = attr[1:].rstrip(")")
        result = {}
        for m in re.finditer(r'(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|[^,)]+)', inner):
            val = m.group(2).strip()
            if val.startswith('"') and val.endswith('"'):
                val = val[1:-1]
            result[m.group(1)] = val
        return result
    return {}


def parse_line(raw: str):
    """
    Classify one raw line. Returns one of:
      ("tag",  tag_name_lower, params_dict, trailing_text)
      ("text", None,           {},          plain_text)
      None  — skip
    """
    line = raw.strip()
    if not line:
        return None
    if line.startswith("{{") or line.startswith("}}"):
        return None
    if line.startswith("["):
        m = TAG_RE.match(line)
        if not m:
            return None
        tag = m.group(1).lower()
        params = parse_tag_attr(m.group(2))
        trailing = m.group(3).strip()
        return ("tag", tag, params, trailing)
    # Plain text line → narrator speech
    return ("text", None, {}, line)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

BATCH_SIZE = 500  # rows per bulk insert

# Buffers flushed at end of each story
_node_buffer: list[dict] = []
_branch_node_buffer: list[dict] = []


def insert_one(table: str, data: dict) -> int:
    """Insert a single row and return its generated id."""
    res = supabase.table(table).insert(data).execute()
    return res.data[0]["id"]


def buffer_node(row: dict):
    _node_buffer.append(row)
    if len(_node_buffer) >= BATCH_SIZE:
        flush_nodes()


def buffer_branch_node(row: dict):
    _branch_node_buffer.append(row)
    if len(_branch_node_buffer) >= BATCH_SIZE:
        flush_branch_nodes()


def flush_nodes():
    if _node_buffer:
        supabase.table("nodes").insert(_node_buffer).execute()
        _node_buffer.clear()


def flush_branch_nodes():
    if _branch_node_buffer:
        supabase.table("branch_nodes").insert(_branch_node_buffer).execute()
        _branch_node_buffer.clear()


def flush_all():
    flush_nodes()
    flush_branch_nodes()


def query_one(table: str, col: str, val) -> dict | None:
    """Return the first row where col = val, or None."""
    res = supabase.table(table).select("id").eq(col, val).limit(1).execute()
    return res.data[0] if res.data else None


def truncate_content_tables():
    """Delete all rows from content tables in dependency order."""
    for table in ("branch_nodes", "predicate_branches", "decisions",
                  "nodes", "scenes", "chapter_descriptions", "chapters",
                  "stories"):
        supabase.table(table).delete().neq("id", 0).execute()


# Cache (category, story_name) → stories.id during a run.
_story_id_cache: dict[tuple[str, str], int] = {}


def get_or_create_story(category: str, name: str) -> int:
    """Return the stories row id for (category, name), creating if missing.

    stories.name_en is NOT NULL — we insert the Chinese name as a placeholder
    so this script doesn't depend on scrape_story_pages.py having run first.
    scrape_story_pages.py overwrites with the real wiki 副标题 later.
    """
    key = (category, name)
    if key in _story_id_cache:
        return _story_id_cache[key]
    res = (supabase.table("stories")
           .select("id")
           .eq("category", category).eq("name", name)
           .limit(1).execute())
    if res.data:
        sid = res.data[0]["id"]
    else:
        sid = insert_one("stories", {
            "category": category,
            "name":     name,
            "name_en":  name,   # placeholder; scrape_story_pages.py overwrites
        })
    _story_id_cache[key] = sid
    return sid


# ---------------------------------------------------------------------------
# Story parser (state machine)
# ---------------------------------------------------------------------------

def parse_story(chapter_id: int, file_path: Path):
    scene_seq = 0
    node_seq = 0
    current_scene_id = None

    current_decision_db_id = None
    current_branch_id = None
    branch_node_seq = 0
    branch_seq = 0

    with open(file_path, encoding="utf-8") as f:
        for raw in f:
            parsed = parse_line(raw)
            if parsed is None:
                continue

            kind = parsed[0]

            # ---- Plain narrator text ----------------------------------------
            if kind == "text":
                _insert_content(chapter_id, current_scene_id, current_branch_id,
                                node_seq, branch_node_seq,
                                "speech", "narrator", parsed[3], None)
                if current_branch_id:
                    branch_node_seq += 1
                else:
                    node_seq += 1
                continue

            _, tag, params, trailing = parsed

            # ---- Scene boundary ---------------------------------------------
            if tag in ("dialog", "dialogs"):
                scene_seq += 1
                current_scene_id = insert_one("scenes", {
                    "chapter_id": chapter_id,
                    "seq": scene_seq,
                })
                current_branch_id = None
                branch_node_seq = 0
                continue

            # ---- Decision ---------------------------------------------------
            if tag == "decision":
                options = [o.strip() for o in params.get("options", "").split(";") if o.strip()]
                values  = [v.strip() for v in params.get("values",  "").split(";") if v.strip()]
                mismatch = len(options) != len(values)
                if mismatch:
                    log.warning(
                        f"Decision count mismatch in {file_path.name}: "
                        f"{len(options)} options vs {len(values)} values"
                    )
                node_id = insert_one("nodes", {
                    "chapter_id": chapter_id,
                    "scene_id":   current_scene_id,
                    "seq":        node_seq,
                    "type":       "decision",
                    "speaker":    None,
                    "content":    None,
                    "raw_params": params,
                })
                node_seq += 1
                current_decision_db_id = insert_one("decisions", {
                    "node_id":            node_id,
                    "options":            options,
                    "values":             values,
                    "has_count_mismatch": mismatch,
                })
                current_branch_id = None
                branch_seq = 0
                continue

            # ---- Predicate branch -------------------------------------------
            if tag == "predicate":
                if current_decision_db_id is None:
                    log.warning(f"Predicate without preceding Decision in {file_path.name}")
                    continue
                refs = [r.strip() for r in params.get("references", "").split(";") if r.strip()]
                branch_seq += 1
                current_branch_id = insert_one("predicate_branches", {
                    "decision_id": current_decision_db_id,
                    "chapter_id":  chapter_id,
                    "predicates":  refs,
                    "seq":         branch_seq,
                })
                branch_node_seq = 0
                continue

            # ---- Speech: [name="speaker"] text ------------------------------
            if tag == "name":
                if not trailing:
                    continue
                _insert_content(chapter_id, current_scene_id, current_branch_id,
                                node_seq, branch_node_seq,
                                "speech", params.get("name", "narrator"), trailing, None)
                if current_branch_id:
                    branch_node_seq += 1
                else:
                    node_seq += 1
                continue

            # ---- Speech: [multiline(...)] text ------------------------------
            if tag == "multiline":
                if not trailing:
                    continue
                _insert_content(chapter_id, current_scene_id, current_branch_id,
                                node_seq, branch_node_seq,
                                "speech", params.get("name", "narrator"), trailing, None)
                if current_branch_id:
                    branch_node_seq += 1
                else:
                    node_seq += 1
                continue

            # ---- Subtitle ---------------------------------------------------
            if tag == "subtitle":
                content = params.get("text", "").strip()
                if not content:
                    continue
                _insert_content(chapter_id, current_scene_id, current_branch_id,
                                node_seq, branch_node_seq,
                                "subtitle", "narrator", content, params)
                if current_branch_id:
                    branch_node_seq += 1
                else:
                    node_seq += 1
                continue

            # ---- CG image ---------------------------------------------------
            if tag == "cgitem":
                _insert_content(chapter_id, current_scene_id, current_branch_id,
                                node_seq, branch_node_seq,
                                "cgitem", None, None, params)
                if current_branch_id:
                    branch_node_seq += 1
                else:
                    node_seq += 1
                continue

            # Everything else is a visual/audio directive — skip


def _insert_content(chapter_id, scene_id, branch_id,
                    node_seq, branch_node_seq,
                    type_, speaker, content, raw_params):
    if branch_id is not None:
        buffer_branch_node({
            "branch_id":  branch_id,
            "chapter_id": chapter_id,
            "seq":        branch_node_seq,
            "type":       type_,
            "speaker":    speaker,
            "content":    content,
            "raw_params": raw_params,
        })
    else:
        buffer_node({
            "chapter_id": chapter_id,
            "scene_id":   scene_id,
            "seq":        node_seq,
            "type":       type_,
            "speaker":    speaker,
            "content":    content,
            "raw_params": raw_params,
        })


# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------

# Anchored at end of filename body; matches the file-side stage code.
_STAGE_RE = re.compile(r'^(.+)_(BEG|END|NBT|ENTRY|SP\d+|剧情\d*)$')


def split_chapter_fields(fname_body: str) -> tuple[str, str, str]:
    """
    Parse the title-part of a plot filename (without the leading order_
    prefix and without the .txt suffix) into (level_code, level_name, stage).

    Examples:
        '3-5 呼叫_END'          → ('3-5',  '呼叫',   'END')
        'UR-1 嘈杂的天空_BEG'   → ('UR-1', '嘈杂的天空', 'BEG')
        '15-17 “她”_END_SP1'    → ('15-17', '“她”_END', 'SP1')   # level_name keeps the inner _END
        'SL01_ENTRY'            → ('',     'SL01',  'ENTRY')
        '喧闹法则_剧情'          → ('',     '喧闹法则', '剧情')
        'something_unknown'     → ('',     'something_unknown', '')   # no recognized stage

    `level_code` is whatever sits before the first space when a space exists;
    files that have no space (interludes / overview pages) get an empty code.
    """
    m = _STAGE_RE.match(fname_body)
    if m:
        body, stage = m.group(1), m.group(2)
    else:
        body, stage = fname_body, ""

    if " " in body:
        code, _, name = body.partition(" ")
    else:
        code, name = "", body
    return code, name, stage


def collect_files() -> list[dict]:
    """Return list of file metadata dicts, sorted within each story.

    Each dict has:
        category, story_name, level_code, level_name, stage,
        rel_path, order, full_path
    """
    files = []
    for root, _, fnames in os.walk(DATA_DIR):
        for fname in fnames:
            if not fname.endswith(".txt"):
                continue
            fpath = Path(root) / fname
            rel = fpath.relative_to(DATA_DIR)
            parts = rel.parts
            if len(parts) < 3:
                continue
            category, story_name = parts[0], parts[1]
            m = re.match(r'^(\d+)_(.*?)\.txt$', fname)
            if not m:
                log.warning(f"Skipping unexpected filename: {fname}")
                continue
            order = int(m.group(1))
            level_code, level_name, stage = split_chapter_fields(m.group(2))
            files.append({
                "category":   category,
                "story_name": story_name,
                "level_code": level_code,
                "level_name": level_name,
                "stage":      stage,
                "rel_path":   str(rel),
                "order":      order,
                "full_path":  fpath,
            })
    files.sort(key=lambda f: (f["category"], f["story_name"], f["order"]))
    return files


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def debug_story(rel: str):
    """
    Re-parse a single story by its relative path and print:
      - each parsed line with its line number
      - the exact error and traceback when it fails
    Does NOT insert anything into the database.
    """
    import traceback
    fpath = DATA_DIR / Path(rel)
    if not fpath.exists():
        print(f"File not found: {fpath}")
        return

    print(f"\n=== DEBUG: {rel} ===\n")
    lines = fpath.read_text(encoding="utf-8").splitlines()
    for i, raw in enumerate(lines, 1):
        parsed = parse_line(raw)
        print(f"  {i:>4}  {raw[:120]}")
        if parsed:
            print(f"        → {parsed[:3]}")  # kind, tag, params (no trailing text noise)

    # Now do a dry-run parse (no DB) and catch the error
    print(f"\n=== DRY-RUN PARSE ===\n")
    scene_seq = 0
    node_seq = 0
    current_scene_id = None
    current_decision_db_id = None
    current_branch_id = None
    branch_node_seq = 0
    branch_seq = 0

    try:
        with open(fpath, encoding="utf-8") as f:
            for lineno, raw in enumerate(f, 1):
                parsed = parse_line(raw)
                if parsed is None:
                    continue
                kind = parsed[0]
                if kind == "text":
                    node_seq += 1
                    continue
                _, tag, params, trailing = parsed
                if tag in ("dialog", "dialogs"):
                    scene_seq += 1
                    current_scene_id = scene_seq  # fake id
                    current_branch_id = None
                    branch_node_seq = 0
                elif tag == "decision":
                    options = [o.strip() for o in params.get("options", "").split(";") if o.strip()]
                    values  = [v.strip() for v in params.get("values",  "").split(";") if v.strip()]
                    if len(options) != len(values):
                        print(f"  WARNING line {lineno}: decision count mismatch "
                              f"({len(options)} options, {len(values)} values)")
                        print(f"    {raw.strip()}")
                    current_decision_db_id = node_seq  # fake id
                    current_branch_id = None
                    branch_seq = 0
                    node_seq += 1
                elif tag == "predicate":
                    if current_decision_db_id is None:
                        print(f"  WARNING line {lineno}: predicate without decision")
                        print(f"    {raw.strip()}")
                    branch_seq += 1
                    current_branch_id = branch_seq  # fake id
                    branch_node_seq = 0
                elif tag in ("name", "multiline"):
                    if trailing:
                        if current_branch_id:
                            branch_node_seq += 1
                        else:
                            node_seq += 1
                elif tag == "subtitle":
                    content = params.get("text", "").strip()
                    if content:
                        if current_branch_id:
                            branch_node_seq += 1
                        else:
                            node_seq += 1
                elif tag == "cgitem":
                    if current_branch_id:
                        branch_node_seq += 1
                    else:
                        node_seq += 1

        print(f"\nDry-run completed OK — {node_seq} main nodes, "
              f"{branch_node_seq} branch nodes (last branch), "
              f"{scene_seq} scenes.")
    except Exception:
        print(f"\nERROR at or after line {lineno}:")
        print(f"  {raw.strip()}")
        traceback.print_exc()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true",
                        help="Delete all existing content and re-insert")
    parser.add_argument("--debug", metavar="REL_PATH",
                        help="Dry-run a single story file and print parse details + errors. "
                             "Example: 主线/黑暗时代·上/3_0-1 坍塌_BEG.txt")
    args = parser.parse_args()

    if args.debug:
        debug_story(args.debug)
        return

    files = collect_files()
    log.info(f"Found {len(files)} plot files")

    if args.force:
        log.info("--force: deleting all content tables")
        truncate_content_tables()

    failed = []
    for f in files:
        rel = f["rel_path"]
        if query_one("chapters", "file_path", rel):
            log.info(f"Skip (exists): {rel}")
            continue
        log.info(f"Parsing: {f['category']}/{f['story_name']}/{f['level_code']} "
                 f"{f['level_name']} [{f['stage']}]")

        story_id = get_or_create_story(f["category"], f["story_name"])

        # Recover the wiki-original level_name when the on-disk one was
        # sanitized (e.g. '6:44P.M.' → '6_44P.M.'). Falls back to the
        # on-disk name when there's no JSON entry.
        orig = _orig_level_lookup.get(
            (f["category"], f["story_name"], f["level_code"] or "")
        )
        level_name = orig or f["level_name"]

        chapter_id = insert_one("chapters", {
            "story_id":       story_id,
            "level_code":     f["level_code"] or None,
            "level_name":     level_name,
            "stage":          f["stage"] or None,
            "file_path":      rel,
            "order_in_story": f["order"],
        })
        try:
            parse_story(chapter_id, f["full_path"])
            flush_all()
        except Exception as e:
            # Discard any buffered rows for this failed file
            _node_buffer.clear()
            _branch_node_buffer.clear()
            # Delete the partial chapter row — CASCADE removes all child rows.
            # Leave the stories row in place: other chapters may share it.
            supabase.table("chapters").delete().eq("id", chapter_id).execute()
            log.error(f"FAILED {rel}: {e} — rolled back, will retry on next run")
            failed.append(rel)

    if failed:
        log.warning(f"{len(failed)} stories failed and were rolled back:")
        for f in failed:
            log.warning(f"  {f}")
            log.warning(f"  → python scripts/parse_plots.py --debug \"{f}\"")
        log.warning("Re-run the script to retry them.")
    else:
        log.info("Done.")


if __name__ == "__main__":
    main()
