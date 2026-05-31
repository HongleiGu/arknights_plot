-- ============================================================
-- 010_furniture.sql
--
-- Per-shape extension for the in-game furniture (家具) system.
-- Follows the same gadgets-style pattern (006_gadgets.sql):
-- a single table hanging off stories.id with no intermediate
-- "theme" layer.
--
-- Furniture is organised into two kinds of `stories` rows
-- (both with category='家具'):
--
--   主题 (themed sets) — arc = section label.
--       Known sections: '宿舍/活动室主题', '会客室主题'.
--       stories carries: name, description, icon_sha1.
--       This table carries: individual pieces + theme-level
--       metadata (atmo_total, date_added, acquisition) stored
--       per-item (same value for every piece in a theme).
--
--   散件 (standalone pieces) — arc = '散件'.
--       Each subcategory ('信赖', '饰牌', '掉落', …) gets its
--       own `stories` row (name = '散件/<subcat>').
--       Items have atmo_total / date_added / acquisition NULL.
--
-- Additive: runs after 009.  reset.sql must drop
-- furniture_items before stories.
--
-- Scrape:  python scripts/scrape_furniture.py
-- Upload:  python scripts/upload_furniture_icons.py
-- Import:  python scripts/import_furniture.py
-- ============================================================

CREATE TABLE furniture_items (
  id               SERIAL PRIMARY KEY,
  story_id         INT  NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  wiki_href        TEXT,
  description      TEXT,
  atmo_value       INT,
  icon_sha1        TEXT,
  seq              INT  NOT NULL DEFAULT 0,
  raw              JSONB,

  -- Theme-level metadata (NULL for standalone items).
  -- Identical across all items of the same themed set.
  atmo_total       INT,
  date_added       TEXT,
  acquisition      TEXT,

  UNIQUE (story_id, name)
);

CREATE INDEX idx_furniture_items_story ON furniture_items(story_id, seq);

-- ---- RLS: public read, same as the rest of the content layer ----

ALTER TABLE furniture_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON furniture_items FOR SELECT USING (true);
