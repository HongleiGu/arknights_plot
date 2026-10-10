-- ============================================================
-- 045_story_review_progress.sql  (AP-35/AP-36)
--
-- Per-story review progress, grouped in the database.
--
-- Entity review moved from a global queue to a per-story one, because name
-- similarity across 715 stories is where coincidence lives: 安娜 is not 薇薇安娜,
-- 瑟琳 is not 凯瑟琳, and a rule that pairs them by spelling produces confident
-- mistakes. Inside ONE story the cast is a few dozen names, "is 模糊的声音 someone
-- who also speaks here" is answerable by reading it, and a wrong pairing cannot
-- be imported from a story the reviewer never opened.
--
-- That needs a work list: which stories still have unjudged speakers. Computing
-- it by calling scope_speakers() once per story takes ~90s over the wire for 715
-- stories, which is not a page load. One grouped query is.
--
-- The exclusions match scope_speakers() (034) and seed_entities.py exactly —
-- narration and `？？？` are not people to judge — and must stay in step with
-- them, or the counts here will disagree with the cast list the page shows.
--
-- STABLE + SECURITY INVOKER: `nodes`, `chapters`, `stories` and `entities` are
-- all public-read, so this reads under the caller's own RLS and grants nothing
-- extra (AP-19).
-- ============================================================

CREATE OR REPLACE FUNCTION story_review_progress()
RETURNS TABLE (
  story_id   INT,
  story_name TEXT,
  category   TEXT,
  speakers   BIGINT,   -- distinct judgeable speakers in this story
  unresolved BIGINT,   -- ... of which no human has judged yet
  lines      BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT s.id, s.name, s.category,
         COUNT(DISTINCT n.speaker)::BIGINT,
         -- A speaker counts as resolved only when its entity says a human
         -- looked: `review = 'reviewed'`. A missing entity row counts as
         -- unresolved rather than being skipped, since a speaker with no vertex
         -- is precisely something to look at.
         COUNT(DISTINCT n.speaker) FILTER (
           WHERE e.id IS NULL OR e.review IS DISTINCT FROM 'reviewed'
         )::BIGINT,
         COUNT(*)::BIGINT
    FROM stories s
    JOIN chapters c ON c.story_id = s.id
    JOIN nodes    n ON n.chapter_id = c.id
    LEFT JOIN entities e ON e.type = 'character' AND e.name = n.speaker
   WHERE n.speaker IS NOT NULL
     AND btrim(n.speaker) <> ''
     AND n.speaker <> 'narrator'
     AND btrim(n.speaker) !~ '^[？?]+$'
   GROUP BY s.id, s.name, s.category
$$;

GRANT EXECUTE ON FUNCTION story_review_progress() TO anon, authenticated;

-- This function scans every node by design (it has no selective predicate), so
-- the index below is NOT for it. It is for `getEntityEvidence`, which asks
-- `WHERE speaker = $1` across all 414,720 rows to show where a name speaks —
-- today a full scan on every expansion in the review UI.
--
-- `034` already has `idx_nodes_chapter_speaker (chapter_id, speaker)`, which
-- cannot serve that: its leading column is `chapter_id`, and a bare equality on
-- the second column of a composite index does not get an index scan.
CREATE INDEX IF NOT EXISTS idx_nodes_speaker ON nodes(speaker);
