-- ============================================================
-- 018_member_data.sql  (AP-11 extension)
--
-- Free-form per-node custom data on board members: user notes, extra
-- assets, layout extras — "leave space for whatever" without widening the
-- schema or going polymorphic. The entity FK columns stay the system of
-- record for *what* a node points at; `data` is just decoration.
-- ============================================================

ALTER TABLE correlation_members
  ADD COLUMN IF NOT EXISTS data JSONB;
