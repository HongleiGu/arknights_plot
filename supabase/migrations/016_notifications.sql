-- ============================================================
-- 016_notifications.sql  (AP-6)
--
-- Per-user notifications, written when someone replies to / @-mentions
-- your comment (see addCommentTo). Surfaced via a header bell, pushed
-- live with Supabase Realtime.
--
--   user_id    — recipient.
--   actor_id   — who triggered it (the replier).
--   type       — 'reply' | 'mention'.
--   comment_id — the new comment; the client resolves a permalink from
--                its anchor (page + #cmt-<id>).
--   read_at    — NULL = unread.
--
-- RLS: a user sees/updates only their own; any authenticated user may
-- INSERT a notification *for someone else* (that's the whole point) but
-- can't forge the actor. notifications references users + comments (both
-- preserved across reset.sql).
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INT  NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  actor_id    INT  REFERENCES users(id)             ON DELETE SET NULL,
  type        TEXT NOT NULL,
  comment_id  INT  REFERENCES comments(id)          ON DELETE CASCADE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user        ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own read" ON notifications;
CREATE POLICY "own read" ON notifications FOR SELECT USING (
  user_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
);

-- Insert a notification for any recipient, but the actor must be the caller
-- (or null) — you can't impersonate someone else as the trigger.
DROP POLICY IF EXISTS "auth insert" ON notifications;
CREATE POLICY "auth insert" ON notifications FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
  AND (actor_id IS NULL OR actor_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text))
);

-- Mark-as-read on your own rows.
DROP POLICY IF EXISTS "own update" ON notifications;
CREATE POLICY "own update" ON notifications FOR UPDATE USING (
  user_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
) WITH CHECK (
  user_id IN (SELECT id FROM users WHERE clerk_id = auth.uid()::text)
);

-- ---- Realtime: broadcast row changes on this table (idempotent add) ---------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;
