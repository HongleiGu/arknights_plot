-- ============================================================
-- 031_billing.sql  (AP-21)
--
-- Commercialization: subscription tiers over a free quota, metered against
-- the AP-17 usage ledger. No new metering — a plan simply sets the caller's
-- monthly USD allowance, which ai_budget_check() already enforces.
--
--   billing_plans   the catalog (free / pro / max …), admin-editable
--   subscriptions   one row per user, mirrored from Stripe by the webhook
--   billing_events  raw Stripe events, for idempotency + audit
--
-- Entitlement resolution (ai_budget_check below), first non-NULL wins:
--   1. users.ai_limit_usd            explicit per-user override (AP-18)
--   2. active subscription's plan    monthly_ai_limit_usd
--   3. the 'free' plan               monthly_ai_limit_usd
--   4. ai_budget_config.per_user_limit_usd   global default (AP-17)
-- A plan limit of NULL means unlimited (still bounded by the global cap).
--
-- Stripe is the source of truth for subscription state; nothing here writes
-- to Stripe. The webhook (api/billing/webhook) verifies Stripe's signature and
-- then upserts through these tables. Prices live in Stripe — billing_plans
-- only records the price id and a display amount.
-- ============================================================

-- ---- 1. plan catalog --------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_plans (
  id                   SERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,      -- stable key: 'free' | 'pro' | …
  name                 TEXT NOT NULL,
  description          TEXT,
  monthly_price_usd    NUMERIC NOT NULL DEFAULT 0,
  -- Monthly AI allowance in USD of model spend. NULL = unlimited.
  monthly_ai_limit_usd NUMERIC,
  -- Stripe Price id (price_…). NULL → not purchasable yet; the checkout action
  -- refuses such a plan, which is how this ships safely unconfigured.
  stripe_price_id      TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  seq                  INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the ladder. Amounts are placeholders the admin can edit in /admin/ai;
-- the paid tiers stay unpurchasable until their stripe_price_id is filled in.
INSERT INTO billing_plans (code, name, description, monthly_price_usd, monthly_ai_limit_usd, seq) VALUES
  ('free', '免费',  '基础阅读与批注，附赠少量 AI 额度',       0,  0.25, 0),
  ('pro',  '进阶',  '更高的每月 AI 额度，适合深度考据',       5,  5.00, 1),
  ('max',  '档案员', '大额 AI 额度，适合长篇多跳分析',        20, 25.00, 2)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON billing_plans;
CREATE POLICY "public read" ON billing_plans FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin write" ON billing_plans;
CREATE POLICY "admin write" ON billing_plans FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));

