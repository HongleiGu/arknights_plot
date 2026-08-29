-- ============================================================
-- 020_edge_kind.sql  (AP-14)
--
-- Typed board edges: give the "red string" a relationship kind
-- (causes / contradicts / same-person / …) so the graph can style and
-- filter connections by meaning.
--
-- Free-text (no CHECK) — a new relationship kind is data, not a migration,
-- same philosophy as gadgets.kind. NULL = a plain, untyped relation. The
-- preset vocabulary lives in the editor UI (EDGE_KINDS in BoardEditor).
-- ============================================================

ALTER TABLE correlation_edges ADD COLUMN IF NOT EXISTS kind TEXT;
