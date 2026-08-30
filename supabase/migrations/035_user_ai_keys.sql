-- ============================================================
-- 035_user_ai_keys.sql  (AP-21, revised)
--
-- Bring-your-own API key, replacing the subscription billing of the original
-- AP-21 plan. This project isn't commercial, so the useful thing is not to
-- resell model access but to let a reader spend their own.
--
-- (The Stripe schema that used to be 031 was never applied and has been
-- removed from the repo. Nothing to undo here.)
--
-- Storage: the key is encrypted by the APPLICATION (AES-256-GCM, node:crypto)
-- under AI_KEY_SECRET from the environment, and only the ciphertext is stored.
-- Deliberately NOT pgcrypto: that would mean passing the secret as a SQL
-- argument on every call, where it can surface in query logs and pg_stat.
-- Postgres never sees the plaintext key or the secret.
--
-- The owner can read their own ciphertext row. That is not a leak — it is
-- their own key, encrypted with a secret only the server holds, and they
-- already know the plaintext. `key_hint` (last 4 chars) is what the UI shows
-- so a user can tell which key is stored without ever decrypting it.
--
-- Losing AI_KEY_SECRET makes every stored key undecryptable. That is the
-- intended failure mode: users re-enter their key, and nothing is recoverable
-- from a database dump alone.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_ai_keys (
  user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Free text: 'openrouter' today, another OpenAI-compatible host tomorrow.
  provider   TEXT NOT NULL DEFAULT 'openrouter',
  ciphertext TEXT NOT NULL,
  -- Last 4 characters, for "sk-…a1b2" in the UI. Never enough to use.
  key_hint   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_ai_keys ENABLE ROW LEVEL SECURITY;

-- Strictly own-row. No admin read: an administrator has no business holding
-- someone else's API key, and the budget tools never need it.
DROP POLICY IF EXISTS "own select" ON user_ai_keys;
CREATE POLICY "own select" ON user_ai_keys FOR SELECT USING (user_id = app_uid());
DROP POLICY IF EXISTS "own insert" ON user_ai_keys;
CREATE POLICY "own insert" ON user_ai_keys FOR INSERT WITH CHECK (user_id = app_uid());
DROP POLICY IF EXISTS "own update" ON user_ai_keys;
CREATE POLICY "own update" ON user_ai_keys FOR UPDATE USING (user_id = app_uid());
DROP POLICY IF EXISTS "own delete" ON user_ai_keys;
CREATE POLICY "own delete" ON user_ai_keys FOR DELETE USING (user_id = app_uid());

-- ---- access: a key of your own is its own entitlement ----------------------
-- Supersedes the 023 version. Someone spending their own credit doesn't need
-- to be on the allowlist — that gate exists to protect OUR budget, and a BYOK
-- caller never touches it. Blocks still win: 'block' is moderation, not
-- billing, so it must not be bypassable by supplying a key.
CREATE OR REPLACE FUNCTION ai_can_use(p_user INT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u users; mode TEXT;
BEGIN
  SELECT * INTO u FROM users WHERE id = p_user;
  IF u IS NULL THEN RETURN FALSE; END IF;
  IF u.ai_access = 'block' THEN RETURN FALSE; END IF;
  IF u.is_admin THEN RETURN TRUE; END IF;
  IF u.ai_access = 'allow' THEN RETURN TRUE; END IF;
  IF EXISTS (SELECT 1 FROM user_ai_keys WHERE user_id = p_user) THEN RETURN TRUE; END IF;
  SELECT access_mode INTO mode FROM ai_budget_config WHERE id = 1;
  RETURN mode = 'all';
END $$;
GRANT EXECUTE ON FUNCTION ai_can_use(INT) TO anon, authenticated;

-- Does the caller have a key stored? Lets the assistant route decide whether to
-- apply the budget gate without being able to read the ciphertext itself.
CREATE OR REPLACE FUNCTION my_ai_key_present() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_ai_keys WHERE user_id = app_uid())
$$;
GRANT EXECUTE ON FUNCTION my_ai_key_present() TO authenticated;
