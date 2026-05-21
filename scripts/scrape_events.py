"""
Scrape the 集成战略 random *events* (事件) from prts.wiki <theme>/事件一览
into data/events.json, the file scripts/import_events.py upserts into the
`events` + `event_options` tables (migration 007).

Why a scraper / new shape
-------------------------
The 集成战略 .txt plots only carry each theme's framing + 5 endings — the
per-encounter events are NOT in them. 事件一览 is the only source. Each event
is a shallow decision tree (intro → choices → outcomes; some choices open a
sub-scene with its own choices; some choices are predicate-gated). The linear
node/decision model is deliberately 1-level and AVG-script shaped, so events
get their own shape (same call `gadgets` made). See 007_events.sql.

Wiki structure (reverse-engineered)
-----------------------------------
The page mounts a JS widget but server-renders its data in a hidden
`<div id="IS-event-data-root" data-theme="…">`. Inside, each `scene` div:

    <div class="scene" data-nav="开始|结束|…" data-name="<event>"
         data-ename="" data-etype="<section, only on a section's 1st scene>"
         data-image="Avg_pic_rogue_5_2" data-index="" data-prtsinfo="">
      <div class="sceneText">…narrative…</div>
      <div class="edesc">…legend cross-link, ignored…</div>
      <div class="choose" data-type=".." data-title="<label>" data-icon=".."
           data-dest="<ordinal>" data-subchoose="lab;ord;;lab;ord">
        <div class="desc1">short result</div>
        <div class="desc2"><span class="mdi mdi-help-circle"/> predicate…</div>
      </div> …

* An event = a `data-nav="开始"` scene up to (excluding) the next `开始`.
  `data-name` can repeat for two distinct events (传讯 ×2) — hence the
  start-to-start split, and `seq` in the DB key.
* Within an event the scenes are E[0..m] (E[0] = 开始). A `choose`'s
  `data-dest` is the 1-based ordinal into E (dest "1" → E[1]); the
  destination scene's text is that option's outcome, and that scene's own
  `choose`s become the option's children (the nesting).
* `data-subchoose="天随人愿;4;;不尽人意;7"` = one choice with several
  labelled sub-outcomes → modelled as that option's children.
* `desc2` lead icon: help-circle → it states when the option appears
  (predicate); information/alert → a side note.

The 5 modern themes use the widget layout above (`_parse_widget`).
刻俄柏的灰蕈迷境 uses an older MediaWiki layout (`_parse_wikitable`):
`<h2>` = section, `<h3 id="<event>">` = event; the event's first
`wikitable logo` table holds the intro in its `<th>`, and each inner
`wikitable mw-collapsible` table is one (flat) choice — its `<th>` is the
label + an mc-tooltips span (relic icon + hidden 收藏品名/effect → `note`)
+ the short result, its `<td>` is the outcome. No nesting / predicates in
that layout. `parse_theme` sniffs which and dispatches; both emit the same
shape.

Idempotency: a theme already present in events.json is skipped unless
--force; --force re-scrapes and replaces just that theme's block.

Usage
-----
    python scripts/scrape_events.py                    # all 6 themes
    python scripts/scrape_events.py --theme 岁的界园志异
    python scripts/scrape_events.py --force            # ignore cache
    python scripts/scrape_events.py --dry-run          # write debug only

Dependencies: stdlib only (urllib/ssl/re/json), matching scrape_gadgets.py.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT       = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
EVENTS_JSON = DATA_DIR / "events.json"
DEBUG_JSON  = DATA_DIR / "events_scrape.json"

API_URL = "https://prts.wiki/api.php"
SSL_CTX = ssl._create_unverified_context()

MAX_RETRIES   = 4
RETRY_BACKOFF = 2.0
DELAY         = 0.5
TIMEOUT       = 60
MAX_DEPTH     = 40            # cycle / runaway guard

CATEGORY = "集成战略"
THEMES = [
    "傀影与猩红孤钻", "刻俄柏的灰蕈迷境", "岁的界园志异",
    "探索者的银凇止境", "水月与深蓝之树", "萨卡兹的无终奇语",
]

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Network (same retry/backoff idiom as scrape_gadgets.py)
# ---------------------------------------------------------------------------

def _urlopen(url: str) -> bytes:
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT, context=SSL_CTX) as r:
                return r.read()
        except Exception as e:
            last = e
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"  retry {attempt+1}/{MAX_RETRIES} after {wait:.0f}s "
                        f"({type(e).__name__})")
            time.sleep(wait)
    raise last  # type: ignore[misc]


def fetch_rendered_html(page_title: str) -> str | None:
    url = API_URL + "?" + urllib.parse.urlencode({
        "action": "parse", "page": page_title, "prop": "text",
        "format": "json", "formatversion": "2"})
    d = json.loads(_urlopen(url).decode("utf-8"))
    if "error" in d:
        return None
    return d.get("parse", {}).get("text")


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------

RE_TAG = re.compile(r"<[^>]+>")


def clean(html_fragment: str | None) -> str | None:
    if html_fragment is None:
        return None
    text = re.sub(r"<br\s*/?>", "\n", html_fragment)
    text = RE_TAG.sub("", text)
    text = (text.replace("&amp;", "&").replace("&lt;", "<")
                .replace("&gt;", ">").replace("&quot;", '"')
                .replace("&#160;", " ").replace("&nbsp;", " "))
    lines = [ln.strip() for ln in text.splitlines()]
    out = "\n".join(ln for ln in lines if ln)
    return out or None


def _attrs(open_tag: str) -> dict[str, str]:
    return dict(re.findall(r'(data-[a-z]+|id)="([^"]*)"', open_tag))


RE_SCENE_SPLIT = re.compile(r'(?=<div class="scene")')
RE_SCENE_OPEN  = re.compile(r'<div class="scene"[^>]*>')
RE_SCENETEXT   = re.compile(r'<div class="sceneText"[^>]*>([\s\S]*?)</div>')
RE_CHOOSE_OPEN = re.compile(r'<div class="choose"[^>]*>')
RE_DESC1       = re.compile(r'<div class="desc1"[^>]*>([\s\S]*?)</div>')
RE_DESC2       = re.compile(
    r'<div class="desc2"[^>]*>\s*(?:<span class="(mdi mdi-[a-z-]+)"[^>]*>'
    r'\s*</span>)?([\s\S]*?)</div>')

# ---- 刻俄柏的灰蕈迷境 old wikitable layout --------------------------------
# <h2> = section, <h3 id="<event>"> = event; the event's first
# `wikitable logo` table has the intro in its <th>; each inner
# `wikitable mw-collapsible` table is one (flat) choice: <th> = label +
# option icon + optional <div><b>收藏品</b>effect</div> + short result,
# <td> = the outcome narrative. No nesting / predicates in this layout.
RE_WT_HEAD     = re.compile(
    r'<h([23])\b[^>]*>(?:\s*<span[^>]*></span>)?\s*'
    r'<span class="mw-headline"[^>]*>([^<]+)</span>')
RE_WT_LOGO     = re.compile(r'<table class="wikitable logo"')
RE_WT_TH       = re.compile(r'<th[^>]*>([\s\S]*?)</th>')
RE_WT_TD       = re.compile(r'<td[^>]*>([\s\S]*?)</td>')
RE_WT_CHOICE   = re.compile(
    r'<table class="wikitable mw-collapsible[^"]*"[^>]*>([\s\S]*?)</table>')
# A relic-granting choice carries a <span class="mc-tooltips"> holding the
# relic icon + a hidden tooltip <…><b>收藏品名</b><br/>效果…</…>.
RE_WT_TOOLTIP  = re.compile(
    r'<span class="mc-tooltips">[\s\S]*?</div>\s*</span>\s*</span>')
RE_WT_GRANT    = re.compile(
    r'<b>([^<]+)</b>\s*(?:</span>)?\s*(?:<br\s*/?>\s*)?'
    r'(?:<span[^>]*>)?([\s\S]*?)</span>\s*</div>')
RE_WT_FILEHREF = re.compile(r'<a href="/w/([^"]+)" class="mw-file-description"')


def parse_scene(segment: str) -> dict:
    """One <div class="scene"> … up to the next scene → structured dict."""
    open_tag = RE_SCENE_OPEN.match(segment).group(0)            # type: ignore
    a = _attrs(open_tag)
    st = RE_SCENETEXT.search(segment)
    scene = {
        "name":  a.get("data-name", ""),
        "ename": a.get("data-ename", ""),
        "etype": a.get("data-etype", ""),
        "nav":   a.get("data-nav", ""),
        "image": a.get("data-image", ""),
        "index": a.get("data-index", ""),
        "prtsinfo": a.get("data-prtsinfo", ""),
        "text":  clean(st.group(1)) if st else None,
        "chooses": [],
    }
    # Slice each choose: from its opening tag to the next choose / end.
    starts = [m.start() for m in RE_CHOOSE_OPEN.finditer(segment)]
    for i, s in enumerate(starts):
        chunk = segment[s: starts[i + 1] if i + 1 < len(starts) else len(segment)]
        ca = dict(re.findall(r'(data-[a-z]+)="([^"]*)"',
                             RE_CHOOSE_OPEN.match(chunk).group(0)))   # type: ignore
        d1 = RE_DESC1.search(chunk)
        d2 = RE_DESC2.search(chunk)
        predicate = note = None
        if d2:
            icon, body = d2.group(1) or "", clean(d2.group(2))
            if "help-circle" in icon:
                predicate = body
            else:
                note = body
        scene["chooses"].append({
            "label":     ca.get("data-title") or None,
            "type":      ca.get("data-type") or None,
            "icon":      ca.get("data-icon") or None,
            "dest":      ca.get("data-dest") or "",
            "subchoose": ca.get("data-subchoose") or "",
            "description": clean(d1.group(1)) if d1 else None,
            "predicate": predicate,
            "note":      note,
        })
    return scene


def _dest_index(dest: str, n: int) -> int | None:
    """data-dest is the 1-based ordinal into the event's scene list."""
    if dest and dest.isdigit():
        i = int(dest)
        if 0 < i < n:
            return i
    return None


