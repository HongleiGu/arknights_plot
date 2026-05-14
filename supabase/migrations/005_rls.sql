-- ============================================================
-- 005_rls.sql
--
-- Row-Level Security.
--   • Content tables   → public read.
--   • Annotation tables → public read, authenticated write,
--                         owner-only update / delete.
-- ============================================================

-- ---- Content: public read --------------------------------------------------

ALTER TABLE stories               ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_group_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters              ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE predicate_branches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_nodes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_descriptions  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON stories              FOR SELECT USING (true);
CREATE POLICY "public read" ON story_groups         FOR SELECT USING (true);
CREATE POLICY "public read" ON story_group_members  FOR SELECT USING (true);
CREATE POLICY "public read" ON chapters             FOR SELECT USING (true);
CREATE POLICY "public read" ON scenes               FOR SELECT USING (true);
CREATE POLICY "public read" ON nodes                FOR SELECT USING (true);
CREATE POLICY "public read" ON decisions            FOR SELECT USING (true);
CREATE POLICY "public read" ON predicate_branches   FOR SELECT USING (true);
CREATE POLICY "public read" ON branch_nodes         FOR SELECT USING (true);
CREATE POLICY "public read" ON chapter_descriptions FOR SELECT USING (true);

-- ---- Annotations: public read, owner-only writes ---------------------------

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_anchors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE correlations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE correlation_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON users               FOR SELECT USING (true);
CREATE POLICY "public read" ON comments            FOR SELECT USING (true);
CREATE POLICY "public read" ON comment_anchors     FOR SELECT USING (true);
CREATE POLICY "public read" ON correlations        FOR SELECT USING (true);
CREATE POLICY "public read" ON correlation_members FOR SELECT USING (true);

CREATE POLICY "auth insert" ON comments FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update" ON comments FOR UPDATE
  USING (auth.uid()::text = (SELECT clerk_id FROM users WHERE id = user_id));
CREATE POLICY "auth delete" ON comments FOR DELETE
  USING (auth.uid()::text = (SELECT clerk_id FROM users WHERE id = user_id));

CREATE POLICY "auth insert" ON comment_anchors FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete" ON comment_anchors FOR DELETE USING (
  auth.uid() IS NOT NULL AND
  EXISTS (
    SELECT 1 FROM comments c
     WHERE c.id = comment_id
       AND auth.uid()::text = (SELECT clerk_id FROM users WHERE id = c.user_id)
  )
);

CREATE POLICY "auth insert" ON correlations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update" ON correlations FOR UPDATE
  USING (auth.uid()::text = (SELECT clerk_id FROM users WHERE id = created_by));
CREATE POLICY "auth delete" ON correlations FOR DELETE
  USING (auth.uid()::text = (SELECT clerk_id FROM users WHERE id = created_by));

CREATE POLICY "auth insert" ON correlation_members FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete" ON correlation_members FOR DELETE USING (auth.uid() IS NOT NULL);
