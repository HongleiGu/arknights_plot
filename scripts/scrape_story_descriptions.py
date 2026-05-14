"""
Scrape story icons and per-stage descriptions from prts.wiki/w/情报处理室.

The page has two top-level groupings, marked by level-2 headings:
  ==公共事务实录==   → SideStory events  (current DB category=支线)
  ==特别行动记述==   → Story sets        (current DB category=故事集)

Inside each grouping, every story is a block beginning with:
  {{锚点|story_name}}
  {| class="wikitable" ...
  ! ... |<big><big>story_name</big></big>
  ...
  ! ... |[[文件:情报处理室 story_name.png|160px|link=story_name]]
  ...
  {{剧情简介|level_code|level_name|stage|description}}    ← 公共事务实录 only
  {{剧情简介|level_code|level_name|stage|description|链接=...}}
  ...
  |}                                                       ← end of block

特别行动记述 blocks have {{剧情跳转|...}} jump-links instead of {{剧情简介}}.

This script:
  1. Fetches the wikitext via the MediaWiki API.
  2. Parses (category → story → icon, stages[]) into a nested structure.
  3. Downloads each unique icon to  data/story_icons/.
  4. Writes data/story_descriptions.json — full nested data for review.

Run:
    python scripts/scrape_story_descriptions.py
"""

import re
import time
import json
import urllib.parse
import urllib.request
import ssl
from pathlib import Path

API_URL   = "https://prts.wiki/api.php"
PAGE      = "情报处理室"
ROOT      = Path(__file__).parent.parent
ICONS_DIR = ROOT / "data" / "story_icons"
OUT_JSON  = ROOT / "data" / "story_descriptions.json"
DELAY     = 0.4

# prts.wiki ships a cert chain that some Windows Python installs cannot verify.
# urlopen falls back to an unverified context — matches what curl -k does.
SSL_CTX = ssl._create_unverified_context()

MAX_RETRIES = 4
RETRY_BACKOFF = 2.0  # seconds, doubled each retry


CATEGORY_FOR_GROUPING = {
    "公共事务实录": "支线",
    "特别行动记述": "故事集",
}


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _urlopen_retry(url: str) -> bytes:
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=60, context=SSL_CTX) as resp:
                return resp.read()
        except Exception as e:
            last_exc = e
            wait = RETRY_BACKOFF * (2 ** attempt)
            print(f"    retry {attempt+1}/{MAX_RETRIES} after {wait:.0f}s ({e})")
            time.sleep(wait)
    raise last_exc  # type: ignore[misc]


def api_get(params: dict) -> dict:
    url = API_URL + "?" + urllib.parse.urlencode(params)
    return json.loads(_urlopen_retry(url).decode("utf-8"))


def get_wikitext(title: str) -> str:
    d = api_get({
        "action": "query", "prop": "revisions", "titles": title,
        "rvprop": "content", "rvslots": "main", "format": "json",
    })
    for page in d["query"]["pages"].values():
        if "revisions" in page:
            return page["revisions"][0]["slots"]["main"]["*"]
    return ""


def resolve_file_url(filename: str) -> str | None:
    d = api_get({
        "action": "query", "titles": filename,
        "prop": "imageinfo", "iiprop": "url", "format": "json",
    })
    for page in d["query"]["pages"].values():
        ii = page.get("imageinfo", [])
        if ii:
            return ii[0]["url"]
    return None


# ---------------------------------------------------------------------------
# Wikitext parsing
# ---------------------------------------------------------------------------

# {{剧情简介|...}} may continue across newlines if the description contains <br/>.
# Match the whole template lazily — it never nests another {{...}} in practice
# on this page, so a simple non-greedy match against the next `}}` is safe.
RE_JIANJIE     = re.compile(r"\{\{剧情简介\|(.+?)\}\}", re.DOTALL)
RE_ANCHOR      = re.compile(r"\{\{锚点\|([^}|]+)\}\}")
RE_ICON_FILE   = re.compile(
    r"\[\[(?:文件|File):(情报处理室[^\]|]+?\.(?:png|jpg|jpeg|webp))\|",
    re.I,
)
RE_HEADING_L2  = re.compile(r"^==([^=].*?)==\s*$")


def parse_jianjie_body(body: str) -> dict | None:
    """
    Parse the inner pipe-separated args of {{剧情简介|...}}.

    Positional args (1..4): level_code, level_name, stage, description
    Named arg seen: 链接=<link>
    """
    parts = [p.strip() for p in body.split("|")]
    positional = []
    extras = {}
    for p in parts:
        if "=" in p and not p.startswith("http"):
            k, _, v = p.partition("=")
            extras[k.strip()] = v.strip()
        else:
            positional.append(p)

    if len(positional) < 4:
        return None

    return {
        "level_code":  positional[0],
        "level_name":  f"{positional[1]}_{positional[0]}",
        # "stage":       positional[2],
        "description": positional[3],
        "link":        extras.get("链接"),
    }


