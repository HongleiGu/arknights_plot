-- ============================================================
-- 044_graph_schema.sql  (AP-35 / AP-36)
--
-- Freeze the shape of the world graph before a model writes thousands of rows
-- into it. The structure here is meant to be final; the VOCABULARY is data, so
-- adding a type or a relation kind stays an INSERT, never a migration.
--
-- That split is the whole point. `026` left `entities.type` and
-- `entity_relations.kind` as free text on the grounds that "a new entity class
-- is data, not a migration" — right about extensibility, and it cost us drift
-- that nothing could catch:
--
--   * `026` documented  character | location | faction | concept | artefact.
--     AP-35's seeders wrote  place | organisation | nation | race | event.
--     So `location`/`faction` were renamed by accident and `artefact` never
--     existed. Nothing in code enumerated the types, so nothing could object.
--   * 11 AI-extracted relations produced SIX kinds, two of which (敌对 / 对立)
--     are the same relation. At 11 rows that is untidy; at several thousand,
--     "who opposes X" has to know every synonym a model ever reached for.
--
-- The two are NOT treated the same, because they are not the same problem:
--
--   * `entities.type` is CLOSED by an FK to `entity_types`. "Is this a nation or
--     a place" has a discrete answer, so an unknown value is a mistake and
--     should fail at write time. Adding a legitimate type is one INSERT.
--   * `entity_relations.kind` stays FREE TEXT with no FK. Relations are more
--     complex than discrete words, and forcing 凯尔希↔特蕾西娅 into 盟友 discards
--     the thing worth keeping. The meaning lives in `note` + `source_refs`,
--     which is more precise than any label, so the label is free. An
--     unrecognised kind becomes a review item rather than a write failure.
--
-- A CHECK constraint would have forced a migration per value; free text alone
-- forced nothing at all. A lookup table with an FK is the middle, and an
-- advisory lookup table without one is the middle for the free side.
-- ============================================================

-- ---------- the vertex vocabulary -------------------------------------------
CREATE TABLE IF NOT EXISTS entity_types (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  note  TEXT
);

-- `nation` is deliberately separate from `place`: there are 19 nations against 4
-- cities, AP-36's 出身地 edges resolve to nations specifically, and the two
-- behave differently in traversal (a nation contains places).
--
-- `place` and `organisation` are ratified over 026's `location` and `faction`
-- because the book's own chapter is 组织 ORGANISATIONS IN TERRA — the source's
-- word, the same rule that made 炎国 win over 大炎 — and because `faction` is
-- simply wrong for 鲤氏侦探事务所 and 企鹅物流, a detective agency and a courier
-- firm. `artefact` is NOT seeded: nothing creates one yet, and a declared type
-- with no rows is the kind of thing a later writer mistakes for a convention.
INSERT INTO entity_types (key, label, note) VALUES
  ('character',    '人物',   'a person; identity is global only when named — see entities.identity'),
  ('nation',       '国家',   'from 大地巡旅 5.x'),
  ('place',        '地点',   'city/region; 026 called this `location`'),
  ('race',         '种族',   'from the operators'' 基础档案 种族 field'),
  ('organisation', '组织',   'company/agency/institution; 026 called this `faction`'),
  ('concept',      '概念',   'source/arts/catastrophe/oripathy and the like'),
  ('event',        '事件',   'a named historical event; dated ones live in timeline_events (039)')
ON CONFLICT (key) DO NOTHING;

