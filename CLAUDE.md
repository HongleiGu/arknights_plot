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
2. Re-apply migrations `001_core.sql … 008_is_text.sql` (in order). `users`
   and `comments` are `CREATE TABLE IF NOT EXISTS`, so their data survives.
3. `python scripts/run_pipeline.py` to repopulate.

## Run the pipeline

```bash
python scripts/run_pipeline.py             # fast, additive (idempotent)
python scripts/run_pipeline.py --force     # wipe data/plots/ + re-scrape + re-import
python scripts/run_pipeline.py --only wiki,upload   # subset
python scripts/run_pipeline.py --only sgad,gadgets  # scrape + import IS gadgets
```

**Prereqs**
- `.env` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`
- Migrations `001_core.sql` … `008_is_text.sql` applied
- Public bucket named **`data`** exists in Supabase Storage

**Steps** (in order):
1. `scrape_plots.py` — only with `--force`, fetches plot `.txt` files into `data/plots/`
2. `parse_plots.py [--force]` — populates `stories` + `chapters` + `scenes`/`nodes`/`branches`. Inserts each story with `name_en = name` as the NOT NULL placeholder.
2a. `scrape_gadgets.py [--force] [--no-icons]` — **force-only** in the pipeline. Scrapes the 集成战略 gadget catalogs from prts.wiki into `data/gadgets.json`. Relic catalogs are fully implemented for the 5 modern themes (each reskins the catalog under a different subpage — see `CATALOGS` in the script); IS1 `傀影与猩红孤钻` and squads/trader are registered parser slots (TODO). For non-刻俄柏 themes the relic **sub-category** (斗争之物 / 生存助力 / 专业工具 / …, from the section headings) becomes `gadgets.kind`; 刻俄柏 is a flat list → `kind='relic'`. Each relic icon is downloaded to `data/gadget-icons/<theme>/<wiki-basename>` and `icon_sha1` set (same sha1 convention as `upload_story_images.py`); `scripts/upload_gadget_icons.py` pushes them to Storage at `gadget-icons/<sha1>.png` (not auto-wired into the pipeline — run it after import). Idempotent via a per-(theme, parser) marker in `gadgets.json` (`raw.parser`); skips themes already populated unless `--force`. Writes `data/gadgets_scrape.json` for debugging.
2b. `import_gadgets.py [--force]` — upserts the gadget catalog (relics/squads/endings/…) from `data/gadgets.json` into `gadgets`. No-op if that file is absent or `[]`. `gadgets.json` is produced by `scrape_gadgets.py`; hand-edits are still respected (the scraper skips already-populated themes without `--force`). See `data/gadgets.example.json` for the shape.
2c. `scrape_events.py [--force]` — **force-only** in the pipeline. Scrapes the 集成战略 random-event decision trees from each theme's `事件一览` into `data/events.json` for **all 6 themes** (287 events / 2484 options). Two layouts, auto-detected: the 5 modern themes hydrate a hidden `IS-event-data-root` widget block (`_parse_widget`, nested trees + predicates); `刻俄柏的灰蕈迷境` uses the older MediaWiki wikitable layout (`_parse_wikitable`, flat — `<h3>` per event, inner collapsible table per choice). Idempotent: skips themes already in `events.json` unless `--force`. Writes `data/events_scrape.json` for debugging (per-theme counts — a sudden 0 flags a layout change). See `data/events.example.json` for the shape.
2d. `import_events.py [--force]` — replace-per-theme load of `data/events.json` into `events` + `event_options` (self-ref tree). No-op if that file is absent. Always wipes a listed theme's events (cascade) then re-inserts — idempotent; events are wholly scrape-sourced (no hand-edits).
2e. `scrape_is_text.py [--force] [--no-import]` — **standalone** (not in the pipeline). Scrapes 集成战略 supplementary text from each theme's archive sub-page into `data/is_text.json`, then calls `import_is_text.py` automatically. Two sections per theme: `遐想交织录` (character dossiers → `kind='character_record'`) and `预言诗篇` (ending epilogue text → `kind='ending_supplement'`). Each `PART` block in the wiki → one `text_chunk` row. Idempotent: skips themes already in `is_text.json` unless `--force`. Writes `data/is_text_scrape.json` for debugging (chunk counts — a sudden 0 flags a layout change). Currently implements **萨卡兹的无终奇语** only (`THEMES` list in the script); add entries for other themes as their archive sub-pages are confirmed. `刻俄柏の灰蕈迷境` has no character records — no entry needed.
3. `import_wiki_descriptions.py` — fills `chapter_descriptions` from `data/story_descriptions.json`
4. `scrape_story_pages.py` — for each story, fetches `prts.wiki/w/<story_name>` and extracts `name_en` (the `副标题` field), `description` (first `<div class="poem">` block), and the title image filename (`标题图文件名`). Downloads the title image into the matching `data/img/<grouping>/<story>.<ext>` and stamps `stories.name_en` + `stories.description`. Skips stories whose `description` is already set unless `--force`. Writes `data/story_pages.json` for debugging / cover handling.
5. `upload_story_images.py` — uploads all `<story>.png` / `.jpg` / `_cover.png` / `_icon.png` files under `data/img/` to Storage (non-PNG converted to PNG via Pillow), stamps `stories.{icon,title,cover}_sha1`. When multiple files match the same `(kind, story)` pair, the most recently modified wins — so a fresh JPG from step 4 supersedes an older local PNG.

Each step is idempotent. `--force` re-runs `parse_plots` from scratch and
triggers the force-only steps (`scrape_plots`, `scrape_gadgets`,
`scrape_events`). To populate gadgets/events on a fast (non-force) run, use
`--only sgad,gadgets` / `--only sevt,events` (`--only` bypasses force-only
gating). Image assets under `data/img/` and `data/story_descriptions.json`
are NOT touched by `--force` — re-scrape those with
`scripts/scrape_story_descriptions.py` (which writes into `data/story_icons/`)
followed by `scripts/reorg_story_icons.py --apply`.

---

## Data model — universal registry + per-shape extensions

```
stories  (id, category, name, description, image_path, image_source_filename, arc, seq)
   ↑
   referenced by per-content-shape tables:
   - chapters       (text-narrative content — dialogue/decisions; 002)
   - gadgets        (集成战略/生息演算 catalog: relics/squads/endings/…; 006)
   - events         (集成战略 random-event decision trees; 007)
   - text_clusters / text_chunks  (集成战略 hand-kept supplementary text; 008)
   - tracks         (future, for 主题曲/乐章)