def build_options(scenes: list[dict], si: int, path: tuple[int, ...]) -> list[dict]:
    """Recursively turn scene `si`'s choices into an event_options subtree."""
    if len(path) > MAX_DEPTH:
        return []
    out: list[dict] = []
    for ci, ch in enumerate(scenes[si]["chooses"]):
        node = {
            "seq": ci,
            "label": ch["label"],
            "description": ch["description"],
            "predicate": ch["predicate"],
            "note": ch["note"],
            "outcome": None,
            "raw": {k: v for k, v in (("type", ch["type"]), ("icon", ch["icon"]),
                                      ("dest", ch["dest"] or None),
                                      ("subchoose", ch["subchoose"] or None))
                    if v},
            "options": [],
        }

        if ch["subchoose"]:
            # "lab;ord;;lab;ord" → each sub-outcome is a child option.
            for k, pair in enumerate(p for p in ch["subchoose"].split(";;") if p):
                bits = pair.split(";")
                sub_label = bits[0] or None
                di = _dest_index(bits[1] if len(bits) > 1 else "", len(scenes))
                child = {"seq": k, "label": sub_label, "description": None,
                         "predicate": None, "note": None, "outcome": None,
                         "raw": {"subnav": sub_label}, "options": []}
                if di is not None and di not in path:
                    child["outcome"] = scenes[di]["text"]
                    child["options"] = build_options(scenes, di, path + (di,))
                elif di is not None:
                    child["outcome"] = scenes[di]["text"]
                    child["raw"]["loop"] = di
                node["options"].append(child)
        else:
            di = _dest_index(ch["dest"], len(scenes))
            if di is not None and di not in path:
                node["outcome"] = scenes[di]["text"]
                node["options"] = build_options(scenes, di, path + (di,))
            elif di is not None:                       # cycle (再来 / loop)
                node["outcome"] = scenes[di]["text"]
                node["raw"]["loop"] = di
            # di is None → terminal: description IS the result text.

        out.append(node)
    return out


