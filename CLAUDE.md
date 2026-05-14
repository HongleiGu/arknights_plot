# arknights-plot

Web app for reading Arknights plot text with annotations. Plot data is scraped from
[prts.wiki](https://prts.wiki) and stored in Supabase. Stack: Next.js (App Router) +
Clerk auth + Supabase (Postgres + Storage).

---

## Reset & re-bootstrap

When the stories/chapter schema changes and you want to wipe content data
without losing `users` / `comments`:

1. Run [supabase/reset.sql](supabase/reset.sql) in the Supabase SQL editor.
   It drops the whole content + correlations + comment_anchors chain in
   dependency order (no `CASCADE`), and drops policies on the preserved
   `users` + `comments` tables so `005_rls.sql` can recreate them.
2. Re-apply migrations `001_core.sql … 005_rls.sql` (in order). `users` and
   `comments` are `CREATE TABLE IF NOT EXISTS`, so their data survives.
3. `python scripts/run_pipeline.py` to repopulate.

## Run the pipeline

```bash
python scripts/run_pipeline.py             # fast, additive (idempotent)
python scripts/run_pipeline.py --force     # wipe data/plots/ + re-scrape + re-import
python scripts/run_pipeline.py --only wiki,upload   # subset
```

**Prereqs**
- `.env.local` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`
- Migrations `001_core.sql` … `005_rls.sql` applied
- Public bucket named **`data`** exists in Supabase Storage

**Steps** (in order):
1. `scrape_plots.py` — only with `--force`, fetches plot `.txt` files into `data/plots/`
2. `parse_plots.py [--force]` — populates `stories` + `chapters` + `scenes`/`nodes`/`branches`. Inserts each story with `name_en = name` as the NOT NULL placeholder.
3. `import_wiki_descriptions.py` — fills `chapter_descriptions` from `data/story_descriptions.json`
4. `scrape_story_pages.py` — for each story, fetches `prts.wiki/w/<story_name>` and extracts `name_en` (the `副标题` field), `description` (first `<div class="poem">` block), and the title image filename (`标题图文件名`). Downloads the title image into the matching `data/img/<grouping>/<story>.<ext>` and stamps `stories.name_en` + `stories.description`. Skips stories whose `description` is already set unless `--force`. Writes `data/story_pages.json` for debugging / cover handling.
5. `upload_story_images.py` — uploads all `<story>.png` / `.jpg` / `_cover.png` / `_icon.png` files under `data/img/` to Storage (non-PNG converted to PNG via Pillow), stamps `stories.{icon,title,cover}_sha1`. When multiple files match the same `(kind, story)` pair, the most recently modified wins — so a fresh JPG from step 4 supersedes an older local PNG.

Each step is idempotent. `--force` only affects `parse_plots` (and triggers the
scrape step). Image assets under `data/img/` and `data/story_descriptions.json`
are NOT touched by `--force` — re-scrape those with
`scripts/scrape_story_descriptions.py` (which writes into `data/story_icons/`)
followed by `scripts/reorg_story_icons.py --apply`.

---

## Data model — universal registry + per-shape extensions

```
stories  (id, category, name, description, image_path, image_source_filename, arc, seq)
   ↑
   referenced by per-content-shape tables:
   - chapters       (text-narrative content — only shape today)
   - tracks         (future, for 主题曲/乐章)
   - is_events      (future, for 集成战略 roguelike)
```

Every browsable piece of content gets a `stories` row regardless of category.
Per-shape tables FK to `stories.id`. New content shapes = new migration, no
changes to the universal layer.

Annotations (`comments`, `correlations`) anchor at any of `story_id` /
`chapter_id` / `node_id` / `branch_node_id`. To support a new anchor type,
add a nullable FK column to `comment_anchors` and extend its CHECK.

### Categories (`stories.category`)

| Category | Content shape | Notes |
|---|---|---|
| 主线 | text-narrative | Main story arcs (黑暗时代·上 …) |
| 支线 | text-narrative | Side stories (51 entries, all have icons + wiki descriptions) |
| 故事集 | text-narrative | Story sets / 微型故事集 (20 entries, icons only) |
| 集成战略 | text-narrative (today) | Roguelike. May need its own shape later. |
| 生息演算 | text-narrative (today) | Reclamation algorithm. May need its own shape later. |
| 四月辑录 | text-narrative | April records |
| 特殊 | text-narrative | Hidden / special |
| 主题曲, 乐章 | not imported yet | Music — will need their own per-shape tables |

---

## Naming history

The schema was renamed once. **Current names:**
- `stories` = top-level registry (one row per event/arc/album/run)
- `chapters` = file-level (one row per parsed .txt)
- `chapters.story_id` → FK to `stories`
- `scenes` / `nodes` / `branch_nodes` / `predicate_branches` use `chapter_id` (not `story_id`)

**Before** the rename (older git history):
- `stories` was file-level (now `chapters`)
- `stories.section` was the event name (now `stories.name`)
- `section_meta` held arc metadata (now folded into `stories`)

---

## Plot file naming

```
data/plots/<category>/<story_name>/<order>_<level_code> <level_name>_<stage>.txt
```

Examples:
- `支线/骑兵与猎人/1_GT-1 日正当中_BEG.txt`      (typical)
- `主线/二次呼吸/10_3-5 呼叫_END.txt`             (chapter-stage code)
- `支线/火蓝之心/1_火蓝之心_剧情.txt`             (no level_code — body is the name)

Stage codes seen: `BEG`, `END`, `NBT`, `ENTRY`, `SP1`, `SP2`, `剧情`, `剧情1`, `剧情2`.
Parser handles all variations — see `split_chapter_fields()` in
[scripts/parse_plots.py](scripts/parse_plots.py).

### Safe filenames vs. real wiki names

`scrape_plots.py:safe_name()` strips Windows-illegal chars (`:` `*` `?` `"` `<` `>` `|`)
from paths so the local cache works on Windows. This means level names like
`6:44P.M.` land on disk as `6_44P.M.`.

To keep the DB holding **real** wiki names, `parse_plots.py` loads
`data/story_descriptions.json` at startup (the 情报处理室 scrape, which
preserves wiki originals intact) and uses it as a `(category, story, level_code)
→ original level_name` lookup. When inserting a `chapters` row, the original
wins; the on-disk-sanitized form is only the fallback for categories the
index page doesn't cover (主线, 集成战略, etc. — which generally don't have
ASCII punctuation in their level names).