```

Every browsable piece of content gets a `stories` row regardless of category.
Per-shape tables FK to `stories.id`. New content shapes = new migration, no
changes to the universal layer. **Misc / uncategorized content** needs no
special shape: it's just a bare `stories` row (no cover, maybe a few
`chapters`) — the universal layer already covers it.

Annotations (`comments`, `correlations`) anchor at any of `story_id` /
`chapter_id` / `node_id` / `gadget_id` / `event_id` / `event_option_id`. To
support a new anchor type, add a nullable FK column to `comment_anchors` (+
`correlation_members`) and extend its CHECK — see `006_gadgets.sql` /
`007_events.sql`, which ALTER both after the fact rather than renumbering
`004`.

**Events** (`007`): 集成战略 per-encounter events (事件) — NOT in the parsed
`.txt` (those hold only each theme's framing + 5 endings); the wiki
`事件一览` page is the sole source. An event is a shallow decision tree —
`events` (one row per event; `UNIQUE(story_id, name, seq)` because a theme
can ship two same-named events) + `event_options`, a **self-referencing**
tree (`parent_option_id` NULL = a top-level choice; set = a choice inside the
sub-scene the parent opened — handles the 同心-style 2-level events). It does
NOT reuse the linear `nodes`/`decisions` model, which is deliberately 1-level
(`no_decision_in_branch`) and AVG-script shaped. `scrape_events.py` →
`data/events.json` → `import_events.py` (replace-per-theme, idempotent).
`predicate` = a `desc2` that gates when the option appears; `note` = an
info/alert `desc2`.

**Gadgets** (`006`): the fixed, finite catalog a 集成战略 / 生息演算 theme
ships with — 藏品 (relic), 分队 (squad), 结局 (ending), 道具 (tool), …. One
`gadgets` row per item, FK → owning `stories` theme, `kind` free-text (no
CHECK — a new gadget class is data, not a migration), `UNIQUE
(story_id, kind, name)` for idempotent upsert. The *narrative + decision*
side of these modes already flows through the text-narrative shape (the
`.txt` exist and parse today); `gadgets` is only the catalog side.
`scrape_gadgets.py` scrapes the catalog from prts.wiki into
`data/gadgets.json`, then `import_gadgets.py` upserts it. Relic catalogs
are done for the 5 modern 集成战略 themes (each reskins the catalog under
a different subpage — `CATALOGS` in `scrape_gadgets.py`); IS1
`傀影与猩红孤钻` (older multi-section layout) and squads / the 诡意行商
trader are registered parser slots — adding one = a parser fn + CatalogSpec
rows, no harness change. Level descriptions are deliberately out of the
gadget layer; endings flow through the text-narrative pipeline, not here.
`data/gadgets.example.json` documents the shape (incl. the scraper's `raw`
keys); `data/gadgets.json` is `[]` until first scraped.

**Supplementary text** (`008`): hand-maintained prose that belongs to a
集成战略 theme but is neither scraped AVG script nor the relic catalog.
Two current `kind` values:
- `ending_supplement` — epilogue chunks for one ending chapter. `level_code`
  matches the corresponding `chapters.level_code` (soft tie; no FK) so the
  chapter reader can look it up. Shown appended to the ending chapter after
  the full narrative (last page only).
- `character_record` — per-character dossier for the theme. `title` = character
  name; `title_en` = optional English name.

Schema: `text_clusters` (story_id FK → stories, kind, title, level_code, seq)
\+ `text_chunks` (cluster_id FK, seq, title, body). A cluster is the chapter-like
grouping; each chunk is its own row (individually addressable — a future
`comment_anchors` widening can add `text_chunk_id` the same way 006/007 added
`gadget_id`/`event_option_id`). No UNIQUE on `text_clusters` — idempotent
import via replace-per-story (delete the story's clusters of the relevant kind,
re-insert), the established `import_events.py` idiom. A new supplementary text
shape = new `kind` value in the JSON + new import handling; no migration needed.

Source: `data/is_text.json` → `python scripts/import_is_text.py`. The JSON shape
is documented in `data/is_text.example.json`. Each chunk is either a plain string
(→ body, no title) or `{ "title": "…", "body": "…" }`. `刻俄柏的灰蕈迷境` has no
character records — simply no rows; no special-casing needed.

**World graph — `entities` + `entity_relations`** (`026`, AP-22): a
cross-cutting knowledge graph (NOT a per-shape table — it doesn't FK to
`stories`). `entities` = one row per character/location/faction/concept/
artefact (`type` free-text, `UNIQUE(type, name)`, `aliases[]`, `summary` +
`summary_status`, `mention_count`, `source_url`). `entity_relations` = typed,
self-referencing edges (`kind` = 所属/盟友/敌对/位于/…) that carry
`source_refs[]` (`@node`/`@chapter`/`@text` citations) so the graph stays
grounded to internal canon, never pretraining. Postgres-native "GraphRAG":
traversal via recursive CTEs, **no Neo4j/Cypher** (see AP-22 for why);
pgvector deferred. P1 seeds the **character** skeleton from who actually
speaks — `python scripts/seed_entities.py` derives characters from distinct
`nodes.speaker` (grounded, idempotent upsert on `(type, name)`; excludes
`narrator`/`？？？`). Later phases enrich (aliases/name_en/summary) and extract
relations with citations. Public read, admin/service-role write.

**Clue board — one node type** (`033`): a board node is **text + an optional
image**, nothing else. Evidence is not pinned as its own node; it's cited
*inside* the node's text as `@type/id` tokens (the AP-2 idiom), rendered by
`CommentMarkdown` as chips with hover previews. Before `033` a member was
either a typed anchor (one of nine FK columns) or a free card, so citing five
lines needed five cards and a guess looked identical to a quote.

Why no `role`/`claim`/`evidence` column: groundedness is **derived** — a node
whose text contains no refs cites nothing, and the card renders it muted. A
flag would have to be set honestly; this can't be faked.

`correlation_member_refs` is the derived citation index (`member_id`,
`correlation_id`, `ref_type`, `ref_id`), maintained by the `sync_member_refs`
trigger on insert/update of `title`/`body`. **Never write it from the app** —
the trigger is the only writer, and it has no client write policy. It is
deliberately generic (indexes any `@word/digits`), so the ref vocabulary lives
in exactly one place, `REF_TYPE_COL` in `lib/references.ts`; an unknown type
simply fails to resolve at read time. AP-13 backlinks read this table, which is
why they survived the rewrite — and improved, since one node citing five things
now yields five backlinks.

Citing a line has to be cheap or nobody grounds anything, so `CiteSearch`
narrows **story → chapter → speaker** before searching, and the results list
pages in on scroll (`searchEntities` takes `limit`/`offset`; "more" is inferred
from a full page rather than a second count query). `speaker` is a hard `eq`
filter, never a scored term — picking 凯尔希 must not surface lines *about* her.
The speaker dropdown comes from `scope_speakers()` (`034`), which groups in the
database; the pre-`034` fallback in `listSpeakers` dedupes client-side and has
to cap the scan, which silently truncated long stories.

Edges carry all the argument structure, so `EDGE_KINDS` (in `BoardEditor.tsx`)
is now argumentative: supports / contradicts / causes / precedes / answers.
The old world-model kinds (same-person / allied / opposed) were dropped — they
duplicate AP-22's `entity_relations`, which carry source citations; a
hand-drawn line doesn't. Board images go to R2 under `board-media/<sha1>` via
`uploadImage(bytes, type, prefix)`, downscaled client-side first by
`lib/downscale.ts` (WebP, longest edge 1600; GIFs pass through untouched so
animation survives).

**RLS gotcha — mutual policy recursion** (`032`): if table A's policy
subqueries table B while B's policy subqueries A, Postgres aborts every read
of either with `42P17 infinite recursion detected in policy for relation …`.
`019` shipped exactly that (`correlations` ↔ `correlation_shares`), which took
down *all* board reads for non-service-role callers — the service role masks it
completely, so it only shows up as a real user. **Rule: a policy must never
subquery a table whose own policy subqueries back.** Put the cross-table lookup
in a `SECURITY DEFINER` helper (exempt from RLS on what it reads) and call that
from the policy — `my_shared_board_ids()` / `my_owned_board_ids()` /
`board_readable()` / `board_editable()`, mirrored for sessions in `030`. Keep
those helpers caller-scoped (resolve the user via `app_uid()` internally, never
take a user id parameter) so they can't be used to enumerate someone else's
access. Quick check for any new sharing table: `GET /rest/v1/<table>?select=id&limit=1`
with the **anon** key — the service role bypasses RLS and will happily return 200
on a table that is fully broken.

**Saved AI sessions — `ai_conversations`** (`030`, AP-20): the assistant used
to be ephemeral (transcript in React state only). A session can now be saved,
linked and shared. `ai_conversations` (owner, title, `visibility`
private/unlisted/public, optional `board_id` context) + `ai_conversation_messages`
(the transcript; `parts` JSONB keeps the tool trace so a shared link replays
exactly what the runner saw — **append-only**, no UPDATE policy) +
`ai_conversation_shares` (viewer/editor). Deliberately the same shape as
`019`'s board sharing, down to `ai_convo_editable()` mirroring `board_editable()`
and `share_ai_convo_by_email()` mirroring `share_board_by_email()` — so
`components/ShareDialog.tsx` serves both. Editors may append turns; only the
owner can rename, change visibility, or manage shares. `board_id` is the
"ask in a board's context" half of AP-20: the route nudges the agent to call
`read_board`, which reads under the **caller's** RLS (AP-19), so anchoring a
session to a board grants a collaborator no access they didn't already have.
UI: `/ai` (list), `/ai/[id]` (replay + continue), save/share from the panel.

**Bring-your-own key — `user_ai_keys`** (`035`, AP-21 revised): this project
isn't commercial, so instead of reselling model access a reader can spend their
own. The key is encrypted **in the app** (AES-256-GCM, `lib/ai/userKey.ts`)
under `AI_KEY_SECRET` and only the ciphertext is stored — deliberately not
pgcrypto, which would mean passing the secret as a SQL argument where it can
surface in query logs. Postgres never sees the plaintext or the secret; losing
`AI_KEY_SECRET` makes every stored key undecryptable, which is the intended
failure mode (a database dump alone is inert). `key_hint` is the last 4 chars,
so the UI can show *which* key is stored without decrypting it, and the
plaintext is never returned to the browser again after saving — not even to its
owner.

Consequences: `ai_can_use()` treats a stored key as its own entitlement (a
BYOK caller doesn't need the allowlist — that gate protects *our* budget), but
`ai_access = 'block'` still wins, since blocking is moderation and must not be
bypassable by supplying a key. The assistant route skips **both** budget caps
for a BYOK caller and builds a per-request client via `llmWithKey()` — never
cached, since a module-level cache would leak one user's credentials into
another's request. Usage is still recorded to `ai_usage` so they can see their
own spend. UI: `/settings`.

`.env`: `AI_KEY_SECRET` (≥16 chars; absent → the feature reports itself
unconfigured and everyone stays on the shared budgeted key).

The earlier Stripe subscription design (`031`) was removed before it was ever
applied — see git history if it's ever wanted back.

**AI can edit boards** (tools.ts): `create_board` / `add_board_node` /
`update_board_node` / `delete_board_node` / `link_board_nodes` go through the
same server actions the editor uses, so `033`'s RLS decides what the agent may
touch — it can only edit boards the **caller** could already edit. That
containment is the real control: board text is user-authored, so a node could
try to talk the agent into editing something, and the answer must be that the
database refuses, not that the prompt held. The prompt additionally requires an
explicit user request per turn (answering a question is not licence to edit) and
states that board text can never trigger a write. Write steps render in green in
the tool trace so an edit is visible at a glance.


**Branch dialogue is unified into `nodes`** (no separate `branch_nodes`
table): a predicate-branch line is a `nodes` row with `branch_id` set
(FK → `predicate_branches`, added via ALTER in `002` to break the
`nodes → predicate_branches → decisions → nodes` cycle; `reset.sql`
drops constraint `nodes_branch_fk` first for the same reason). The
discriminator is `branch_id IS NOT NULL` — no redundant boolean. `seq`
is position within the row's parent context: within `chapter_id` for
main-sequence rows (`branch_id IS NULL`), within `branch_id` for branch
rows. Consequences: the linear reader must filter `branch_id IS NULL`;
one `node_id` anchor now covers both main and branch lines.

### Categories (`stories.category`)

| Category | Content shape | Notes |
|---|---|---|
| 主线 | text-narrative | Main story arcs (黑暗时代·上 …) |
| 支线 | text-narrative | Side stories (51 entries, all have icons + wiki descriptions) |
| 故事集 | text-narrative | Story sets / 微型故事集 (20 entries, icons only) |
| 集成战略 | text-narrative + `gadgets` + `text_clusters` | Roguelike. Events/endings parse as text-narrative; relics/squads catalog in `gadgets` (006); supplementary text (ending epilogues, character dossiers) in `text_clusters`/`text_chunks` (008). |
| 生息演算 | text-narrative + `gadgets` | Reclamation algorithm. Same split — narrative in chapters/nodes, tools/catalog in `gadgets`. |
| 四月辑录 | text-narrative | April records |
| 特殊 | text-narrative | Hidden / special |
| 主题曲, 乐章 | not imported yet | Music — will need their own per-shape tables |

---

## Naming history

The schema was renamed once. **Current names:**
- `stories` = top-level registry (one row per event/arc/album/run)
- `chapters` = file-level (one row per parsed .txt)
- `chapters.story_id` → FK to `stories`
- `scenes` / `nodes` / `predicate_branches` use `chapter_id` (not `story_id`);
  branch dialogue is `nodes` rows with `branch_id` set (no `branch_nodes` table)

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
data/gadget-icons/<sha1>.png      ← from data/gadget-icons/<theme>/<file>
```

