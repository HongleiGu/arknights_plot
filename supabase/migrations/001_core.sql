-- ============================================================
-- 001_core.sql
--
-- Universal "registry" layer. Every piece of content — text
-- stories, future music albums (主题曲/乐章), roguelike runs
-- (集成战略), reclamation games (生息演算), etc. — gets a row
-- in `stories`. Content-shape-specific tables live in later
-- migrations and hang off `stories.id`.
-- ============================================================

-- One row per "thing the user can browse" (an arc, an album, a run, …).
-- `category` is the top-level grouping (主线 / 支线 / 故事集 /
-- 主题曲 / 乐章 / 集成战略 / 生息演算 / 四月辑录 / 特殊 / …).
CREATE TABLE stories (
  id           SERIAL PRIMARY KEY,
  category     TEXT NOT NULL,
  name         TEXT NOT NULL,           -- e.g. '骑兵与猎人', '黑暗时代·上'
  name_en      TEXT NOT NULL,           -- e.g. 'COME CATASTROPHES OR WAKES OF VULTURES'
                                        -- parse_plots.py inserts the Chinese name as a placeholder;
                                        -- scrape_story_pages.py overwrites with the wiki 副标题.
  description  TEXT,

  -- Image references. Each column stores ONLY the SHA1 (40 hex chars) used
  -- as the storage object key. The bucket ('data'), per-kind subdirectory
  -- ('story-icons' / 'story-titles' / 'story-covers'), and extension are
  -- implicit. Construct the full URL via src/lib/storage.ts.
  --
  -- SHA1 input = the relative path from data/ to the original local file,
  -- so identical filenames in different folders never collide.
  cover_sha1             TEXT,
  title_sha1             TEXT,
  icon_sha1              TEXT,
  image_source_filename  TEXT,

  arc          TEXT,                    -- thematic grouping, e.g. '觉醒', '幻灭'
  seq          INT,                     -- optional ordering within category

  UNIQUE (category, name)
);

-- Auth identity (Clerk → app user).
-- IF NOT EXISTS so this migration is safe to re-run after supabase/reset.sql,
-- which preserves the users table (and its rows) intact.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  clerk_id      TEXT NOT NULL UNIQUE,
  display_name  TEXT
);

-- A named cross-category cluster of stories.
-- Use cases:
--   • 主线: give each story arc (e.g. '黑暗时代', '切尔诺伯格') a canonical seq
--   • 支线: cluster thematically related events
-- `category` NULL = cross-category group.
CREATE TABLE story_groups (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT,
  description  TEXT,
  seq          INT
);

CREATE TABLE story_group_members (
  group_id  INT NOT NULL REFERENCES story_groups(id) ON DELETE CASCADE,
  story_id  INT NOT NULL REFERENCES stories(id)      ON DELETE CASCADE,
  seq       INT NOT NULL,
  PRIMARY KEY (group_id, story_id)
);

CREATE INDEX idx_stories_category ON stories(category, seq);
