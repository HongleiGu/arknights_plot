-- ============================================================
-- 003_chapter_descriptions.sql
--
-- Per-chapter prose descriptions, sourced from external places.
-- Keyed by (chapter_id, source) so re-importing a source upserts
-- without disturbing rows from other sources or user edits.
--
-- Today's sources:
--   • 'prts.wiki/情报处理室' — 行动前/后/幕间 blurbs scraped from
--     https://prts.wiki/w/情报处理室 (only covers 支线 events).
--
-- Future sources (just pick a unique string per source):
--   • 'prts.wiki/<another-page>'
--   • 'user_edit' — manually curated overrides
--   • 'ai_summary' — generated summaries
-- ============================================================

CREATE TABLE chapter_descriptions (
  id          SERIAL PRIMARY KEY,
  chapter_id  INT  NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  body        TEXT NOT NULL,
  scraped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chapter_id, source)
);

CREATE INDEX idx_chapter_descriptions_chapter ON chapter_descriptions(chapter_id);
