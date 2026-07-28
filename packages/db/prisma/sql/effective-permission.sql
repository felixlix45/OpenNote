-- =============================================================================
-- OpenNote — effective-permission CTE (the hot path, ticket 0002 / 0003)
-- =============================================================================
-- Computes the effective permission for (workspace_id, user_id, resource).
-- Implements the union rule: the MAXIMUM (strongest) grant anywhere on the path
-- from the workspace root down to the resource, across direct + group shares,
-- evaluated LIVE (group membership is an indexed join, never cached).
-- Owner/Admin bypass is checked by the caller (packages/auth) first via a
-- one-row lookup on workspace_members; this query is only reached for
-- guest/member roles.
--
-- Parameters ($1..$5):
--   $1  workspace_id  uuid   — the tenant boundary (🔒 always filtered)
--   $2  user_id       uuid   — the principal
--   $3  resource_type text   — 'page' | 'folder'
--   $4  resource_id   uuid   — the resource; NULL = workspace-root sentinel
--   $5  max_depth     int    — nesting-depth cap (🔒 DoS bound; default 32)
--
-- Returns one row: (effective text) in {'none','reader','commenter','editor'}.
-- NULL/none when no grant matches. Owner/Admin → caller returns 'manage'.

CREATE OR REPLACE FUNCTION effective_permission(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_resource_type text,
  p_resource_id   uuid,
  p_max_depth     int DEFAULT 32
) RETURNS text
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result text;
  starting_folder_id uuid;
BEGIN
  -- Resolve the starting folder for the path walk.
  -- For a folder resource, that's the folder itself. For a page resource, we
  -- do NOT pre-resolve here: a page may be nested under several parent pages
  -- before reaching a folder, so the starting folder is derived inside the
  -- recursive CTE from the topmost ancestor page's folder_id. (Resolving it
  -- here via COALESCE(folder_id, parent_page_id) would wrongly feed a *page*
  -- id into the folder walk and silently skip folder shares — a union-rule
  -- violation. See code-review finding.)
  IF p_resource_type = 'folder' THEN
    starting_folder_id := p_resource_id;
  ELSE
    starting_folder_id := NULL; -- computed by the CTE for page resources
  END IF;

  WITH RECURSIVE
    -- Live group membership: groups this user currently belongs to in this workspace.
    groups_of_u AS (
      SELECT gm.group_id
        FROM group_members gm
        JOIN groups g ON g.id = gm.group_id
       WHERE gm.user_id = p_user_id
         AND g.workspace_id = p_workspace_id   -- 🔒 tenant guard
    ),
    -- Walk nested pages up (page -> parent_page -> ... ). Carries folder_id so
    -- the folder walk can anchor on whichever ancestor page actually sits in a
    -- folder (the topmost nested page's folder_id, not a page id).
    page_ancestors(id, parent_id, folder_id, depth) AS (
      SELECT id, parent_page_id, folder_id, 0
        FROM pages
       WHERE id = p_resource_id
         AND workspace_id = p_workspace_id
         AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.parent_page_id, p.folder_id, pa.depth + 1
        FROM pages p
        JOIN page_ancestors pa ON p.id = pa.parent_id
       WHERE p.workspace_id = p_workspace_id
         AND p.deleted_at IS NULL
         AND pa.depth < p_max_depth
    ),
    -- The folder (if any) the page chain bottoms out in. NULL if the page and
    -- all its ancestors live at the workspace root.
    page_chain_folder AS (
      SELECT folder_id FROM page_ancestors WHERE folder_id IS NOT NULL
      ORDER BY depth ASC LIMIT 1
    ),
    -- Walk folders up to root (folder -> parent -> ... -> NULL). For a page
    -- resource this starts from page_chain_folder; for a folder resource from
    -- the resource itself (starting_folder_id).
    folder_ancestors(id, parent_id, depth) AS (
      SELECT id, parent_id, 0
        FROM folders
       WHERE id = COALESCE(
               (SELECT folder_id FROM page_chain_folder),
               starting_folder_id
             )
         AND workspace_id = p_workspace_id
         AND deleted_at IS NULL
      UNION ALL
      SELECT f.id, f.parent_id, fa.depth + 1
        FROM folders f
        JOIN folder_ancestors fa ON f.id = fa.parent_id
       WHERE f.workspace_id = p_workspace_id
         AND f.deleted_at IS NULL
         AND fa.depth < p_max_depth
    ),
    -- The full set of (type, id) pairs on the path from root to the resource.
    -- Includes the workspace-root sentinel (folder, NULL) so the implicit
    -- all-members -> Editor share is picked up.
    path_resources AS (
      SELECT 'page'::text AS type, p_resource_id AS id WHERE p_resource_type = 'page'
      UNION ALL
      SELECT 'page', id FROM page_ancestors WHERE id <> p_resource_id
      UNION ALL
      SELECT 'folder', id FROM folder_ancestors
      UNION ALL
      SELECT 'folder', NULL::uuid  -- workspace-root sentinel
    )
  -- Join shares against the path with NULL-safe equality (IS NOT DISTINCT
  -- FROM). A plain `IN` would fail to match the workspace-root sentinel: the
  -- sentinel share has resource_id = NULL, and `NULL IN (NULL)` is NULL (not
  -- true), so the open-workspace root share would never apply. NULL-safe
  -- equality treats two NULLs as equal.
  SELECT max(
    CASE s.level
      WHEN 'editor'    THEN 3
      WHEN 'commenter' THEN 2
      WHEN 'reader'    THEN 1
      ELSE 0
    END
  )
  INTO result
  FROM shares s
  JOIN path_resources pr
    ON s.resource_type = pr.type
   AND s.resource_id IS NOT DISTINCT FROM pr.id
  WHERE s.workspace_id = p_workspace_id                       -- 🔒 tenant guard
    AND ( s.principal_user_id  = p_user_id
       OR s.principal_group_id IN (SELECT group_id FROM groups_of_u) );

  RETURN COALESCE(
    CASE result
      WHEN '3' THEN 'editor'
      WHEN '2' THEN 'commenter'
      WHEN '1' THEN 'reader'
      ELSE 'none'
    END,
    'none'
  );
END;
$$;
