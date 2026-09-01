-- ============================================================
-- 037_enemies_items.sql
--
-- Two global catalogs: 敌人 (enemies) and 道具 (items).
--
-- Unlike every per-shape table so far, these do NOT reference `stories`.
-- gadgets/events/text_clusters/furniture all hang off a story because they
-- belong to one 集成战略 theme or event. An enemy or an item belongs to the
-- game, not to a story — the same 源石虫 appears across dozens of them. So
-- they are peers of `stories` rather than children, the same way `entities`
-- (026) is.
--
-- Sources are different for each, and both are structured rather than scraped
-- HTML:
--   items   — prts.wiki exposes a Cargo table `item` with exactly the fields
--             we want (name, description, obtain_method, rarity, iconId).
--             One API call, no parsing. 道具一览 itself is just
--             {{#cargo_query:}} + a JS widget, so there is nothing in its
--             wikitext to scrape.
--   enemies — no Cargo table. Enumerated from Category:敌人 (paginated, the
--             same idiom scrape_operator_profile.py uses for Category:干员),
--             then each page's {{敌人信息/common2}} infobox is parsed for
--             名称 / 描述 / 种类 / 地位级别, and the [[文件:…]] thumbnail is
--             the asset. 敌人一览 is a bare {{#widget:EnemiesListV2}}.
--
-- icon_sha1 follows the established convention exactly: sha1 of the
-- data/-relative path of the downloaded file, uploaded to R2 under
-- <kind>-icons/<sha1>.png. URL construction lives in src/lib/storage.ts.
--
-- UNIQUE(name) on both so the importers can upsert idempotently — these are
-- flat catalogs with no natural parent to scope a key by.
--
-- Public content: RLS on, read-only to clients. Writes go through the
-- service-role pipeline, which bypasses RLS.
-- ============================================================

-- ---- enemies ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enemies (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  -- Wiki's own ordering key (index=B1 etc.); handy for a stable sort that
  -- matches how players expect the bestiary to read.
  code         TEXT,
  description  TEXT,
  -- 种类 (感染生物 / 萨卡兹 / …) and 地位级别 (普通 / 精英 / BOSS). Free text,
  -- no CHECK — a new class is data, not a migration (same as gadgets.kind).
  kind         TEXT,
  rank         TEXT,
  icon_sha1    TEXT,
  wiki_href    TEXT,
  raw          JSONB,
  seq          INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_enemies_kind ON enemies(kind);
CREATE INDEX IF NOT EXISTS idx_enemies_name ON enemies(lower(name));

ALTER TABLE enemies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON enemies;
CREATE POLICY "public read" ON enemies FOR SELECT USING (true);

-- ---- items -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT,
  -- Cargo's `purpose` (用途) and `obtain method` (获得方式).
  usage_text     TEXT,
  obtain_method  TEXT,
  rarity         INT,
  -- Cargo ships three category columns; we keep them joined for filtering and
  -- the originals in `raw`.
  category       TEXT,
  -- Cargo's itemId — the game's own key, stable across renames.
  item_key       TEXT,
  icon_sha1      TEXT,
  wiki_href      TEXT,
  raw            JSONB,
  seq            INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_rarity   ON items(rarity);
CREATE INDEX IF NOT EXISTS idx_items_name     ON items(lower(name));

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON items;
CREATE POLICY "public read" ON items FOR SELECT USING (true);

-- ---- annotation anchors ----------------------------------------------------
-- Follows the 006/007/011/027 idiom: add a nullable FK and re-state the CHECK,
-- rather than renumbering 004. This is what lets a comment be pinned to an
-- enemy and what makes @enemy/12 resolve in board nodes and AI answers —
-- correlation_member_refs (033) is generic over `@word/digits`, so board
-- citations work as soon as lib/references.ts can resolve the type.
ALTER TABLE comment_anchors ADD COLUMN IF NOT EXISTS enemy_id INT REFERENCES enemies(id) ON DELETE CASCADE;
ALTER TABLE comment_anchors ADD COLUMN IF NOT EXISTS item_id  INT REFERENCES items(id)   ON DELETE CASCADE;

ALTER TABLE comment_anchors DROP CONSTRAINT IF EXISTS exactly_one_anchor;
ALTER TABLE comment_anchors ADD CONSTRAINT exactly_one_anchor CHECK (
  (story_id          IS NOT NULL)::INT +
  (chapter_id        IS NOT NULL)::INT +
  (node_id           IS NOT NULL)::INT +
  (gadget_id         IS NOT NULL)::INT +
  (event_id          IS NOT NULL)::INT +
  (event_option_id   IS NOT NULL)::INT +
  (text_chunk_id     IS NOT NULL)::INT +
  (furniture_item_id IS NOT NULL)::INT +
  (entity_id         IS NOT NULL)::INT +
  (enemy_id          IS NOT NULL)::INT +
  (item_id           IS NOT NULL)::INT = 1
);
CREATE INDEX IF NOT EXISTS idx_comment_anchors_enemy ON comment_anchors(enemy_id);
CREATE INDEX IF NOT EXISTS idx_comment_anchors_item  ON comment_anchors(item_id);
