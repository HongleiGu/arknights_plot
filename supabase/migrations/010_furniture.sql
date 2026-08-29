-- ============================================================
-- 010_furniture.sql
--
-- 生息演算 base-building furniture catalog (家具). One row per furniture
-- item, FK → owning 家具 story (stories.category='家具'). Loaded by
-- scripts/scrape_furniture.py → import_furniture.py (replace-per-story:
-- delete the story's items, re-insert — so no UNIQUE key is needed).
--
-- NOTE: this file was reconstructed during the AP-19 RLS audit — the original
-- had been truncated to a stray "su" (the live table was unaffected, but a
-- fresh bootstrap would have failed at 011's FK). Schema mirrors the live
-- table; CREATE ... IF NOT EXISTS makes it a no-op against the existing DB.
--
-- Public content → RLS on, read-only to clients (writes go via the
-- service-role pipeline, which bypasses RLS).
-- ============================================================

CREATE TABLE IF NOT EXISTS furniture_items (
  id          SERIAL PRIMARY KEY,
  story_id    INT REFERENCES stories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  wiki_href   TEXT,
  description TEXT,
  atmo_value  INT,
  atmo_total  INT,
  icon_sha1   TEXT,
  seq         INT NOT NULL DEFAULT 0,
  raw         JSONB,
  date_added  TEXT,
  acquisition TEXT
);
CREATE INDEX IF NOT EXISTS idx_furniture_items_story ON furniture_items(story_id);

ALTER TABLE furniture_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON furniture_items;
CREATE POLICY "public read" ON furniture_items FOR SELECT USING (true);
