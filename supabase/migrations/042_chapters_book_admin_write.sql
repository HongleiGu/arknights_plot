-- ============================================================
-- 042_chapters_book_admin_write.sql  (AP-31)
--
-- Let an admin write the 大地巡旅 chapter rows — and only those.
--
-- Exactly the same hole as 041, one table over, and found the same way. `nodes`
-- got an admin-write policy when the page editor needed to apply a correction;
-- `chapters` never did, because nothing wrote it from the app. /admin/book now
-- does: renaming a chapter, deleting an emptied one, and compacting
-- order_in_story after a delete are all UPDATE/DELETE on `chapters`, and under
-- RLS the admin's own client can do none of them.
--
-- This is the failure mode 005 makes dangerous rather than loud: `chapters` is
-- public-read with no write policy at all, so an UPDATE matches zero rows and
-- reports success. The rename appears to work, the page re-renders from the
-- unchanged row, and it looks like a caching bug.
--
-- Scope is the book's own stories. Unlike 041 the predicate cannot be read off
-- the row — a chapter carries no category — so it subqueries `stories`. That is
-- safe from the mutual-recursion trap 032 documents because `stories`'s own
-- policy is `FOR SELECT USING (true)` and does not subquery back into
-- `chapters`; the rule is that two policies must not reference each other, not
-- that a policy may not reference another table. `chapters` is ~2,100 rows, so
-- the per-row EXISTS costs nothing at this size.
--
-- Deliberately NOT widened to 漫画. Comic episodes are upserted by
-- import_comics.py and carry no hand-edited structure yet (0 text nodes until
-- AP-33), so there is nothing for an admin to fix there — and a policy is
-- easier to widen later than to narrow after something depends on it.
--
-- FOR ALL rather than UPDATE-only: deleting an emptied chapter is half the
-- point, and creating one is the operation /admin/book still lacks.
-- ============================================================

DROP POLICY IF EXISTS "admin write book chapters" ON chapters;
CREATE POLICY "admin write book chapters" ON chapters FOR ALL
  USING (
    EXISTS (SELECT 1 FROM stories s
             WHERE s.id = chapters.story_id AND s.category = '大地巡旅')
    AND EXISTS (SELECT 1 FROM users
                 WHERE clerk_id = auth.uid()::text AND is_admin)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM stories s
             WHERE s.id = chapters.story_id AND s.category = '大地巡旅')
    AND EXISTS (SELECT 1 FROM users
                 WHERE clerk_id = auth.uid()::text AND is_admin)
  );
