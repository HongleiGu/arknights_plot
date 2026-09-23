"""
Load data/book_sections.json (scripts/structure_book.py) into the existing
content model as category 大地巡旅 (AP-31).

    book chapter  ->  stories   (6 numbered + a synthetic 附录)
    section       ->  chapters
    paragraph     ->  nodes     (type='subtitle', speaker='narrator')
    illustration  ->  nodes     (type='cgitem', raw_params) — AP-34

Why this shape and not 008's text_clusters/text_chunks
------------------------------------------------------
The first cut used text_clusters/text_chunks, which is what 008 exists for. The
deciding argument against it is that the alternative needs a migration and this
does not: to comment on a paragraph, `comment_anchors` would have to gain a
`text_chunk_id` column, whereas `chapter_id` and `node_id` are already there.
Reusing stories/chapters/nodes also inherits the chapter reader, `@chapter/N`
and `@node/N` citations, and CiteSearch — none of which text_chunks has.

There is a content-shape argument too. 008 is for short adjuncts appended to a
chapter (ending epilogues, character dossiers). This is 6 chapters × 61
sections × 441 pages of standalone hierarchical prose, and hierarchy plus
length is exactly what stories/chapters model.

The cost, worth stating because it is real: `nodes` is AVG-script shaped.
`scene_id`, `branch_id`, the `no_decision_in_branch` constraint and `speaker`
are all meaningless for book prose, and this is the table's first non-script
tenant — so 18k rows here are narration, not dialogue. The one thing that
actually reads `nodes.speaker` is seed_entities.py, which already excludes
'narrator', so it stays correct.

`raw_params.page` carries the printed page number. `nodes.seq` is paragraph
order, so without this the page — the only way to check a claim against a
physical copy — would be lost.

Idempotent: the category's chapters are deleted (nodes cascade) and re-inserted,
while stories are upserted on (category, name) so their ids survive. Rows are
wholly OCR-derived, so there are no hand-edits to preserve; re-running after a
better OCR pass is the intended way to update.

NOTE: this is a commercially published book (ISBN 978-7-5514-4726-3). Importing
makes it searchable by the assistant and the graph; whether any of it is
publicly readable is a frontend decision, deliberately not made here.

Usage:
    conda run -n study python scripts/import_book.py
    conda run -n study python scripts/import_book.py --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

try:
    from postgrest.exceptions import APIError
except Exception:                       # import path varies across versions
    APIError = None                     # type: ignore[assignment,misc]

ROOT      = Path(__file__).parent.parent
BOOK_JSON = ROOT / "data" / "book_sections.json"

CATEGORY = "大地巡旅"

# --- page override serialisation (040) --------------------------------------
# One printed page as plain text: blocks separated by a blank line, `#` marks a
# heading, `[[img:file|caption]]` pins an illustration. The same format the
# admin editor reads and writes — see 040_book_page_overrides.sql for why the
# unit is a whole page rather than a chunk.
# `[[img:a.png|cap]]` or, for a row of plates that share one printed caption,
# `[[img:a.png,b.png,c.png|cap]]`. Comma-separated rather than a new block type:
# 12 of the book's 35 multi-image runs share a caption, and a separate syntax
# for them would be a second rule to remember for a case that is one character
# away from the first.
# A caption may itself contain a line break (10 of the book's 96 do — the
# 大小：190—200cm / (常见种成体…) plate labels), so the caption tail is matched
# with [\s\S] rather than `.`. With `.` the whole token failed to match and the
# block fell through to the plain-text branch, turning the illustration into a
# paragraph of literal `[[img:…]]` markup the first time the page was saved.
# Captions after the first pipe are positional: one caption applies to the whole
# row, N captions label the N images individually. No caption contains a pipe
# (checked: 0 of 96), so splitting on it is safe.
IMG_LINE = re.compile(r"^\[\[img:([^|\]]+?)\s*(?:\|([\s\S]*))?\]\]$")
# Used to lift whole tokens out of the body before blank-line splitting, so a
# caption may run to several paragraphs. Non-greedy so two tokens in a row
# don't merge into one.
IMG_TOKEN = re.compile(r"\[\[img:[\s\S]*?\]\]")
# `#` … `#####`. Five levels because MinerU only resolves two and the print
# nests deeper than that; the extra depth is assigned by hand while proofreading.
HEAD_LINE = re.compile(r"^(#{1,5})\s+(.*)$", re.S)
# `>> ` marks an inserted block — a pull quote, a sidebar, a PRTS terminal
# transcript — that sits beside the prose rather than in its flow.
#
# Deliberately NOT a single `>`: measured, 11 of the book's paragraphs already
# begin with `> ` as PRINTED content (the terminal prompts in 罗德岛生活指南,
# e.g. `> 欢迎使用原生罗德岛终端服务`). A single-`>` marker would strip that
# character on the first save — silent corruption presenting as a formatting
# change. `>> ` occurs in none of the 3,904 paragraphs.
ASIDE_LINE = re.compile(r"^>>[ \t]?", re.M)
# How an image token survives the blank-line split. It is replaced by a
# newline-free placeholder, the body is split into blocks, and the placeholder
# is swapped back afterwards.
#
# The first cut LIFTED tokens out of the body instead, which protected a caption
# that runs to several paragraphs but threw away the token's POSITION — and
# position is exactly what says whether a plate continues the inserted block
# above it or starts a new one. Masking protects the caption for the same reason
# (the placeholder holds no newline, so no splitter can cut it) while keeping
# the token where the author put it.
PLACEHOLDER = "\x00img{}\x00"
PLACEHOLDER_RE = re.compile(r"\x00img(\d+)\x00")


def images_of(c: dict) -> list[str]:
    """A chunk's illustrations. One block can hold a row sharing a caption."""
    if c.get("images"):
        return [f for f in c["images"] if f]
    return [c["image"]] if c.get("image") else []


