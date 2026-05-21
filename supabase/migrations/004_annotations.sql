-- ============================================================
-- 004_annotations.sql
--
-- Universal annotation layer: comments + correlations.
--
-- comment_anchors uses nullable FK columns per anchorable
-- entity type. To add a new anchor target later (e.g. a music
-- track or roguelike event), add a new nullable column and
-- extend the CHECK to include it.
--
-- NOTE: predicate-branch dialogue is no longer a separate table —
-- it's `nodes` rows with branch_id set (see 002). So a single
-- `node_id` anchor covers both main-sequence and branch lines;
-- there is no `branch_node_id`.
-- ============================================================

-- IF NOT EXISTS so this migration is safe to re-run after supabase/reset.sql,
-- which preserves the comments table (and any chat/comment rows) intact.
CREATE TABLE IF NOT EXISTS comments (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A comment pins to exactly one target. Anchor granularity:
--   story_id   — comment on the whole arc/album/run
--   chapter_id — comment on a chapter (entire file)
--   node_id    — comment on a single line; main-sequence OR predicate
--                branch (branch lines are nodes with branch_id set)
CREATE TABLE comment_anchors (
  id              SERIAL PRIMARY KEY,
  comment_id      INT NOT NULL REFERENCES comments(id)     ON DELETE CASCADE,
  story_id        INT REFERENCES stories(id)               ON DELETE CASCADE,
  chapter_id      INT REFERENCES chapters(id)              ON DELETE CASCADE,
  node_id         INT REFERENCES nodes(id)                 ON DELETE CASCADE,
  CONSTRAINT exactly_one_anchor CHECK (
    (story_id   IS NOT NULL)::INT +
    (chapter_id IS NOT NULL)::INT +
    (node_id    IS NOT NULL)::INT = 1
  )
);

-- A named cluster of nodes (main or branch) / comments across stories,
-- e.g. "all references to Reunion", "all scenes featuring Amiya".
CREATE TABLE correlations (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE correlation_members (
  id              SERIAL PRIMARY KEY,
  correlation_id  INT NOT NULL REFERENCES correlations(id) ON DELETE CASCADE,
  story_id        INT REFERENCES stories(id)               ON DELETE CASCADE,
  chapter_id      INT REFERENCES chapters(id)              ON DELETE CASCADE,
  node_id         INT REFERENCES nodes(id)                 ON DELETE CASCADE,
  comment_id      INT REFERENCES comments(id)              ON DELETE CASCADE,
  note            TEXT,
  CONSTRAINT at_least_one_member CHECK (
    (story_id   IS NOT NULL)::INT +
    (chapter_id IS NOT NULL)::INT +
    (node_id    IS NOT NULL)::INT +
    (comment_id IS NOT NULL)::INT >= 1
  )
);

CREATE INDEX idx_comment_anchors_comment      ON comment_anchors(comment_id);
CREATE INDEX idx_comment_anchors_story        ON comment_anchors(story_id);
CREATE INDEX idx_comment_anchors_chapter      ON comment_anchors(chapter_id);
CREATE INDEX idx_comment_anchors_node         ON comment_anchors(node_id);
CREATE INDEX idx_correlation_members_corr     ON correlation_members(correlation_id);
