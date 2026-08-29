-- ============================================================
-- 034_scope_speakers.sql
--
-- Speaker list for the citation picker's scope row (033), computed in the
-- database instead of over the wire.
--
-- The first cut of listSpeakers() selected `speaker` for every node in scope
-- (capped at 8000 rows) and de-duplicated in JS, because PostgREST has no
-- DISTINCT. That is fine for one chapter and wasteful for a whole story — and
-- worse, the cap silently truncated the list, so a long story's less frequent
-- speakers just never appeared in the dropdown.
--
-- A GROUP BY here ships one row per speaker (tens), not one per line
-- (thousands), and drops the cap entirely.
--
-- STABLE + SECURITY INVOKER: `nodes` and `chapters` are public-read, so this
-- reads under the caller's own RLS and grants nothing extra (AP-19).
-- ============================================================

-- Exactly one of p_chapter / p_story is honoured: chapter wins when supplied,
-- since it is the narrower scope. Passing neither returns nothing rather than
-- scanning every line in the game.
CREATE OR REPLACE FUNCTION scope_speakers(p_story INT DEFAULT NULL, p_chapter INT DEFAULT NULL)
RETURNS TABLE (speaker TEXT, lines BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT n.speaker, COUNT(*)::BIGINT AS lines
    FROM nodes n
    JOIN chapters c ON c.id = n.chapter_id
   WHERE CASE
           WHEN p_chapter IS NOT NULL THEN n.chapter_id = p_chapter
           WHEN p_story   IS NOT NULL THEN c.story_id   = p_story
           ELSE FALSE
         END
     AND n.speaker IS NOT NULL
     AND btrim(n.speaker) <> ''
     -- Same exclusions as scripts/seed_entities.py: narration and unknowns
     -- aren't people you would filter dialogue by.
     AND n.speaker <> 'narrator'
     AND btrim(n.speaker) !~ '^[？?]+$'
   GROUP BY n.speaker
   ORDER BY lines DESC, n.speaker
$$;
GRANT EXECUTE ON FUNCTION scope_speakers(INT, INT) TO anon, authenticated;

-- Supports both the chapter-scoped filter and the story-scoped join.
CREATE INDEX IF NOT EXISTS idx_nodes_chapter_speaker ON nodes(chapter_id, speaker);