def captions_of(c: dict, n: int) -> list[str | None]:
    """
    A chunk's captions: one shared, or one per image.

    Returns [] when there is no caption at all, a 1-list when the row shares
    one, and an n-list when each plate is labelled separately (8 runs in the
    book do that — p11's 未活性化 / 开始活性化 / 逐渐分解 / 活性化结束).
    """
    caps = c.get("captions")
    if caps:
        if len(caps) == 1:
            # One caption stays one, even for a multi-image row — padding it out
            # to the image count would serialise as a trailing empty `|`.
            return [caps[0]] if caps[0] else []
        trimmed = list(caps[:n]) + [None] * max(0, n - len(caps))
        return trimmed if any(trimmed) else []
    return [c["caption"]] if c.get("caption") else []


def page_to_text(chunks: list[dict]) -> str:
    """
    Chunks -> the editable text for a page.

    Blocks are separated by a blank line. Inside an inserted block, paragraphs
    are separated by a marker-only `>>` line instead — a blank line there would
    end the block, which is how the author says "two blocks" rather than "two
    paragraphs of one block".
    """
    out: list[str] = []
    prev_aside = False
    for c in chunks:
        imgs = images_of(c)
        aside = bool(c.get("aside"))
        if imgs:
            caps = captions_of(c, len(imgs))
            tail = "".join(f"|{x or ''}" for x in caps) if caps else ""
            # Only the token's first line carries the marker. A caption may span
            # paragraphs and the token is parsed back whole, before markers are
            # stripped, so a `>> ` on an inner line would end up inside the
            # caption text rather than being removed.
            piece = f"{'>> ' if aside else ''}[[img:{','.join(imgs)}{tail}]]"
        elif c.get("text"):
            lvl = c.get("level") or (1 if c.get("heading") else 0)
            head = "#" * min(lvl, 5) + " " if lvl else ""
            piece = head + c["text"]
            if aside:
                piece = "\n".join(">> " + ln for ln in piece.split("\n"))
        else:
            continue
        # A chunk not flagged as starting a block continues the one above it.
        # Rows written before the flag existed have none, which reads as
        # "continues" — the same single block they rendered as back then.
        if aside and prev_aside and not c.get("aside_start"):
            out[-1] += "\n>>\n" + piece
        else:
            out.append(piece)
        prev_aside = aside
    return "\n\n".join(out)


