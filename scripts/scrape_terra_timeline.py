"""
Scrape prts.wiki 泰拉年表 into data/timeline.json — the dated-event backbone
that scripts/import_timeline.py loads into `timeline_events` (migration 039).

Why this page (AP-27)
---------------------
The entity graph (026 / AP-22) has no time axis: `entity_relations` is
timeless, so "凯尔希和阿米娅是盟友" cannot answer *when*. Events carry time;
entities don't. 泰拉年表 is a curated, cited, community-maintained chronology,
so the time axis can be **scraped rather than inferred** — the same posture as
seed_entities.py deriving characters from nodes.speaker instead of running NER.

It is also a two-for-one: every row is itself an event with a description and
source citations, so this populates the event layer with zero LLM involvement.

Measured on the 2026-09 revision: 890 event rows, 1106 wiki links, 439 unique
chapter references of which 434 (98.9%) resolve against data/plots. The 5
misses are the known `6:44P.M.` colon case that parse_plots.py already handles
via story_descriptions.json.

IMPORTANT — these dates are inferred, not canon
-----------------------------------------------
The page carries its own banner: 以下时间均通过游戏内剧情推测，可能会出现偏差.
Every row is a community reading of the plot, not published setting. That is
why each event keeps `refs` (the citations the wiki itself gives) and why the
UI must present them as sourced claims, never as fact.

Wiki structure
--------------
Headings nest era → century → period:

    ==结晶纴元==  →  ===11世纪===  →  ===='''1096 年'''====

Inside each period is a `{|class="wikitable"`. A `!` header cell carries the
date label and applies to every following data row until the next `!` (which
is what the source's `rowspan="12"` encodes); each data row is one

    |{{并行折叠框|<描述>|<出处 bullet lines>}}

Header labels are a small, enumerable set — 年 / 月 / 月日 / 季节 / 世纪 /
BC years / the pre-Terra TT calendar / plain era names — so `parse_date` maps
them to (year, month, day) plus an explicit `precision`. Sparse and uneven by
nature: 149 rows are year-only, 31 month-only, 112 day-level. Hence
year/month/day columns + precision, never a timestamp.

Citations look like

    * 生于黑夜：[[DM-7 龟裂/BEG|DM-7行动前（前半部分）]]
    * 温米：[[温米#干员档案|干员档案：档案资料三]]
    * [[大地巡旅]]：6.Extra 罗德岛

so a ref keeps the story hint before the colon plus the parsed link. Link
targets classify into chapter (`<level>/<stage>`, incl. the compound
`15-17 “她”/END/SP2` → stage `END_SP2`), milv (`<干员>/干员密录/N`), anchor
(`<page>#<section>`) and plain page. Only chapters resolve to a chapters row;
the rest are kept verbatim so nothing is silently dropped.

Idempotency: one page, one request — this always re-fetches and rewrites, which
is what makes it correct under `run_pipeline.py --sync` (new entries appear as
the wiki gains them). Nothing is wiped; import_timeline.py is replace-all.

Usage
-----
    python scripts/scrape_terra_timeline.py
    python scripts/scrape_terra_timeline.py --dry-run   # debug file only

Dependencies: stdlib only, matching scrape_events.py / scrape_gadgets.py.
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
from datetime import datetime, timezone
from pathlib import Path

ROOT          = Path(__file__).parent.parent
DATA_DIR      = ROOT / "data"
TIMELINE_JSON = DATA_DIR / "timeline.json"
DEBUG_JSON    = DATA_DIR / "timeline_scrape.json"

API_URL = "https://prts.wiki/api.php"
SSL_CTX = ssl._create_unverified_context()
PAGE    = "泰拉年表"

MAX_RETRIES   = 4
RETRY_BACKOFF = 2.0
TIMEOUT       = 60

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Network (same retry/backoff idiom as scrape_events.py)
# ---------------------------------------------------------------------------

def _urlopen(url: str) -> bytes:
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT, context=SSL_CTX) as r:
                return r.read()
        except Exception as e:                      # noqa: BLE001 — retry on anything
            last = e
            wait = RETRY_BACKOFF * (2 ** attempt)
            log.warning(f"  retry {attempt+1}/{MAX_RETRIES} after {wait:.0f}s "
                        f"({type(e).__name__})")
            time.sleep(wait)
    raise last  # type: ignore[misc]


def fetch_wikitext(page_title: str) -> str:
    url = API_URL + "?" + urllib.parse.urlencode({
        "action": "parse", "page": page_title, "prop": "wikitext",
        "format": "json", "formatversion": "2"})
    d = json.loads(_urlopen(url).decode("utf-8"))
    if "error" in d:
        raise RuntimeError(f"wiki error for {page_title}: {d['error']}")
    return d["parse"]["wikitext"]


# ---------------------------------------------------------------------------
# Wikitext helpers
# ---------------------------------------------------------------------------

RE_COMMENT = re.compile(r"<!--.*?-->", re.S)
RE_TAG     = re.compile(r"<[^>]+>")


def strip_markup(s: str) -> str:
    """Comments out, <br> to newline, tags out, entities decoded."""
    s = RE_COMMENT.sub("", s)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = RE_TAG.sub("", s)
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#160;", " "), ("&nbsp;", " ")):
        s = s.replace(a, b)
    return s


def split_top_level(s: str) -> list[str]:
    """
    Split a template body on `|` at nesting depth 0.

    Naive splitting breaks on `[[a|b]]` and nested templates, both of which
    appear in the citation argument.
    """
    parts, buf, depth = [], [], 0
    i = 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ("{{", "[["):
            depth += 1
            buf.append(two); i += 2; continue
        if two in ("}}", "]]"):
            depth -= 1
            buf.append(two); i += 2; continue
        if s[i] == "[" and depth == 0:              # external [url label]
            depth += 1
            buf.append(s[i]); i += 1; continue
        if s[i] == "]" and depth > 0:
            depth -= 1
            buf.append(s[i]); i += 1; continue
        if s[i] == "|" and depth == 0:
            parts.append("".join(buf)); buf = []; i += 1; continue
        buf.append(s[i]); i += 1
    parts.append("".join(buf))
    return parts


def find_templates(text: str, name: str) -> list[tuple[int, str]]:
    """All `{{name|…}}` bodies with their start offset, brace-matched."""
    out: list[tuple[int, str]] = []
    needle = "{{" + name + "|"
    i = 0
    while True:
        i = text.find(needle, i)
        if i < 0:
            return out
        depth, j = 0, i
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1; j += 2; continue
            if text.startswith("}}", j):
                depth -= 1; j += 2
                if depth == 0:
                    break
                continue
            j += 1
        out.append((i, text[i + 2:j - 2]))
        i = j


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

# Stage tokens seen in chapter link targets, incl. the compound END/SP2.
STAGE_RE = re.compile(r"^(?:BEG|END|NBT|ENTRY|SP\d|剧情\d?)(?:/(?:BEG|END|NBT|ENTRY|SP\d))*$")

CN_NUM = {"元": 1}


def _int(s: str) -> int | None:
    m = re.search(r"\d+", s)
    return int(m.group()) if m else None


def parse_period(label: str) -> tuple[int | None, str]:
    """
    A section heading (====…====) to a base year.

    Returns (year, precision_hint). Ranges keep their start year but are
    flagged, so a UI can sort by it without claiming the precision.
    """
    lab = label.strip().strip("'").strip()
    if re.match(r"^\d+\s*年$", lab):
        return _int(lab), "year"
    if re.match(r"^\d+\s*-\s*\d+\s*年$", lab):
        return _int(lab), "range"
    if "未知" in lab:
        return None, "unknown"
    if "世纪" in lab:
        return None, "century"
    return None, "era"


def parse_date(label: str, base_year: int | None) -> dict:
    """
    A row header label to structured date fields.

    The label set is small and fully enumerated from the page (see module
    docstring); anything unrecognised degrades to precision='era' with the
    label preserved rather than being guessed at.
    """
    lab = strip_markup(label).strip()
    out: dict = {"date_label": lab, "year": None, "month": None, "day": None,
                 "precision": "era", "approx": False, "calendar": "terra"}
    if not lab:
        out["precision"] = "unknown"
        return out

    # Pre-Terra TT calendar (TT 197/19/09) — a different reckoning entirely,
    # and the page itself is unsure of the field order, so keep it as a label.
    if lab.startswith("TT"):
        out["calendar"] = "TT"
        return out

    approx = "约" in lab
    bc = "前" in lab and "泰拉纪元前" not in lab and "前文明" not in lab

    m = re.match(r"^(\d+)\s*月\s*(\d+)\s*日", lab)
    if m:
        out.update(year=base_year, month=int(m.group(1)), day=int(m.group(2)),
                   precision="day")
        return out
    m = re.match(r"^(\d+)\s*月$", lab)
    if m:
        out.update(year=base_year, month=int(m.group(1)), precision="month")
        return out
    if re.search(r"(春|夏|秋|冬)季|年初|年末", lab):
        out.update(year=base_year, precision="season")
        return out
    if re.match(r"^\d+\s*-\s*\d+\s*年$", lab):
        out.update(year=_int(lab), precision="range", approx=approx)
        return out
    if re.search(r"世纪", lab):
        out.update(precision="century", approx=approx)
        return out
    if bc:
        y = _int(lab)
        out.update(year=-y if y is not None else None,
                   precision="range" if "~" in lab else "year", approx=True)
        return out
    if lab == "泰拉历元年":
        out.update(year=1, precision="year")
        return out
    m = re.match(r"^(\d+)\s*年", lab)
    if m:
        out.update(year=int(m.group(1)), precision="year", approx=approx)
        return out
    return out


# ---------------------------------------------------------------------------
# Citations
# ---------------------------------------------------------------------------

RE_WIKILINK = re.compile(r"\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]")
RE_EXTLINK  = re.compile(r"\[(https?://[^\s\]]+)\s*([^\]]*)\]")


def classify_target(target: str) -> dict:
    """Split a wiki link target into the most specific shape we can resolve."""
    t = target.strip().replace("_", " ").strip()

    # <干员>/干员密录/N — operator records live under data/plots/干员/<name>/
    m = re.match(r"^(.+?)/干员密录/(\d+)$", t)
    if m:
        return {"kind": "milv", "page": m.group(1).strip(),
                "ordinal": int(m.group(2)), "stage": None, "section": None}

    if "/" in t:
        page, _, rest = t.partition("/")
        if STAGE_RE.match(rest.replace(" ", "")):
            # 15-17 “她”/END/SP2 lands on disk as ..._END_SP2
            return {"kind": "chapter", "page": page.strip(),
                    "stage": rest.replace("/", "_").strip(),
                    "ordinal": None, "section": None}

    if "#" in t:
        page, _, sec = t.partition("#")
        return {"kind": "anchor", "page": page.strip(), "section": sec.strip(),
                "stage": None, "ordinal": None}

    return {"kind": "page", "page": t, "stage": None, "ordinal": None,
            "section": None}


def parse_refs(arg: str) -> list[dict]:
    """
    Parse the citation argument into one ref per link.

    `story_hint` is the text before `：` on the bullet — the wiki's own
    convention (活动名：[[关卡]]) — which is what lets the importer
    disambiguate a level_code that repeats across stories.
    """
    refs: list[dict] = []
    for raw_line in RE_COMMENT.sub("", arg).split("\n"):
        line = raw_line.strip().lstrip("*").strip()
        if not line:
            continue

        # Story hint: plain text before a full-width colon, links stripped so
        # `[[大地巡旅]]：6.Extra` yields the page name rather than markup.
        hint = None
        if "：" in line:
            head = line.split("：", 1)[0]
            head_txt = strip_markup(RE_WIKILINK.sub(r"\1", head)).strip()
            if head_txt and len(head_txt) < 40:
                hint = head_txt

        found = False
        for m in RE_WIKILINK.finditer(line):
            target, label = m.group(1), (m.group(2) or m.group(1))
            ref = classify_target(target)
            ref.update(target=target.strip(), label=strip_markup(label).strip(),
                       story_hint=hint, url=None)
            refs.append(ref)
            found = True
        for m in RE_EXTLINK.finditer(line):
            refs.append({"kind": "external", "page": None, "stage": None,
                         "ordinal": None, "section": None, "target": None,
                         "label": strip_markup(m.group(2)).strip() or m.group(1),
                         "story_hint": hint, "url": m.group(1)})
            found = True

        if not found:
            # A bare textual citation (e.g. "活动名：某段剧情") — keep it, so a
            # row is never silently left uncited.
            txt = strip_markup(line).strip()
            if txt:
                refs.append({"kind": "text", "page": None, "stage": None,
                             "ordinal": None, "section": None, "target": None,
                             "label": txt, "story_hint": hint, "url": None})
    return refs


# ---------------------------------------------------------------------------
# Page walk
# ---------------------------------------------------------------------------

RE_HEADING = re.compile(r"^(={2,4})\s*(.+?)\s*\1\s*$")
RE_HEADER_CELL = re.compile(r"^!(.*)$")


def header_label(line: str) -> str | None:
    """The date label out of a `!` header cell, dropping HTML attributes."""
    cell = line[1:]
    if "|" in cell:
        # `rowspan="9"|12 月 23 日` / `colspan=3| <big>…</big>` — attrs before
        # the last pipe. Header rows can also pack cells with `!!`.
        cell = cell.split("!!")[0]
        head, _, tail = cell.rpartition("|")
        if re.search(r'(rowspan|colspan|style|class)\s*=', head):
            cell = tail
    return strip_markup(cell).strip() or None


def parse_page(wikitext: str) -> list[dict]:
    lines = wikitext.split("\n")
    era = sub = period = None
    base_year, period_precision = None, "era"
    cur_label = ""
    events: list[dict] = []

    for line in lines:
        stripped = line.strip()

        m = RE_HEADING.match(stripped)
        if m:
            level, title = len(m.group(1)), m.group(2)
            title = strip_markup(title).strip().strip("'").strip()
            if level == 2:
                era, sub, period = title, None, None
                base_year, period_precision = None, "era"
            elif level == 3:
                sub, period = title, None
                base_year, period_precision = None, "era"
            else:
                period = title
                base_year, period_precision = parse_period(title)
            cur_label = ""
            continue

        if stripped.startswith("{|"):
            cur_label = ""
            continue

        if stripped.startswith("!"):
            lab = header_label(stripped)
            if lab:
                cur_label = lab
            continue

        for _off, body in find_templates(line, "并行折叠框"):
            args = split_top_level(body)
            # {{并行折叠框|<描述>|<出处>}} — arg0 is the template name.
            desc = strip_markup(args[1]).strip() if len(args) > 1 else ""
            src  = args[2] if len(args) > 2 else ""
            if not desc:
                continue
            date = parse_date(cur_label, base_year)
            # A period heading like "1096 年" is itself the date when the row
            # header only repeats it or names an era.
            if date["year"] is None and base_year is not None:
                date["year"] = base_year
                if date["precision"] == "era":
                    date["precision"] = period_precision
            events.append({
                "seq": len(events) + 1,
                "era": era, "section": sub, "period": period,
                **date,
                "description": desc,
                "refs": parse_refs(src),
            })
    return events


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape prts.wiki 泰拉年表.")
    ap.add_argument("--dry-run", action="store_true",
                    help="write the debug file only, leave timeline.json alone")
    ap.add_argument("--page", default=PAGE, help="override the source page")
    args = ap.parse_args()

    log.info(f"fetching {args.page} …")
    wikitext = fetch_wikitext(args.page)
    log.info(f"  {len(wikitext)} bytes")

    events = parse_page(wikitext)
    if not events:
        log.error("parsed 0 events — the page layout has probably changed")
        return 1

    # Per-precision counts are the layout-change canary, the same role the
    # per-theme counts play in events_scrape.json: a sudden collapse in
    # day/month precision means the header cells stopped parsing.
    by_prec: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    for e in events:
        by_prec[e["precision"]] = by_prec.get(e["precision"], 0) + 1
        for r in e["refs"]:
            by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1

    payload = {
        "source": args.page,
        "source_url": f"https://prts.wiki/w/{urllib.parse.quote(args.page)}",
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        # Carried into the DB and shown in the UI: these dates are the wiki's
        # own inference from the plot, not published setting.
        "disclaimer": "以下时间均通过游戏内剧情推测，可能会出现偏差。",
        "events": events,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DEBUG_JSON.write_text(json.dumps(
        {"scraped_at": payload["scraped_at"], "events": len(events),
         "by_precision": by_prec, "by_ref_kind": by_kind},
        ensure_ascii=False, indent=2), encoding="utf-8")

    log.info(f"events: {len(events)}")
    log.info(f"  precision: {by_prec}")
    log.info(f"  refs:      {by_kind}")

    if args.dry_run:
        log.info("--dry-run: timeline.json not written")
        return 0

    TIMELINE_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info(f"wrote {TIMELINE_JSON.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
