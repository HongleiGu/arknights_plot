-- ============================================================
-- 028_ai_max_steps.sql  (AP-15/AP-17 follow-up)
--
-- The assistant's agent-loop step cap was hardcoded at 8, which cut off
-- complex multi-hop questions mid-investigation. Make it an admin-tunable
-- knob on /admin/ai so it can be raised when the budget allows (and lowered
-- to contain spend). Bounded 1..24 so it can't be set to something runaway.
-- ============================================================

ALTER TABLE ai_budget_config ADD COLUMN IF NOT EXISTS max_steps INT NOT NULL DEFAULT 8;
ALTER TABLE ai_budget_config DROP CONSTRAINT IF EXISTS ai_budget_config_max_steps_chk;
ALTER TABLE ai_budget_config ADD CONSTRAINT ai_budget_config_max_steps_chk
  CHECK (max_steps BETWEEN 1 AND 24);
