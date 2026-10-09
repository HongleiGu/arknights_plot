# Open tickets

Numbering continues from the AP-N references in [CLAUDE.md](CLAUDE.md); AP-34 was
the last one used. Architecture decisions live in CLAUDE.md — this file is only
what is *not yet done*, and why.

Measured state at the time of writing (2026-09-28):

| | |
|---|---|
| `entities` | 7,067 — 6,984 `character` (432 with a scraped summary) + 83 world rows: 36 `race`, 19 `nation`, 11 `concept`, 9 `organisation`, 4 `place`, 4 `event` (2026-10-09) |
| `entity_relations` | **11** |
| `content_summaries` | **14** (13 chapter, 1 story) of ~2,400 possible targets |
| `chapter_descriptions` (curated, count as done) | 973 |
| `correlation_member_refs` | **0** — no board cites anything |
| `timeline_events` | 890, with resolved citations |
| retrieval | `ILIKE '%token%'` over 414,720 nodes — no index, no FTS |

---

## AP-35 · Entity types beyond `character`  — DONE except summaries

**Done 2026-10-09**, no model calls: `seed_world_entities.py` created 83 world
entities from 大地巡旅's table of contents and the operators' 基础档案 — 19
`nation`, 36 `race`, 11 `concept`, 9 `organisation`, 4 `place`, 4 `event`, with
176 citations, 0 unresolvable and 0 uncited. CLAUDE.md records why the mapping is
a written-out table rather than parsed from `level_code` depth.

**What is left of this ticket is the summaries, and they need the model.**
Acceptance said "each with a type, a citation and a summary"; the first two are
met, the third is not, because the book's opening prose is an authorial aside
about a third of the time and a summary that is wrong one time in three is worse
than none. The first body paragraph sits in `entities.raw.opening` for a model
pass to work from, which folds into AP-37.

**Original problem.** `entities` held 6,885 rows and every one was a `character`,
because `seed_entities.py` derives them from distinct `nodes.speaker`. There was
not one location, faction, race or concept. A knowledge graph of a cast list can
answer "who spoke" and nothing else, and it is why AP-38 had nothing to
traverse.

**Approach — derive, don't extract.** The same posture as `seed_entities.py`
(characters from who actually speaks) and `scrape_terra_timeline.py` (a curated
chronology rather than inferred dates): take the names from a structure that is
already authored and grounded, rather than asking a model to find them.

The book's own table of contents *is* that structure:

| book section | entity type |
|---|---|
| `4.x` 泰拉种族 | race |
| `5.x` 维多利亚 / 莱塔尼亚 / 乌萨斯 / … | nation |
| `5.x.1` sub-sections (四国战争, 梦魇远征, …) | event / place |
| `6.x` 莱茵生命 / 黑钢国际 / 企鹅物流 / … | organisation |

Each is a `chapters` row with a `level_code`, a `level_name` and a body of
prose — so the entity gets a name, a type **and** a citation (`@chapter/<id>`)
for free, with no model call and nothing invented. `timeline_events.source_refs`
adds a second grounded source for events.

**Scope.**
- Extend `seed_entities.py`, or a sibling script, to seed from book chapters.
- Idempotent upsert on `(type, name)` — the existing unique constraint.
- Populate `entities.summary` from the section's opening prose, with
  `summary_status = 'scraped'` (not `ai_draft`) — it is transcribed, not written.
- Keep `source_url` / a citation on every row.

**The character half is already done** (2026-10-09, no model calls):
`seed_entity_profiles.py` gave all 432 operators the official 客观履历 from their
人员档案 as `summary`, with `@text/<id>` citations, and created the 99 operator
entities `seed_entities.py` had missed because those operators never speak. So
AP-35 is now only about the **non-character** types, which is what it was always
really about.

**And it got cheaper.** That script parsed `基础档案` into `entities.raw.profile`,
which holds **32 distinct 出身地 and 45 distinct 种族 across 424 operators** — so
the moment this ticket creates `nation` and `race` entities, those are the
grounded names to create them from, and the character→nation / character→race
edges follow by join rather than by extraction. See the AP-36 note.

**Not in scope.** Inventing entities the book does not name; relations (AP-36).

**Acceptance.**
- Non-`character` entities exist for every numbered book section, each with a
  type, a citation and a summary.