**SHA1 input** = the path relative to `data/`, e.g.
`img/乐章/夏日律动/火蓝之心_icon.png` or
`gadget-icons/萨卡兹的无终奇语/rogue_4_relic_legacy_9.png`. This guarantees
uniqueness across folders without depending on file content. Gadget icons
live under `data/gadget-icons/` (NOT `data/img/`, which `upload_story_images.py`
rglobs); `scrape_gadgets.py` downloads them, `upload_gadget_icons.py` uploads.

**Why SHA1**: Supabase Storage rejects `:`, `·`, and some Unicode in object names.
Hashing the relative path produces a safe key. The original filename is
recoverable via filesystem (the local copy is still readable by name).

**DB columns** on `stories`:

| column | kind | full storage URL |
|---|---|---|
| `icon_sha1`  | icon  | `data/story-icons/<sha1>.png` |
| `title_sha1` | title | `data/story-titles/<sha1>.png` |
| `cover_sha1` | cover | `data/story-covers/<sha1>.png` |

Plus `gadgets.icon_sha1` → `data/gadget-icons/<sha1>.png`.

The DB stores **only the SHA1** (40 hex chars). Bucket, subdirectory, and
extension are implicit. URL construction lives in
[src/lib/storage.ts](src/lib/storage.ts) — `storyImageUrl(kind, sha1)` for
stories, `gadgetIconUrl(sha1)` for gadgets.

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

