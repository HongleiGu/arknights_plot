-- ============================================================
-- 032_fix_board_rls_recursion.sql
--
-- Fixes: `infinite recursion detected in policy for relation "correlations"`
-- (SQLSTATE 42P17), hit by createBoard — the `.select('id')` after the INSERT
-- evaluates the SELECT policy on correlations.
--
-- The cycle 019 introduced:
--   correlations."read shared"    subqueries correlation_shares
--   correlation_shares."read shares" subqueries correlations
-- Evaluating either policy re-enters the other's policy, forever.
--
-- Fix: move each cross-table lookup into a SECURITY DEFINER function. A
-- definer function owned by the table owner is exempt from RLS on the tables
-- it reads, so the policy stops re-entering its counterpart and the cycle is
-- cut. We cut it on BOTH edges rather than just one, so neither direction can
-- reintroduce it later.
--
-- These functions disclose nothing new: each answers only "what may the
-- CALLER see", using app_uid() internally. They are not parameterised by an
-- arbitrary user id, so they can't be used to enumerate someone else's access.
-- ============================================================

-- ---- caller-scoped id sets (definer: read the base tables, skip policies) ---

-- Boards shared with the caller. Reads ONLY correlation_shares, so the
-- correlations policy no longer re-enters correlation_shares' policy.
CREATE OR REPLACE FUNCTION my_shared_board_ids() RETURNS SETOF INT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT correlation_id FROM correlation_shares WHERE user_id = app_uid()
$$;
GRANT EXECUTE ON FUNCTION my_shared_board_ids() TO anon, authenticated;

-- Boards the caller owns. Reads ONLY correlations, so the correlation_shares
-- policies no longer re-enter the correlations policy.
CREATE OR REPLACE FUNCTION my_owned_board_ids() RETURNS SETOF INT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM correlations WHERE created_by = app_uid()
$$;
GRANT EXECUTE ON FUNCTION my_owned_board_ids() TO anon, authenticated;

-- ---- authorization primitives (now definer) --------------------------------

-- Can the caller read board `bid`? Same rule as the correlations policy:
-- not-private, or owner, or shared with them.
CREATE OR REPLACE FUNCTION board_readable(bid INT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM correlations c
     WHERE c.id = bid
       AND (c.visibility <> 'private'
            OR c.created_by = app_uid()
            OR EXISTS (SELECT 1 FROM correlation_shares s
                        WHERE s.correlation_id = c.id AND s.user_id = app_uid()))
  )
$$;
GRANT EXECUTE ON FUNCTION board_readable(INT) TO anon, authenticated;

-- Was SECURITY INVOKER in 019; promoted to DEFINER so member/edge policies
-- resolve edit rights without dragging both tables' policies in behind them.
CREATE OR REPLACE FUNCTION board_editable(bid INT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM correlations c
                  WHERE c.id = bid AND c.created_by = app_uid())
      OR EXISTS (SELECT 1 FROM correlation_shares s
                  WHERE s.correlation_id = bid AND s.user_id = app_uid()
                    AND s.role = 'editor')
$$;
GRANT EXECUTE ON FUNCTION board_editable(INT) TO anon, authenticated;

-- ---- rewritten policies -----------------------------------------------------
-- Semantics are unchanged from 019; only the recursion is removed.

-- correlations: read = not-private OR owner OR shared.
DROP POLICY IF EXISTS "read shared" ON correlations;
CREATE POLICY "read shared" ON correlations FOR SELECT USING (
  visibility <> 'private'
  OR created_by = app_uid()
  OR id IN (SELECT my_shared_board_ids())
);

-- correlation_shares: own grant, or every grant on a board the caller owns.
DROP POLICY IF EXISTS "read shares"  ON correlation_shares;
CREATE POLICY "read shares" ON correlation_shares FOR SELECT USING (
  user_id = app_uid()
  OR correlation_id IN (SELECT my_owned_board_ids())
);
DROP POLICY IF EXISTS "owner insert" ON correlation_shares;
CREATE POLICY "owner insert" ON correlation_shares FOR INSERT WITH CHECK (
  correlation_id IN (SELECT my_owned_board_ids())
);
DROP POLICY IF EXISTS "owner update" ON correlation_shares;
CREATE POLICY "owner update" ON correlation_shares FOR UPDATE USING (
  correlation_id IN (SELECT my_owned_board_ids())
);
DROP POLICY IF EXISTS "owner delete" ON correlation_shares;
CREATE POLICY "owner delete" ON correlation_shares FOR DELETE USING (
  correlation_id IN (SELECT my_owned_board_ids())
);

-- members / edges: read follows board readability; write = owner OR editor.
-- `correlation_id IN (SELECT id FROM correlations)` also worked once the cycle
-- above was cut, but board_readable() states the intent and resolves in one
-- indexed lookup instead of pulling every readable board id.
DROP POLICY IF EXISTS "read via board" ON correlation_members;
CREATE POLICY "read via board" ON correlation_members FOR SELECT
  USING (board_readable(correlation_id));

DROP POLICY IF EXISTS "read via board" ON correlation_edges;
CREATE POLICY "read via board" ON correlation_edges FOR SELECT
  USING (board_readable(correlation_id));
