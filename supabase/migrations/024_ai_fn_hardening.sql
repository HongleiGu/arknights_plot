-- ============================================================
-- 024_ai_fn_hardening.sql  (AP-19)
--
-- Audit hardening. ai_can_use() and ai_budget_check() are SECURITY DEFINER and
-- granted to authenticated, but took a p_user argument WITHOUT checking that
-- the caller is that user. The app only ever passes the caller's own id, but a
-- logged-in user could call the RPC directly to probe someone else's AI-access
-- status or spend/limits. Add a self-or-admin guard to both.
--
-- (Audited & OK, unchanged: no service-role anywhere in the app path — every
-- query runs under the caller's RLS; users.email / ai_access / ai_limit_usd are
-- not in the client column grant; share_board_by_email / set_user_ai_access /
-- list_ai_access already enforce ownership/admin internally.)
-- ============================================================

CREATE OR REPLACE FUNCTION ai_can_use(p_user INT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u            users;
  mode         TEXT;
  caller       INT;
  caller_admin BOOLEAN;
BEGIN
  SELECT id, is_admin INTO caller, caller_admin FROM users WHERE clerk_id = auth.uid()::text;
  -- Only answer about yourself, unless you're an admin.
  IF caller IS NULL OR (p_user <> caller AND NOT caller_admin) THEN RETURN FALSE; END IF;

  SELECT * INTO u FROM users WHERE id = p_user;
  IF u IS NULL THEN RETURN FALSE; END IF;
  IF u.ai_access = 'block' THEN RETURN FALSE; END IF;
  IF u.is_admin THEN RETURN TRUE; END IF;
  IF u.ai_access = 'allow' THEN RETURN TRUE; END IF;
  SELECT access_mode INTO mode FROM ai_budget_config WHERE id = 1;
  RETURN mode = 'all';
END $$;
GRANT EXECUTE ON FUNCTION ai_can_use(INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ai_budget_check(p_user INT)
RETURNS TABLE (allowed BOOLEAN, reason TEXT, global_spent NUMERIC, global_limit NUMERIC, user_spent NUMERIC, user_limit NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg          ai_budget_config;
  period_start TIMESTAMPTZ := date_trunc('month', now());
  eff_user_lim NUMERIC;
BEGIN
  -- Only your own budget, unless you're an admin.
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND (id = p_user OR is_admin)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO cfg FROM ai_budget_config WHERE id = 1;
  SELECT COALESCE((SELECT ai_limit_usd FROM users WHERE id = p_user), cfg.per_user_limit_usd)
    INTO eff_user_lim;

  SELECT COALESCE(SUM(CASE WHEN cfg.pricing_mode = 'custom' THEN cost_custom ELSE cost_openrouter END), 0)
    INTO global_spent FROM ai_usage WHERE created_at >= period_start;
  SELECT COALESCE(SUM(CASE WHEN cfg.pricing_mode = 'custom' THEN cost_custom ELSE cost_openrouter END), 0)
    INTO user_spent   FROM ai_usage WHERE created_at >= period_start AND user_id = p_user;

  allowed := TRUE; reason := '';
  IF cfg.monthly_limit_usd IS NOT NULL AND global_spent >= cfg.monthly_limit_usd THEN
    allowed := FALSE; reason := 'global_limit';
  ELSIF eff_user_lim IS NOT NULL AND user_spent >= eff_user_lim THEN
    allowed := FALSE; reason := 'user_limit';
  END IF;

  global_limit := cfg.monthly_limit_usd;
  user_limit   := eff_user_lim;
  RETURN NEXT;
END $$;
GRANT EXECUTE ON FUNCTION ai_budget_check(INT) TO authenticated;
