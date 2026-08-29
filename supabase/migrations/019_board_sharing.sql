-- ============================================================
-- 019_board_sharing.sql  (AP-12)
--
-- Google-Docs-style board permissions & sharing on top of AP-11.
--
--   correlations.visibility   private | unlisted | public
--   correlation_shares        per-user grants (viewer | editor)
--   users.email               backfilled from auth.users → invite by email
--
-- Read model:
--   private   → owner + shared users only
--   unlisted  → readable by anyone who has the id/link (NOT listed — the
--               listing query filters it out; RLS can't tell "has link")
--   public    → readable + listed
-- Edit (members/edges): owner OR an 'editor' share.
-- Board meta (rename / visibility / manage shares): owner only.
--
-- Privacy: users.email must never reach a browser. We REVOKE table SELECT on
-- users from the client roles and re-GRANT only the safe columns; email is
-- resolved for invites through the SECURITY DEFINER share_board_by_email().
-- ============================================================

-- Ordering note: the helper functions (section 4) are defined AFTER the
-- correlation_shares table (section 3), because a LANGUAGE sql body is
-- validated at CREATE time and board_editable() references that table.

-- ---- 1. users.email + lockdown ---------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill from Supabase auth (clerk_id stores the auth uid as text).
UPDATE users u
   SET email = a.email
  FROM auth.users a
 WHERE u.email IS NULL AND a.id::text = u.clerk_id;

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- Hide email (and any future column) from the browser: drop the blanket
-- client SELECT and re-grant only the safe columns. RLS still governs rows.
REVOKE SELECT ON users FROM anon, authenticated;
GRANT  SELECT (id, clerk_id, display_name, is_admin) ON users TO anon, authenticated;

-- ---- 2. correlations.visibility --------------------------------------------
-- DEFAULT 'public' so existing boards keep their world-readable behaviour;
-- the app inserts new boards as 'private' (createBoard).
ALTER TABLE correlations ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE correlations DROP CONSTRAINT IF EXISTS correlations_visibility_chk;
ALTER TABLE correlations ADD CONSTRAINT correlations_visibility_chk
  CHECK (visibility IN ('private', 'unlisted', 'public'));

-- ---- 3. per-user shares -----------------------------------------------------
CREATE TABLE IF NOT EXISTS correlation_shares (
  id             SERIAL PRIMARY KEY,
  correlation_id INT NOT NULL REFERENCES correlations(id) ON DELETE CASCADE,
  user_id        INT NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'viewer',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (correlation_id, user_id),
  CONSTRAINT correlation_shares_role_chk CHECK (role IN ('viewer', 'editor'))
);
CREATE INDEX IF NOT EXISTS idx_correlation_shares_board ON correlation_shares(correlation_id);
CREATE INDEX IF NOT EXISTS idx_correlation_shares_user  ON correlation_shares(user_id);
ALTER TABLE correlation_shares ENABLE ROW LEVEL SECURITY;

-- ---- 4. helpers (defined here so referenced tables already exist) -----------
-- Caller's users.id (NULL when anon). SECURITY INVOKER: reads users under the
-- caller's own RLS (public-read), so no privilege escalation.
CREATE OR REPLACE FUNCTION app_uid() RETURNS INT
  LANGUAGE sql STABLE AS $$
  SELECT id FROM users WHERE clerk_id = auth.uid()::text
$$;
GRANT EXECUTE ON FUNCTION app_uid() TO anon, authenticated;

-- Can the caller edit board `bid`? (owner or an editor-share.)
CREATE OR REPLACE FUNCTION board_editable(bid INT) RETURNS BOOLEAN
  LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM correlations c
                  WHERE c.id = bid AND c.created_by = app_uid())
      OR EXISTS (SELECT 1 FROM correlation_shares s
                  WHERE s.correlation_id = bid AND s.user_id = app_uid()
                    AND s.role = 'editor')
$$;
GRANT EXECUTE ON FUNCTION board_editable(INT) TO anon, authenticated;

-- ---- 5. RLS rewrite ---------------------------------------------------------

