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
# The same marker immediately before an `[[img:…]]` token — i.e. the tail of the
# text segment that precedes one. Image tokens are lifted out of the body before
# blank-line splitting, so the `>> ` in `>> [[img:a.png|图注]]` was left behind
# as a text segment that strips to nothing and is dropped: the marker never
# reached the image, and a plate belonging to an inserted block rendered as a
# full-width illustration in the main flow.
ASIDE_TAIL = re.compile(r"(?:\n|\A)[ \t]*>>[ \t]*\Z")


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
    """Chunks -> the editable text for a page."""
    out = []
    for c in chunks:
        imgs = images_of(c)
        if imgs:
            caps = captions_of(c, len(imgs))
            tail = "".join(f"|{x or ''}" for x in caps) if caps else ""
            # Only the token's first line carries the marker. A caption may span
            # paragraphs, and the token is parsed back atomically before markers
            # are stripped, so a `>> ` on an inner line would end up inside the
            # caption text rather than being removed.
            lead = ">> " if c.get("aside") else ""
            out.append(f"{lead}[[img:{','.join(imgs)}{tail}]]")
        elif c.get("text") and c.get("aside"):
            lvl = c.get("level") or (1 if c.get("heading") else 0)
            head = "#" * min(lvl, 5) + " " if lvl else ""
            out.append("\n".join(">> " + ln
                                 for ln in (head + c["text"]).split("\n")))
        elif c.get("text"):
            lvl = c.get("level") or (1 if c.get("heading") else 0)
            out.append(("#" * min(lvl, 5) + " " if lvl else "") + c["text"])
    return "\n\n".join(out)


def text_to_page(body: str, page: int) -> list[dict]:
    """
    The editable text -> chunks. Inverse of page_to_text.

    `[[img:…]]` tokens are extracted FIRST and treated as atomic, then the text
    between them is split on blank lines. Splitting on blank lines first would
    make a blank line inside a caption end the token, so a caption could never
    be more than one paragraph — and several plate captions in this book are
    two (a measurement line, then a parenthetical).
    """
    chunks: list[dict] = []

    def emit_text(segment: str) -> None:
        for block in re.split(r"\n\s*\n", segment or ""):
            b = block.strip()
            if not b:
                continue
            if ASIDE_LINE.match(b):
                # Strip the marker from every line that carries it, then split
                # the remainder on its own blank lines. A `>> ` line with
                # nothing after it is blank INSIDE the aside but not blank to
                # the outer splitter, so without this an inserted block that
                # contains a heading and a paragraph collapsed into one chunk
                # and the heading rendered as a literal `#`.
                inner = "\n".join(ASIDE_LINE.sub("", ln) for ln in b.split("\n"))
                for sub in re.split(r"\n\s*\n", inner):
                    t = sub.strip()
                    if not t:
                        continue
                    if (hm := HEAD_LINE.match(t)):
                        chunks.append({"page": page, "text": hm.group(2).strip(),
                                       "heading": True, "level": len(hm.group(1)),
                                       "aside": True})
                    else:
                        chunks.append({"page": page, "text": t, "aside": True})
            elif (m := HEAD_LINE.match(b)):
                chunks.append({"page": page, "text": m.group(2).strip(),
                               "heading": True, "level": len(m.group(1))})
            else:
                chunks.append({"page": page, "text": b})

    pos = 0
    for tok in IMG_TOKEN.finditer(body or ""):
        lead = (body or "")[pos:tok.start()]
        # A `>> ` directly before the token marks the plate as part of the
        # inserted block, so take it off the preceding segment rather than
        # letting it strip away unnoticed.
        aside = bool(ASIDE_TAIL.search(lead))
        if aside:
            lead = ASIDE_TAIL.sub("", lead)
        emit_text(lead)
        m = IMG_LINE.match(tok.group(0).strip())
        if m:
            files = [f.strip() for f in m.group(1).split(",") if f.strip()]
            raw = m.group(2)
            caps = [x.strip() or None for x in raw.split("|")] if raw is not None else []
            chunks.append({"page": page, "images": files, "kind": "image",
                           # `image`/`caption` kept alongside the lists so
                           # anything still reading the single-file fields works.
                           "image": files[0] if files else None,
                           "captions": caps,
                           "caption": caps[0] if len(caps) == 1 else None,
                           **({"aside": True} if aside else {})})
        pos = tok.end()
    emit_text((body or "")[pos:])
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


def main() -> None:
    ap = argparse.ArgumentParser(description="Import the 大地巡旅 settings book.")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
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
                               **({"aside": True} if c.get("aside") else {})},
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
