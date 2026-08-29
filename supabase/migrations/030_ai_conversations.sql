-- ============================================================
-- 030_ai_conversations.sql  (AP-20)
--
-- Google-Docs-style sharing / collaboration for AI assistant sessions.
-- Until now the assistant was ephemeral (transcript lived in React state);
-- this persists a session so it can be linked, shared and continued by
-- someone else.
--
--   ai_conversations           one saved assistant session
--   ai_conversation_messages   the transcript (user turns + assistant turns
--                              with their tool trace)
--   ai_conversation_shares     per-user grants (viewer | editor)
--
-- Deliberately the SAME shape as 019's board sharing, so the two read the
-- same way and the UI can share one dialog:
--   private   → owner + shared users only
--   unlisted  → readable by anyone with the link (NOT listed)
--   public    → readable + listed
-- Edit (append a turn / rename-in-place) = owner OR an 'editor' share.
-- Conversation meta (visibility / manage shares / delete) = owner only.
--
-- board_id is the second half of AP-20's scope: "authorize someone to ask
-- questions in a given board's context". A conversation may be anchored to a
-- board; editors of that conversation can then ask against it. Note this
-- grants no extra board access — the AI tools read under the caller's own RLS
-- (AP-19), so a collaborator who cannot read the board still cannot read it
-- through the assistant.
-- ============================================================

-- ---- 1. conversations -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_conversations (
  id         SERIAL PRIMARY KEY,
  created_by INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '未命名会话',
  visibility TEXT NOT NULL DEFAULT 'private',
  -- optional board context; SET NULL so deleting a board doesn't take the
  -- conversation with it (the transcript is still worth reading).
  board_id   INT REFERENCES correlations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_conversations_visibility_chk CHECK (visibility IN ('private', 'unlisted', 'public'))
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_owner ON ai_conversations(created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_board ON ai_conversations(board_id);
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

-- ---- 2. transcript ----------------------------------------------------------
-- One row per turn. `parts` keeps the assistant's interleaved tool trace
-- (SEARCH/READ/NOTE lines) as JSON so a shared session replays exactly as the
-- live panel rendered it; `content` is the plain answer text, which is what
-- gets replayed back to the model when the conversation is continued.
CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id INT  NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  seq             INT  NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  parts           JSONB,
  token_usage     JSONB,
  author_id       INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, seq),
  CONSTRAINT ai_conversation_messages_role_chk CHECK (role IN ('user', 'assistant'))
);
CREATE INDEX IF NOT EXISTS idx_ai_convo_messages ON ai_conversation_messages(conversation_id, seq);
ALTER TABLE ai_conversation_messages ENABLE ROW LEVEL SECURITY;