-- ---------- the edge vocabulary ---------------------------------------------
CREATE TABLE IF NOT EXISTS relation_kinds (
  key       TEXT PRIMARY KEY,
  label     TEXT NOT NULL,
  -- TRUE: the relation reads the same both ways, so it is stored ONCE with
  -- from_entity_id < to_entity_id. That canonical ordering is what makes
  -- UNIQUE(from,to,kind) mean anything — without it 盟友 can be stored twice,
  -- once each way, and both rows look valid. `relations.ts` already does this
  -- via a hardcoded JS Set that covers only the kinds its prompt suggested, so
  -- 对立 and 联络 fell through it. Declaring it here keeps one answer.
  --
  -- NOT named `symmetric`: that is a RESERVED word in Postgres (it belongs to
  -- `BETWEEN SYMMETRIC`), so the column would need quoting at every single
  -- reference and the first one to forget is a syntax error. Renaming is the
  -- cheaper fix than remembering.
  is_symmetric BOOLEAN NOT NULL DEFAULT FALSE,
  -- 'derived'   computed from a structured field; no model, no judgement
  -- 'narrative' asserted about the story; needs citations and review
  category  TEXT NOT NULL CHECK (category IN ('derived', 'narrative')),
  -- For a directed kind, what each end means. Without this, 师徒 is ambiguous
  -- and half the rows end up backwards.
  from_role TEXT,
  to_role   TEXT
);

-- ADVISORY, NOT ENFORCING. `entity_relations.kind` stays free TEXT with no FK.
--
-- A closed list was considered and rejected: relations are more complex than
-- discrete words, and forcing 凯尔希↔特蕾西娅 into 盟友 throws away exactly the
-- thing worth keeping. The meaning lives in `note` plus `source_refs`, which is
-- more precise than any label, so the label is free to be whatever the text
-- actually supports.
--
-- This table exists for the one question free text cannot answer on its own:
-- **is this kind symmetric?** Without an answer, 盟友 can be stored twice — once
-- each way — and `UNIQUE(from,to,kind)` stops meaning anything, because the
-- canonical `from_entity_id < to_entity_id` ordering has nothing to key off.
-- `relations.ts` currently answers it from a hardcoded JS Set covering only the
-- kinds its own prompt suggested, which is how 对立 and 联络 fell through.
--
-- So: a kind listed here is handled as declared. **A kind that is NOT listed is
-- treated as directed and the row is flagged `review = 'suspicious'`** — which
-- is the same manual-review queue the vague speakers go into, rather than a
-- second mechanism. New kinds are expected; they just get looked at once.
INSERT INTO relation_kinds (key, label, is_symmetric, category, from_role, to_role) VALUES
  -- derived: a join over entities.raw.profile, citable to the 基础档案 chunk
  ('出身',   '出身',   FALSE, 'derived',   '人物', '国家/地点'),
  ('种族',   '种族',   FALSE, 'derived',   '人物', '种族'),
  ('所属',   '所属',   FALSE, 'derived',   '成员', '组织'),
  ('位于',   '位于',   FALSE, 'derived',   '地点', '国家/地点'),
  -- narrative: extracted from text, every row cited
  ('盟友',   '盟友',   TRUE,  'narrative', NULL,   NULL),
  ('敌对',   '敌对',   TRUE,  'narrative', NULL,   NULL),
  ('亲属',   '亲属',   TRUE,  'narrative', NULL,   NULL),
  ('同僚',   '同僚',   TRUE,  'narrative', NULL,   NULL),
  ('旧识',   '旧识',   TRUE,  'narrative', NULL,   NULL),
  ('同一人', '同一人', TRUE,  'narrative', NULL,   NULL),
  ('上下级', '上下级', FALSE, 'narrative', '上级', '下级'),
  ('师徒',   '师徒',   FALSE, 'narrative', '师',   '徒'),
  ('恋慕',   '恋慕',   FALSE, 'narrative', '爱慕者', '对象'),
  ('统治',   '统治',   FALSE, 'narrative', '统治者', '国家/地点'),
  ('创立',   '创立',   FALSE, 'narrative', '创立者', '组织'),
  -- generic: connected in a way no word names. `note` carries it.
  ('关联',   '关联',   TRUE,  'narrative', NULL,   NULL)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE relation_kinds IS
  'Advisory registry for entity_relations.kind, which is free text. Supplies '
  'symmetry (so symmetric edges canonicalise to from<to and UNIQUE means '
  'something) and the role of each end for directed kinds. An unlisted kind is '
  'allowed, treated as directed, and flagged review=suspicious.';