# ---------------------------------------------------------------------------
# Theme → list of event dicts
# ---------------------------------------------------------------------------

def parse_theme(html: str) -> tuple[list[dict], dict]:
    """Dispatch on layout. The 5 modern themes server-render the ISEvent
    widget data (`IS-event-data-root`); 刻俄柏的灰蕈迷境 uses the older
    MediaWiki wikitable layout (an <h3> per event, outer `wikitable logo`
    holding the intro + one inner collapsible table per choice). Both paths
    return the same (events, meta) shape."""
    if 'id="IS-event-data-root"' in html:
        return _parse_widget(html)
    if RE_WT_HEAD.search(html) and 'wikitable logo' in html:
        return _parse_wikitable(html)
    raise RuntimeError("unrecognised 事件一览 layout")


def _parse_widget(html: str) -> tuple[list[dict], dict]:
    s = html.find('id="IS-event-data-root"')
    blob = html[s: html.find("<script", s)]

    raw_scenes = [seg for seg in RE_SCENE_SPLIT.split(blob)
                  if seg.startswith('<div class="scene"')]
    scenes = [parse_scene(seg) for seg in raw_scenes]

    # Split into events on every 开始; carry the current section (etype).
    events: list[dict] = []
    cur_section = None
    bounds: list[int] = [i for i, sc in enumerate(scenes) if sc["nav"] == "开始"]
    for ei, start in enumerate(bounds):
        end = bounds[ei + 1] if ei + 1 < len(bounds) else len(scenes)
        E = scenes[start:end]
        # The section divider's etype is on its first scene; it may be this
        # 开始 scene or one already passed — track the latest non-empty.
        for sc in scenes[(bounds[ei - 1] + 1 if ei else 0): start + 1]:
            if sc["etype"]:
                cur_section = sc["etype"]
        head = E[0]
        events.append({
            "category": cur_section,
            "name": head["name"] or None,
            "name_en": head["ename"] or None,
            "intro": head["text"],
            "image": head["image"] or None,
            "seq": ei,
            "raw": {k: v for k, v in (("data_index", head["index"]),
                                      ("prtsinfo", head["prtsinfo"])) if v},
            "options": build_options(E, 0, (0,)),
        })

    def _count(opts):
        return sum(1 + _count(o["options"]) for o in opts)

    meta = {
        "events": len(events),
        "options": sum(_count(e["options"]) for e in events),
        "sections": sorted({e["category"] for e in events if e["category"]}),
        "scenes": len(scenes),
    }
    return events, meta