def parse_page(wikitext: str) -> list[dict]:
    """
    Returns a list of {category, story_name, icon_file, stages: [...]}.

    Walks the page line-by-line, tracking:
      • current_grouping  — set by ==L2 heading==
      • current_story     — set by {{锚点|...}}
      • icon discovery    — only the first 情报处理室 file= inside the block
    """
    results: list[dict] = []
    current_grouping = None
    current_story    = None  # the active dict being filled

    lines = wikitext.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        s    = line.strip()

        # Level-2 heading switches grouping
        m = RE_HEADING_L2.match(s)
        if m:
            heading = m.group(1).strip()
            current_grouping = heading if heading in CATEGORY_FOR_GROUPING else None
            current_story = None
            i += 1
            continue

        if current_grouping is None:
            i += 1
            continue

        # {{锚点|story_name}} opens a new story block
        m = RE_ANCHOR.search(s)
        if m:
            current_story = {
                "category":    CATEGORY_FOR_GROUPING[current_grouping],
                "grouping":    current_grouping,
                "story_name":  m.group(1).strip(),
                "icon_file":   None,
                "icon_path":   None,
                "stages":      [],
            }
            results.append(current_story)
            i += 1
            continue

        if current_story is None:
            i += 1
            continue

        # First [[文件:情报处理室 ...]] inside the block is the section icon
        if current_story["icon_file"] is None:
            mfile = RE_ICON_FILE.search(s)
            if mfile:
                current_story["icon_file"] = f"File:{mfile.group(1).strip()}"

        # {{剧情简介|...}} may span multiple lines if it contains <br/>.
        # Greedy join: if line starts a 剧情简介 but doesn't close on this line,
        # accumulate until we hit `}}`.
        if "{{剧情简介" in s:
            buf = line
            while "}}" not in buf:
                i += 1
                if i >= len(lines):
                    break
                buf += "\n" + lines[i]
            for body in RE_JIANJIE.findall(buf):
                parsed = parse_jianjie_body(body)
                if parsed:
                    current_story["stages"].append(parsed)

        i += 1

    return results


# ---------------------------------------------------------------------------
# Icon download
# ---------------------------------------------------------------------------

def safe_filename(icon_file: str) -> str:
    """File:情报处理室 骑兵与猎人.png → 情报处理室_骑兵与猎人.png"""
    name = icon_file.removeprefix("File:")
    return re.sub(r"[^\w\-.一-鿿·]", "_", name)


def download_icons(stories: list[dict]) -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    seen: dict[str, str | None] = {}

    for st in stories:
        icon_file = st["icon_file"]
        if not icon_file:
            print(f"  WARNING: no icon for {st['story_name']}")
            continue

        if icon_file in seen:
            st["icon_path"] = seen[icon_file]
            continue

        local_name = safe_filename(icon_file)
        local = ICONS_DIR / local_name
        rel = f"story_icons/{local_name}"

        if local.exists():
            print(f"  cached:  {local_name}")
            st["icon_path"] = rel
            seen[icon_file] = rel
            continue

        print(f"  resolving: {icon_file}")
        url = resolve_file_url(icon_file)
        if not url:
            print(f"    WARNING: no URL for {icon_file}")
            seen[icon_file] = None
            continue

        print(f"  downloading: {url}")
        try:
            local.write_bytes(_urlopen_retry(url))
        except Exception as e:
            print(f"    FAILED after retries: {e}")
            seen[icon_file] = None
            continue

        st["icon_path"] = rel
        seen[icon_file] = rel
        time.sleep(DELAY)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"Fetching {PAGE} …")
    wikitext = get_wikitext(PAGE)
    print(f"  ({len(wikitext)} chars)\n")

    print("Parsing …")
    stories = parse_page(wikitext)

    by_cat: dict[str, int] = {}
    total_stages = 0
    for st in stories:
        by_cat[st["category"]] = by_cat.get(st["category"], 0) + 1
        total_stages += len(st["stages"])

    print(f"  Found {len(stories)} stories: " +
          ", ".join(f"{k}={v}" for k, v in by_cat.items()))
    print(f"  Total {total_stages} per-stage description entries.\n")

    # Quick sanity print: first few stories
    for st in stories[:3]:
        print(f"  [{st['category']}] {st['story_name']}  icon={st['icon_file']}"
              f"  stages={len(st['stages'])}")
    if len(stories) > 3:
        print("  …")

    # Write JSON before downloads so a network hang doesn't lose parse work.
    OUT_JSON.write_text(
        json.dumps(stories, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Pre-download JSON written → {OUT_JSON}")

    print("\nDownloading icons …")
    try:
        download_icons(stories)
    finally:
        # Rewrite to capture icon_path values, even on partial completion.
        OUT_JSON.write_text(
            json.dumps(stories, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(f"\nFinal JSON → {OUT_JSON}")
    print(f"Icons      → {ICONS_DIR}")


if __name__ == "__main__":
    main()
