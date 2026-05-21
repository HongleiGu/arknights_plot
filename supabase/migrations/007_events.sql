-- ============================================================
-- 007_events.sql
--
-- Per-shape extension for 集成战略 (Integrated Strategies) random
-- *events* (事件) — the per-encounter branching scenarios
-- (不期而遇 / 传说 / …). These are NOT in the parsed .txt plots
-- (those only hold each theme's framing + 5 endings); the wiki
-- 事件一览 page is the only source, and it is a shallow decision
-- tree: intro narrative → choices → outcomes, with some choices
-- opening a sub-scene that has its own choices, and some choices
-- gated by a predicate (队伍中招募了电弧且…精英1阶段时出现).
--
-- The linear text model (002 nodes/decisions/predicate_branches)
-- is deliberately 1-level (CONSTRAINT no_decision_in_branch:
-- "branches never re-fork") and is built around AVG script
-- semantics (speaker/content). Events re-fork and have no
-- speakers, so they get their own shape rather than bending that
-- invariant — same call the project made for `gadgets` (006).
--
-- Additive: runs after 006, ALTERs the annotation layer to make
-- events + event options anchorable (CLAUDE.md: "to add a new
-- anchor type, add a nullable FK column to comment_anchors and
-- extend its CHECK"). Bootstrap order 001 … 007; reset.sql drops
-- event_options + events before stories.
-- ============================================================

CREATE TABLE events (
  id        SERIAL PRIMARY KEY,
  story_id  INT  NOT NULL REFERENCES stories(id) ON DELETE CASCADE,

  -- The wiki section the event sits in (data-etype): 不期而遇,
  -- 传说, 常乐, ★代理人, … Free-text, no CHECK — a new theme
  -- inventing a new section is data, not a migration.
  category  TEXT,

  name      TEXT NOT NULL,
  name_en   TEXT,
  intro     TEXT,                  -- the 开始 scene narrative
  image     TEXT,                  -- data-image (scene art id)

  -- Occurrence order within the theme. Part of the key because a
  -- theme can ship two distinct events under the same name
  -- (e.g. 岁的界园志异 has 传讯 twice) — seq disambiguates them
  -- and makes the import idempotent.
  seq       INT  NOT NULL,
  raw       JSONB,

  UNIQUE (story_id, name, seq)
);

-- The decision tree. A choice (the wiki's `choose`) is one row.
-- parent_option_id NULL = a top-level choice of the event; set =
-- a choice inside the sub-scene the parent choice opened. This
-- self-reference carries arbitrary depth (the common event is
-- one flat level; 同心-style events are two).
CREATE TABLE event_options (
  id                SERIAL PRIMARY KEY,
  event_id          INT  NOT NULL REFERENCES events(id)        ON DELETE CASCADE,
  parent_option_id  INT  REFERENCES event_options(id)          ON DELETE CASCADE,

  seq          INT  NOT NULL,      -- order among siblings
  label        TEXT,               -- data-title (the button text)
  description  TEXT,               -- desc1 (short result / teaser)

  -- desc2 split by its lead icon: a help-circle desc2 states *when
  -- the option appears* (a predicate); an information/alert desc2
  -- is a side note. Either may be NULL.
  predicate    TEXT,
  note         TEXT,

  outcome      TEXT,               -- destination scene narrative
  raw          JSONB               -- data-type/icon/dest/subnav…
);

CREATE INDEX idx_events_story          ON events(story_id, category, seq);
CREATE INDEX idx_event_options_event   ON event_options(event_id, parent_option_id, seq);

-- ---- Make events + event options anchorable (comments + correlations) ----
-- 006 last set these CHECKs (story/chapter/node/gadget); widen again.

ALTER TABLE comment_anchors
  ADD COLUMN IF NOT EXISTS event_id        INT REFERENCES events(id)        ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_option_id INT REFERENCES event_options(id) ON DELETE CASCADE;

ALTER TABLE comment_anchors DROP CONSTRAINT IF EXISTS exactly_one_anchor;
ALTER TABLE comment_anchors ADD CONSTRAINT exactly_one_anchor CHECK (
  (story_id        IS NOT NULL)::INT +
  (chapter_id      IS NOT NULL)::INT +
  (node_id         IS NOT NULL)::INT +
  (gadget_id       IS NOT NULL)::INT +
  (event_id        IS NOT NULL)::INT +
  (event_option_id IS NOT NULL)::INT = 1
);

CREATE INDEX idx_comment_anchors_event        ON comment_anchors(event_id);
CREATE INDEX idx_comment_anchors_event_option ON comment_anchors(event_option_id);

ALTER TABLE correlation_members
  ADD COLUMN IF NOT EXISTS event_id        INT REFERENCES events(id)        ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_option_id INT REFERENCES event_options(id) ON DELETE CASCADE;

ALTER TABLE correlation_members DROP CONSTRAINT IF EXISTS at_least_one_member;
ALTER TABLE correlation_members ADD CONSTRAINT at_least_one_member CHECK (
  (story_id        IS NOT NULL)::INT +
  (chapter_id      IS NOT NULL)::INT +
  (node_id         IS NOT NULL)::INT +
  (gadget_id       IS NOT NULL)::INT +
  (comment_id      IS NOT NULL)::INT +
  (event_id        IS NOT NULL)::INT +
  (event_option_id IS NOT NULL)::INT >= 1
);

-- ---- RLS: public read, same as the rest of the content layer -------------

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON events FOR SELECT USING (true);

ALTER TABLE event_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON event_options FOR SELECT USING (true);
