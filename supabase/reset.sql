-- ============================================================
-- reset.sql
--
-- Wipe the stories / correlations / content chain, leaving users
-- and comments intact. No CASCADE — dropped explicitly in
-- dependency-respecting order.
--
-- Use this when the stories or chapter schema changes and you
-- want to re-bootstrap data from scratch.
--
-- After running this:
--   1. Re-apply migrations 001_core … 008_is_text in Supabase SQL editor.
--      (users + comments use CREATE TABLE IF NOT EXISTS, so they survive.)
--   2. Run `python scripts/run_pipeline.py` to repopulate.
-- ============================================================

BEGIN;

-- Annotation join tables (FKs into stories / chapters / nodes / gadgets /
-- comments). Dropped first so the gadget_id / node_id FKs are gone before
-- their targets.
DROP TABLE IF EXISTS correlation_members;
DROP TABLE IF EXISTS correlations;
DROP TABLE IF EXISTS comment_anchors;

-- Break the nodes ↔ predicate_branches cycle so the chain below can be
-- dropped in plain dependency order without CASCADE (002 added this FK
-- via ALTER for the same reason).
ALTER TABLE IF EXISTS nodes DROP CONSTRAINT IF EXISTS nodes_branch_fk;

-- IS supplementary text (008): text_chunks → text_clusters → stories.
DROP TABLE IF EXISTS text_chunks;
DROP TABLE IF EXISTS text_clusters;

-- Text-narrative chain (deepest children first). Branch dialogue is no
-- longer a separate table — it lives in `nodes` with branch_id set.
DROP TABLE IF EXISTS predicate_branches;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS scenes;
DROP TABLE IF EXISTS chapter_descriptions;
DROP TABLE IF EXISTS chapters;

-- Registry grouping (FK into stories)
DROP TABLE IF EXISTS story_group_members;
DROP TABLE IF EXISTS story_groups;

-- Per-shape catalog (FK into stories; its anchors were dropped above)
DROP TABLE IF EXISTS gadgets;

-- IS events (007): event_options self-references and FKs event_id; drop the
-- children before events, both before stories. Anchors were dropped above.
DROP TABLE IF EXISTS event_options;
DROP TABLE IF EXISTS events;

-- Furniture (010): items → stories
DROP TABLE IF EXISTS furniture_items;

-- The registry itself
DROP TABLE IF EXISTS stories;

-- Drop policies on preserved tables so 005_rls.sql can recreate them
-- without conflict. The users / comments tables and their data survive.
DROP POLICY IF EXISTS "public read" ON users;

DROP POLICY IF EXISTS "public read" ON comments;
DROP POLICY IF EXISTS "auth insert" ON comments;
DROP POLICY IF EXISTS "auth update" ON comments;
DROP POLICY IF EXISTS "auth delete" ON comments;

COMMIT;
