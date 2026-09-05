-- ============================================================
-- 039_timeline_events.sql  (AP-27)
--
-- The dated-event backbone: prts.wiki 泰拉年表 scraped into one row per event.
--
-- Why this exists
-- ---------------
-- The entity graph (026 / AP-22) has no time axis. `entity_relations` is
-- timeless — "凯尔希和阿米娅是盟友" cannot answer *when*, because entities
-- don't carry time and relations between them can't be dated. Events can.
-- So events become first-class, and time enters the model through them.
--
-- Crucially the time did NOT have to be inferred: 泰拉年表 is a curated,
-- cited chronology, so this is a scrape (890 rows) rather than an extraction.
-- Same posture as seed_entities.py deriving characters from nodes.speaker.
--
-- Like `entities` (026) and `enemies`/`items` (037), this does NOT reference
-- `stories`. An event belongs to the world, not to one story — and most events
-- cite several stories at once. It is a peer of `stories`, not a child.
--
-- These dates are inferred, not canon
-- -----------------------------------
-- The source page carries its own banner: 以下时间均通过游戏内剧情推测，
-- 可能会出现偏差。Every row is a community reading of the plot, not published
-- setting. That is why `source_refs` is NOT NULL-defaulted-empty but expected
-- to be populated, and why the UI must render these as sourced claims. Do not
-- let this table become "the official timeline" in how it is presented.
--
-- Ordering: `seq` is the source page's own order, which is already
-- chronological and — unlike (year, month, day) — is total. It spans the
-- pre-Terra era, BC years, "12世纪（时间未知）" and the TT calendar without any
-- numeric gymnastics or invented precision. So `seq` is the sort key;
-- year/month/day exist for display, filtering and range queries only.
--
-- Precision is explicit rather than implied by NULLs, because the spread is
-- real and uneven — measured over the 890 rows:
--   year 460 · day 250 · month 57 · century 47 · season 42 · era 22
--   · range 9 · unknown 3
-- Storing a timestamp would force precision the source does not have.
--
-- `source_refs` holds resolved `@chapter/<id>` / `@story/<id>` tokens — the
-- same AP-2 citation vocabulary `entity_relations.source_refs` (026) uses, and
-- the same one `correlation_member_refs` (033) indexes generically. That means
-- a timeline event can be cited on a clue board as `@timeline/<id>` with no
-- schema at all; only lib/references.ts needs to learn the type.
--
-- `refs` keeps the FULL parsed citation list including the ones that do not
-- resolve to a chapter (wiki pages, section anchors, operator records,
-- external links, bare text). Nothing is silently dropped — an unresolvable
-- citation is still evidence, and losing it would make a row look uncited.
--
-- Idempotent load: replace-all in import_timeline.py (the import_events.py
-- idiom). Rows are wholly scrape-sourced; there are no hand-edits to preserve.
-- ============================================================

CREATE TABLE IF NOT EXISTS timeline_events (
  id          SERIAL PRIMARY KEY,
  -- Position on the source page = asserted chronological order. Total, stable,
  -- and the only ordering that works across every precision. UNIQUE so a
  -- half-finished import can't leave two rows claiming the same slot.
  seq         INT NOT NULL UNIQUE,

  -- Heading context: ==结晶纪元== / ===11世纪=== / ===='''1096 年'''====
  era         TEXT,
  section     TEXT,
  period      TEXT,

  -- The row header verbatim ("12 月 23 日", "约前 9000 年", "TT 197/19/09"),
  -- kept so an unparsed or exotic label is still displayable.
  date_label  TEXT,
  -- Negative year = before 泰拉历元年. NULL where the source gives no year.
  year        INT,
  month       INT,
  day         INT,
  -- day | month | season | year | century | range | era | unknown
  -- Free text, no CHECK: a new granularity is data, not a migration — the
  -- same call gadgets.kind and enemies.kind make.
  precision   TEXT NOT NULL DEFAULT 'era',
  -- The source's own hedge ("约前 9000 年").
  approx      BOOLEAN NOT NULL DEFAULT FALSE,
  -- 'terra' or 'TT' (the pre-civilisation reckoning, whose field order the
  -- wiki itself is unsure of — hence kept as a label, not parsed).
  calendar    TEXT NOT NULL DEFAULT 'terra',

  description TEXT NOT NULL,

  -- Resolved citations as @type/id tokens (AP-2 / 026 convention).
  source_refs TEXT[] NOT NULL DEFAULT '{}',
  -- Every parsed citation, resolved or not.
  refs        JSONB,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeline_seq       ON timeline_events(seq);
CREATE INDEX IF NOT EXISTS idx_timeline_year      ON timeline_events(year);
CREATE INDEX IF NOT EXISTS idx_timeline_precision ON timeline_events(precision);
-- Reverse lookup: "which timeline events cite this chapter?" — the query the
-- chapter reader needs, and the reason source_refs is an array rather than a
-- join table.
CREATE INDEX IF NOT EXISTS idx_timeline_refs ON timeline_events USING GIN (source_refs);

ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON timeline_events;
CREATE POLICY "public read" ON timeline_events FOR SELECT USING (true);
-- Writes go through the service-role pipeline, which bypasses RLS. No client
-- write policy: this table is scrape-sourced only.