def text_to_page(body: str, page: int) -> list[dict]:
    """
    The editable text -> chunks. Inverse of page_to_text.

    A blank line separates blocks, and that is also what separates two inserted
    blocks: `>> a` / blank / `>> b` is two blocks, while `>> a` / `>>` / `>> b`
    is one block of two paragraphs. The block boundary therefore has to be
    decided before anything is pulled out of the text, which is why `[[img:…]]`
    tokens are MASKED rather than lifted — see PLACEHOLDER.
    """
    toks: list[str] = []

    def mask(m: re.Match) -> str:
        toks.append(m.group(0))
        return PLACEHOLDER.format(len(toks) - 1)

    masked = IMG_TOKEN.sub(mask, body or "")
    chunks: list[dict] = []

    def flags(aside: bool, start: bool) -> dict:
        if not aside:
            return {}
        return {"aside": True, **({"aside_start": True} if start else {})}

    def push_text(t: str, aside: bool, start: bool) -> None:
        if (hm := HEAD_LINE.match(t)):
            chunks.append({"page": page, "text": hm.group(2).strip(),
                           "heading": True, "level": len(hm.group(1)),
                           **flags(aside, start)})
        else:
            chunks.append({"page": page, "text": t, **flags(aside, start)})

    def push_image(tok: str, aside: bool, start: bool) -> None:
        m = IMG_LINE.match(tok.strip())
        if not m:
            return
        files = [f.strip() for f in m.group(1).split(",") if f.strip()]
        raw = m.group(2)
        caps = [x.strip() or None for x in raw.split("|")] if raw is not None else []
        chunks.append({"page": page, "images": files, "kind": "image",
                       # `image`/`caption` kept alongside the lists so anything
                       # still reading the single-file fields works.
                       "image": files[0] if files else None,
                       "captions": caps,
                       "caption": caps[0] if len(caps) == 1 else None,
                       **flags(aside, start)})

    def push_para(part: str, aside: bool, start: bool) -> bool:
        """One paragraph, which may interleave text and plates. Returns `start`."""
        pos = 0
        for m in PLACEHOLDER_RE.finditer(part):
            lead = part[pos:m.start()].strip()
            if lead:
                push_text(lead, aside, start)
                start = False
            push_image(toks[int(m.group(1))], aside, start)
            start = False
            pos = m.end()
        tail = part[pos:].strip()
        if tail:
            push_text(tail, aside, start)
            start = False
        return start

    for block in re.split(r"\n\s*\n", masked):
        b = block.strip()
        if not b:
            continue
        if ASIDE_LINE.match(b):
            # A blank line ended whatever came before, so this is a new block.
            # Inside it, strip the marker from every line and split on the
            # remainder's own blank lines — a `>>` line with nothing after it is
            # blank INSIDE the block but not blank to the outer splitter, which
            # is precisely what lets one block hold several paragraphs.
            start = True
            inner = "\n".join(ASIDE_LINE.sub("", ln) for ln in b.split("\n"))
            for sub in re.split(r"\n\s*\n", inner):
                t = sub.strip()
                if t:
                    start = push_para(t, True, start)
        else:
            push_para(b, False, False)
    return chunks


def page_hash(chunks: list[dict]) -> str:
    """Fingerprint of MinerU's own text for a page, for staleness reporting."""
    return hashlib.sha1(page_to_text(chunks).encode("utf-8")).hexdigest()

