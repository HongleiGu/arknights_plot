-- ============================================================
-- 038_catalog_filters.sql
--
-- Two columns to make the 037 catalogs browsable, both promoted out of `raw`
-- rather than re-scraped.
--
--   enemies.debut     登场活动 — the event an enemy first appeared in.
--                     Already scraped into raw on 100% of 1780 rows, 102
--                     distinct values, no wiki markup. Backfilled here in one
--                     statement; scrape_enemies.py now writes it as a field.
--
--   items.item_group  A coarse bucket over Cargo's category1, which has 29
--                     values with a long tail (信物 420 … 其他干员道具 2) —
--                     usable as data, useless as a filter row.
--
-- Why item_group is computed in the importer rather than as a generated column:
-- the mapping needs a name fallback (103 items have NO category1, and most of
-- them are class tokens like 近卫信物原件 or vouchers like 寻访数据契约（…）),
-- so it is a judgement table, not an expression. Keeping it in
-- import_catalog.py means one readable place to change it, and re-running the
-- import is how it gets rewritten.
--
-- Measured distribution of the mapping over the current 1359 items:
--   信物 690 · 活动道具 164 · 干员养成 155 · 寻访凭证 131 · 消耗品 119
--   建造材料 58 · 其他道具 42
-- 活动道具 is split out deliberately: folded into 其他道具 it made that bucket
-- 15% and a dumping ground; separated, 其他道具 is a real 3% residual.
-- ============================================================

ALTER TABLE enemies ADD COLUMN IF NOT EXISTS debut TEXT;
CREATE INDEX IF NOT EXISTS idx_enemies_debut ON enemies(debut);

-- Backfill from what was already scraped. NULLIF so blank stays NULL rather
-- than becoming an empty-string filter value.
UPDATE enemies
   SET debut = NULLIF(btrim(raw->>'登场活动'), '')
 WHERE debut IS NULL
   AND raw ? '登场活动';

ALTER TABLE items ADD COLUMN IF NOT EXISTS item_group TEXT;
CREATE INDEX IF NOT EXISTS idx_items_group ON items(item_group);

-- item_group is left NULL here; populate it with
--   conda run -n study python scripts/import_catalog.py --only items
-- which upserts every row with the group the importer computes.
