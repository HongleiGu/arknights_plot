-- ============================================================
-- 015_comment_reactions.sql  (AP-5)
--
-- Emoji reactions on comments. Its own table (not a "kind of comment")
-- so UNIQUE(comment_id, user_id, emoji) can enforce one-per-user-per-emoji
-- and counts are a trivial GROUP BY.
--
-- RLS mirrors the rest of the annotation layer: public read; a user may
-- add/remove only their own reaction (user_id must resolve to the caller).
--
-- comment_reactions references comments + users (both preserved across
-- supabase/reset.sql), so no reset changes. IF NOT EXISTS / DROP POLICY
-- IF EXISTS keep it re-runnable.
-- ============================================================

CREATE TABLE IF NOT EXISTS comment_reactions (
  id          SERIAL PRIMARY KEY,
  comment_id  INT  NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     INT  NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (comment_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);

ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read" ON comment_reactions;
CREATE POLICY "public read" ON comment_reactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "self insert" ON comment_reactions;
CREATE POLICY "self insert" ON comment_reactions FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
);

DROP POLICY IF EXISTS "self delete" ON comment_reactions;
CREATE POLICY "self delete" ON comment_reactions FOR DELETE USING (
  user_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
);