# The first cut of this import; removed so the book does not exist twice.
LEGACY_CATEGORY = "设定集"

# Carried on every story row so the provenance travels with the content rather
# than living only in a UI banner someone might later remove. The text is
# machine-read from a scan and is known to contain errors — see
# scripts/check_book_ocr.py for the review list.
OCR_NOTE = ("本篇文本由《大地巡旅：〈明日方舟〉官方世界观设定集》扫描件 OCR 得到，"
            "可能存在识别错误（尤其是凯尔希的手写批注），非官方校订版本。")

load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

MAX_RETRIES   = 5
RETRY_BACKOFF = 2.0
CHUNK         = 500


def _execute(query, what: str):
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return query.execute()
        except Exception as e:                       # noqa: BLE001
            if APIError is not None and isinstance(e, APIError):
                raise
            last = e
            if attempt == MAX_RETRIES - 1:
                break
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"  retry {attempt+1}/{MAX_RETRIES} for {what} after {wait:.0f}s")
            time.sleep(wait)
    raise RuntimeError(f"{what} failed after {MAX_RETRIES} attempts") from last


def _book_chapter_ids(db: Client) -> list[int]:
    """Chapter ids of the already-imported book, or [] on a first run."""
    stories = _execute(db.table("stories").select("id").eq("category", CATEGORY),
                       "select book stories").data or []
    if not stories:
        return []
    ids, start = [], 0
    while True:
        rows = _execute(db.table("chapters").select("id")
                        .in_("story_id", [s["id"] for s in stories])
                        .range(start, start + 999), "select book chapters").data or []
        ids += [r["id"] for r in rows]
        if len(rows) < 1000:
            return ids
        start += 1000


