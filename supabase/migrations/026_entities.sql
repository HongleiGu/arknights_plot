-- ============================================================
-- 026_entities.sql  (AP-22 · P1)
--
-- The cross-related world graph: entities (character / location / faction /
-- concept / artefact) + typed, self-referencing relationships. A grounded,
-- Postgres-native GraphRAG substrate — no Neo4j/Cypher (see AP-22 for the
-- rationale). Traversal is done with recursive CTEs; pgvector is deferred
-- until keyword + traversal proves insufficient.
--
-- `type` is free text (no CHECK) — a new entity class is data, not a
-- migration, same as gadgets.kind. Every relation carries source_refs
-- (@node/@chapter/@text citations) so the graph stays grounded to internal
-- canon, never pretraining.
--
-- Public read (derived from public content); writes go via the admin/
-- service-role pipeline (which bypasses RLS).
-- ============================================================

CREATE TABLE IF NOT EXISTS entities (
  id             SERIAL PRIMARY KEY,
  type           TEXT NOT NULL,                    -- character | location | faction | concept | artefact | …
  name           TEXT NOT NULL,
  name_en        TEXT,
  aliases        TEXT[] NOT NULL DEFAULT '{}',
  summary        TEXT,
  summary_status TEXT NOT NULL DEFAULT 'none',     -- none | scraped | ai_draft | verified
  source_url     TEXT,
  mention_count  INT NOT NULL DEFAULT 0,           -- appearance frequency (e.g. speaker lines) — ranking
  icon_sha1      TEXT,
  raw            JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (type, name)
);
CREATE INDEX IF NOT EXISTS idx_entities_type      ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name_lower ON entities(lower(name));

CREATE TABLE IF NOT EXISTS entity_relations (
  id             SERIAL PRIMARY KEY,
  from_entity_id INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity_id   INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'related',  -- 所属 / 盟友 / 敌对 / 位于 / 同一人 / …
  note           TEXT,
  source         TEXT,                             -- 'ai' | 'manual' | 'scraped'
  source_refs    TEXT[] NOT NULL DEFAULT '{}',     -- provenance: ['@node/123','@chapter/45']
  confidence     REAL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_entity_id, to_entity_id, kind),
  CONSTRAINT entity_relations_no_self CHECK (from_entity_id <> to_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_to   ON entity_relations(to_entity_id);

ALTER TABLE entities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_relations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read" ON entities;
CREATE POLICY "public read" ON entities FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin write" ON entities;
CREATE POLICY "admin write" ON entities FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));

DROP POLICY IF EXISTS "public read" ON entity_relations;
CREATE POLICY "public read" ON entity_relations FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin write" ON entity_relations;
CREATE POLICY "admin write" ON entity_relations FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));