-- correlations: read = not-private OR owner OR shared. Writes stay owner-only
-- (005's "auth insert" + owner update/delete remain in force).
DROP POLICY IF EXISTS "public read" ON correlations;
DROP POLICY IF EXISTS "read shared" ON correlations;
CREATE POLICY "read shared" ON correlations FOR SELECT USING (
  visibility <> 'private'
  OR created_by = app_uid()
  OR id IN (SELECT correlation_id FROM correlation_shares WHERE user_id = app_uid())
);

-- correlation_members: read follows board readability; write = owner OR editor.
DROP POLICY IF EXISTS "public read"   ON correlation_members;
DROP POLICY IF EXISTS "read via board" ON correlation_members;
DROP POLICY IF EXISTS "auth insert"   ON correlation_members;  -- 005, superseded
DROP POLICY IF EXISTS "auth delete"   ON correlation_members;  -- 005, superseded
DROP POLICY IF EXISTS "owner insert"  ON correlation_members;  -- 017, superseded
DROP POLICY IF EXISTS "owner update"  ON correlation_members;  -- 017, superseded
DROP POLICY IF EXISTS "owner delete"  ON correlation_members;  -- 017, superseded
CREATE POLICY "read via board" ON correlation_members FOR SELECT
  USING (correlation_id IN (SELECT id FROM correlations));
CREATE POLICY "edit insert" ON correlation_members FOR INSERT WITH CHECK (board_editable(correlation_id));
CREATE POLICY "edit update" ON correlation_members FOR UPDATE USING (board_editable(correlation_id));
CREATE POLICY "edit delete" ON correlation_members FOR DELETE USING (board_editable(correlation_id));

-- correlation_edges: same shape.
DROP POLICY IF EXISTS "public read"  ON correlation_edges;
DROP POLICY IF EXISTS "read via board" ON correlation_edges;
DROP POLICY IF EXISTS "owner insert" ON correlation_edges;
DROP POLICY IF EXISTS "owner update" ON correlation_edges;
DROP POLICY IF EXISTS "owner delete" ON correlation_edges;
CREATE POLICY "read via board" ON correlation_edges FOR SELECT
  USING (correlation_id IN (SELECT id FROM correlations));
CREATE POLICY "edit insert" ON correlation_edges FOR INSERT WITH CHECK (board_editable(correlation_id));
CREATE POLICY "edit update" ON correlation_edges FOR UPDATE USING (board_editable(correlation_id));
CREATE POLICY "edit delete" ON correlation_edges FOR DELETE USING (board_editable(correlation_id));

-- correlation_shares: a user sees their own grants; the owner sees + manages all.
DROP POLICY IF EXISTS "read shares"  ON correlation_shares;
DROP POLICY IF EXISTS "owner insert" ON correlation_shares;
DROP POLICY IF EXISTS "owner update" ON correlation_shares;
DROP POLICY IF EXISTS "owner delete" ON correlation_shares;
CREATE POLICY "read shares" ON correlation_shares FOR SELECT USING (
  user_id = app_uid()
  OR correlation_id IN (SELECT id FROM correlations WHERE created_by = app_uid())
);
CREATE POLICY "owner insert" ON correlation_shares FOR INSERT WITH CHECK (
  correlation_id IN (SELECT id FROM correlations WHERE created_by = app_uid())
);
CREATE POLICY "owner update" ON correlation_shares FOR UPDATE USING (
  correlation_id IN (SELECT id FROM correlations WHERE created_by = app_uid())
);
CREATE POLICY "owner delete" ON correlation_shares FOR DELETE USING (
  correlation_id IN (SELECT id FROM correlations WHERE created_by = app_uid())
);

-- ---- 6. invite-by-email (email is client-hidden, so resolve server-side) ----
-- SECURITY DEFINER: runs as owner to look up users.email, but enforces board
-- ownership internally. Idempotent (upsert role on re-invite).
CREATE OR REPLACE FUNCTION share_board_by_email(p_board INT, p_email TEXT, p_role TEXT)
RETURNS TABLE (user_id INT, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller INT;
  v_target INT;
  v_dname  TEXT;
BEGIN
  SELECT id INTO v_caller FROM users WHERE clerk_id = auth.uid()::text;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_role NOT IN ('viewer', 'editor') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM correlations WHERE id = p_board AND created_by = v_caller) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  SELECT id, users.display_name INTO v_target, v_dname
    FROM users WHERE lower(email) = lower(trim(p_email));
  IF v_target IS NULL THEN RAISE EXCEPTION 'no_such_user'; END IF;
  IF v_target = v_caller THEN RAISE EXCEPTION 'cannot_share_self'; END IF;
  INSERT INTO correlation_shares (correlation_id, user_id, role)
    VALUES (p_board, v_target, p_role)
    ON CONFLICT (correlation_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  RETURN QUERY SELECT v_target, v_dname;
END $$;
GRANT EXECUTE ON FUNCTION share_board_by_email(INT, TEXT, TEXT) TO authenticated;
