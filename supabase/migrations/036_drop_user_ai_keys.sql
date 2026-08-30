-- ============================================================
-- 036_drop_user_ai_keys.sql
--
-- Reverses 035 (bring-your-own API key).
--
-- Why: AI_MODEL is now minimax/minimax-m3:free, so there is no cost to shift
-- onto users. And because AI_MODEL is GLOBAL, a user supplying their own key
-- got the same model as everyone else — so BYOK bought exactly one thing,
-- quota isolation, and nothing else. That is thin justification for holding
-- other people's API credentials: the risk isn't the crypto, it's that a
-- database dump plus a leaked AI_KEY_SECRET would leak keys that cost THEM
-- money, on a non-commercial plot-reading site.
--
-- Done now because it's free to do now: the table was empty, AI_KEY_SECRET was
-- never set in any environment, so nothing was ever encrypted and no user ever
-- stored anything. After someone stores a key this becomes a migration plus an
-- apology.
--
-- 035 is deliberately KEPT in the repo — it was applied, and a replay of the
-- migration sequence has to pass through it to reach the same end state.
-- If BYOK comes back (e.g. to let users pick their own model), 035 is the
-- starting point; it would need per-user model selection to be worth it.
-- ============================================================

-- ---- 1. restore ai_can_use to its 023 form ---------------------------------
-- Replaced BEFORE the table goes: a plpgsql body isn't dependency-checked at
-- DROP time, so dropping first would leave a function that compiles and then
-- fails at runtime on a missing relation.
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

-- ---- 2. remove the BYOK surface --------------------------------------------
DROP FUNCTION IF EXISTS my_ai_key_present();
DROP TABLE IF EXISTS user_ai_keys;

-- The AP-17/18 budget layer is untouched and is once again the only gate on
-- assistant access: it caps the shared (currently free) model quota.
