-- ============================================================
-- 029_ai_steps_unlimited.sql  (AP-15 follow-up)
--
-- Allow max_steps = 0 to mean "unlimited" for deep multi-hop investigations.
-- It is not truly unbounded: the app still enforces HARD_MAX_STEPS (60) and,
-- more importantly, the budget gate (ai_budget_check) refuses new runs once
-- the monthly/per-user cap is hit. 1..24 keeps meaning an explicit cap.
-- ============================================================

ALTER TABLE ai_budget_config DROP CONSTRAINT IF EXISTS ai_budget_config_max_steps_chk;
ALTER TABLE ai_budget_config ADD CONSTRAINT ai_budget_config_max_steps_chk
  CHECK (max_steps BETWEEN 0 AND 24);
