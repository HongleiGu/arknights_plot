-- ============================================================
-- 041_nodes_book_admin_write.sql  (AP-31)
--
-- Let an admin write the 大地巡旅 nodes — and only those.
--
-- `nodes` is public-read with no client write policy: every write comes from
-- the service-role pipeline. That was right while the table held nothing but
-- scraped AVG script. The book's proofreading editor (040) breaks it: applying
-- a corrected page has to rewrite that page's nodes so the reader shows the fix
-- immediately, and under RLS the admin's own client cannot, which surfaces as
--   new row violates row-level security policy for table "nodes"
--
-- Two ways to fix it, and the reason for this one:
--   * Use the service role inside the server action — rejected. AP-19's whole
--     point is that app-side writes go through RLS rather than around it, so a
--     mistake is refused by the database instead of relying on a code path
--     staying correct.
--   * Widen `nodes` for admins — but NOT the whole table. `nodes` is 415,111
--     rows of game script; the book is 4,267 of them.
--
-- The scope predicate is `raw_params->>'source'`, which import_book.py stamps
-- as 'mineru' (imported) or 'override' (applied from a correction). Measured
-- before writing this: exactly 4,267 rows carry it and every one is the book,
-- so the predicate separates the two populations cleanly. It reads only the
-- row itself — no subquery into chapters/stories — so it costs nothing per row
-- and cannot trip the mutual-policy recursion trap 032 documents.
--
-- FOR ALL rather than INSERT-only on purpose: applying a page deletes the old
-- nodes and inserts the new ones. With INSERT alone the delete would silently
-- affect zero rows (RLS filters it, it does not error) and the page would end
-- up with both versions.
-- ============================================================

DROP POLICY IF EXISTS "admin write book nodes" ON nodes;
CREATE POLICY "admin write book nodes" ON nodes FOR ALL
  USING (
    raw_params->>'source' IN ('mineru', 'override')
    AND EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
  )
  WITH CHECK (
    raw_params->>'source' IN ('mineru', 'override')
    AND EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin)
  );

-- The editor filters nodes by printed page, which is a JSONB lookup over the
-- whole table without this.
CREATE INDEX IF NOT EXISTS idx_nodes_book_page
  ON nodes ((raw_params->>'page')) WHERE raw_params->>'source' IS NOT NULL;
