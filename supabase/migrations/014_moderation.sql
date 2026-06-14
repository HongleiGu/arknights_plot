-- ============================================================
-- 014_moderation.sql  (AP-4)
--
-- Moderation layer on top of 013's soft-delete:
--   • users.is_admin      — who may moderate.
--   • comments.removed_by — attribution: NULL + deleted_at = author
--                           self-deleted (013); set = a mod removed it,
--                           so the UI can show a different tombstone.
--   • comment_reports     — user reports feeding a mod queue.
--   • is_admin()          — RLS helper (SECURITY DEFINER so it can read
--                           users regardless of the caller's row access).
--   • admin RLS           — admins may UPDATE any comment (to set
--                           deleted_at + removed_by). The owner-only
--                           "auth update" policy from 005 stays; multiple
--                           permissive UPDATE policies are OR'd, so owners
--                           still edit their own and admins can moderate.
--
-- All ADD COLUMN / CREATE … IF NOT EXISTS + DROP POLICY IF EXISTS, so the
-- migration is re-runnable. comments/users/comment_reports are all
-- preserved across supabase/reset.sql (content-only wipe).
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS removed_by INT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS comment_reports (
  id           SERIAL PRIMARY KEY,
  comment_id   INT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reporter_id  INT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  INT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (comment_id, reporter_id)               -- one report per user per comment
);

CREATE INDEX IF NOT EXISTS idx_comment_reports_open    ON comment_reports(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comment_reports_comment ON comment_reports(comment_id);

-- ---- admin helper -----------------------------------------------------------
-- SECURITY DEFINER + pinned search_path: reads users.is_admin for the current
-- auth.uid() without depending on the caller's RLS view of `users`.
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin
  );
$$;

-- ---- comments: admins may moderate (update) any row -------------------------
DROP POLICY IF EXISTS "admin moderate" ON comments;
CREATE POLICY "admin moderate" ON comments FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- comment_reports RLS ----------------------------------------------------
ALTER TABLE comment_reports ENABLE ROW LEVEL SECURITY;

-- Reporters see their own; admins see all.
DROP POLICY IF EXISTS "report read" ON comment_reports;
CREATE POLICY "report read" ON comment_reports FOR SELECT USING (
  is_admin()
  OR reporter_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
);

-- A user may file a report only as themselves.
DROP POLICY IF EXISTS "report insert" ON comment_reports;
CREATE POLICY "report insert" ON comment_reports FOR INSERT WITH CHECK (
  reporter_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
);

-- Only admins resolve (update) reports.
DROP POLICY IF EXISTS "report resolve" ON comment_reports;
CREATE POLICY "report resolve" ON comment_reports FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());
