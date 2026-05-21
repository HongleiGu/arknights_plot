-- ============================================================
-- 006_gadgets.sql
--
-- Per-shape extension for the "gadget" family: the fixed, finite
-- catalog of named things a 集成战略 / 生息演算 theme ships with —
-- 藏品 (relics/collectibles), 分队 (squads), 结局 (endings),
-- reclamation tools, etc. Each is a named entity with an icon,
-- flavour text, and a mechanical effect. The narrative + decision
-- side of these modes already flows through the text-narrative
-- shape (002) — this only covers the catalog side.
--
-- One row per gadget, FK to the owning `stories` theme. This is
-- additive: it runs after 005 and ALTERs the annotation layer to
-- make gadgets anchorable (CLAUDE.md: "to add a new anchor type,
-- add a nullable FK column to comment_anchors and extend its
-- CHECK"). Bootstrap order is therefore 001 … 006; reset.sql
-- drops `gadgets` before `stories`.
-- ============================================================

CREATE TABLE gadgets (
  id           SERIAL PRIMARY KEY,
  story_id     INT  NOT NULL REFERENCES stories(id) ON DELETE CASCADE,

  -- Free-text on purpose. Conventional values: 'relic' (藏品),
  -- 'squad' (分队), 'ending' (结局), 'tool' (生息演算 道具),
  -- 'recruit', 'other'. No CHECK — a new theme inventing a new
  -- gadget class is data, not a migration.
  kind         TEXT NOT NULL,

  name         TEXT NOT NULL,
  name_en      TEXT,
  description  TEXT,                  -- flavour / lore text
  effect       TEXT,                  -- mechanical effect (usually a distinct field on the wiki)

  -- Same storage convention as stories.*_sha1: only the 40-hex
  -- SHA1 key; bucket/subdir/ext implicit. NULL until an icon is
  -- uploaded (gadget art upload is a separate, later concern).
  icon_sha1    TEXT,

  seq          INT,                   -- display order within (story_id, kind)
  raw          JSONB,                 -- theme-specific extras (rarity, cost, unlock cond…)

  -- Idempotent import key: a theme never has two same-kind gadgets
  -- with the same name.
  UNIQUE (story_id, kind, name)
);

CREATE INDEX idx_gadgets_story_kind ON gadgets(story_id, kind, seq);

-- ---- Make gadgets anchorable (comments + correlations) --------------------
-- 004 created these tables with the pre-gadget CHECK; widen it here.

ALTER TABLE comment_anchors
  ADD COLUMN IF NOT EXISTS gadget_id INT REFERENCES gadgets(id) ON DELETE CASCADE;

ALTER TABLE comment_anchors DROP CONSTRAINT IF EXISTS exactly_one_anchor;
ALTER TABLE comment_anchors ADD CONSTRAINT exactly_one_anchor CHECK (
  (story_id   IS NOT NULL)::INT +
  (chapter_id IS NOT NULL)::INT +
  (node_id    IS NOT NULL)::INT +
  (gadget_id  IS NOT NULL)::INT = 1
);

CREATE INDEX idx_comment_anchors_gadget ON comment_anchors(gadget_id);

ALTER TABLE correlation_members
  ADD COLUMN IF NOT EXISTS gadget_id INT REFERENCES gadgets(id) ON DELETE CASCADE;

ALTER TABLE correlation_members DROP CONSTRAINT IF EXISTS at_least_one_member;
ALTER TABLE correlation_members ADD CONSTRAINT at_least_one_member CHECK (
  (story_id   IS NOT NULL)::INT +
  (chapter_id IS NOT NULL)::INT +
  (node_id    IS NOT NULL)::INT +
  (gadget_id  IS NOT NULL)::INT +
  (comment_id IS NOT NULL)::INT >= 1
);

-- ---- RLS: public read, same as the rest of the content layer -------------

ALTER TABLE gadgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON gadgets FOR SELECT USING (true);
