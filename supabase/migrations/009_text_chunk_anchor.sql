-- ============================================================
-- 009_text_chunk_anchor.sql
--
-- Widens comment_anchors and correlation_members to accept
-- text_chunk_id as an anchor target, following the same
-- ALTER-and-replace-CHECK idiom used by 006 and 007.
--
-- After this migration a comment can be pinned to a single
-- text_chunks row (one PART block inside a 集成战略 character
-- record or ending supplement).  No sub-chunk range is stored —
-- users reference specific lines in their comment body.
--
-- Bootstrap order: 001 … 009 (runs after 008 which creates
-- text_chunks).  reset.sql already drops text_chunks before
-- stories, so the FK is safe there too.
-- ============================================================

ALTER TABLE comment_anchors
  ADD COLUMN IF NOT EXISTS text_chunk_id INT REFERENCES text_chunks(id) ON DELETE CASCADE;

ALTER TABLE comment_anchors DROP CONSTRAINT IF EXISTS exactly_one_anchor;
ALTER TABLE comment_anchors ADD CONSTRAINT exactly_one_anchor CHECK (
  (story_id        IS NOT NULL)::INT +
  (chapter_id      IS NOT NULL)::INT +
  (node_id         IS NOT NULL)::INT +
  (gadget_id       IS NOT NULL)::INT +
  (event_id        IS NOT NULL)::INT +
  (event_option_id IS NOT NULL)::INT +
  (text_chunk_id   IS NOT NULL)::INT = 1
);

CREATE INDEX IF NOT EXISTS idx_comment_anchors_text_chunk ON comment_anchors(text_chunk_id);

ALTER TABLE correlation_members
  ADD COLUMN IF NOT EXISTS text_chunk_id INT REFERENCES text_chunks(id) ON DELETE CASCADE;

ALTER TABLE correlation_members DROP CONSTRAINT IF EXISTS at_least_one_member;
ALTER TABLE correlation_members ADD CONSTRAINT at_least_one_member CHECK (
  (story_id        IS NOT NULL)::INT +
  (chapter_id      IS NOT NULL)::INT +
  (node_id         IS NOT NULL)::INT +
  (gadget_id       IS NOT NULL)::INT +
  (event_id        IS NOT NULL)::INT +
  (event_option_id IS NOT NULL)::INT +
  (text_chunk_id   IS NOT NULL)::INT +
  (comment_id      IS NOT NULL)::INT >= 1
);
