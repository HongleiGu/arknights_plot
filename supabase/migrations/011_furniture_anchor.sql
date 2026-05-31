-- ============================================================
-- 011_furniture_anchor.sql
--
-- Widens comment_anchors and correlation_members to accept
-- furniture_item_id as an anchor target, following the same
-- ALTER-and-replace-CHECK idiom used by 006, 007, and 009.
--
-- Bootstrap order: 001 … 011 (runs after 010 which creates
-- furniture_items).  reset.sql drops furniture_items before
-- stories, so the FK is safe there too.
-- ============================================================

ALTER TABLE comment_anchors
  ADD COLUMN IF NOT EXISTS furniture_item_id INT REFERENCES furniture_items(id) ON DELETE CASCADE;

ALTER TABLE comment_anchors DROP CONSTRAINT IF EXISTS exactly_one_anchor;
ALTER TABLE comment_anchors ADD CONSTRAINT exactly_one_anchor CHECK (
  (story_id          IS NOT NULL)::INT +
  (chapter_id        IS NOT NULL)::INT +
  (node_id           IS NOT NULL)::INT +
  (gadget_id         IS NOT NULL)::INT +
  (event_id          IS NOT NULL)::INT +
  (event_option_id   IS NOT NULL)::INT +
  (text_chunk_id     IS NOT NULL)::INT +
  (furniture_item_id IS NOT NULL)::INT = 1
);

CREATE INDEX IF NOT EXISTS idx_comment_anchors_furniture_item
  ON comment_anchors(furniture_item_id);

ALTER TABLE correlation_members
  ADD COLUMN IF NOT EXISTS furniture_item_id INT REFERENCES furniture_items(id) ON DELETE CASCADE;

ALTER TABLE correlation_members DROP CONSTRAINT IF EXISTS at_least_one_member;
ALTER TABLE correlation_members ADD CONSTRAINT at_least_one_member CHECK (
  (story_id          IS NOT NULL)::INT +
  (chapter_id        IS NOT NULL)::INT +
  (node_id           IS NOT NULL)::INT +
  (gadget_id         IS NOT NULL)::INT +
  (event_id          IS NOT NULL)::INT +
  (event_option_id   IS NOT NULL)::INT +
  (text_chunk_id     IS NOT NULL)::INT +
  (furniture_item_id IS NOT NULL)::INT +
  (comment_id        IS NOT NULL)::INT >= 1
);