The folder names (`stories.name`) are unaffected — none of the observed
story names contain ASCII chars `safe_name` would strip.

### Wiki → DB stage mapping

The wiki uses Chinese stage names; DB rows use file codes:

| wiki | DB stage |
|---|---|
| 行动前 | BEG |
| 行动后 | END |
| 幕间 | NBT (fallback: ENTRY / SP1 / SP2 / 剧情*) |

Unmatched wiki entries are written to `data/wiki_import_unmatched.json` for review.

---

## Image assets — local layout

All per-story images live under `data/img/<category>/<grouping>/`, with up to
three files per story sharing a name stem:

```
data/img/乐章/夏日律动/
  火蓝之心.png            # title splash (logo / main image)
  火蓝之心_cover.png      # wide cover / banner
  火蓝之心_icon.png       # operator-class icon (from 情报处理室 wiki scrape)
```

Not every story has all three. 主线 chapters typically have title + cover (under
`主题曲/<arc>/`). 支线 events typically have all three (under `乐章/<album>/`).
故事集 currently has icon only.

To move newly-scraped icons from `data/story_icons/` into this layout, run
[scripts/reorg_story_icons.py](scripts/reorg_story_icons.py) — one-shot, finds
the right target folder by matching `<story>.png` siblings.

## Supabase Storage

Single public bucket **`data`** for all assets, with one subdirectory per
image kind:

```
data/story-icons/<sha1>.png       ← from <story>_icon.png
data/story-titles/<sha1>.png      ← from <story>.png
data/story-covers/<sha1>.png      ← from <story>_cover.png
```

