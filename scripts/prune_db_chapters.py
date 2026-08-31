"""
Delete `chapters` rows whose source .txt no longer exists on disk.

Companion to prune_plots.py. That one cleans data/plots/; this one cleans the
database rows those files produced. Run it AFTER prune_plots.py --apply, since
disk is the source of truth: parse_plots.py imports from disk, and every
chapters row records the file it came from in `file_path`.

Why it's needed: before the `{|`/`|}` depth fix in scrape_plots.py, the nav
parser ran past the end of the wikitable and swept the trailing Navbox
catalogue into whichever section was the last table row. Those pages were
scraped and imported under the wrong story — 故事集/十字路口 ended up with 89
chapters where it should have 6. Fixing the parser and pruning the files does
not remove rows already imported.

Deliberately general rather than a one-off delete: anything whose file is gone
is stale, so this also catches renames and upstream reorderings later.

SAFETY
  • dry run unless --apply
  • refuses to delete a chapter that carries your own data — a comment anchored
    to it or to one of its nodes, or a board citation — and lists them instead.
    Those are hand-made and must never be collateral. Override with --force
    only if you have looked at the list.
  • deletion cascades to nodes / scenes / predicate_branches /
    chapter_descriptions / content_summaries / comment_anchors (all FKs are
    ON DELETE CASCADE), so removing a chapter removes its dialogue too.

Usage:
    conda run -n study python scripts/prune_db_chapters.py            # dry run
    conda run -n study python scripts/prune_db_chapters.py --apply
"""

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

try:
    import certifi
    _CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _CTX = ssl.create_default_context()

ROOT  = Path(__file__).resolve().parent.parent
PLOTS = ROOT / "data" / "plots"
CHUNK = 50


def env() -> tuple[str, str]:
    vals: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        k, _, v = line.strip().partition("=")
        if k and not k.startswith("#"):
            vals[k] = v.strip().strip('"').strip("'")
    url = (vals.get("SUPABASE_URL") or "").rstrip("/")
    key = vals.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        sys.exit("need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env")
    return url, key


URL, KEY = env()


def req(path: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None):
    r = urllib.request.Request(URL + path, method=method, data=body)
    r.add_header("apikey", KEY)
    r.add_header("Authorization", "Bearer " + KEY)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=120, context=_CTX) as resp:
            body = resp.read().decode()
            return json.loads(body) if body.strip() else None, resp.headers
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} on {method} {path}\n{e.read().decode(errors='replace')[:400]}")


