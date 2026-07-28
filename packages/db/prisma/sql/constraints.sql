-- =============================================================================
-- OpenNote — post-migration constraints & generated columns
-- =============================================================================
-- Prisma can't express: XOR CHECKs, generated columns, GIN indexes, triggers.
-- These run after `prisma migrate deploy` via the migration's final step
-- (a `migrate.sql` that `CALL`s or `\i`-sources these). See README in this dir.
-- All 🔒 SECURITY-REVIEW items land here where SQL is the cheapest enforcement.

-- Pages: exactly one tree parent (folder_id XOR parent_page_id) — ticket 0003.
ALTER TABLE pages
  ADD CONSTRAINT pages_exactly_one_parent_chk
  CHECK ((folder_id IS NULL) <> (parent_page_id IS NULL));

-- Shares: exactly one principal (principal_user_id XOR principal_group_id) — ticket 0003.
ALTER TABLE shares
  ADD CONSTRAINT shares_exactly_one_principal_chk
  CHECK ((principal_user_id IS NULL) <> (principal_group_id IS NULL));

-- Workspace members: role in the allowed enum — defensive mirror of the app check.
ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_role_chk
  CHECK (role IN ('guest', 'member', 'admin', 'owner'));

-- Shares: level in the allowed enum.
ALTER TABLE shares
  ADD CONSTRAINT shares_level_chk
  CHECK (level IN ('reader', 'commenter', 'editor'));

-- Pages: search_tsv generated column + GIN index (ticket 0008).
-- Title is weight A (highest), body weight D. 'simple' config avoids stemming
-- surprises across languages for a self-hosted deploy; swap per-locale post-v1.
ALTER TABLE pages
  ADD COLUMN search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(body_text, '')), 'D')
    ) STORED;
CREATE INDEX pages_search_idx ON pages USING gin(search_tsv);