- `scrape_plots.py`, `scrape_story_descriptions.py`, `scrape_gadgets.py`
  and `scrape_events.py` all hit prts.wiki, all with retry+backoff (60s
  timeout, exponential).
- Scraping is idempotent: existing files are skipped, so re-runs resume
  cleanly. `scrape_gadgets.py` / `scrape_events.py` are keyed differently —
  the marker is per-theme inside `data/gadgets.json` (`raw.parser`) /
  `data/events.json` (theme block present), not file existence; they feed
  `import_gadgets.py` / `import_events.py` and write debug
  `data/gadgets_scrape.json` / `data/events_scrape.json` (per-theme counts —
  a sudden 0 flags a wiki layout change).
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
- **集成战略 / 生息演算** — the theme framing + 5 endings use the
  text-narrative shape (the `.txt` parse fine). The **catalog**
  (relics/squads/endings/tools) is `gadgets` (006); the per-encounter
  **events** are `events` + `event_options` (007). Relic catalogs are scraped
  (`scrape_gadgets.py`) for the 5 modern themes → `data/gadgets.json` →
  `import_gadgets.py`, with per-relic sub-category as `kind` and icons
  downloaded + uploadable (`upload_gadget_icons.py`). Events are scraped
  (`scrape_events.py`) for **all 6 themes** → `data/events.json` →
  `import_events.py` (the 5 modern themes via the widget layout, 刻俄柏的灰蕈迷境
  via the old wikitable layout — auto-detected). Open: (1) `is1-relic` parser
  for 傀影与猩红孤钻 (older multi-section relic layout — registered, raises a
  clear TODO); (2) squad / 诡意行商 trader parsers (registered slots); (3) a
  frontend surface for browsing gadgets/events.
- **四月辑录** — still plain text-narrative; fine as-is.
