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
-- ============================================================

CREATE TABLE chapters (
  id              SERIAL PRIMARY KEY,
  story_id        INT  NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  level_code      TEXT,                  -- 'GT-1', 'OF-ST1', 'PA-EX-3'
  level_name      TEXT,                  -- '日正当中'
  -- stage           TEXT,                  -- file-side code: BEG/END/NBT/ENTRY/SP1/…
  file_path       TEXT NOT NULL UNIQUE,  -- '支线/骑兵与猎人/GT-1 日正当中_BEG.txt'
  order_in_story  INT  NOT NULL
);

-- Camera/scene boundaries within a chapter (one chapter has many scenes).
CREATE TABLE scenes (
  id          SERIAL PRIMARY KEY,
  chapter_id  INT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  seq         INT NOT NULL
);

-- Every renderable text element in a chapter's main linear sequence.
-- Predicate-branch content lives in branch_nodes.
CREATE TABLE nodes (
  id          SERIAL PRIMARY KEY,
  chapter_id  INT  NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  scene_id    INT  REFERENCES scenes(id) ON DELETE SET NULL,
  seq         INT  NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('speech', 'subtitle', 'decision', 'cgitem')),
  speaker     TEXT,    -- name=…; 'narrator' for subtitle/plain text; NULL for decision/cgitem
  content     TEXT,    -- spoken or display text; NULL for decision/cgitem
  raw_params  JSONB    -- full parsed params for non-text nodes
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

CREATE TABLE branch_nodes (
  id          SERIAL PRIMARY KEY,
  branch_id   INT  NOT NULL REFERENCES predicate_branches(id) ON DELETE CASCADE,
  chapter_id  INT  NOT NULL REFERENCES chapters(id)           ON DELETE CASCADE,
  seq         INT  NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('speech', 'subtitle', 'cgitem')),
  speaker     TEXT,
  content     TEXT,
  raw_params  JSONB
);

CREATE INDEX idx_chapters_story_order        ON chapters(story_id, order_in_story);
CREATE INDEX idx_nodes_chapter_order         ON nodes(chapter_id, seq);
CREATE INDEX idx_nodes_scene                 ON nodes(scene_id);
CREATE INDEX idx_branch_nodes_branch_order   ON branch_nodes(branch_id, seq);
CREATE INDEX idx_predicate_branches_decision ON predicate_branches(decision_id);