**SHA1 input** = the path relative to `data/`, e.g.
`img/乐章/夏日律动/火蓝之心_icon.png`. This guarantees uniqueness across
folders without depending on file content.

**Why SHA1**: Supabase Storage rejects `:`, `·`, and some Unicode in object names.
Hashing the relative path produces a safe key. The original filename is
recoverable via filesystem (the local copy is still readable by name).

**DB columns** on `stories`:

| column | kind | full storage URL |
|---|---|---|
| `icon_sha1`  | icon  | `data/story-icons/<sha1>.png` |
| `title_sha1` | title | `data/story-titles/<sha1>.png` |
| `cover_sha1` | cover | `data/story-covers/<sha1>.png` |

The DB stores **only the SHA1** (40 hex chars). Bucket, subdirectory, and
extension are implicit. URL construction lives in
[src/lib/storage.ts](src/lib/storage.ts) — call `storyImageUrl(kind, sha1)`.

---

## Frontend conventions

### Design tokens ([src/app/globals.css](src/app/globals.css))
- Backgrounds: `#0a0c0e` / `#121417` / `#1d1f20` (near-black grays)
- Accent: cyan `#18d1ff` — sourced from `ak.hypergryph.com` (the **corporate** site
  palette, not in-game tactical orange — the corporate site is what we're matching)
- Success: lime `#8fc31f` — also from the corporate site, used for "go"/available states
- Text: `#e8e6e3` → muted `#585858`

### Mixed-script labels
HUD chrome uses Latin-mono + Chinese with `//` dividers:
- `[ INDEX ] // 选择类别`
- `// CHAPTERS · 16`
- `ARKNIGHTS // 明日方舟 · RECORD // 剧情阅览`

Geist Mono is loaded for the Latin labels. Don't drop the slashes — they're a
signature element.

### **JSX gotcha — `//` in text**
JSX parses `//` in children as a JS-style comment and chokes. **Always wrap:**
```tsx
<span>{'//'}</span>     // correct
<span>//</span>         // PARSE ERROR
```

### Layouts (current state)
- Home [src/app/page.tsx](src/app/page.tsx) — category grid with mixed-script labels
- Category [src/app/[category]/page.tsx](src/app/[category]/page.tsx):
  - 主线 → `MainlineGrid` (square aspect cards in 2/3/4-col grid)
  - everything else → `CategoryBrowser` (vertical list, full-size native-aspect icons,
    sinusoidal tilt via `.ark-tilted` for the "loose documents" feel — hover snaps flat)
- Story [src/app/[category]/[story]/page.tsx](src/app/[category]/[story]/page.tsx) —
  chapter cards via `ChapterCard`
- Persistent chrome:
  - `Header` — rhomboid mark, mixed-script wordmark, login chip
  - `StatusStrip` (bottom, decorative) — terminal-style readout with current path

---

## Scraper / network notes

- `scrape_plots.py` and `scrape_story_descriptions.py` both hit prts.wiki.
  Both have retry+backoff (5 attempts, 60s timeout, exponential).
- Scraping is idempotent: existing files are skipped, so re-runs resume cleanly.
- Persistent timeouts after retries usually mean GFW throttling — VPN fixes it.

---

## Open / not done

- **Chapter reader page** — viewing a single chapter's content with comment/correlation
  anchoring UI doesn't exist yet. The DB tables (`nodes`, `comment_anchors`) are ready.
- **主题曲 / 乐章 as a content kind** — currently 乐章 is used as a *grouping folder*
  for 支线 events in `data/img/乐章/<album>/`, not as a separate `stories.category`.
  If we ever want music-track playback or per-album navigation, a new per-shape
  table hanging off `stories.id` is the move.
- **Story-level descriptions** — `stories.description` is mostly NULL. We only
  imported per-chapter descriptions (`chapter_descriptions`), not per-story ones.
- **集成战略 / 生息演算 / 四月辑录** — currently mapped to the text-narrative shape.
  If their content gets weird (roguelike branching, choice trees, etc.), break them
  out into their own per-shape tables.