def main() -> None:
    ap = argparse.ArgumentParser(description="Import the 大地巡旅 settings book.")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--rebuild", action="store_true",
                    help="DESTRUCTIVE: wipe the imported book and rebuild it from "
                         "book_sections.json, discarding anything edited in the "
                         "database since. Refuses without this once the book exists.")
    args = ap.parse_args()

    if not BOOK_JSON.exists():
        log.info(f"{BOOK_JSON.relative_to(ROOT)} not found — nothing to import")
        return
    doc = json.loads(BOOK_JSON.read_text(encoding="utf-8"))
    sections = doc.get("sections") or []
    chapters = doc.get("chapters") or []
    if not sections or not chapters:
        log.info("book_sections.json has no chapters/sections — nothing to import")
        return

    paras = sum(len(s["chunks"]) for s in sections)
    log.info(f"{len(chapters)} chapters / {len(sections)} sections / {paras} paragraphs "
             f"/ {sum(s['chars'] for s in sections):,} chars")
    if args.dry_run:
        for c in chapters:
            n = sum(1 for s in sections if s["chapter"] == c["number"])
            log.info(f"  {c['number']:<6} {str(c['title'])[:18]:<20} {n} section(s)")
        log.info("--dry-run: nothing written")
        return

    db: Client = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # This import is a BOOTSTRAP, not a sync. It replaces every chapter and node
    # of the book, so once the book exists the database — not this script — is
    # the authority: the text is proofread page by page in the admin editor, and
    # chapters are restructured by hand. A re-run would silently discard all of
    # it, which it has done twice (23 chapter titles reverted, a hand-deleted
    # section restored).
    #
    # So it refuses rather than warns. `import_comics.py` reaches the same place
    # by upserting on file_path, because comic episodes carry hand-attached
    # panel text; the book cannot upsert as cheaply, because a node's identity
    # is (chapter, seq) and seq shifts whenever a page's paragraph count changes.
    # Refusing is the honest version of the same rule.
    cids = _book_chapter_ids(db)
    existing = (_execute(db.table("nodes").select("id", count="exact")
                         .in_("chapter_id", cids).limit(1),
                         "count existing book nodes").count or 0) if cids else 0
    if existing and not args.rebuild:
        log.error(
            f"the book is already imported ({existing:,} nodes) and the database "
            f"is the source of truth for it.\n"
            f"  This script REPLACES every chapter and node, discarding "
            f"proofreading and any hand-made structure.\n"
            f"  Text is edited at /大地巡旅 (the 校订 button on each page); "
            f"structure at /admin/book.\n"
            f"  data/book_corrections.json, SECTION_TITLES and EXTRA_SECTIONS / "
            f"PAGE_MOVES no longer take effect\n"
            f"  on their own — they are what a --rebuild would REPRODUCE, not a "
            f"live edit path.\n"
            f"  If you really do want to rebuild from book_sections.json, pass "
            f"--rebuild.")
        raise SystemExit(1)
    if existing:
        log.warning(f"--rebuild: replacing {existing:,} existing node(s); "
                    f"only book_page_overrides survives this")

    # Drop the earlier text_clusters shape (chunks cascade).
    legacy = _execute(db.table("stories").select("id")
                      .eq("category", LEGACY_CATEGORY), "select legacy").data or []
    if legacy:
        log.info(f"removing {len(legacy)} legacy {LEGACY_CATEGORY} story row(s)")
        _execute(db.table("stories").delete()
                 .in_("id", [r["id"] for r in legacy]), "delete legacy")

    story_rows = [{
        "category": CATEGORY,
        "name": c["title"] or c["number"],
        "name_en": c["title_en"] or c["title"] or c["number"],
        "description": OCR_NOTE,
        "arc": doc["title"],
        "seq": i + 1,
    } for i, c in enumerate(chapters)]
    _execute(db.table("stories").upsert(story_rows, on_conflict="category,name"),
             "upsert stories")

    got = _execute(db.table("stories").select("id, name").eq("category", CATEGORY),
                   "select stories").data or []
    story_id = {r["name"]: r["id"] for r in got}
    by_number = {c["number"]: (c["title"] or c["number"]) for c in chapters}

    # Replace the chapters wholesale; nodes cascade, so no orphans are possible.
    log.info("clearing existing chapters …")
    _execute(db.table("chapters").delete().in_("story_id", list(story_id.values())),
             "delete chapters")

    chapter_rows, order = [], {}
    for s in sections:
        name = by_number.get(s["chapter"])
        sid = story_id.get(name) if name else None
        if not sid:
            log.warning(f"  section {s['number']}: no story for chapter {s['chapter']}")
            continue
        order[s["chapter"]] = order.get(s["chapter"], 0) + 1
        chapter_rows.append({
            "story_id": sid,
            "level_code": s["number"],
            "level_name": s["title"],
            "stage": None,
            "file_path": f"{CATEGORY}\\{name}\\{order[s['chapter']]}_{s['number']}.book",
            "order_in_story": order[s["chapter"]],
        })
    _execute(db.table("chapters").insert(chapter_rows), "insert chapters")

    made = _execute(db.table("chapters").select("id, level_code, story_id")
                    .in_("story_id", list(story_id.values())), "select chapters").data or []
    chapter_id = {r["level_code"]: r["id"] for r in made}
    log.info(f"  {len(made)} chapter(s)")

    # Hand-corrected pages (040). Read AFTER the wipe above because they live in
    # their own table — that separation is the whole point: the import destroys
    # chapters and nodes on every run, and would destroy proofreading with them.
    overrides = {}
    for start in range(0, 20000, 1000):
        rows = _execute(db.table("book_page_overrides")
                        .select("page, body, source_hash").range(start, start + 999),
                        "select overrides").data or []
        for r in rows:
            overrides[r["page"]] = r
        if len(rows) < 1000:
            break
    if overrides:
        log.info(f"{len(overrides)} hand-corrected page(s)")

    node_rows = []
    stale_pages = []
    for s in sections:
        cid = chapter_id.get(s["number"])
        if not cid:
            continue
        # Replace each overridden page's chunks in place, keeping the section's
        # page order. A page absent from the overrides is untouched.
        by_page: dict[int, list[dict]] = {}
        for c in s["chunks"]:
            by_page.setdefault(c["page"], []).append(c)
        rebuilt: list[dict] = []
        for pno, group in by_page.items():
            ov = overrides.get(pno)
            if not ov:
                rebuilt.extend(group)
                continue
            if ov.get("source_hash") and ov["source_hash"] != page_hash(group):
                # The OCR changed under an existing edit. The human read the
                # scan and the model did not, so the edit still wins — but say
                # so, or new upstream text is masked silently.
                stale_pages.append(pno)
            rebuilt.extend(text_to_page(ov["body"], pno))
        s = {**s, "chunks": rebuilt}
        for i, c in enumerate(s["chunks"], 1):
            imgs = images_of(c)
            if imgs:
                # An illustration. `cgitem` already exists in the nodes type
                # CHECK for exactly this — a non-dialogue visual — so the book's
                # plates need no schema of their own. The sha1 is the same
                # convention every other asset uses (sha1 of the data/-relative
                # path), which means it can be computed here without the upload
                # having happened yet.
                sha1s = [hashlib.sha1(f"book-images/{f}".encode("utf-8")).hexdigest()
                         for f in imgs]
                caps = captions_of(c, len(imgs))
                node_rows.append({
                    "chapter_id": cid,
                    "seq": i,
                    "type": "cgitem",
                    "speaker": None,
                    "content": None,
                    "raw_params": {
                        "page": c["page"], "source": "mineru",
                        "kind": c.get("kind"),
                        # `image`/`image_sha1` stay as the first of the row so
                        # anything reading the single-file fields keeps working;
                        # `images`/`image_sha1s` carry the whole row.
                        "image": imgs[0], "image_sha1": sha1s[0],
                        **({"images": imgs, "image_sha1s": sha1s}
                           if len(imgs) > 1 else {}),
                        # The plate's printed label. MinerU nests it under the
                        # image block, so it belongs to the illustration rather
                        # than to the surrounding prose. `captions` carries one
                        # label per image when the row is labelled individually.
                        **({"caption": caps[0]} if len(caps) == 1 and caps[0] else {}),
                        **({"captions": caps} if len(caps) > 1 else {}),
                        # Belongs to an inserted block, so the reader indents it
                        # under the same rule as the block's prose instead of
                        # running it full-width through the main flow.
                        **({"aside": True} if c.get("aside") else {}),
                        # First chunk of its block. Without this two blocks
                        # that happen to be adjacent render as one.
                        **({"aside_start": True} if c.get("aside_start") else {}),
                    },
                })
                continue
            node_rows.append({
                "chapter_id": cid,
                "seq": i,
                "type": "subtitle",          # plain display text, not dialogue
                "speaker": "narrator",
                "content": c["text"],
                # seq is paragraph order; the printed page lives here or nowhere.
                "raw_params": {"page": c["page"], "source": "mineru",
                               **({"heading": True} if c.get("heading") else {}),
                               **({"level": c["level"]} if c.get("level") else {}),
                               **({"aside": True} if c.get("aside") else {}),
                               **({"aside_start": True} if c.get("aside_start") else {})},
            })

    done = 0
    for i in range(0, len(node_rows), CHUNK):
        _execute(db.table("nodes").insert(node_rows[i:i + CHUNK]), "insert nodes")
        done += len(node_rows[i:i + CHUNK])
        log.info(f"    inserted {done}/{len(node_rows)} paragraph(s)")
    if stale_pages:
        log.warning(f"  {len(stale_pages)} overridden page(s) whose OCR has since "
                    f"changed — the edit still wins, but review: {sorted(stale_pages)[:10]}")
    log.info("done")


if __name__ == "__main__":
    main()
