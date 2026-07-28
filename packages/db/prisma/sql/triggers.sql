-- =============================================================================
-- OpenNote — triggers
-- =============================================================================

-- keep_all_members_in_sync: the all-members group auto-tracks every non-guest
-- member (ticket 0002 "open-workspace rule"; ticket 0003). On member insert /
-- role change to non-guest → add to the workspace's all-members group. On
-- leave or downgrade to guest → remove. Group membership is evaluated live by
-- the permission engine, so this trigger just keeps the group's roster honest.

CREATE OR REPLACE FUNCTION keep_all_members_in_sync() RETURNS trigger AS $$
DECLARE
  g_id uuid;
BEGIN
  SELECT id INTO g_id FROM groups
   WHERE workspace_id = COALESCE(NEW.workspace_id, OLD.workspace_id)
     AND is_all_members = true;
  IF g_id IS NULL THEN
    RETURN COALESCE(NEW, OLD); -- all-members group not yet seeded; skip
  END IF;

  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.role <> 'guest' THEN
    INSERT INTO group_members (group_id, user_id)
    VALUES (g_id, NEW.user_id)
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;

  IF (TG_OP = 'DELETE') OR (TG_OP = 'UPDATE' AND NEW.role = 'guest') THEN
    DELETE FROM group_members
     WHERE group_id = g_id
       AND user_id = COALESCE(NEW.user_id, OLD.user_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_members_all_members_sync
  AFTER INSERT OR UPDATE OR DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION keep_all_members_in_sync();
