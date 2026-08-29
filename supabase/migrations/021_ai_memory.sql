-- ============================================================
-- 021_ai_memory.sql  (AP-16)
--
-- Persistent, cross-session memory for the AI assistant — a small store of
-- AI-distilled facts so repeated questions skip re-retrieval (token saver).
--
-- Agent-driven: the assistant calls recall(query) to consult it and
-- memorize(topic, content, sources) to write a durable finding. Content is
-- AI-authored from canonical plot data (not user text), so injection risk is
-- low — but the assistant still treats recalled memory as a hint, verifying
-- against source when it matters.
--
-- topic is a normalized key (e.g. 'character:多萝西') → UNIQUE for upsert.
-- Writes are admin-only for now (the assistant runs admin-gated); reads are
-- public (distilled canonical facts are safe to surface).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_memory (
  id         SERIAL PRIMARY KEY,
  topic      TEXT NOT NULL,
  content    TEXT NOT NULL,
  sources    TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (topic)
);
CREATE INDEX IF NOT EXISTS idx_ai_memory_topic ON ai_memory (lower(topic));

ALTER TABLE ai_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read" ON ai_memory;
CREATE POLICY "public read" ON ai_memory FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin insert" ON ai_memory;
CREATE POLICY "admin insert" ON ai_memory FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
);

DROP POLICY IF EXISTS "admin update" ON ai_memory;
CREATE POLICY "admin update" ON ai_memory FOR UPDATE USING (
  EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
);

DROP POLICY IF EXISTS "admin delete" ON ai_memory;
CREATE POLICY "admin delete" ON ai_memory FOR DELETE USING (
  EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
);
