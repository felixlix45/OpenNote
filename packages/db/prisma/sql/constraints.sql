-- =============================================================================
-- OpenNote — post-push constraints & generated columns
-- =============================================================================
-- Prisma can't express: XOR CHECKs, generated columns, GIN indexes.
-- Applied by db:setup (scripts/apply-sql.mjs) after `prisma db push`.
-- Idempotent: every statement guards with IF NOT EXISTS / DO $$ blocks so the
-- whole file is safe to re-run.
-- All 🔒 SECURITY-REVIEW items land here where SQL is the cheapest enforcement.

-- Pages: exactly one tree parent (folder_id XOR parent_page_id) — ticket 0003.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pages_exactly_one_parent_chk') THEN
    ALTER TABLE pages ADD CONSTRAINT pages_exactly_one_parent_chk
      CHECK ((folder_id IS NULL) <> (parent_page_id IS NULL));
  END IF;
END $$;

-- Shares: exactly one principal (principal_user_id XOR principal_group_id) — ticket 0003.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shares_exactly_one_principal_chk') THEN
    ALTER TABLE shares ADD CONSTRAINT shares_exactly_one_principal_chk
      CHECK ((principal_user_id IS NULL) <> (principal_group_id IS NULL));
  END IF;
END $$;

-- Workspace members: role in the allowed enum — defensive mirror of the app check.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_role_chk') THEN
    ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_chk
      CHECK (role IN ('guest', 'member', 'admin', 'owner'));
  END IF;
END $$;

-- Shares: level in the allowed enum.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shares_level_chk') THEN
    ALTER TABLE shares ADD CONSTRAINT shares_level_chk
      CHECK (level IN ('reader', 'commenter', 'editor'));
  END IF;
END $$;

-- Pages: search_tsv generated column + GIN index (ticket 0008).
-- Title is weight A (highest), body weight D. 'simple' config avoids stemming
-- surprises across languages for a self-hosted deploy; swap per-locale post-v1.
ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      to_tsvector('simple', coalesce(body_text, ''))
    ) STORED;
CREATE INDEX IF NOT EXISTS pages_search_idx ON pages USING gin(search_tsv);

-- Groups: exactly one all-members sentinel per workspace (ticket 0003).
-- Drop the mistaken full unique on (workspace_id, is_all_members) if present —
-- that constraint also forbade more than one custom (is_all_members=false) group.
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_workspace_id_is_all_members_key;
DROP INDEX IF EXISTS groups_workspace_id_is_all_members_key;
CREATE UNIQUE INDEX IF NOT EXISTS groups_one_all_members_per_ws
  ON groups (workspace_id) WHERE is_all_members = true;

-- Shares: structural tenant binding for polymorphic resource_id (🔒 HIGH #1).
-- App-layer assertResourceInWorkspace is still required; this trigger is the
-- DB backstop so a missed filter cannot insert a cross-workspace share.
CREATE OR REPLACE FUNCTION assert_share_resource_in_workspace()
RETURNS trigger AS $$
BEGIN
  IF NEW.resource_id IS NULL THEN
    RETURN NEW; -- workspace-root sentinel
  END IF;
  IF NEW.resource_type = 'folder' THEN
    IF NOT EXISTS (
      SELECT 1 FROM folders
      WHERE id = NEW.resource_id AND workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'share resource_id not in workspace';
    END IF;
  ELSIF NEW.resource_type = 'page' THEN
    IF NOT EXISTS (
      SELECT 1 FROM pages
      WHERE id = NEW.resource_id AND workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'share resource_id not in workspace';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown share resource_type: %', NEW.resource_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shares_resource_in_workspace ON shares;
CREATE TRIGGER shares_resource_in_workspace
  BEFORE INSERT OR UPDATE OF workspace_id, resource_type, resource_id ON shares
  FOR EACH ROW EXECUTE FUNCTION assert_share_resource_in_workspace();