-- ---- 3. per-user shares -----------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_conversation_shares (
  id              SERIAL PRIMARY KEY,
  conversation_id INT  NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id         INT  NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'viewer',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_id),
  CONSTRAINT ai_conversation_shares_role_chk CHECK (role IN ('viewer', 'editor'))
);
CREATE INDEX IF NOT EXISTS idx_ai_convo_shares_convo ON ai_conversation_shares(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_convo_shares_user  ON ai_conversation_shares(user_id);
ALTER TABLE ai_conversation_shares ENABLE ROW LEVEL SECURITY;

-- ---- 4. helpers (mirror the board ones, post-032) ---------------------------
-- Defined after the shares table, since a LANGUAGE sql body is validated at
-- CREATE time. app_uid() comes from 019.
--
-- All SECURITY DEFINER, for the reason 032 documents: if the conversations
-- policy subqueried ai_conversation_shares while that table's own policy
-- subqueried ai_conversations, the two would recurse forever (42P17 —
-- exactly the bug 019 shipped for boards). A definer function is exempt from
-- RLS on the tables it reads, which cuts the cycle. Each answers only "what
-- may the CALLER see" via app_uid(), so nothing new is disclosed.

-- Sessions shared with the caller. Reads ONLY the shares table.
CREATE OR REPLACE FUNCTION my_shared_convo_ids() RETURNS SETOF INT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT conversation_id FROM ai_conversation_shares WHERE user_id = app_uid()
$$;
GRANT EXECUTE ON FUNCTION my_shared_convo_ids() TO anon, authenticated;

-- Sessions the caller owns. Reads ONLY the conversations table.
CREATE OR REPLACE FUNCTION my_owned_convo_ids() RETURNS SETOF INT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM ai_conversations WHERE created_by = app_uid()
$$;
GRANT EXECUTE ON FUNCTION my_owned_convo_ids() TO anon, authenticated;

CREATE OR REPLACE FUNCTION ai_convo_readable(cid INT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM ai_conversations c
     WHERE c.id = cid
       AND (c.visibility <> 'private'
            OR c.created_by = app_uid()
            OR EXISTS (SELECT 1 FROM ai_conversation_shares s
                        WHERE s.conversation_id = c.id AND s.user_id = app_uid()))
  )
$$;
GRANT EXECUTE ON FUNCTION ai_convo_readable(INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ai_convo_editable(cid INT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM ai_conversations c
                  WHERE c.id = cid AND c.created_by = app_uid())
      OR EXISTS (SELECT 1 FROM ai_conversation_shares s
                  WHERE s.conversation_id = cid AND s.user_id = app_uid()
                    AND s.role = 'editor')
$$;
GRANT EXECUTE ON FUNCTION ai_convo_editable(INT) TO anon, authenticated;

-- ---- 5. RLS -----------------------------------------------------------------

-- conversations: read = not-private OR owner OR shared. Insert = own rows only.
-- Update/delete = owner only (an editor appends turns but can't re-share).
DROP POLICY IF EXISTS "read shared"  ON ai_conversations;
CREATE POLICY "read shared" ON ai_conversations FOR SELECT USING (
  visibility <> 'private'
  OR created_by = app_uid()
  OR id IN (SELECT my_shared_convo_ids())
);
DROP POLICY IF EXISTS "owner insert" ON ai_conversations;
CREATE POLICY "owner insert" ON ai_conversations FOR INSERT WITH CHECK (created_by = app_uid());
DROP POLICY IF EXISTS "owner update" ON ai_conversations;
CREATE POLICY "owner update" ON ai_conversations FOR UPDATE USING (created_by = app_uid());
DROP POLICY IF EXISTS "owner delete" ON ai_conversations;
CREATE POLICY "owner delete" ON ai_conversations FOR DELETE USING (created_by = app_uid());

-- messages: read follows conversation readability; append = owner OR editor.
-- No UPDATE policy — a transcript is append-only, so turns can't be rewritten
-- after the fact (a shared session must stay faithful to what was actually said).
DROP POLICY IF EXISTS "read via convo" ON ai_conversation_messages;
CREATE POLICY "read via convo" ON ai_conversation_messages FOR SELECT
  USING (ai_convo_readable(conversation_id));
DROP POLICY IF EXISTS "edit insert"    ON ai_conversation_messages;
CREATE POLICY "edit insert" ON ai_conversation_messages FOR INSERT
  WITH CHECK (ai_convo_editable(conversation_id));
DROP POLICY IF EXISTS "owner delete"   ON ai_conversation_messages;
CREATE POLICY "owner delete" ON ai_conversation_messages FOR DELETE USING (
  conversation_id IN (SELECT my_owned_convo_ids())
);

-- shares: a user sees their own grant; the owner sees + manages all.
DROP POLICY IF EXISTS "read shares"  ON ai_conversation_shares;
CREATE POLICY "read shares" ON ai_conversation_shares FOR SELECT USING (
  user_id = app_uid()
  OR conversation_id IN (SELECT my_owned_convo_ids())
);
DROP POLICY IF EXISTS "owner insert" ON ai_conversation_shares;
CREATE POLICY "owner insert" ON ai_conversation_shares FOR INSERT WITH CHECK (
  conversation_id IN (SELECT my_owned_convo_ids())
);
DROP POLICY IF EXISTS "owner update" ON ai_conversation_shares;
CREATE POLICY "owner update" ON ai_conversation_shares FOR UPDATE USING (
  conversation_id IN (SELECT my_owned_convo_ids())
);
DROP POLICY IF EXISTS "owner delete" ON ai_conversation_shares;
CREATE POLICY "owner delete" ON ai_conversation_shares FOR DELETE USING (
  conversation_id IN (SELECT my_owned_convo_ids())
);

-- ---- 6. invite-by-email (email is client-hidden since 019) -------------------
-- SECURITY DEFINER to read users.email, but enforces ownership internally.
-- Idempotent (re-invite updates the role).
CREATE OR REPLACE FUNCTION share_ai_convo_by_email(p_convo INT, p_email TEXT, p_role TEXT)
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
  IF NOT EXISTS (SELECT 1 FROM ai_conversations WHERE id = p_convo AND created_by = v_caller) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  SELECT id, users.display_name INTO v_target, v_dname
    FROM users WHERE lower(email) = lower(trim(p_email));
  IF v_target IS NULL THEN RAISE EXCEPTION 'no_such_user'; END IF;
  IF v_target = v_caller THEN RAISE EXCEPTION 'cannot_share_self'; END IF;
  INSERT INTO ai_conversation_shares (conversation_id, user_id, role)
    VALUES (p_convo, v_target, p_role)
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  RETURN QUERY SELECT v_target, v_dname;
END $$;
GRANT EXECUTE ON FUNCTION share_ai_convo_by_email(INT, TEXT, TEXT) TO authenticated;
