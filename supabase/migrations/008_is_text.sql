-- ============================================================
-- 008_is_text.sql
--
-- Clustered supplementary text for 集成战略 (and future shapes).
-- Fed by hand-maintained data/is_text.json → import_is_text.py.
-- NOT scraped; each theme's data is hand-authored.
--
--   text_clusters   — a named group of ordered chunks, anchored
--       to a stories row (the IS theme).  `kind` discriminates the
--       content shape:
--           'ending_supplement' — epilogue prose for one ending
--               chapter; `level_code` cross-references the matching
--               chapters row (soft tie — no FK — so the archive
--               survives if a chapter is later removed).
--           'character_record'  — one character's dossier; `title`
--               holds the character name.
--       Future shapes = new `kind` value; no migration needed.
--       The cluster is always story-anchored (story_id NOT NULL),
--       the same direction that chapters and gadgets already use —
--       the registry itself (stories) gains no outbound pointer.
--
--   text_chunks     — one row per prose chunk inside a cluster,
--       ordered by `seq`.  `title` is optional (per-chunk heading).
--       Each chunk is its own row so it can be individually
--       addressed by a future comment_anchors / correlation_members
--       widening (add `text_chunk_id` via ALTER, exactly like 006/007
--       added gadget_id / event_option_id).  Not wired yet — the row
--       identity is the enabler; annotation on supplements wasn't
--       requested in 008.
--
-- No UNIQUE constraint on text_clusters: idempotent import uses
-- replace-per-story (delete the story's clusters of the relevant
-- kind, re-insert), the same idiom import_events.py uses.
--
-- Additive: runs after 007.  Bootstrap order 001 … 008.
-- reset.sql drops text_chunks then text_clusters before stories.
-- ============================================================

CREATE TABLE text_clusters (
  id         SERIAL PRIMARY KEY,
  story_id   INT  NOT NULL REFERENCES stories(id) ON DELETE CASCADE,

  kind       TEXT NOT NULL,         -- 'ending_supplement' | 'character_record' | …
  title      TEXT,                  -- character name (character_record); NULL for endings
  title_en   TEXT,
  level_code  TEXT,                  -- ending_supplement only: the matching chapter level_code
  image_sha1  TEXT,                  -- ending_supplement only: storage key for ending banner image
  seq         INT  NOT NULL DEFAULT 0,
  raw         JSONB
);

CREATE TABLE text_chunks (
  id          SERIAL PRIMARY KEY,
  cluster_id  INT  NOT NULL REFERENCES text_clusters(id) ON DELETE CASCADE,

  seq         INT  NOT NULL,
  title       TEXT,
  body        TEXT NOT NULL,
  raw         JSONB
);

CREATE INDEX idx_text_clusters_story      ON text_clusters(story_id);
CREATE INDEX idx_text_clusters_story_kind ON text_clusters(story_id, kind);
CREATE INDEX idx_text_clusters_level_code ON text_clusters(story_id, level_code)
  WHERE level_code IS NOT NULL;
CREATE INDEX idx_text_chunks_cluster      ON text_chunks(cluster_id, seq);

-- ---- RLS: public read, same as the rest of the content layer ----

ALTER TABLE text_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON text_clusters FOR SELECT USING (true);

ALTER TABLE text_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON text_chunks FOR SELECT USING (true);
