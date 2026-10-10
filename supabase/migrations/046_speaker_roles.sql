-- ============================================================
-- 046_speaker_roles.sql  (AP-35/AP-36)
--
-- What a speaker LABEL means inside ONE story.
--
-- `entities.identity` (044) answers a global question: may an edge attach to
-- this vertex at all. It cannot answer the one that actually blocks extraction,
-- because three common shapes have no global answer:
--
--   整合运动成员A   the label denotes a ROLE. The stable fact is the
--                 ORGANISATION; the occurrence is an anonymous member of it. So
--                 整合运动成员A should never be a vertex, while 整合运动 should —
--                 and is not one today, nor are 深池, 近卫局, 黑钢, because the
--                 book's 组织 chapter covers companies and every faction that
--                 exists only in plot is missing.
--   女儿           the label denotes a RELATION. "Someone's daughter" is stable;
--                 WHOSE depends on the scene. Making it a named character is
--                 wrong in every story but one.
--   蒙面人         the label denotes a MASK. A character is behind it, and which
--                 one is a claim the text reveals at a specific line.
--
-- Measured, these are not edge cases: 477 rows carry a role+instance suffix
-- across 196 stems (127 of which ALSO exist as the bare word — 村民 and 村民A…),
-- 11 bare relational terms (母亲 124 lines, 爷爷 120, 女儿 37) plus 98 compounds,
-- and 549 mask-shaped rows holding 5,601 lines.
--
-- The scope is the story, not the node. A node-level table would be 414,720 rows
-- that no human could ever check, and within one story a speaker label is
-- consistent — which is the observation this whole design rests on. UNIQUE
-- (story_id, speaker) is therefore the unit of judgement.
--
-- No `spoiler` column, deliberately: anyone reading this archive is assumed to
-- have accepted spoilers, so a resolved mask needs no special handling.
-- ============================================================

CREATE TABLE IF NOT EXISTS speaker_roles (
  id           SERIAL PRIMARY KEY,
  story_id     INT  NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  -- The raw `nodes.speaker` string, verbatim. Not an FK because speakers are a
  -- column rather than a table; the extraction pass only ever writes strings it
  -- read from that story.
  speaker      TEXT NOT NULL,

  -- person      a specific individual, named as such
  -- role        a function or membership — a different person each time it is used
  -- relational  defined by relation to someone else (女儿/师父)
  -- mask        a character deliberately not named here
  -- device      not a person at all (众人, 广播, 门外的声音)
  kind         TEXT NOT NULL CHECK (kind IN ('person','role','relational','mask','device')),

  -- The individual this label resolves to, when there is one. NULL is a
  -- legitimate and common answer: an anonymous villager resolves to nobody.
  entity_id    INT REFERENCES entities(id) ON DELETE SET NULL,
  -- The anchor the label hangs off: the ORGANISATION for a role, the PARENT for
  -- 女儿. Also NULL when there is none (a bare 村民 belongs to no org).
  of_entity_id INT REFERENCES entities(id) ON DELETE SET NULL,

  -- SET NULL and NOT CASCADE, unlike 026/027. A resolution row is a RECORD OF A
  -- DECISION — its reason and citation stay worth having even if the entity it
  -- pointed at is later merged away, and cascading would mean deleting 整合运动
  -- silently destroys 196 role statements. The blank is visible; the loss would
  -- not be. `mergeEntities` repoints these before deleting, so a merge does not
  -- blank them in the first place.

  -- Why. Required, for the model and for a human alike: a resolution without a
  -- reason is indistinguishable from a guess, and this is exactly the table a
  -- model fills in.
  reason       TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','manual')),
  source_refs  TEXT[] NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'ai_draft'
                 CHECK (status IN ('ai_draft','confirmed','rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (story_id, speaker)
);

-- A reason that is whitespace is not a reason.
ALTER TABLE speaker_roles DROP CONSTRAINT IF EXISTS speaker_roles_reason_said;
ALTER TABLE speaker_roles ADD CONSTRAINT speaker_roles_reason_said
  CHECK (btrim(reason) <> '');

-- A device is not a person, so it cannot resolve to one. The only shape worth
-- forbidding: every other NULL combination is a real state (an unresolved mask,
-- a role with no org, a person with no anchor).
ALTER TABLE speaker_roles DROP CONSTRAINT IF EXISTS speaker_roles_device_has_no_entity;
ALTER TABLE speaker_roles ADD CONSTRAINT speaker_roles_device_has_no_entity
  CHECK (kind <> 'device' OR entity_id IS NULL);

-- Grounding, reusing 044's functions so there is one definition of a citation.
-- Same rule as `entity_relations`: a human may assert from their own reading,
-- anything the model wrote must cite a node/chapter/text — `@story/<id>` alone
-- resolves while making "does the cited text support this" unanswerable.
ALTER TABLE speaker_roles DROP CONSTRAINT IF EXISTS speaker_roles_refs_shape;
ALTER TABLE speaker_roles ADD CONSTRAINT speaker_roles_refs_shape
  CHECK (graph_refs_well_formed(source_refs));

ALTER TABLE speaker_roles DROP CONSTRAINT IF EXISTS speaker_roles_grounded;
ALTER TABLE speaker_roles ADD CONSTRAINT speaker_roles_grounded
  CHECK (source = 'manual' OR graph_refs_precise(source_refs));

CREATE INDEX IF NOT EXISTS idx_speaker_roles_story  ON speaker_roles(story_id);
CREATE INDEX IF NOT EXISTS idx_speaker_roles_entity ON speaker_roles(entity_id);
CREATE INDEX IF NOT EXISTS idx_speaker_roles_of     ON speaker_roles(of_entity_id);
CREATE INDEX IF NOT EXISTS idx_speaker_roles_draft  ON speaker_roles(status)
  WHERE status = 'ai_draft';

CREATE OR REPLACE FUNCTION speaker_roles_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_speaker_roles_touch ON speaker_roles;
CREATE TRIGGER trg_speaker_roles_touch BEFORE UPDATE ON speaker_roles
  FOR EACH ROW EXECUTE FUNCTION speaker_roles_touch();

-- RLS, mirroring 026: public read (it is derived from public content), writes
-- via admin or the service role.
ALTER TABLE speaker_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read" ON speaker_roles;
CREATE POLICY "public read" ON speaker_roles FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin write" ON speaker_roles;
CREATE POLICY "admin write" ON speaker_roles FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));

COMMENT ON TABLE speaker_roles IS
  'What a speaker label means inside one story: person / role / relational / '
  'mask / device, with the entity it resolves to, the anchor it hangs off, a '
  'required reason and a node citation. entities.identity stays the global '
  'answer (may an edge attach at all); this is the per-story one.';
