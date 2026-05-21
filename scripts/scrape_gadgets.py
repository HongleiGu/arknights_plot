"""
Scrape the 集成战略 (Integrated Strategies) gadget catalogs from prts.wiki and
write them into data/gadgets.json, the same hand-curated-shaped file that
scripts/import_gadgets.py already upserts into the `gadgets` table.

Why a scraper now: every IS theme publishes its *complete, finite* collectible
catalog on the wiki (e.g. 刻俄柏的灰蕈迷境/收藏品图鉴). That is exactly the
"fixed set per theme" the gadget layer wants — typing it by hand was the old
plan; scraping it is idempotent and complete.

Architecture
------------
* `CATALOGS` — a declarative per-theme list of `CatalogSpec(theme, subpage,
  kind, parser)`. Each IS theme *reskins* its relic catalog under a different
  wiki subpage name, so this map is intrinsic and hand-maintained (6 themes).
* `PARSERS` — a registry keyed by a parser-variant string. Adding a new catalog
  type (squads, the 诡意行商 trader, …) = write one parser fn + add CatalogSpec
  rows. No harness rework. Stubs raise NotImplementedError with a layout note.
* The scraper holds NO Supabase client — it is pure scrape → file.
  `import_gadgets.py` stays the sole DB writer, so a scrape failure never
  touches the DB.

Output shape (per `data/gadgets.example.json`, read by import_gadgets.py):

    [ { "category": "集成战略", "story": "<theme>",
        "gadgets": [ { "kind", "name", "name_en", "description", "effect",
                       "icon_sha1", "seq", "raw" }, … ] }, … ]

`kind`: non-刻俄柏 themes group relics under section headings like
"No.059-143 斗争之物" — the trailing label (斗争之物, 生存助力, 专业工具, …)
becomes the per-relic `kind`. 刻俄柏 is a flat list → the CatalogSpec fallback
kind ("relic"). UNIQUE(story_id, kind, name) still holds.

`icon_sha1`: each relic icon is downloaded to
data/gadget-icons/<theme>/<wiki-basename> and icon_sha1 = sha1 of that
data/-relative path (matching upload_story_images.sha1_for). Two CDNs are
handled (media.prts.wiki thumbs / torappu.prts.wiki). scripts/
upload_gadget_icons.py pushes the files to Storage at gadget-icons/<sha1>.png
(URL via src/lib/storage.ts `gadgetIconUrl`). `--no-icons` skips the download
(icon_sha1 stays null, raw.icon_filename still recorded).

Idempotency
-----------
A theme's items for a given parser carry `raw.parser == spec.parser`. A run
skips a (theme, parser) already present unless `--force`; otherwise it replaces
only that theme's items *of that parser*, preserving items contributed by other
parsers/kinds for the same theme. Re-runs are byte-stable (seq from wiki No.).

Usage
-----
    python scripts/scrape_gadgets.py                       # all catalogs
    python scripts/scrape_gadgets.py --kind relic          # only relics
    python scripts/scrape_gadgets.py --theme 岁的界园志异    # one theme
    python scripts/scrape_gadgets.py --force               # ignore cache
    python scripts/scrape_gadgets.py --no-icons            # skip icon download
    python scripts/scrape_gadgets.py --dry-run             # scrape, write
                                                           # gadgets_scrape.json
                                                           # only (no gadgets.json)

Dependencies: stdlib only (urllib/ssl/re/json) — no bs4, matching the regex
style of scrape_story_pages.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import ssl
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ROOT       = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
GADGETS_JSON = DATA_DIR / "gadgets.json"          # consumed by import_gadgets.py
DEBUG_JSON   = DATA_DIR / "gadgets_scrape.json"   # per-theme scrape metadata

# Gadget icons land under their own tree, one dir per theme:
#   data/gadget-icons/<theme>/<wiki-image-basename>
# Deliberately NOT under data/img/ — upload_story_images.py rglobs data/img/
# and would warn on every file. icon_sha1 = sha1 of the data/-relative path
# (the exact convention upload_story_images.sha1_for uses), so an uploader
# pushes each file to Storage at gadget-icons/<sha1>.png (src/lib/storage.ts).
GADGET_ICON_REL = Path("gadget-icons")

API_URL = "https://prts.wiki/api.php"
SSL_CTX = ssl._create_unverified_context()

MAX_RETRIES   = 4
RETRY_BACKOFF = 2.0
DELAY         = 0.5
ICON_DELAY    = 0.15   # courtesy gap between icon downloads (CDN, lighter)
TIMEOUT       = 60

CATEGORY = "集成战略"

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Network (same retry/backoff idiom as scrape_story_pages.py)
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


def api(params: dict) -> dict:
    url = API_URL + "?" + urllib.parse.urlencode(params)
    return json.loads(_urlopen(url).decode("utf-8"))


def fetch_rendered_html(page_title: str) -> str | None:
    """Rendered HTML of a wiki page via action=parse. None if the page is
    missing (recorded per-theme, never aborts the run)."""
    d = api({
        "action": "parse", "page": page_title, "prop": "text",
        "format": "json", "formatversion": "2",
    })
    if "error" in d:
        return None
    return d.get("parse", {}).get("text")


# ---------------------------------------------------------------------------
# HTML text helpers (parse_description idiom from scrape_story_pages.py)
# ---------------------------------------------------------------------------

RE_TAG = re.compile(r"<[^>]+>")


def clean(html_fragment: str | None) -> str | None:
    """<br> → \\n, strip tags, trim, drop empty lines. None if empty."""
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


def sha1_for(rel_path: Path) -> str:
    """SHA1 of the data/-relative path string, forward-slashed. Identical to
    upload_story_images.sha1_for so a future uploader pushes the file to
    Storage at gadget-icons/<sha1>.png."""
    return hashlib.sha1("/".join(rel_path.parts).encode("utf-8")).hexdigest()


# The relic icon is the FIRST <img> in a block: row order puts the icon cell
# before the price-currency img and the (img-less) effect cell. Two CDNs are
# in play — media.prts.wiki (thumb URL; full-res in the srcset 2x entry) and
# torappu.prts.wiki (protocol-relative, already full-res).
RE_FIRST_IMG = re.compile(r"<img\b[^>]*>")
RE_SRC       = re.compile(r'\bsrc="([^"]+)"')
RE_SRCSET    = re.compile(r'\bsrcset="([^"]+)"')


def icon_url_from_block(block: str) -> str | None:
    m = RE_FIRST_IMG.search(block)
    if not m:
        return None
    img = m.group(0)
    candidates: list[str] = []
    s = RE_SRC.search(img)
    if s:
        candidates.append(s.group(1))
    ss = RE_SRCSET.search(img)
    if ss:
        candidates += [p.strip().split(" ")[0]
                       for p in ss.group(1).split(",") if p.strip()]

    pick = next((u for u in candidates if "/thumb/" not in u), None)
    if pick is None and candidates:
        # Derive the original from a /thumb/a/bc/Name.ext/123px-Name.ext URL.
        u = candidates[0]
        base, _, query = u.partition("?")
        dm = re.match(r"(https?:)?(//[^/]+)/thumb/(.+/[^/]+?\.\w+)/[^/]+$",
                      base, re.I)
        pick = (f"{dm.group(1) or 'https:'}{dm.group(2)}/{dm.group(3)}"
                + (f"?{query}" if query else "")) if dm else u
    if not pick:
        return None
    if pick.startswith("//"):
        pick = "https:" + pick
    return pick


def download_icon(block: str, theme: str, *, enabled: bool
                   ) -> tuple[str | None, str | None]:
    """Download the relic icon into data/img/集成战略/<theme>/<name> (skip if
    already present) and return (icon_sha1, icon_filename). Failures are
    non-fatal — return (None, filename|None)."""
    url = icon_url_from_block(block)
    if not url:
        return None, None
    filename = urllib.parse.unquote(
        Path(urllib.parse.urlparse(url).path).name)
    if not filename:
        return None, None

    rel = GADGET_ICON_REL / theme / filename
    if not enabled:
        return None, filename

    dst = DATA_DIR / rel
    try:
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            data = _urlopen(url)
            if not data:
                raise RuntimeError("empty body")
            dst.write_bytes(data)
            time.sleep(ICON_DELAY)
        return sha1_for(rel), filename
    except Exception as e:
        log.warning(f"  icon download failed ({filename}): "
                    f"{type(e).__name__}: {e}")
        return None, filename


# ---------------------------------------------------------------------------
# Catalog config + parser registry
# ---------------------------------------------------------------------------

@dataclass
class CatalogSpec:
    theme: str       # == stories.name == data/plots/集成战略/<folder>
    subpage: str     # full wiki page = f"{theme}/{subpage}"
    kind: str        # gadgets.kind FALLBACK — modern-relic overrides this
                     # per block with the relic's sub-category (斗争之物 …);
                     # the fallback is used for flat themes (刻俄柏) / when no
                     # sub-category heading applies.
    parser: str      # PARSERS key

    @property
    def page_title(self) -> str:
        return f"{self.theme}/{self.subpage}"


# Each modern theme reskins the relic catalog under a different subpage name.
# IS1 (傀影与猩红孤钻) uses an older, structurally different page.
CATALOGS: list[CatalogSpec] = [
    CatalogSpec("刻俄柏的灰蕈迷境", "收藏品图鉴",   "relic",  "modern-relic"),
    CatalogSpec("萨卡兹的无终奇语", "想象实体图鉴", "relic",  "modern-relic"),
    CatalogSpec("探索者的银凇止境", "仪式用品索引", "relic",  "modern-relic"),
    CatalogSpec("水月与深蓝之树",   "生物制品陈设", "relic",  "modern-relic"),
    CatalogSpec("岁的界园志异",     "珍玩集册",     "relic",  "modern-relic"),
    CatalogSpec("傀影与猩红孤钻",   "猩红珍藏",     "relic",  "is1-relic"),
    # ---- special relics (手记/研究/藏钱木盒 pages, same wikitable logo layout) ----
    # Uses "special-relic" parser key so idempotency is tracked separately from
    # the main relic catalog (same theme, different subpage, different parser slot).
    CatalogSpec("萨卡兹的无终奇语", "佚散思维辑录", "特殊藏品", "special-relic"),
    CatalogSpec("探索者的银凇止境", "密文板研究",   "特殊藏品", "special-relic"),
    CatalogSpec("岁的界园志异",     "藏钱木盒",     "特殊藏品", "special-relic"),
    # ---- ready-to-fill slots (write the parser, then uncomment specs) ----
    # squads:  傀影/小队编队 · 月度小队 ; modern themes /分队 etc. (kind="squad")
    # trader:  <theme>/诡意行商 (small plain wikitable, all themes; kind="other")
]

Parser = Callable[..., list[dict]]   # (html, spec, *, download_icons) -> rows
PARSERS: dict[str, Parser] = {}


def register(name: str):
    def deco(fn: Parser) -> Parser:
        PARSERS[name] = fn
        return fn
    return deco


def _gadget(spec: CatalogSpec, *, kind: str, name: str, seq: int,
            effect: str | None, description: str | None,
            icon_sha1: str | None, raw: dict) -> dict:
    """Build a row in the exact shape import_gadgets.py reads. Every parser
    must stamp raw['parser'] — it is the incremental-fill / idempotency key."""
    raw = {k: v for k, v in raw.items() if v is not None}
    raw["parser"] = spec.parser
    return {
        "kind": kind,
        "name": name,
        "name_en": None,
        "description": description,
        "effect": effect,
        "icon_sha1": icon_sha1,
        "seq": seq,
        "raw": raw,
    }


# ---- modern relic layout: 收藏品图鉴 / 想象实体图鉴 / 仪式用品索引 / … --------
#
# Each relic is one <table class="wikitable logo">…</table> with:
#   <tr><th>No.N</th><th colspan=2>NAME</th></tr>
#   <tr><td rowspan=N>ICON</td> [<th>售价</th>] <th colspan=2>效果</th></tr>
#   <tr> [<td>PRICE</td>] <td><b>EFFECT</b><br><i>FLAVOUR</i></td></tr>
#   <tr><th>解锁条件</th><td>…</td></tr>  (and/or 获取方式, optional, repeats)
# 售价 (price) is absent for free relics. The icon/price/effect cells never
# carry a <th>label</th><td>value</td> shape, so labelled rows below extract
# cleanly without catching the header/value rows.

# Non-刻俄柏 modern themes group relics under section headings whose text is
# "No.059-143 斗争之物" / "编号.048-125 斗争之物" — the trailing label is the
# relic sub-category, used as `kind`. 刻俄柏 has no such headings (flat list →
# fallback kind). The 收藏品导航 nav heading has no range and no blocks.
RE_HEADLINE = re.compile(
    r'<span class="mw-headline"[^>]*>([^<]+)</span>')
RE_SUBCAT   = re.compile(
    r'^(?:No|编号)\.\s*\d+\s*[-–—~]\s*\d+\s+(.+?)\s*$')

RE_LOGO_BLOCK = re.compile(r'<table class="wikitable logo"[\s\S]*?</table>')
RE_NO_NAME    = re.compile(r'No\.\s*(\d+)\s*</th>\s*<th[^>]*>([\s\S]*?)</th>')
RE_EFFECT_TD  = re.compile(r'<td[^>]*>((?:(?!</td>)[\s\S])*?<b>[\s\S]*?)</td>')
RE_FLAVOUR    = re.compile(r'<i>([\s\S]*?)</i>')
RE_PRICE      = re.compile(r'售价[\s\S]*?<span[^>]*>\s*([\d,]+)\s*</span>')
RE_LABEL_ROW  = re.compile(
    r'<th[^>]*>\s*([^<]+?)\s*</th>\s*<td[^>]*>([\s\S]*?)</td>')

# Chinese label → raw key for the well-known rows.
_LABEL_KEY = {"解锁条件": "unlock", "获取方式": "acquire", "售价": "price"}


def _subcat_boundaries(html: str) -> list[tuple[int, str | None]]:
    """[(pos, subcat|None)] for each section heading, in document order.
    None = a heading that is not a relic sub-category (e.g. 收藏品导航)."""
    out = []
    for m in RE_HEADLINE.finditer(html):
        sm = RE_SUBCAT.match(m.group(1).strip())
        out.append((m.start(), sm.group(1) if sm else None))
    return out


def _kind_at(pos: int, bounds: list[tuple[int, str | None]],
             fallback: str) -> str:
    """Sub-category of the nearest heading before `pos`, else the fallback."""
    sub = None
    for hpos, hsub in bounds:
        if hpos <= pos:
            sub = hsub
        else:
            break
    return sub or fallback


@register("modern-relic")
def parse_modern_relic(html: str, spec: CatalogSpec, *,
                        download_icons: bool = True) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    skipped = collisions = 0
    bounds = _subcat_boundaries(html)

    for bm in RE_LOGO_BLOCK.finditer(html):
        block = bm.group(0)
        m = RE_NO_NAME.search(block)
        if not m:                       # not a relic detail block (e.g. a
            skipped += 1                # decorative logo table) — skip + count
            continue
        wiki_no = int(m.group(1))
        # The name <th> may carry a trailing absolutely-positioned <div>
        # tooltip badge (e.g. 【内容拓展·Ⅱ】加入的收藏品) — the real name is
        # the leading text node, so cut at the first nested <div>.
        name = clean(re.split(r"<div\b", m.group(2), maxsplit=1)[0])
        if not name:
            skipped += 1
            continue
        if name in seen:
            collisions += 1
            log.warning(f"  [{spec.theme}] duplicate relic name "
                        f"{name!r} (No.{wiki_no}) — keeping first")
            continue
        seen.add(name)

        # effect + flavour live in the one <td> that contains <b>.
        effect = description = None
        em = RE_EFFECT_TD.search(block)
        if em:
            cell = em.group(1)
            fm = RE_FLAVOUR.search(cell)
            if fm:
                description = clean(fm.group(1))
                cell = cell[:fm.start()] + cell[fm.end():]
            effect = clean(cell)

        icon_sha1, icon_filename = download_icon(
            block, spec.theme, enabled=download_icons)

        raw: dict = {"wiki_no": wiki_no, "icon_filename": icon_filename}

        pm = RE_PRICE.search(block)
        if pm:
            raw["price"] = pm.group(1).replace(",", "")

        for label, value in RE_LABEL_ROW.findall(block):
            key = _LABEL_KEY.get(label, label)
            val = clean(value)
            if val is not None:
                raw[key] = val

        kind = _kind_at(bm.start(), bounds, spec.kind)
        out.append(_gadget(spec, kind=kind, name=name, seq=wiki_no,
                            effect=effect, description=description,
                            icon_sha1=icon_sha1, raw=raw))

    if skipped or collisions:
        log.info(f"  [{spec.theme}] skipped {skipped} non-relic block(s), "
                 f"{collisions} duplicate(s)")
    kinds: dict[str, int] = {}
    for g in out:
        kinds[g["kind"]] = kinds.get(g["kind"], 0) + 1
    _SCRAPE_META.setdefault(spec.theme, {})[spec.parser] = {
        "page": spec.page_title, "parser": spec.parser,
        "item_count": len(out), "skipped": skipped, "collisions": collisions,
        "kinds": kinds,
        "icons": sum(1 for g in out if g["icon_sha1"]),
    }
    return out


RE_FIRST_TR    = re.compile(r'<tr>([\s\S]*?)</tr>', re.I)
RE_TH_COLSPAN2 = re.compile(
    r'<th\b[^>]*colspan=["\']?2["\']?[^>]*>([\s\S]*?)</th>', re.I)
RE_DIV_FLAVOUR = re.compile(r'<div\b[^>]*>([\s\S]*?)</div>', re.I)


@register("special-relic")
def parse_special_relic(html: str, spec: CatalogSpec, *,
                        download_icons: bool = True) -> list[dict]:
    """Special relic pages (佚散思维辑录 / 密文板研究 / 藏钱木盒).
    Same wikitable logo blocks but without No.N numbering.
    Name: last <th colspan=2> in header row, nested <div> stripped.
    Icon: first <img> after the header row (skips currency icons in header).
    Flavour: <i> fallback to <div> (岁 uses <div> instead of <i>)."""
    out: list[dict] = []
    seen: set[str] = set()
    skipped = collisions = 0
    bounds = _subcat_boundaries(html)
    seq = 1

    for bm in RE_LOGO_BLOCK.finditer(html):
        block = bm.group(0)

        hm = RE_FIRST_TR.search(block)
        if not hm:
            skipped += 1
            continue
        header = hm.group(1)

        # Name: last <th colspan=2> in header, strip nested tooltip <div>
        th_matches = RE_TH_COLSPAN2.findall(header)
        if not th_matches:
            skipped += 1
            continue
        name = clean(re.split(r"<div\b", th_matches[-1], maxsplit=1)[0])
        if not name:
            skipped += 1
            continue
        if name in seen:
            collisions += 1
            log.warning(f"  [{spec.theme}] duplicate special relic "
                        f"{name!r} — keeping first")
            continue
        seen.add(name)

        # Icon: first <img> in body rows (after the header <tr>)
        after_header = block[hm.end():]
        icon_sha1, icon_filename = download_icon(
            after_header, spec.theme, enabled=download_icons)

        # Effect + flavour: <td> containing <b>
        effect = description = None
        em = RE_EFFECT_TD.search(block)
        if em:
            cell = em.group(1)
            # <i> first, then <div> fallback (岁 uses <div> for flavour)
            fm = RE_FLAVOUR.search(cell)
            if fm:
                description = clean(fm.group(1))
                cell = cell[:fm.start()] + cell[fm.end():]
            else:
                dm = RE_DIV_FLAVOUR.search(cell)
                if dm:
                    description = clean(dm.group(1))
                    cell = cell[:dm.start()] + cell[dm.end():]
            effect = clean(cell)

        raw: dict = {"icon_filename": icon_filename}
        for label, value in RE_LABEL_ROW.findall(block):
            key = _LABEL_KEY.get(label, label)
            val = clean(value)
            if val is not None:
                raw[key] = val

        kind = _kind_at(bm.start(), bounds, spec.kind)
        out.append(_gadget(spec, kind=kind, name=name, seq=seq,
                           effect=effect, description=description,
                           icon_sha1=icon_sha1, raw=raw))
        seq += 1

    if skipped or collisions:
        log.info(f"  [{spec.theme}] skipped {skipped} non-special block(s), "
                 f"{collisions} duplicate(s)")
    kinds: dict[str, int] = {}
    for g in out:
        kinds[g["kind"]] = kinds.get(g["kind"], 0) + 1
    _SCRAPE_META.setdefault(spec.theme, {})[spec.parser] = {
        "page": spec.page_title, "parser": spec.parser,
        "item_count": len(out), "skipped": skipped, "collisions": collisions,
        "kinds": kinds,
        "icons": sum(1 for g in out if g["icon_sha1"]),
    }
    return out


@register("is1-relic")
def parse_is1_relic(html: str, spec: CatalogSpec, *,
                    download_icons: bool = True) -> list[dict]:
    # 傀影与猩红孤钻/猩红珍藏 does NOT use the modern `wikitable logo` layout.
    # Its collectibles are spread across several reskinned sections
    # (通讯记录仪 / 戏剧彩排 / 留声典藏 / 战术道具箱 / 活页剧目集 …) with a
    # different per-section table shape. Reverse-engineering that reliably is
    # its own task; registered here so the harness/config are complete and
    # the work item is explicit rather than silently missing.
    raise NotImplementedError(
        "IS1 (傀影与猩红孤钻/猩红珍藏) older multi-section layout — TODO. "
        "Sections: 通讯记录仪/戏剧彩排/留声典藏/战术道具箱/活页剧目集. "
        "Not the modern `wikitable logo` shape; needs a dedicated parser.")


# ---------------------------------------------------------------------------
# Merge into data/gadgets.json
# ---------------------------------------------------------------------------

# Per-theme/per-parser scrape stats, written to DEBUG_JSON.
_SCRAPE_META: dict[str, dict] = {}


def load_gadgets_json() -> list[dict]:
    if not GADGETS_JSON.exists():
        return []
    try:
        data = json.loads(GADGETS_JSON.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        log.warning(f"{GADGETS_JSON.name} is not valid JSON — treating as empty")
        return []


def theme_already_done(themes: list[dict], theme: str, parser: str) -> bool:
    for t in themes:
        if t.get("category") == CATEGORY and t.get("story") == theme:
            return any((g.get("raw") or {}).get("parser") == parser
                       for g in t.get("gadgets", []))
    return False


def merge_theme(themes: list[dict], theme: str,
                parser: str, items: list[dict]) -> None:
    """Replace only this theme's items contributed by `parser`; keep items
    from other parsers/kinds for the same theme. Stable order: existing
    non-this-parser items first, then this parser's items by seq."""
    obj = next((t for t in themes
                if t.get("category") == CATEGORY and t.get("story") == theme),
               None)
    if obj is None:
        obj = {"category": CATEGORY, "story": theme, "gadgets": []}
        themes.append(obj)
    kept = [g for g in obj.get("gadgets", [])
            if (g.get("raw") or {}).get("parser") != parser]
    obj["gadgets"] = kept + sorted(items, key=lambda g: (g["seq"], g["name"]))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--theme", help="restrict to one theme (stories.name)")
    p.add_argument("--kind", help="restrict to specs of this kind (relic, …)")
    p.add_argument("--force", action="store_true",
                   help="re-scrape themes already populated for that parser")
    p.add_argument("--dry-run", action="store_true",
                   help="scrape + write gadgets_scrape.json only; "
                        "do NOT touch gadgets.json")
    p.add_argument("--no-icons", action="store_true",
                   help="don't download relic icons (icon_sha1 stays null; "
                        "raw.icon_filename still recorded)")
    args = p.parse_args()

    specs = CATALOGS
    if args.theme:
        specs = [s for s in specs if s.theme == args.theme]
    if args.kind:
        specs = [s for s in specs if s.kind == args.kind]
    if not specs:
        raise SystemExit("no CatalogSpec matches the given --theme/--kind")

    themes = load_gadgets_json()
    processed = skipped = failed = 0

    for spec in specs:
        if not args.force and theme_already_done(themes, spec.theme, spec.parser):
            log.info(f"skip (cached): {spec.theme} [{spec.parser}]")
            skipped += 1
            continue

        log.info(f"→ {spec.page_title}  [{spec.parser}]")
        try:
            html = fetch_rendered_html(spec.page_title)
            if not html:
                raise RuntimeError("page missing or empty")
            items = PARSERS[spec.parser](
                html, spec, download_icons=not args.no_icons)
            if not items:
                raise RuntimeError("parser produced 0 items")
        except NotImplementedError as e:
            log.warning(f"  not implemented: {e}")
            _SCRAPE_META.setdefault(spec.theme, {})[spec.parser] = {
                "page": spec.page_title, "parser": spec.parser,
                "item_count": 0, "errors": [f"NotImplementedError: {e}"]}
            failed += 1
            continue
        except Exception as e:
            log.error(f"  FAILED: {type(e).__name__}: {e}")
            _SCRAPE_META.setdefault(spec.theme, {})[spec.parser] = {
                "page": spec.page_title, "parser": spec.parser,
                "item_count": 0, "errors": [f"{type(e).__name__}: {e}"]}
            failed += 1
            continue

        log.info(f"  {spec.theme}: {len(items)} {spec.kind}(s)")
        if not args.dry_run:
            merge_theme(themes, spec.theme, spec.parser, items)
        processed += 1
        time.sleep(DELAY)

    if not args.dry_run:
        GADGETS_JSON.write_text(
            json.dumps(themes, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
    DEBUG_JSON.write_text(
        json.dumps(_SCRAPE_META, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")

    log.info("---")
    log.info(f"processed = {processed}, skipped = {skipped}, failed = {failed}")
    if args.dry_run:
        log.info(f"DRY RUN — {GADGETS_JSON.name} untouched")
    else:
        log.info(f"wrote → {GADGETS_JSON.relative_to(ROOT)}")
    log.info(f"meta  → {DEBUG_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
