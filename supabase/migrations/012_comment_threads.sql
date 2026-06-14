-- ============================================================
-- 012_comment_threads.sql
--
-- Turns the flat comments list into a forum-style 2-level thread.
--
--   parent_comment_id    — the THREAD ROOT this comment hangs under.
--                          NULL  → a top-level (first-level) comment.
--                          set   → a reply, rendered collapsed below
--                                  the root.  Always points at a
--                                  top-level comment, never another
--                                  reply, so the tree stays 2 levels
--                                  deep (YouTube-style) no matter how
--                                  deep the @-reference chain goes.
--   reply_to_comment_id  — the SPECIFIC comment this reply @-mentions
--                          (the root itself, or a sibling reply).
--                          Drives the "@<user>" badge + "jump to the
--                          referenced comment" button.  ON DELETE SET
--                          NULL so a reply survives if the comment it
--                          referenced is removed (the badge just
--                          disappears).
--
-- Both are self-references on comments.  No anchor change: a reply
-- still gets its own comment_anchors row with the SAME anchor as the
-- root (same node / event_option / …), so listCommentsFor picks the
-- whole thread up in one anchor query and the client assembles the
-- tree from parent_comment_id.
--
-- comments is preserved across supabase/reset.sql, so these columns
-- (and their data) survive a content wipe.  IF NOT EXISTS keeps the
-- migration re-runnable.
-- ============================================================

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS parent_comment_id   INT REFERENCES comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reply_to_comment_id INT REFERENCES comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comments_parent   ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_reply_to ON comments(reply_to_comment_id);
