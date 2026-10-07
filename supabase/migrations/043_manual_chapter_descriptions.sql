-- ============================================================
-- 043_manual_chapter_descriptions.sql  (AP-37)
--
-- Let an admin write chapter descriptions by hand, without being able to
-- destroy the scraped ones — and give every reader one obvious row per chapter.
--
-- Why this is needed at all: the official 情报处理室 summaries cover 973 of the
-- 1,046 支线 chapters and **none** of the 427 主线 ones. Measured: that page's
-- wikitext contains zero occurrences of 二次呼吸, 黑暗时代, 异卵同生 or even the
-- word 主线, so no amount of re-scraping it will fill the gap. Main-story
-- descriptions have to be entered, or sourced from somewhere not yet found.
--
-- `source = 'manual'` rather than editing the scraped row:
-- import_wiki_descriptions.py upserts on (chapter_id, source) with its own
-- SOURCE, so a row under a different source is invisible to it. That is the
-- same shape as book_page_overrides (040) and import_comics.py's file_path
-- upsert — the importer reads or ignores, never overwrites. Editing the
-- scraped row in place would be undone by the next --sync with no warning.
--
-- The policy is row-local (`source = 'manual'`), like 041's raw_params check
-- and unlike 042's subquery: an admin may create, edit and delete manual rows,
-- and may not touch a scraped one at all. If the wiki text is wrong, the answer
-- is to write a manual row that wins, not to silently rewrite the scrape —
-- which would then be re-scraped back.
--
-- The view exists because the schema has ALWAYS allowed several rows per
-- chapter but every reader assumed one: `.maybeSingle()` in lib/ai/tools.ts and
-- friends raises PGRST116 the moment a chapter has both a scraped and a manual
-- row. Putting the precedence in one place beats fixing the same `ORDER BY` in
-- seven call sites and hoping the eighth remembers.
-- ============================================================

DROP POLICY IF EXISTS "admin write manual descriptions" ON chapter_descriptions;
CREATE POLICY "admin write manual descriptions" ON chapter_descriptions FOR ALL
  USING (
    source = 'manual'
    AND EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
  )
  WITH CHECK (
    source = 'manual'
    AND EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
  );

-- One row per chapter: a hand-written description wins over a scraped one.
-- DISTINCT ON needs the ORDER BY to lead with the same expression, so the
-- precedence is the `source = 'manual' DESC` term — true sorts first.
CREATE OR REPLACE VIEW chapter_description_effective AS
SELECT DISTINCT ON (chapter_id)
       id, chapter_id, source, body, scraped_at,
       (source = 'manual') AS is_manual
  FROM chapter_descriptions
 ORDER BY chapter_id, (source = 'manual') DESC, scraped_at DESC;

-- A view runs with the privileges of its owner unless told otherwise, which
-- would bypass RLS on the table beneath it. `security_invoker` makes it obey
-- the caller's policies — here that only means public read, but a view that
-- quietly escalates is the kind of thing that is discovered much later.
ALTER VIEW chapter_description_effective SET (security_invoker = on);

GRANT SELECT ON chapter_description_effective TO anon, authenticated;
