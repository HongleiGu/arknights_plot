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
--   1. Re-apply migrations 001_core … 005_rls in Supabase SQL editor.
--      (users + comments use CREATE TABLE IF NOT EXISTS, so they survive.)
--   2. Run `python scripts/run_pipeline.py` to repopulate.
-- ============================================================

BEGIN;

-- Annotation join tables (FKs into stories / chapters / nodes / comments)
DROP TABLE IF EXISTS correlation_members;
DROP TABLE IF EXISTS correlations;
DROP TABLE IF EXISTS comment_anchors;

-- Text-narrative chain (deepest children first)
DROP TABLE IF EXISTS branch_nodes;
DROP TABLE IF EXISTS predicate_branches;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS scenes;
DROP TABLE IF EXISTS chapter_descriptions;
DROP TABLE IF EXISTS chapters;

-- Registry grouping (FK into stories)
DROP TABLE IF EXISTS story_group_members;
DROP TABLE IF EXISTS story_groups;

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