def _wt_choice(inner: str, seq: int) -> dict:
    """One inner `wikitable mw-collapsible` table → a flat option dict."""
    thm = RE_WT_TH.search(inner)
    tdm = RE_WT_TD.search(inner)
    th = thm.group(1) if thm else ""

    # A choice that grants a 收藏品 carries an mc-tooltips span: icon +
    # hidden <b>name</b><br/>effect. Pull the name/effect into `note`,
    # then drop the whole tooltip so it's out of the label/result text.
    grant = None
    tm = RE_WT_TOOLTIP.search(th)
    if tm:
        gm = RE_WT_GRANT.search(tm.group(0))
        if gm:
            gname, geff = clean(gm.group(1)), clean(gm.group(2))
            grant = f"{gname}：{geff}" if geff else gname
        th = th[:tm.start()] + th[tm.end():]

    # Drop the option-icon image, then label = first line, the rest = result.
    th = re.sub(r"<img[^>]*>", "", th)
    parts = [p for p in (clean(x) for x in re.split(r"<br\s*/?>", th)) if p]
    label = parts[0] if parts else None
    description = "\n".join(parts[1:]) or None

    return {
        "seq": seq,
        "label": label,
        "description": description,
        "predicate": None,
        "note": grant,
        "outcome": clean(tdm.group(1)) if tdm else None,
        "raw": {"grant": grant, "layout": "wikitable"} if grant
               else {"layout": "wikitable"},
        "options": [],
    }


