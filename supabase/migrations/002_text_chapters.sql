-- ============================================================
-- 002_text_chapters.sql
--
-- Text-narrative content shape: chapters → scenes → nodes,
-- with decision/predicate branching.
--
-- One `chapters` row = one parsed .txt file, e.g.
--   '骑兵与猎人 / GT-1 日正当中 / 行动前 (BEG)'.
--
-- Categories using this shape today: 主线, 支线, 故事集, 特殊,
-- 四月辑录, 集成战略, 生息演算 (partial). Future weird shapes
-- (music albums, roguelike maps) get their own migrations and
-- skip this layer entirely.
--
-- Branch unification (was: a separate `branch_nodes` table):
-- predicate-branch dialogue lives in the SAME `nodes` table as the
-- main sequence, distinguished by `branch_id IS NOT NULL`. This
-- gives every renderable line one identity, so a single `node_id`
-- anchor in 004 covers both main and branch content (comments /
-- correlations no longer need a parallel column per shape).
-- ============================================================

CREATE TABLE chapters (
  id              SERIAL PRIMARY KEY,
  story_id        INT  NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  level_code      TEXT,                  -- 'GT-1', 'OF-ST1', 'PA-EX-3'
  level_name      TEXT,                  -- '日正当中'
  stage           TEXT,                  -- file-side code: BEG/END/NBT/ENTRY/SP1/…
  file_path       TEXT NOT NULL UNIQUE,  -- '支线/骑兵与猎人/GT-1 日正当中_BEG.txt'
  order_in_story  INT  NOT NULL
);

-- Camera/scene boundaries within a chapter (one chapter has many scenes).
CREATE TABLE scenes (
  id          SERIAL PRIMARY KEY,
  chapter_id  INT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  seq         INT NOT NULL
);

-- Every renderable text element, main-sequence AND predicate-branch.
--
--   main-sequence row : branch_id IS NULL, scene_id optionally set,
--                       ordered by seq within chapter_id.
--   branch row        : branch_id set, scene_id NULL,
--                       ordered by seq within branch_id.
--
-- The discriminator is `branch_id IS NOT NULL` — there is intentionally
-- no redundant boolean (a flag could disagree with branch_id; a derived
-- predicate cannot).
--
-- branch_id → predicate_branches creates a dependency cycle
-- (nodes → predicate_branches → decisions → nodes), so the FK is added
-- via ALTER once predicate_branches exists (see below). reset.sql drops
-- the constraint by its name `nodes_branch_fk` to break the cycle.
CREATE TABLE nodes (
  id          SERIAL PRIMARY KEY,
  chapter_id  INT  NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  scene_id    INT  REFERENCES scenes(id) ON DELETE SET NULL,
  branch_id   INT,    -- FK to predicate_branches added by ALTER below
  seq         INT  NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('speech', 'subtitle', 'decision', 'cgitem')),
  speaker     TEXT,    -- name=…; 'narrator' for subtitle/plain text; NULL for decision/cgitem
  content     TEXT,    -- spoken or display text; NULL for decision/cgitem
  raw_params  JSONB,   -- full parsed params for non-text nodes
  -- A decision marker only exists in the main sequence; branches never re-fork.
  CONSTRAINT no_decision_in_branch CHECK (branch_id IS NULL OR type <> 'decision'),
  -- A row is either main-sequence (maybe scene-tagged) or branch content.
  CONSTRAINT not_scene_and_branch  CHECK (NOT (scene_id IS NOT NULL AND branch_id IS NOT NULL))
);

CREATE TABLE decisions (
  id                  SERIAL PRIMARY KEY,
  node_id             INT  NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE CASCADE,
  options             TEXT[] NOT NULL,
  values              TEXT[] NOT NULL,
  has_count_mismatch  BOOL NOT NULL DEFAULT FALSE
);

-- Each [Predicate(references="…")] block belonging to a decision.
CREATE TABLE predicate_branches (
  id           SERIAL PRIMARY KEY,
  decision_id  INT  NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  chapter_id   INT  NOT NULL REFERENCES chapters(id)  ON DELETE CASCADE,
  predicates   TEXT[] NOT NULL,
  seq          INT  NOT NULL
);

-- Close the cycle now that predicate_branches exists. Deleting a branch
-- cascades its dialogue rows in `nodes`.
ALTER TABLE nodes
  ADD CONSTRAINT nodes_branch_fk
  FOREIGN KEY (branch_id) REFERENCES predicate_branches(id) ON DELETE CASCADE;

CREATE INDEX idx_chapters_story_order        ON chapters(story_id, order_in_story);
CREATE INDEX idx_nodes_chapter_order         ON nodes(chapter_id, seq);  -- main flow
CREATE INDEX idx_nodes_scene                 ON nodes(scene_id);
CREATE INDEX idx_nodes_branch_order          ON nodes(branch_id, seq);   -- branch reveal
CREATE INDEX idx_predicate_branches_decision ON predicate_branches(decision_id);
