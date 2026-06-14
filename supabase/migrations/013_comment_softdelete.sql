-- ============================================================
-- 013_comment_softdelete.sql
--
-- Soft-delete for comments (AP-3).
--
-- Why not a hard DELETE: 012 made replies FK their thread root via
-- parent_comment_id ON DELETE CASCADE, so deleting a top-level comment
-- would cascade-wipe every reply under it. Instead a "deleted" comment
-- keeps its row (and its children) and is rendered as a "[deleted]"
-- tombstone with the body hidden.
--
--   deleted_at  — NULL = live; set = soft-deleted (tombstone).
--
-- Editing reuses the existing updated_at column (bumped on body change);
-- the UI shows an "edited" marker when updated_at > created_at.
--
-- No RLS change: the existing owner "auth update" policy already lets an
-- author set deleted_at on their own comment. Admin/mod removal of
-- *others'* comments is AP-4.
--
-- comments is preserved across supabase/reset.sql, so this column and its
-- data survive a content wipe. IF NOT EXISTS keeps the migration
-- re-runnable.
-- ============================================================

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