-- ---------- identity: the thing that was actually broken ---------------------
--
-- Measured over all 715 stories via scope_speakers(): 6,889 distinct speakers,
-- 5,633 of them in exactly one story, and 148 non-operator speakers in five or
-- more. Those 148 are three different things wearing one costume:
--
--   named    塔露拉 (17 stories, 1,605 lines), 魏彦吾, 特蕾西娅 — real people with
--            no playable 干员 record. Global identity; merging them is correct.
--   scoped   医疗干员 (44 stories), 罗德岛干员 (28), 维多利亚士兵 (11) — a real
--            being with no name given. 医疗干员 is FORTY-FOUR different people,
--            so one vertex for it is a composite and any edge on it is wrong.
--   device   众人 (a chorus), 广播, 门外的声音, 模糊的声音, 父亲 — not entities.
--
-- So identity is not a property of the name; it is a property of the name in a
-- scope. `？？？` needs no handling: seed_entities.py and scope_speakers() both
-- exclude `^[？?]+$` already, and that is right — a masked speaker is an
-- unresolved slot, and resolving it asserts a reveal the game is withholding.
--
-- Default is 'unverified', NOT 'named': 6,889 rows arrived from a speaker column
-- and nothing has vouched for any of them. Each seeder sets what it actually
-- knows (operators and book sections are 'named' by definition); the classifier
-- demotes the rest and flags them for review.
--
-- UNIQUE (type, name) is deliberately UNCHANGED. Scoping identity properly would
-- mean UNIQUE (type, name, scope_story_id), and a nullable column in a unique
-- key needs NULLS NOT DISTINCT or a COALESCE index — either of which stops
-- PostgREST's `on_conflict=type,name` working and breaks all three seeders. A
-- composite row is instead flagged and resolved by hand, which is the workflow
-- that was asked for. If per-story identity is ever wanted, that is the cost.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS identity TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_identity_known;
ALTER TABLE entities ADD CONSTRAINT entities_identity_known
  CHECK (identity IN ('unverified', 'named', 'scoped', 'device'));

ALTER TABLE entities ADD COLUMN IF NOT EXISTS review TEXT NOT NULL DEFAULT 'none';
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_review_known;
ALTER TABLE entities ADD CONSTRAINT entities_review_known
  CHECK (review IN ('none', 'suspicious', 'reviewed'));
ALTER TABLE entities ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_entities_review   ON entities(review) WHERE review <> 'none';
CREATE INDEX IF NOT EXISTS idx_entities_identity ON entities(identity);