- Re-running the seed changes nothing (idempotent).
- Zero rows whose citation does not resolve to a real chapter.

**Depends on** nothing. **Blocks** AP-36, AP-38. **Cost** no LLM calls.

---

## AP-36 · Relation extraction, citations enforced

**Problem.** `entity_relations` has 11 rows. This is the table GraphRAG
traverses, so AP-38 is empty until it is populated.

**The hard constraint.** The model knows Arknights from pretraining and will
assert `凯尔希 —盟友→ 阿米娅` without reading a line. CLAUDE.md's rule for this
table is that `source_refs` grounds every edge in internal canon, *never*
pretraining. A prompt asking politely for citations is not enough, because an
invented citation looks exactly like a real one.

**So the check is structural, not textual:**
1. Extraction runs over passages actually supplied to the model, never over a
   bare entity name.
2. Every returned edge must cite `@node/<id>` or `@chapter/<id>`.
3. **Each citation is resolved against the database before the row is written.**
   An edge whose citation does not exist is dropped, not repaired — a wrong
   citation reads as grounded, which is worse than an absent edge.
4. A sample is read by hand to confirm the cited text actually supports the
   claim. Resolving is not the same as supporting.

**Scope.**
- Extraction pass over chapters, batched, with the AP-29 harness properties:
  the backlog query is the cursor, a failed item is skipped rather than fatal,
  429 is a wait rather than an error.
- Report drop counts per run — a high drop rate is a signal about the prompt,
  not noise to hide.

**Acceptance.**
- Every `entity_relations` row's `source_refs` resolves.
- A hand-checked sample of ≥30 edges supports its citation.
- The pass is resumable: killing it mid-run loses no completed work.

**A slice of this needs no model at all, and AP-35 has now made it a join.**
`entities.raw.profile` holds every operator's 出身地 and 种族 from the game's own
基础档案, and as of 2026-10-09 the target entities exist: **373 of 382 operators
resolve to a `nation`/`place`/`organisation` and 376 of 384 to a `race`**. That
is ~750 edges, each citable to the 基础档案 chunk it came from. Do it **first**:
it costs nothing and gives the extraction pass a populated graph to be measured
against instead of an empty one.