def _parse_wikitable(html: str) -> tuple[list[dict], dict]:
    """刻俄柏的灰蕈迷境/事件一览 — the old MediaWiki layout."""
    heads = list(RE_WT_HEAD.finditer(html))
    events: list[dict] = []
    cur_section = None

    for hi, hm in enumerate(heads):
        level, title = hm.group(1), hm.group(2).strip()
        if level == "2":
            cur_section = title
            continue
        body_end = heads[hi + 1].start() if hi + 1 < len(heads) else len(html)
        body = html[hm.end():body_end]

        lm = RE_WT_LOGO.search(body)
        if lm is None:                       # an <h3> that isn't an event
            continue
        # Intro = the logo table's first <th> (image stripped).
        thm = RE_WT_TH.search(body, lm.start())
        intro = (clean(re.sub(r"<img[^>]*>", "", thm.group(1)))
                 if thm else None)
        fm = RE_WT_FILEHREF.search(thm.group(1)) if thm else None
        image = None
        if fm:
            t = urllib.parse.unquote(fm.group(1))
            image = t.split(":", 1)[1] if ":" in t else t   # drop 文件:/File:

        options = [_wt_choice(m.group(1), i)
                   for i, m in enumerate(RE_WT_CHOICE.finditer(body))]

        events.append({
            "category": cur_section,
            "name": title or None,
            "name_en": None,
            "intro": intro,
            "image": image,
            "seq": len(events),
            "raw": {"layout": "wikitable"},
            "options": options,
        })

    if not events:
        raise RuntimeError("wikitable layout matched but parsed 0 events")

    def _count(opts):
        return sum(1 + _count(o["options"]) for o in opts)

    meta = {
        "events": len(events),
        "options": sum(_count(e["options"]) for e in events),
        "sections": sorted({e["category"] for e in events if e["category"]}),
        "scenes": 0,
        "layout": "wikitable",
    }
    return events, meta


# ---------------------------------------------------------------------------
# events.json merge
# ---------------------------------------------------------------------------

def load_events_json() -> list[dict]:
    if not EVENTS_JSON.exists():
        return []
    try:
        d = json.loads(EVENTS_JSON.read_text(encoding="utf-8"))
        return d if isinstance(d, list) else []
    except json.JSONDecodeError:
        log.warning(f"{EVENTS_JSON.name} invalid JSON — treating as empty")
        return []


def theme_done(themes: list[dict], theme: str) -> bool:
    return any(t.get("category") == CATEGORY and t.get("story") == theme
               and t.get("events") for t in themes)


def merge_theme(themes: list[dict], theme: str, events: list[dict]) -> None:
    obj = next((t for t in themes if t.get("category") == CATEGORY
                and t.get("story") == theme), None)
    if obj is None:
        obj = {"category": CATEGORY, "story": theme, "events": []}
        themes.append(obj)
    obj["events"] = events


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--theme", help="restrict to one theme (stories.name)")
    p.add_argument("--force", action="store_true",
                   help="re-scrape themes already present in events.json")
    p.add_argument("--dry-run", action="store_true",
                   help="scrape + write events_scrape.json only "
                        "(do NOT touch events.json)")
    args = p.parse_args()

    targets = [args.theme] if args.theme else THEMES
    if args.theme and args.theme not in THEMES:
        raise SystemExit(f"unknown theme {args.theme!r}; one of {THEMES}")

    themes = load_events_json()
    meta_all: dict = {}
    processed = skipped = failed = 0

    for theme in targets:
        if not args.force and theme_done(themes, theme):
            log.info(f"skip (cached): {theme}")
            skipped += 1
            continue

        page = f"{theme}/事件一览"
        log.info(f"→ {page}")
        try:
            html = fetch_rendered_html(page)
            if not html:
                raise RuntimeError("page missing or empty")
            events, meta = parse_theme(html)
            if not events:
                raise RuntimeError("parsed 0 events")
        except Exception as e:
            log.error(f"  FAILED: {type(e).__name__}: {e}")
            meta_all[theme] = {"page": page, "events": 0,
                               "errors": [f"{type(e).__name__}: {e}"]}
            failed += 1
            continue

        meta_all[theme] = {"page": page, **meta}
        log.info(f"  {theme}: {meta['events']} events, "
                 f"{meta['options']} options, "
                 f"{len(meta['sections'])} sections")
        if not args.dry_run:
            merge_theme(themes, theme, events)
        processed += 1
        time.sleep(DELAY)

    if not args.dry_run:
        EVENTS_JSON.write_text(
            json.dumps(themes, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
    DEBUG_JSON.write_text(
        json.dumps(meta_all, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")

    log.info("---")
    log.info(f"processed = {processed}, skipped = {skipped}, failed = {failed}")
    log.info(f"{'(dry-run) ' if args.dry_run else ''}meta → "
             f"{DEBUG_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
