-- ============================================================
-- 025_content_summaries.sql  (AP-23)
--
-- System-level content summaries — one AI-generated summary per chapter and
-- per story, so the assistant can answer high-level questions from a cheap
-- outline instead of reading thousands of raw nodes.
--
-- Distinct from ai_memory (021): ai_memory is agent-jotted, ad-hoc, topic-keyed
-- facts; this is systematic, one-row-per-content, admin-generated. Public read
-- (derived from public content), admin write (generation is admin-gated).
--
-- Exactly one of story_id / chapter_id per row; unique per target so
-- generation is idempotent (replace-per-target in the action).
-- ============================================================

CREATE TABLE IF NOT EXISTS content_summaries (
  id         SERIAL PRIMARY KEY,
  story_id   INT REFERENCES stories(id)  ON DELETE CASCADE,
  chapter_id INT REFERENCES chapters(id) ON DELETE CASCADE,
  summary    TEXT NOT NULL,
  model      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT content_summaries_one_target CHECK (
    (story_id IS NOT NULL)::INT + (chapter_id IS NOT NULL)::INT = 1
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_summaries_story
  ON content_summaries(story_id)   WHERE story_id   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_summaries_chapter
  ON content_summaries(chapter_id) WHERE chapter_id IS NOT NULL;

ALTER TABLE content_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read" ON content_summaries;
CREATE POLICY "public read" ON content_summaries FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin write" ON content_summaries;
CREATE POLICY "admin write" ON content_summaries FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));