-- ---- 2. subscriptions -------------------------------------------------------
-- One row per user (UNIQUE user_id): we sell a single plan, not seats.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     SERIAL PRIMARY KEY,
  user_id                INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id                INT REFERENCES billing_plans(id) ON DELETE SET NULL,
  status                 TEXT NOT NULL DEFAULT 'incomplete',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Mirrors Stripe's subscription statuses.
  CONSTRAINT subscriptions_status_chk CHECK (status IN
    ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
-- Read own, or admin. No client write policy at all: only the Stripe webhook
-- (service role, which bypasses RLS) may mutate subscription state, so a user
-- can never grant themselves a plan.
DROP POLICY IF EXISTS "read own or admin" ON subscriptions;
CREATE POLICY "read own or admin" ON subscriptions FOR SELECT USING (
  user_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
  OR EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
);

-- ---- 3. webhook audit / idempotency ----------------------------------------
CREATE TABLE IF NOT EXISTS billing_events (
  id              BIGSERIAL PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,   -- replayed events are ignored
  type            TEXT NOT NULL,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
-- Admin-read only; written by the webhook under the service role.
DROP POLICY IF EXISTS "admin read" ON billing_events;
CREATE POLICY "admin read" ON billing_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
);

-- ---- 4. entitlement ---------------------------------------------------------

-- The caller's effective monthly AI allowance in USD (NULL = unlimited).
-- SECURITY DEFINER so it can read subscriptions/plans for the gate even where
-- the caller couldn't; it discloses only that user's own number.
CREATE OR REPLACE FUNCTION ai_effective_limit(p_user INT) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_override  NUMERIC;
  v_has_over  BOOLEAN;
  v_plan_lim  NUMERIC;
  v_has_plan  BOOLEAN := FALSE;
  v_cfg_lim   NUMERIC;
BEGIN
  -- 1. explicit per-user override (AP-18) wins outright, including when it is
  --    deliberately set to 0 (throttled to nothing).
  SELECT ai_limit_usd, ai_limit_usd IS NOT NULL INTO v_override, v_has_over
    FROM users WHERE id = p_user;
  IF v_has_over THEN RETURN v_override; END IF;

  -- 2. the plan on an entitling subscription
  SELECT p.monthly_ai_limit_usd, TRUE INTO v_plan_lim, v_has_plan
    FROM subscriptions s JOIN billing_plans p ON p.id = s.plan_id
   WHERE s.user_id = p_user AND s.status IN ('active', 'trialing')
   LIMIT 1;
  IF v_has_plan THEN RETURN v_plan_lim; END IF;

  -- 3. the free tier
  SELECT monthly_ai_limit_usd, TRUE INTO v_plan_lim, v_has_plan
    FROM billing_plans WHERE code = 'free' LIMIT 1;
  IF v_has_plan THEN RETURN v_plan_lim; END IF;

  -- 4. global default (AP-17)
  SELECT per_user_limit_usd INTO v_cfg_lim FROM ai_budget_config WHERE id = 1;
  RETURN v_cfg_lim;
END $$;
GRANT EXECUTE ON FUNCTION ai_effective_limit(INT) TO anon, authenticated;

-- Budget check, now plan-aware. Same signature and shape as 022/023 so every
-- existing caller (assistant route, spend.ts) picks this up untouched.
CREATE OR REPLACE FUNCTION ai_budget_check(p_user INT)
RETURNS TABLE (allowed BOOLEAN, reason TEXT, global_spent NUMERIC, global_limit NUMERIC, user_spent NUMERIC, user_limit NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg          ai_budget_config;
  period_start TIMESTAMPTZ := date_trunc('month', now());
  eff_user_lim NUMERIC;
BEGIN
  SELECT * INTO cfg FROM ai_budget_config WHERE id = 1;
  eff_user_lim := ai_effective_limit(p_user);

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

-- ---- 5. access mode gains a 'subscriber' setting ----------------------------
-- 'subscriber' = anyone on an entitling paid subscription may use the
-- assistant (plus admins and explicit allows, as before).
ALTER TABLE ai_budget_config DROP CONSTRAINT IF EXISTS ai_budget_config_access_mode_chk;
ALTER TABLE ai_budget_config ADD CONSTRAINT ai_budget_config_access_mode_chk
  CHECK (access_mode IN ('admin', 'allowlist', 'subscriber', 'all'));

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
  IF mode = 'all' THEN RETURN TRUE; END IF;
  IF mode = 'subscriber' THEN
    RETURN EXISTS (
      SELECT 1 FROM subscriptions s
        JOIN billing_plans p ON p.id = s.plan_id
       WHERE s.user_id = p_user
         AND s.status IN ('active', 'trialing')
         AND p.code <> 'free'
    );
  END IF;
  RETURN FALSE;
END $$;
GRANT EXECUTE ON FUNCTION ai_can_use(INT) TO anon, authenticated;

-- ---- 6. the caller's own billing summary -----------------------------------
-- One call for the pricing / account UI: which plan, what state, how much of
-- this month's allowance is gone.
CREATE OR REPLACE FUNCTION my_billing_status()
RETURNS TABLE (
  plan_code    TEXT,
  plan_name    TEXT,
  status       TEXT,
  period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN,
  limit_usd    NUMERIC,
  spent_usd    NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        INT;
  cfg          ai_budget_config;
  period_start TIMESTAMPTZ := date_trunc('month', now());
BEGIN
  SELECT id INTO v_uid FROM users WHERE clerk_id = auth.uid()::text;
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT * INTO cfg FROM ai_budget_config WHERE id = 1;

  SELECT COALESCE(p.code, 'free'), COALESCE(p.name, '免费'),
         COALESCE(s.status, 'none'), s.current_period_end,
         COALESCE(s.cancel_at_period_end, FALSE)
    INTO plan_code, plan_name, status, period_end, cancel_at_period_end
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status IN ('active', 'trialing')
    LEFT JOIN billing_plans  p ON p.id = s.plan_id
   WHERE u.id = v_uid;

  -- No entitling subscription → the free tier's display name.
  IF plan_code IS NULL OR status = 'none' THEN
    SELECT code, name INTO plan_code, plan_name FROM billing_plans WHERE code = 'free';
    status := COALESCE(status, 'none');
  END IF;

  limit_usd := ai_effective_limit(v_uid);
  SELECT COALESCE(SUM(CASE WHEN cfg.pricing_mode = 'custom' THEN cost_custom ELSE cost_openrouter END), 0)
    INTO spent_usd FROM ai_usage WHERE created_at >= period_start AND user_id = v_uid;
  RETURN NEXT;
END $$;
GRANT EXECUTE ON FUNCTION my_billing_status() TO authenticated;
