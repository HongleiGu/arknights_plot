-- ============================================================
-- 027_entity_graph.sql  (AP-22 · P3)
--
-- Graph traversal over entity_relations using recursive CTEs (the Postgres-
-- native answer to Cypher — see AP-22 for why no Neo4j), plus widening the
-- annotation anchors so an entity can be commented on / pinned to a board.
--
--   entity_neighbors(id, depth) → BFS over the UNDIRECTED graph, nearest first
--   entity_path(from, to, max)  → shortest connecting paths (id arrays)
--
-- Both are STABLE + SECURITY INVOKER: they read entities/entity_relations
-- under the caller's own RLS (both are public-read), so no privilege bypass.
--
-- Anchors follow the established 006/007/011 idiom: add a nullable FK column
-- and re-state the CHECK.
-- ============================================================

-- ---- traversal --------------------------------------------------------------

-- Neighbours within `p_depth` hops. Edges are treated as undirected: a
-- relationship connects two entities regardless of which side it was stored on.
CREATE OR REPLACE FUNCTION entity_neighbors(p_entity INT, p_depth INT DEFAULT 1)
RETURNS TABLE (id INT, name TEXT, type TEXT, depth INT)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE nb(id, depth) AS (
    SELECT p_entity, 0
    UNION
    SELECT CASE WHEN r.from_entity_id = n.id THEN r.to_entity_id ELSE r.from_entity_id END,
           n.depth + 1
      FROM nb n
      JOIN entity_relations r
        ON (r.from_entity_id = n.id OR r.to_entity_id = n.id)
     WHERE n.depth < GREATEST(p_depth, 0)
  )
  SELECT e.id, e.name, e.type, MIN(nb.depth)::INT AS depth
    FROM nb JOIN entities e ON e.id = nb.id
   WHERE nb.id <> p_entity
   GROUP BY e.id, e.name, e.type
   ORDER BY depth, e.name
$$;
GRANT EXECUTE ON FUNCTION entity_neighbors(INT, INT) TO anon, authenticated;

-- Shortest connecting paths (up to 5), as arrays of entity ids. Cycles are
-- excluded via the NOT ... = ANY(path) guard.
CREATE OR REPLACE FUNCTION entity_path(p_from INT, p_to INT, p_max INT DEFAULT 4)
RETURNS TABLE (path INT[], hops INT)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE walk(node, path, hops) AS (
    SELECT p_from, ARRAY[p_from], 0
    UNION ALL
    SELECT nxt.id, w.path || nxt.id, w.hops + 1
      FROM walk w
      JOIN LATERAL (
        SELECT CASE WHEN r.from_entity_id = w.node THEN r.to_entity_id ELSE r.from_entity_id END AS id
          FROM entity_relations r
         WHERE r.from_entity_id = w.node OR r.to_entity_id = w.node
      ) nxt ON TRUE
     WHERE w.hops < GREATEST(p_max, 1)
       AND NOT (nxt.id = ANY(w.path))
  )
  SELECT w.path, w.hops FROM walk w WHERE w.node = p_to ORDER BY w.hops LIMIT 5
$$;
GRANT EXECUTE ON FUNCTION entity_path(INT, INT, INT) TO anon, authenticated;

-- ---- anchors: comments / boards can point at an entity ----------------------

ALTER TABLE comment_anchors
  ADD COLUMN IF NOT EXISTS entity_id INT REFERENCES entities(id) ON DELETE CASCADE;

ALTER TABLE comment_anchors DROP CONSTRAINT IF EXISTS exactly_one_anchor;
ALTER TABLE comment_anchors ADD CONSTRAINT exactly_one_anchor CHECK (
  (story_id          IS NOT NULL)::INT +
  (chapter_id        IS NOT NULL)::INT +
  (node_id           IS NOT NULL)::INT +
  (gadget_id         IS NOT NULL)::INT +
  (event_id          IS NOT NULL)::INT +
  (event_option_id   IS NOT NULL)::INT +
  (text_chunk_id     IS NOT NULL)::INT +
  (furniture_item_id IS NOT NULL)::INT +
  (entity_id         IS NOT NULL)::INT = 1
);
CREATE INDEX IF NOT EXISTS idx_comment_anchors_entity ON comment_anchors(entity_id);

ALTER TABLE correlation_members
  ADD COLUMN IF NOT EXISTS entity_id INT REFERENCES entities(id) ON DELETE CASCADE;

ALTER TABLE correlation_members DROP CONSTRAINT IF EXISTS at_least_one_member;
ALTER TABLE correlation_members ADD CONSTRAINT at_least_one_member CHECK (
  (story_id          IS NOT NULL)::INT +
  (chapter_id        IS NOT NULL)::INT +
  (node_id           IS NOT NULL)::INT +
  (gadget_id         IS NOT NULL)::INT +
  (event_id          IS NOT NULL)::INT +
  (event_option_id   IS NOT NULL)::INT +
  (text_chunk_id     IS NOT NULL)::INT +
  (furniture_item_id IS NOT NULL)::INT +
  (entity_id         IS NOT NULL)::INT +
  (comment_id        IS NOT NULL)::INT >= 1
  OR note IS NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_correlation_members_entity ON correlation_members(entity_id);