def get_all(path: str) -> list:
    """PostgREST caps a response at 1000 rows and does NOT tell you it truncated
    unless you look — page explicitly rather than trusting a big ?limit."""
    out, start = [], 0
    while True:
        batch, _ = req(path, headers={"Range-Unit": "items", "Range": f"{start}-{start+999}"})
        batch = batch or []
        out.extend(batch)
        if len(batch) < 1000:
            return out
        start += 1000


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    p.add_argument("--force", action="store_true",
                   help="delete even chapters carrying comments / board citations")
    args = p.parse_args()

    if not PLOTS.is_dir():
        sys.exit(f"no plots directory at {PLOTS} — run the scraper first")

    chapters = get_all("/rest/v1/chapters?select=id,story_id,level_code,level_name,file_path&order=id")
    stories = {s["id"]: s for s in get_all("/rest/v1/stories?select=id,category,name&order=id")}
    print(f"{len(chapters)} chapters, {len(stories)} stories")

    stale, renamed = [], []
    for c in chapters:
        fp = c.get("file_path")
        if not fp:
            continue                      # no recorded source — leave it alone
        # file_path is stored with Windows separators; normalise both ways.
        rel = fp.replace("\\", os.sep).replace("/", os.sep)
        if (PLOTS / rel).exists():
            continue
        # Distinguish "the wiki reordered this entry" from "this row is junk".
        # Files are named `<index>_<page>.txt`, so an upstream reorder changes
        # only the index. If the same page is still in the same folder under a
        # different index, the row's CONTENT is fine and only its path is stale
        # — repair it rather than delete and re-import, which would churn
        # chapter ids that comments and board citations may point at.
        target = PLOTS / rel
        base = re.sub(r"^\d+_", "", target.name)
        match = None
        if target.parent.is_dir():
            match = next((f for f in target.parent.glob("*.txt")
                          if re.sub(r"^\d+_", "", f.name) == base), None)
        if match:
            renamed.append((c, str(match.relative_to(PLOTS)).replace("/", "\\")))
        else:
            stale.append(c)

    if renamed:
        print(f"\n{len(renamed)} chapter(s) whose file was RENAMED (upstream reorder) "
              f"— path repaired, row and id kept:")
        for c, newp in renamed[:10]:
            print(f"   #{c['id']} {c['level_code']}: {c['file_path']}  ->  {newp}")

    if not stale and not renamed:
        print("Nothing stale — every chapter's source file is present.")
        return

    def repair() -> None:
        for c, newp in renamed:
            req(f"/rest/v1/chapters?id=eq.{c['id']}", method="PATCH",
                headers={"Content-Type": "application/json", "Prefer": "return=minimal"},
                body=json.dumps({"file_path": newp}).encode())
        if renamed:
            print(f"repaired {len(renamed)} file_path(s)")

    if not stale:
        if not args.apply:
            print(f"\nDry run. Nothing to delete; re-run with --apply to repair "
                  f"{len(renamed)} path(s).")
            return
        repair()
        print("nothing to delete.")
        return

    by_story = Counter(c["story_id"] for c in stale)
    print(f"\n{len(stale)} chapter(s) whose source file is gone:\n")
    for sid, n in by_story.most_common():
        s = stories.get(sid, {})
        total = sum(1 for c in chapters if c["story_id"] == sid)
        print(f"  story {sid:>4}  {s.get('category')}/{s.get('name')}: {n} stale of {total}")

    ids = [c["id"] for c in stale]

    # --- what would cascade -------------------------------------------------
    nodes = 0
    for i in range(0, len(ids), CHUNK):
        sl = ",".join(map(str, ids[i:i + CHUNK]))
        _, h = req(f"/rest/v1/nodes?select=id&chapter_id=in.({sl})",
                   headers={"Prefer": "count=exact", "Range": "0-0"})
        nodes += int((h.get("Content-Range") or "/0").split("/")[-1])
    print(f"\ncascade: {nodes} nodes would be deleted with them")

    # --- refuse to destroy hand-made data ------------------------------------
    idset = set(ids)
    anchors = get_all("/rest/v1/comment_anchors?select=id,comment_id,chapter_id,node_id")
    node_chap: dict[int, int] = {}
    anchor_nodes = [a["node_id"] for a in anchors if a.get("node_id")]
    for i in range(0, len(anchor_nodes), CHUNK):
        sl = ",".join(map(str, anchor_nodes[i:i + CHUNK]))
        for n in (req(f"/rest/v1/nodes?select=id,chapter_id&id=in.({sl})")[0] or []):
            node_chap[n["id"]] = n["chapter_id"]
    hit_comments = [a for a in anchors
                    if a.get("chapter_id") in idset or node_chap.get(a.get("node_id")) in idset]

    refs = get_all("/rest/v1/correlation_member_refs?select=member_id,ref_type,ref_id")
    hit_refs = [r for r in refs if r["ref_type"] == "chapter" and r["ref_id"] in idset]

    if hit_comments or hit_refs:
        print(f"\n!! {len(hit_comments)} comment anchor(s) and {len(hit_refs)} board citation(s) "
              f"point at these chapters:")
        for a in hit_comments[:10]:
            print(f"     comment {a['comment_id']} -> chapter {a.get('chapter_id')} node {a.get('node_id')}")
        for r in hit_refs[:10]:
            print(f"     board member {r['member_id']} -> chapter {r['ref_id']}")
        if not args.force:
            sys.exit("\nRefusing to delete: that is hand-made data. Re-run with --force "
                     "only if you have read the list above.")
    else:
        print("no comments or board citations point at any of them")

    if not args.apply:
        print(f"\nDry run. Re-run with --apply to delete {len(stale)} chapter(s) "
              f"and {nodes} node(s)"
              + (f", and repair {len(renamed)} path(s)." if renamed else "."))
        return

    repair()
    deleted = 0
    for i in range(0, len(ids), CHUNK):
        sl = ",".join(map(str, ids[i:i + CHUNK]))
        req(f"/rest/v1/chapters?id=in.({sl})", method="DELETE")
        deleted += len(ids[i:i + CHUNK])
        print(f"  deleted {deleted}/{len(ids)}")

    left = [c for c in get_all("/rest/v1/chapters?select=id") if c["id"] in idset]
    print(f"\nDone. {deleted} chapter(s) deleted; {len(left)} of them still present "
          f"(should be 0).")


if __name__ == "__main__":
    main()