-- ---------- grounding, enforced in the database -----------------------------
--
-- AP-36's rule is that every extracted edge cites internal canon and never
-- pretraining, and that the check must be structural rather than a politely
-- worded prompt. This is that check.
--
-- `@story/<id>` is accepted but is NOT sufficient on its own: all 11 legacy rows
-- cited only a story, which resolves while making "does the cited text support
-- the claim" impossible to answer. Hence the second constraint.
CREATE OR REPLACE FUNCTION graph_refs_well_formed(refs TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(bool_and(r ~ '^@(node|chapter|text|story|timeline)/[0-9]+$'), TRUE)
    FROM unnest(COALESCE(refs, '{}'::TEXT[])) AS r
$$;

CREATE OR REPLACE FUNCTION graph_refs_precise(refs TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(bool_or(r ~ '^@(node|chapter|text)/[0-9]+$'), FALSE)
    FROM unnest(COALESCE(refs, '{}'::TEXT[])) AS r
$$;

-- The legacy rows are removed rather than migrated. They are 11 model-written
-- edges citing only `@story/58`, in six kinds two of which are synonyms, with a
-- confidence hardcoded to 0.6 — so they fail the vocabulary FK, fail the
-- precision check, and will be regenerated by the batch pass. Keeping them would
-- mean relaxing every constraint this migration exists to add.
DELETE FROM entity_relations
 WHERE source = 'ai'
   AND NOT graph_refs_precise(source_refs);

ALTER TABLE entity_relations ADD COLUMN IF NOT EXISTS review TEXT NOT NULL DEFAULT 'none';
ALTER TABLE entity_relations DROP CONSTRAINT IF EXISTS entity_relations_review_known;
ALTER TABLE entity_relations ADD CONSTRAINT entity_relations_review_known
  CHECK (review IN ('none', 'suspicious', 'reviewed'));

ALTER TABLE entity_relations DROP CONSTRAINT IF EXISTS entity_relations_source_known;
ALTER TABLE entity_relations ADD CONSTRAINT entity_relations_source_known
  CHECK (source IS NULL OR source IN ('derived', 'scraped', 'ai', 'manual'));

ALTER TABLE entity_relations DROP CONSTRAINT IF EXISTS entity_relations_refs_shape;
ALTER TABLE entity_relations ADD CONSTRAINT entity_relations_refs_shape
  CHECK (graph_refs_well_formed(source_refs));

-- A human may assert an edge from their own reading. Everything else must cite,
-- and must cite something finer than a whole story.
ALTER TABLE entity_relations DROP CONSTRAINT IF EXISTS entity_relations_grounded;
ALTER TABLE entity_relations ADD CONSTRAINT entity_relations_grounded
  CHECK (source = 'manual' OR graph_refs_precise(source_refs));

-- ---------- the vocabulary FKs, last, so the data is already clean -----------
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_type_fk;
ALTER TABLE entities ADD CONSTRAINT entities_type_fk
  FOREIGN KEY (type) REFERENCES entity_types(key);

-- No FK on entity_relations.kind, deliberately — see relation_kinds above. An
-- unrecognised kind is a review item, not a write failure. Dropped explicitly in
-- case an earlier run of this file added it.
ALTER TABLE entity_relations DROP CONSTRAINT IF EXISTS entity_relations_kind_fk;

-- ---------- `note` is where the meaning lives, so it is required ------------
--
-- `kind` being free text makes `note` more important, not less: the label is now
-- whatever the extractor chose, so the row only means something if it says what
-- the citation actually supports. An edge labelled 关联 with no note says
-- nothing at all. Keyed on `source` rather than on the kind, because with free
-- text there is no reliable category to look up — and `derived` edges genuinely
-- need none, since the 基础档案 field IS the meaning.
ALTER TABLE entity_relations DROP CONSTRAINT IF EXISTS entity_relations_has_note;
ALTER TABLE entity_relations ADD CONSTRAINT entity_relations_has_note
  CHECK (source = 'derived' OR COALESCE(btrim(note), '') <> '');

-- ---------- an edge may not hang off an unreviewed vertex -------------------
--
-- A CHECK cannot read another table, so this is a trigger. The model may write
-- edges, but not onto a vertex that is a composite (医疗干员, forty-four people)
-- or not a person at all (众人) — nor onto one a human has flagged and not yet
-- cleared. The database refuses, rather than the prompt asking nicely.
CREATE OR REPLACE FUNCTION entity_relations_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE bad TEXT;
BEGIN
  SELECT format('%s/%s (identity=%s, review=%s)', e.type, e.name, e.identity, e.review)
    INTO bad
    FROM entities e
   WHERE e.id IN (NEW.from_entity_id, NEW.to_entity_id)
     AND (e.identity = 'device' OR e.review = 'suspicious')
   LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'entity_relations: endpoint % needs review before edges may reference it', bad;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_relations_endpoints ON entity_relations;
DROP TRIGGER IF EXISTS trg_entity_relations_guard ON entity_relations;
CREATE TRIGGER trg_entity_relations_guard
  BEFORE INSERT OR UPDATE ON entity_relations
  FOR EACH ROW EXECUTE FUNCTION entity_relations_guard();

-- ---------- RLS on the vocabulary tables, mirroring 026 ----------------------
ALTER TABLE entity_types   ENABLE ROW LEVEL SECURITY;
ALTER TABLE relation_kinds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read" ON entity_types;
CREATE POLICY "public read" ON entity_types FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin write" ON entity_types;
CREATE POLICY "admin write" ON entity_types FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));

DROP POLICY IF EXISTS "public read" ON relation_kinds;
CREATE POLICY "public read" ON relation_kinds FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin write" ON relation_kinds;
CREATE POLICY "admin write" ON relation_kinds FOR ALL
  USING      (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE clerk_id = auth.uid()::text AND is_admin));