The 9 + 8 that do not resolve are excluded deliberately, not missing: `（自称）`
values where self-description is the point, 阿戈尔地区 / 汐斯塔（独立城邦） which
qualify a name rather than state one, 瓦伊凡 / 杜林 appearing as 出身地 when they
are races, and one corrupted 基础档案 (伊芙利特's).

What genuinely needs a model is the relations no field states — who allies with,
opposes, commands or betrays whom — and those are the ones where the
citation check above is load-bearing.

**Depends on** AP-35. **Blocks** AP-38. **Cost** thousands of calls on a free,
rate-limited model for the narrative edges; zero for the 出身地/种族 slice.

---

## AP-37 · Summaries backlog

**Problem.** `content_summaries` has 14 rows. **The chapter half is now
essentially done by import rather than by model** — 2,002 of 2,080 game chapters
carry an official plot description, so the chapter backlog fell from 1,686 to
670, of which 526 are 漫画 (no panel text imported yet — AP-33) and 66 are
大地巡旅 (excluded below). The real chapter remainder is **78**, and those have no
official text in existence: the game ships no brief for the 集成战略 theme framing
or ro3/ro4/ro5 endings (24), any of 生息演算 (16), the April Fools events (23), or
特殊's EP09-EP12 / 危机合约 / 荷谟伊智境 (14). That is a content gap, confirmed by
listing the shipped files — not something to re-investigate, and arguably not
worth model calls either.

**So the remaining work is story-level: 506 of 715** — 干员密录 432, 故事集 21,
主线 18, 家具 10, and the rest in single digits.

**Priority order** — 主线 (18 stories) → 支线 (53) → 故事集 (21). 干员密录 (432
stories) is the long tail and may never be worth it. Chapters with a curated
`chapter_descriptions` row already count as done: official text beats the
model's, so spending tokens there buys a worse result.

**But `prts.wiki/关卡描述` does NOT count as done.** It is the tactical briefing
from the level page (`提防敌军的迷彩部队`) — real, official, worth showing, and not a
plot summary. `backlogIds()` originally treated any description row as done,
which was correct while every row was a plot brief; after 1,463 tactical rows
landed it marked 10 chapters complete that have no plot text at all. Fixed in
`actions/summaries.ts`; keep the exclusion if a fifth source appears.

**The book is excluded, deliberately.** A summary's value is compressing a
narrative you might not have read. 大地巡旅 is reference prose, not narrative —
summarising it produces a worse version of something already written for
lookup. Its content is not wasted: it goes into `entities` via AP-35, which is
where reference material earns its keep.

**Scope.** Reuse `/admin/ai` → 摘要全量补齐 (`BacklogPanel`), which already has
the right shape; add the category ordering.

**Acceptance.** 主线 and 支线 fully summarised; the run survives being closed and
reopened; no chapter with a curated description is re-summarised.

**Depends on** nothing. **Cost** ~506 calls, down from ~1,700.

---

## AP-38 · Retrieval: GraphRAG, and text search

**Problem.** Retrieval today is `ILIKE '%token%'` across 414,720 unindexed
nodes — a sequential scan, with no ranking and no stemming.

**Two legs, because they answer different questions.**

*GraphRAG* answers "how is A connected to B" by traversing `entity_relations`
with recursive CTEs — Postgres-native, no Neo4j, as decided in AP-22. Useless
until AP-35 and AP-36 populate the graph.

*Text search* answers "where does the text say X", which traversal cannot.
**pgvector is deliberately not the answer**: embeddings for 414k nodes are
~600 MB at 384 dimensions and ~2.5 GB at 1536, far more than the page caching
already declined on space grounds. Postgres FTS is ~10–15% of table size.

**Check first, before committing to FTS:** Chinese has no spaces, so a default
`tsvector` tokeniser produces nothing useful. This needs `zhparser` or
`pg_jieba`, and **Supabase may not offer either** — verify extension
availability before designing around it. The fallback is bigram indexing via
`pg_trgm`, which is coarser but widely available.

**Acceptance.** A question of each kind is answered from an index rather than a
scan; `EXPLAIN` shows no sequential scan over `nodes`.

**Depends on** AP-35, AP-36.

---

## AP-39 · Boards: the AI proposes, the human accepts

**Deliberately last, and possibly never.**

A clue board is the reader's own reasoning space. Its groundedness is *derived*
— a node cites or it does not, and an uncited card renders muted — and AP-33's
note is explicit that this works precisely because it cannot be faked.

An AI that authors board nodes fakes it structurally: the claims are the
model's, the citations are attached automatically, and a reader cannot tell
them from a person's argument. Boards currently hold 2 correlations, 1 member
and **0 citations**, so auto-filling would also populate a tool before anyone
has formed a habit with it.

**If it is built,** the AI proposes candidates into a staging area and the human
accepts them onto a board. The cheaper alternative, available today: the
assistant already answers with citations, and a reader can pull what survives
onto a board themselves.

**Depends on** AP-36. **Recommendation** defer until boards have been used by
hand.

---

## AP-40 · Stop paying for bot traffic *(small, unblocked)*

**Measured over 29 Aug – 28 Sep:** 80,390 requests at the edge, 10.76% cached,
against **230 browser page views** from Cloudflare's JS beacon — a 350× gap,
and ~43% of even those 230 are ChromeHeadless or Unknown. Essentially all
origin traffic is automated.

It is not free. `/robots.txt` **404s**, and a 404 falls through to
`[category]/page.tsx`, which opens a Supabase client and queries `stories`
before calling `notFound()`. Measured: `/wp-login.php` 1.5s, `/.env` 0.84s —
each one a database round trip and a full React render for a scanner.

**Scope.**
- `robots.txt` (disallow `/admin`, `/api`, `/auth`) and a sitemap — with 2,672
  chapters, a sitemap *reduces* crawl load by removing the guessing.
- Middleware early-return so an impossible path never opens a DB connection.
- Cloudflare-side (dashboard, not code): Bot Fight Mode, and a WAF rule for
  scanner paths. **Largest effect of the three, and free.**

**Acceptance.** A junk path costs no database query, measured before and after.

---

## Ordering

```
AP-35 ──┬── AP-36 ── AP-38
        │              ▲
AP-37 ──┴──────────────┘        AP-39 (defer)     AP-40 (any time)
```

AP-35 first: it costs no model calls and unblocks everything else. AP-37 is
independent and can run in parallel — it is mostly waiting on a rate limit.
