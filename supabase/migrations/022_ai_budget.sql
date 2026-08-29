-- ============================================================
-- 022_ai_budget.sql  (AP-17)
--
-- AI cost tracking + budget enforcement. Two independent cost sources so we
-- have a backup and a path to commercialization:
--   1. cost_openrouter — the actual USD OpenRouter bills (read from the
--      response usage when we ask for it).
--   2. cost_custom     — USD under OUR pricing (input/output price per 1M),
--      for subscriptions / reselling / when OpenRouter cost isn't returned.
-- ai_budget_config.pricing_mode picks which column budget enforcement counts.
--
-- ai_budget_check() is SECURITY DEFINER so any signed-in user can be gated
-- against the GLOBAL cap (which they can't read row-by-row under RLS).
-- ============================================================

-- ---- config (single row) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_budget_config (
  id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pricing_mode       TEXT NOT NULL DEFAULT 'openrouter' CHECK (pricing_mode IN ('openrouter', 'custom')),
  input_price_per_m  NUMERIC NOT NULL DEFAULT 0,   -- USD per 1M input tokens (custom mode)
  output_price_per_m NUMERIC NOT NULL DEFAULT 0,   -- USD per 1M output tokens (custom mode)
  monthly_limit_usd  NUMERIC,                       -- global cap this month; NULL = unlimited
  per_user_limit_usd NUMERIC,                       -- per-user cap this month; NULL = unlimited
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ai_budget_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE ai_budget_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read config"  ON ai_budget_config;
CREATE POLICY "read config" ON ai_budget_config FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin write" ON ai_budget_config;
CREATE POLICY "admin write" ON ai_budget_config FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));

-- ---- per-request usage ledger ----------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
  id                BIGSERIAL PRIMARY KEY,
  user_id           INT REFERENCES users(id) ON DELETE SET NULL,
  model             TEXT,
  prompt_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens      INT NOT NULL DEFAULT 0,
  cached_tokens     INT NOT NULL DEFAULT 0,
  cost_openrouter   NUMERIC,   -- actual USD from OpenRouter, when returned
  cost_custom       NUMERIC,   -- USD under our custom pricing
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user    ON ai_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read own or admin" ON ai_usage;
CREATE POLICY "read own or admin" ON ai_usage FOR SELECT USING (
  user_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
  OR EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
);
DROP POLICY IF EXISTS "insert own" ON ai_usage;
CREATE POLICY "insert own" ON ai_usage FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
);

-- ---- budget check (definer: gate against the global cap) --------------------
CREATE OR REPLACE FUNCTION ai_budget_check(p_user INT)
RETURNS TABLE (allowed BOOLEAN, reason TEXT, global_spent NUMERIC, global_limit NUMERIC, user_spent NUMERIC, user_limit NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg          ai_budget_config;
  period_start TIMESTAMPTZ := date_trunc('month', now());
BEGIN
  SELECT * INTO cfg FROM ai_budget_config WHERE id = 1;

  SELECT COALESCE(SUM(CASE WHEN cfg.pricing_mode = 'custom' THEN cost_custom ELSE cost_openrouter END), 0)
    INTO global_spent FROM ai_usage WHERE created_at >= period_start;
  SELECT COALESCE(SUM(CASE WHEN cfg.pricing_mode = 'custom' THEN cost_custom ELSE cost_openrouter END), 0)
    INTO user_spent   FROM ai_usage WHERE created_at >= period_start AND user_id = p_user;

  allowed := TRUE; reason := '';
  IF cfg.monthly_limit_usd IS NOT NULL AND global_spent >= cfg.monthly_limit_usd THEN
    allowed := FALSE; reason := 'global_limit';
  ELSIF cfg.per_user_limit_usd IS NOT NULL AND user_spent >= cfg.per_user_limit_usd THEN
    allowed := FALSE; reason := 'user_limit';
  END IF;

  global_limit := cfg.monthly_limit_usd;
  user_limit   := cfg.per_user_limit_usd;
  RETURN NEXT;
END $$;
GRANT EXECUTE ON FUNCTION ai_budget_check(INT) TO authenticated;
