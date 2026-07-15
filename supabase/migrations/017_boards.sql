-- ============================================================
-- 017_boards.sql  (AP-11)
--
-- Clue-board / relationship-graph editor on top of the existing
-- correlations layer (004 + 006/007/009/011 widened the member anchors).
--
--   correlations         = a board (+ `layout` default view: board|timeline)
--   correlation_members  = a node: an entity anchor (story/chapter/node/
--                          gadget/event/event_option/text_chunk/furniture/
--                          comment) OR a free text card (note-only). Gains
--                          x/y (position), seq (timeline order), title.
--   correlation_edges    = the "red string" between two members.
--
-- Visibility: public read, only the board's creator edits — so member
-- insert/update/delete and all edge writes are gated on owning the parent
-- correlation (created_by). correlations' own owner RLS is already in 005.
--
-- correlations/correlation_members are preserved across reset.sql (annotation
-- layer); correlation_edges references members, so it rides along.
-- ============================================================

ALTER TABLE correlations
  ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'board';

ALTER TABLE correlation_members
  ADD COLUMN IF NOT EXISTS x     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS y     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seq   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Allow a free-text card (no entity anchor) — valid if it has an anchor OR a note.
ALTER TABLE correlation_members DROP CONSTRAINT IF EXISTS at_least_one_member;
ALTER TABLE correlation_members ADD CONSTRAINT at_least_one_member CHECK (
  (story_id          IS NOT NULL)::INT +
  (chapter_id        IS NOT NULL)::INT +
  (node_id           IS NOT NULL)::INT +
  (gadget_id         IS NOT NULL)::INT +
  (event_id          IS NOT NULL)::INT +
  (event_option_id   IS NOT NULL)::INT +
  (text_chunk_id     IS NOT NULL)::INT +
  (furniture_item_id IS NOT NULL)::INT +
  (comment_id        IS NOT NULL)::INT >= 1
  OR note IS NOT NULL
);

-- ---- owner-edit RLS on members (replaces the any-authenticated policies) ----
-- Helper predicate: the caller owns the parent board.
-- correlation_id ∈ boards whose created_by is the caller's users.id.

DROP POLICY IF EXISTS "auth insert" ON correlation_members;
CREATE POLICY "owner insert" ON correlation_members FOR INSERT WITH CHECK (
  correlation_id IN (
    SELECT id FROM correlations
    WHERE created_by IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
  )
);

DROP POLICY IF EXISTS "owner update" ON correlation_members;
CREATE POLICY "owner update" ON correlation_members FOR UPDATE USING (
  correlation_id IN (
    SELECT id FROM correlations
    WHERE created_by IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
  )
);

DROP POLICY IF EXISTS "auth delete" ON correlation_members;
CREATE POLICY "owner delete" ON correlation_members FOR DELETE USING (
  correlation_id IN (
    SELECT id FROM correlations
    WHERE created_by IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
  )
);

-- ---- edges ----
CREATE TABLE IF NOT EXISTS correlation_edges (
  id              SERIAL PRIMARY KEY,
  correlation_id  INT NOT NULL REFERENCES correlations(id)        ON DELETE CASCADE,
  from_member     INT NOT NULL REFERENCES correlation_members(id) ON DELETE CASCADE,
  to_member       INT NOT NULL REFERENCES correlation_members(id) ON DELETE CASCADE,
  label           TEXT,
  directed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correlation_edges_corr ON correlation_edges(correlation_id);

ALTER TABLE correlation_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read" ON correlation_edges;
CREATE POLICY "public read" ON correlation_edges FOR SELECT USING (true);

DROP POLICY IF EXISTS "owner insert" ON correlation_edges;
CREATE POLICY "owner insert" ON correlation_edges FOR INSERT WITH CHECK (
  correlation_id IN (
    SELECT id FROM correlations
    WHERE created_by IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
  )
);

DROP POLICY IF EXISTS "owner update" ON correlation_edges;
CREATE POLICY "owner update" ON correlation_edges FOR UPDATE USING (
  correlation_id IN (
    SELECT id FROM correlations
    WHERE created_by IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
  )
);

DROP POLICY IF EXISTS "owner delete" ON correlation_edges;
CREATE POLICY "owner delete" ON correlation_edges FOR DELETE USING (
  correlation_id IN (
    SELECT id FROM correlations
    WHERE created_by IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
  )
);
