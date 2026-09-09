-- ============================================================
-- 040_book_page_overrides.sql  (AP-31)
--
-- Hand-corrected text for one printed page of 大地巡旅.
--
-- Why a side table rather than editing `nodes`
-- --------------------------------------------
-- `import_book.py` deletes and re-inserts every chapter of the book, so a node
-- edited in place is destroyed by the next import with no warning and no diff.
-- Proofreading 400 pages and losing it to a re-run is the failure this table
-- exists to prevent: the import wipes `chapters`/`nodes`, never this, and
-- re-applies the overrides on the way back in.
--
-- Why it supersedes data/book_corrections.json
-- --------------------------------------------
-- That file can only do find/replace, which cannot reorder two paragraphs,
-- split one that OCR merged, merge two it split, or drop a block of page
-- furniture. Aligning a scan to the printed book needs all four. The
-- corrections file stays useful for a single wrong word that recurs across many
-- pages (one rule fixes every occurrence); this is for making one page right.
--
-- Why the whole page, as text
-- ---------------------------
-- Chunks per page: median 9, max 33 — small enough to edit as one plain-text
-- field, where reordering is moving a line and splitting is pressing Enter. A
-- per-chunk schema would need stable chunk identity across re-OCR, which does
-- not exist: MinerU can legitimately return a different number of blocks for
-- the same page.
--
--   paragraph text
--
--   # a heading
--
--   [[img:p0120_01.png|optional caption]]
--
-- Blocks separated by a blank line; `#` marks a heading; `[[img:…]]` pins an
-- illustration in the flow. Parsing lives in import_book.py.
--
-- `source_hash` is the hash of MinerU's own text for that page at the moment it
-- was edited. If a later OCR run changes that page, the override still applies
-- (a human read the scan; the model did not) but is reported as stale, so the
-- edit can be revisited rather than silently masking new upstream text.
-- ============================================================

CREATE TABLE IF NOT EXISTS book_page_overrides (
  -- The printed page number, which is the only identifier stable across
  -- re-OCR, re-sectioning and re-import.
  page        INT PRIMARY KEY,
  body        TEXT NOT NULL,
  source_hash TEXT,
  note        TEXT,
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE book_page_overrides ENABLE ROW LEVEL SECURITY;

-- Public read: the corrected text is what the reader renders, and the reader is
-- public. Writes are admin-only — this is an editorial surface, not user
-- content, and a bad edit silently rewrites the book.
DROP POLICY IF EXISTS "public read" ON book_page_overrides;
CREATE POLICY "public read" ON book_page_overrides FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin write" ON book_page_overrides;
CREATE POLICY "admin write" ON book_page_overrides FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));
