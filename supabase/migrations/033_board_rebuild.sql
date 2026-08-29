-- ============================================================
-- 033_board_rebuild.sql
--
-- Rebuilds the clue board around ONE node type.
--
-- Before: a member was either a typed anchor (one of nine FK columns) or a
-- free-text card, and a board that cited five dialogue lines needed five
-- cards. Evidence and reasoning were the same kind of object, so a wild guess
-- and a quoted line looked identical on the canvas.
--
-- After: a member is just **text + an optional image**. Evidence is cited
-- *inside* that text as `@type/id` tokens — the same cross-reference idiom
-- comments have used since AP-2 — rendered as chips with hover previews.
--
-- Why this is better than a `role` column: "is this claim grounded?" becomes
-- DERIVED (a node with no refs cites nothing) instead of a flag the author has
-- to set honestly. And one claim node can now cite five lines at once.
--
-- correlation_member_refs is the derived index over those tokens. It exists so
-- AP-13 backlinks ("this fragment appears in N boards") keep working — they
-- used to read the FK columns this migration drops. Backlinks actually get
-- BETTER: five citations in one node produce five backlinks.
--
-- correlations + correlation_shares (019/032) are untouched — the container
-- and its sharing model were never the problem.
--
-- DESTRUCTIVE: drops correlation_members + correlation_edges and everything in
-- them. Authorised explicitly; live data at the time was 1 board / 3 members /
-- 1 edge. correlations rows (the boards themselves) survive.
-- ============================================================

-- ---- 1. out with the old ----------------------------------------------------
-- Edges first: they FK to members.
DROP TABLE IF EXISTS correlation_edges;
DROP TABLE IF EXISTS correlation_members;

-- ---- 2. the single node type ------------------------------------------------
CREATE TABLE correlation_members (
  id             SERIAL PRIMARY KEY,
  correlation_id INT NOT NULL REFERENCES correlations(id) ON DELETE CASCADE,
  -- Optional heading, then the body: markdown + `@type/id` citations.
  title          TEXT,
  body           TEXT NOT NULL DEFAULT '',
  -- One distinguished image per node (R2 public URL). Body markdown may still
  -- embed more; this is the one the card renders as its picture. Dimensions are
  -- stored so the canvas can lay out without waiting on the image to load.
  image_url      TEXT,
  image_w        INT,
  image_h        INT,
  -- canvas position / timeline order
  x              DOUBLE PRECISION NOT NULL DEFAULT 0,
  y              DOUBLE PRECISION NOT NULL DEFAULT 0,
  seq            INT NOT NULL DEFAULT 0,
  -- free-form extras (colour, collapsed, …) — decoration only, per 018
  data           JSONB,
  created_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_correlation_members_board ON correlation_members(correlation_id);
ALTER TABLE correlation_members ENABLE ROW LEVEL SECURITY;

-- ---- 3. edges ---------------------------------------------------------------
-- With one node type, edges carry ALL the argument structure, so `kind` matters
-- more than it did. Vocabulary is free text (no CHECK) — a new kind is data,
-- not a migration, same as gadgets.kind. The preset list lives in the editor.
--
-- Dropped from the old vocabulary: same / allied / opposed. Those are claims
-- about Terra, not about your reasoning, and they now duplicate AP-22's
-- entity_relations — which carry source citations, unlike a hand-drawn line.
-- The board should DISPLAY those, not let you redraw them by hand.
CREATE TABLE correlation_edges (
  id             SERIAL PRIMARY KEY,
  correlation_id INT NOT NULL REFERENCES correlations(id)        ON DELETE CASCADE,
  from_member    INT NOT NULL REFERENCES correlation_members(id) ON DELETE CASCADE,
  to_member      INT NOT NULL REFERENCES correlation_members(id) ON DELETE CASCADE,
  kind           TEXT,
  label          TEXT,
  directed       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_correlation_edges_board ON correlation_edges(correlation_id);
ALTER TABLE correlation_edges ENABLE ROW LEVEL SECURITY;

-- ---- 4. derived citation index ---------------------------------------------
-- Never written by the app: a trigger keeps it in step with the member text, so
-- it cannot drift no matter who writes the row (action, SQL editor, import).
--
-- correlation_id is denormalised so a backlink query filters by board without
-- joining members. ref_id is BIGINT and the regex caps the digit run, so a
-- typo like `@node/99999999999999999999` can't overflow and block a save.
CREATE TABLE correlation_member_refs (
  id             BIGSERIAL PRIMARY KEY,
  member_id      INT NOT NULL REFERENCES correlation_members(id) ON DELETE CASCADE,
  correlation_id INT NOT NULL REFERENCES correlations(id)        ON DELETE CASCADE,
  ref_type       TEXT   NOT NULL,
  ref_id         BIGINT NOT NULL,
  UNIQUE (member_id, ref_type, ref_id)
);
CREATE INDEX idx_member_refs_target ON correlation_member_refs(ref_type, ref_id);
CREATE INDEX idx_member_refs_board  ON correlation_member_refs(correlation_id);
ALTER TABLE correlation_member_refs ENABLE ROW LEVEL SECURITY;

-- Deliberately generic: it indexes ANY `@word/digits` token rather than a fixed
-- list of types. That way the vocabulary lives in exactly one place
-- (REF_TYPE_COL in lib/references.ts) and adding a type needs no migration —
-- an unknown type simply never resolves at read time and is dropped there.
CREATE OR REPLACE FUNCTION sync_member_refs() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM correlation_member_refs WHERE member_id = NEW.id;
  INSERT INTO correlation_member_refs (member_id, correlation_id, ref_type, ref_id)
  SELECT DISTINCT NEW.id, NEW.correlation_id, m[1], (m[2])::BIGINT
    FROM regexp_matches(
           COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, ''),
           '@([a-z_]+)/([0-9]{1,15})', 'g') AS m
  ON CONFLICT (member_id, ref_type, ref_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sync_member_refs
  AFTER INSERT OR UPDATE OF title, body, correlation_id ON correlation_members
  FOR EACH ROW EXECUTE FUNCTION sync_member_refs();

-- ---- 5. RLS -----------------------------------------------------------------
-- board_readable() / board_editable() come from 032 and are SECURITY DEFINER,
-- so none of this can reintroduce the 42P17 recursion 019 shipped.

CREATE POLICY "read via board" ON correlation_members FOR SELECT
  USING (board_readable(correlation_id));
CREATE POLICY "edit insert" ON correlation_members FOR INSERT
  WITH CHECK (board_editable(correlation_id));
CREATE POLICY "edit update" ON correlation_members FOR UPDATE
  USING (board_editable(correlation_id));
CREATE POLICY "edit delete" ON correlation_members FOR DELETE
  USING (board_editable(correlation_id));

CREATE POLICY "read via board" ON correlation_edges FOR SELECT
  USING (board_readable(correlation_id));
CREATE POLICY "edit insert" ON correlation_edges FOR INSERT
  WITH CHECK (board_editable(correlation_id));
CREATE POLICY "edit update" ON correlation_edges FOR UPDATE
  USING (board_editable(correlation_id));
CREATE POLICY "edit delete" ON correlation_edges FOR DELETE
  USING (board_editable(correlation_id));

-- Refs are derived: readable with the board, never client-writable. No INSERT
-- / UPDATE / DELETE policy exists, so only the SECURITY DEFINER trigger writes.
CREATE POLICY "read via board" ON correlation_member_refs FOR SELECT
  USING (board_readable(correlation_id));
