-- ============================================================
-- 023_ai_access.sql  (AP-18)
--
-- User-level access control for the AI assistant. Opens the assistant beyond
-- admins via a global mode + per-user overrides:
--
--   ai_budget_config.access_mode : 'admin' | 'allowlist' | 'all'
--   users.ai_access              : NULL (follow mode) | 'allow' | 'block'
--   users.ai_limit_usd           : per-user monthly cap override (NULL = use config)
--
-- Resolution (ai_can_use): block wins; admins always in (unless blocked);
-- explicit 'allow' in; else follow mode ('all' → everyone, else → no).
--
-- ai_access / ai_limit_usd are NOT in the client SELECT grant (019), so they
-- stay server-only; access is resolved through SECURITY DEFINER functions.
-- ============================================================

ALTER TABLE ai_budget_config ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE ai_budget_config DROP CONSTRAINT IF EXISTS ai_budget_config_access_mode_chk;
ALTER TABLE ai_budget_config ADD CONSTRAINT ai_budget_config_access_mode_chk
  CHECK (access_mode IN ('admin', 'allowlist', 'all'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_access    TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ai_access_chk;
ALTER TABLE users ADD CONSTRAINT users_ai_access_chk CHECK (ai_access IN ('allow', 'block'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_limit_usd NUMERIC;

-- ---- access resolution (any signed-in user can be gated) --------------------
CREATE OR REPLACE FUNCTION ai_can_use(p_user INT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u users; mode TEXT;
BEGIN
  SELECT * INTO u FROM users WHERE id = p_user;
  IF u IS NULL THEN RETURN FALSE; END IF;
  IF u.ai_access = 'block' THEN RETURN FALSE; END IF;
  IF u.is_admin THEN RETURN TRUE; END IF;
  IF u.ai_access = 'allow' THEN RETURN TRUE; END IF;
  SELECT access_mode INTO mode FROM ai_budget_config WHERE id = 1;
  RETURN mode = 'all';
END $$;
GRANT EXECUTE ON FUNCTION ai_can_use(INT) TO anon, authenticated;

-- ---- admin: set a user's access + optional per-user cap, by email -----------
CREATE OR REPLACE FUNCTION set_user_ai_access(p_email TEXT, p_access TEXT, p_limit NUMERIC)
RETURNS TABLE (user_id INT, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target INT; v_dname TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_access IS NOT NULL AND p_access NOT IN ('allow', 'block') THEN RAISE EXCEPTION 'invalid_access'; END IF;
  SELECT id, users.display_name INTO v_target, v_dname FROM users WHERE lower(email) = lower(trim(p_email));
  IF v_target IS NULL THEN RAISE EXCEPTION 'no_such_user'; END IF;
  UPDATE users SET ai_access = p_access, ai_limit_usd = p_limit WHERE id = v_target;
  RETURN QUERY SELECT v_target, v_dname;
END $$;
GRANT EXECUTE ON FUNCTION set_user_ai_access(TEXT, TEXT, NUMERIC) TO authenticated;

-- ---- admin: list current grants / blocks / overrides -----------------------
CREATE OR REPLACE FUNCTION list_ai_access()
RETURNS TABLE (user_id INT, display_name TEXT, ai_access TEXT, ai_limit_usd NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  RETURN QUERY
    SELECT u.id, u.display_name, u.ai_access, u.ai_limit_usd
      FROM users u
     WHERE u.ai_access IS NOT NULL OR u.ai_limit_usd IS NOT NULL
     ORDER BY u.id;
END $$;
GRANT EXECUTE ON FUNCTION list_ai_access() TO authenticated;

-- ---- budget check now honours the per-user cap override --------------------
CREATE OR REPLACE FUNCTION ai_budget_check(p_user INT)
RETURNS TABLE (allowed BOOLEAN, reason TEXT, global_spent NUMERIC, global_limit NUMERIC, user_spent NUMERIC, user_limit NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg          ai_budget_config;
  period_start TIMESTAMPTZ := date_trunc('month', now());
  eff_user_lim NUMERIC;
BEGIN
  SELECT * INTO cfg FROM ai_budget_config WHERE id = 1;
  -- per-user override wins over the global per-user default
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
