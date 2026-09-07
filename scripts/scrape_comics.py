"""
Scrape 泰拉记事社 (terra-historicus.hypergryph.com) comic metadata into
data/comics.json — the file scripts/import_comics.py loads into
`stories` + `chapters` (AP-32).

Why the official site and not the wiki
--------------------------------------
prts.wiki's 「泰拉记事」 page is an archive of the official Weibo account: 67
entries, 4507 characters total, all titles and no bodies. The comics
themselves live on Hypergryph's own site, which serves them through an
undocumented but clean JSON API:

    /api/comic                                     -> every series
    /api/comic/{cid}                               -> metadata + episode list
    /api/comic/{cid}/episode/{eid}                 -> page count + dimensions
    /api/comic/{cid}/episode/{eid}/page?pageNum=N  -> signed CDN image URL

`/api/comic` returns the complete catalogue in one call — page / size / offset
are all accepted and all ignored, so paginating it just re-fetches the same 21
series (which is how a naive loop "finds" 840 comics).

Scope: METADATA ONLY — series, episodes, titles, keywords, cover art. That part
is structured text and needs no OCR, so it lands today and makes the corpus
browsable and citable. Panel text is 4832 images of speech bubbles and is
AP-33; page image URLs are recorded here so that step has nothing to re-discover.

Measured: 21 series, 526 episodes, 4832 pages. The distribution is very uneven —
123罗德岛！？ alone is 339 episodes of 4-panel gags, while the story-bearing
series are 序言组曲, 罗德岛源石记事, A1行动预备组 and 信使安洁莉娜漫游手记.

Idempotency: one page of JSON per run, cheap (about 550 requests), so it always
re-fetches — the same call `scrape_terra_timeline.py` makes, and what makes new
episodes appear under `--sync`.

Usage:
    conda run -n study python scripts/scrape_comics.py
    conda run -n study python scripts/scrape_comics.py --no-pages   # skip image URLs
"""

from __future__ import annotations

import argparse
import json
import logging
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT        = Path(__file__).parent.parent
DATA_DIR    = ROOT / "data"
COMICS_JSON = DATA_DIR / "comics.json"
DEBUG_JSON  = DATA_DIR / "comics_scrape.json"

API  = "https://terra-historicus.hypergryph.com/api"
# The site's chain doesn't verify against this machine's store; every scraper
# here already uses an unverified context for prts.wiki for the same reason.
SSL_CTX = ssl._create_unverified_context()
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

MAX_RETRIES   = 4
RETRY_BACKOFF = 2.0
DELAY         = 0.15
TIMEOUT       = 30

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def get(path: str) -> dict | list | None:
    """GET an API path, retrying transient failures. 404 returns None."""
    url = API + path
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=SSL_CTX) as r:
                return json.loads(r.read().decode("utf-8")).get("data")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:                       # noqa: BLE001
            last = e
        wait = RETRY_BACKOFF * (2 ** attempt)
        log.warning(f"  retry {attempt+1}/{MAX_RETRIES} for {path} "
                    f"after {wait:.0f}s ({type(last).__name__})")
        time.sleep(wait)
    raise RuntimeError(f"GET {path} failed after {MAX_RETRIES} attempts") from last


def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape 泰拉记事社 comic metadata.")
    ap.add_argument("--no-pages", action="store_true",
                    help="skip per-page image URLs (much faster; AP-33 needs them)")
    args = ap.parse_args()

    series = get("/comic") or []
    if not series:
        log.error("/api/comic returned nothing — the API has probably changed")
        return 1
    log.info(f"{len(series)} series")

    out, tot_eps, tot_pages = [], 0, 0
    for s in series:
        cid = s["cid"]
        d = get(f"/comic/{cid}")
        if not d:
            log.warning(f"  {cid}: no detail")
            continue
        episodes = []
        for e in d.get("episodes") or []:
            eid = e["cid"]
            ed = get(f"/comic/{cid}/episode/{eid}") or {}
            infos = ed.get("pageInfos") or []
            pages = []
            if not args.no_pages:
                for n in range(1, len(infos) + 1):
                    p = get(f"/comic/{cid}/episode/{eid}/page?pageNum={n}") or {}
                    if p.get("url"):
                        pages.append({"pageNum": n, "url": p["url"]})
                    time.sleep(DELAY)
            episodes.append({
                "cid": eid,
                "shortTitle": e.get("shortTitle"),
                "title": e.get("title") or ed.get("title"),
                "displayTime": e.get("displayTime"),
                "likes": ed.get("likes"),
                "pageCount": len(infos),
                # Dimensions come free with the episode call and tell AP-33
                # whether a page is a double-page spread before downloading it.
                "pageInfos": infos,
                "pages": pages,
            })
            tot_eps += 1
            tot_pages += len(infos)
            time.sleep(DELAY)

        out.append({
            "cid": cid,
            "title": d.get("title"),
            "subtitle": d.get("subtitle") or None,
            "authors": d.get("authors") or [],
            "keywords": d.get("keywords") or [],
            "introduction": d.get("introduction"),
            # 'left' or 'right' — reading direction, which AP-33 needs to order
            # panels and which cannot be recovered from the images.
            "direction": d.get("direction"),
            "cover": d.get("cover"),
            "updateTime": d.get("updateTime"),
            "episodes": episodes,
        })
        log.info(f"  {cid}  {str(d.get('title'))[:26]:<28} "
                 f"eps={len(episodes):<3} pages={sum(e['pageCount'] for e in episodes)}")
        time.sleep(DELAY)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    COMICS_JSON.write_text(json.dumps({
        "source": "terra-historicus.hypergryph.com",
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "series": out,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # Per-series counts are the layout-change canary, the same role
    # events_scrape.json plays: a series dropping to 0 episodes means the API
    # moved, not that the comic was deleted.
    DEBUG_JSON.write_text(json.dumps({
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "series": len(out), "episodes": tot_eps, "pages": tot_pages,
        "by_series": {c["title"]: sum(e["pageCount"] for e in c["episodes"]) for c in out},
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    log.info(f"{len(out)} series / {tot_eps} episodes / {tot_pages} pages "
             f"→ {COMICS_JSON.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
