/**
 * @opennote/db — repository layer.
 *
 * This is the **only** surface app code should use to read/write content. It
 * centralizes the 🔒 SECURITY-REVIEW MEDIUM invariants that are easy to forget
 * per-query:
 *
 *  - **Tenant isolation:** every content read/write is scoped by `workspaceId`.
 *    Resources never leak across the workspace boundary.
 *  - **Soft-delete discipline:** content reads filter `deletedAt: null`
 *    automatically. A trashed page/folder is invisible unless explicitly asked
 *    for via the trash accessors.
 *  - **Nesting-depth cap:** move/create checks depth against MAX_NESTING_DEPTH.
 *
 * The permission engine (packages/auth) calls {@link queryEffectivePermission}
 * for the raw CTE; it does not bypass this layer for content reads.
 */
import type { PrismaClient } from "./client.js";
import {
  type ResourceType,
  WORKSPACE_ROOT_SENTINEL,
} from "@opennote/shared";

/** Active (non-trashed) content filter, applied everywhere content is read. */
const ACTIVE = { deletedAt: null } as const;

export interface RepositoryDeps {
  prisma: PrismaClient;
}

/**
 * Resolve the workspace_id of a (resourceType, resourceId), asserting it equals
 * `workspaceId`. 🔒 HIGH #1 tenant guard for polymorphic shares.resource_id.
 * Returns true iff the resource exists, is in the workspace, and (for content)
 * is not trashed.
 */
export async function assertResourceInWorkspace(
  db: PrismaClient,
  workspaceId: string,
  resourceType: ResourceType,
  resourceId: string | null,
): Promise<boolean> {
  if (resourceId === WORKSPACE_ROOT_SENTINEL) return true; // root sentinel
  if (resourceType === "folder") {
    const f = await db.folder.findFirst({
      where: { id: resourceId, workspaceId, ...ACTIVE },
      select: { id: true },
    });
    return f !== null;
  }
  const p = await db.page.findFirst({
    where: { id: resourceId, workspaceId, ...ACTIVE },
    select: { id: true },
  });
  return p !== null;
}

/** Count nesting depth from a folder up to root — for the depth cap check. */
export async function folderDepth(
  db: PrismaClient,
  workspaceId: string,
  folderId: string | null,
): Promise<number> {
  if (folderId === null) return 0;
  // Walk up parents until NULL; depth counted in edges. Bounded by MAX_NESTING_DEPTH.
  let depth = 0;
  let current: string | null = folderId;
  const guard = 100; // hard stop well above MAX_NESTING_DEPTH (defensive)
  while (current !== null && depth < guard) {
    const f: { parentId: string | null; workspaceId: string } | null =
      await db.folder.findUnique({
        where: { id: current },
        select: { parentId: true, workspaceId: true },
      });
    if (!f || f.workspaceId !== workspaceId) {
      // Cross-tenant parent — refuse; treat as infinite depth.
      return Number.POSITIVE_INFINITY;
    }
    depth += 1;
    current = f.parentId;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Content accessors — soft-delete + tenant filtered.
// ---------------------------------------------------------------------------

export async function listRootFolders(db: PrismaClient, workspaceId: string) {
  return db.folder.findMany({
    where: { workspaceId, parentId: null, ...ACTIVE },
    orderBy: { name: "asc" },
  });
}

/**
 * Resolve a default root folder for a workspace, creating one if the workspace
 * has no root folders yet. The schema's exactly-one-parent CHECK forbids a
 * parentless page (a page must live in a folder or under another page), so a
 * "New page" with no folder context needs a home — this provides it.
 *
 * Picks the alphabetically-first existing root folder (stable), else creates a
 * workspace-named one. The caller has already proven can_write on the workspace
 * root (the open-workspace rule).
 */
export async function getOrCreateDefaultFolder(
  db: PrismaClient,
  workspaceId: string,
  createdById: string,
) {
  const existing = await db.folder.findFirst({
    where: { workspaceId, parentId: null, ...ACTIVE },
    orderBy: { name: "asc" },
  });
  if (existing) return existing;
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true },
  });
  return db.folder.create({
    data: {
      workspaceId,
      parentId: null,
      name: ws?.name ?? "Pages",
      createdById,
    },
  });
}

export async function listFolderChildren(
  db: PrismaClient,
  workspaceId: string,
  folderId: string | null,
) {
  // Soft-delete + tenant scoped only — NOT per-child permission-scoped.
  // Callers MUST gate with can_read on the parent first. Under the union
  // inheritance rule a readable parent implies descendant visibility, so
  // returning all active children is correct *after* that gate. For
  // per-node scoping (sidebar / guests), use listVisibleTree instead.
  const [folders, pages] = await Promise.all([
    db.folder.findMany({
      where: { workspaceId, parentId: folderId, ...ACTIVE },
      orderBy: { name: "asc" },
    }),
    db.page.findMany({
      where: { workspaceId, folderId, ...ACTIVE },
      orderBy: { title: "asc" },
    }),
  ]);
  return { folders, pages };
}

export async function getPage(
  db: PrismaClient,
  workspaceId: string,
  pageId: string,
) {
  return db.page.findFirst({
    where: { id: pageId, workspaceId, ...ACTIVE },
  });
}

/**
 * Look up a page by id alone (soft-delete filtered), for the "load then check
 * permission" pattern where the caller doesn't yet know the workspace. The
 * permission engine (which DOES know the workspace) enforces tenant scoping;
 * this helper only centralizes the soft-delete filter so it's never forgotten.
 */
export async function findPageById(db: PrismaClient, pageId: string) {
  return db.page.findFirst({
    where: { id: pageId, ...ACTIVE },
  });
}

/**
 * Create a page. Server owns the tree edge (ticket 0005). Enforces the
 * exactly-one-parent invariant + nesting-depth cap.
 */
export async function createPage(
  db: PrismaClient,
  args: {
    workspaceId: string;
    folderId: string | null;
    parentPageId: string | null;
    title?: string;
    createdById: string;
    maxDepth: number;
  },
) {
  if ((args.folderId === null) === (args.parentPageId === null)) {
    throw new Error(
      "Page must have exactly one of folderId / parentPageId (CHECK exactly-one).",
    );
  }
  if (args.parentPageId !== null) {
    // Nested-page depth: count up through parent pages then folders.
    const depth = await nestedPageDepth(db, args.workspaceId, args.parentPageId);
    if (depth + 1 >= args.maxDepth) {
      throw new Error(`Nesting depth cap (${args.maxDepth}) exceeded.`);
    }
  } else if (args.folderId !== null) {
    const depth = await folderDepth(db, args.workspaceId, args.folderId);
    if (depth + 1 >= args.maxDepth) {
      throw new Error(`Nesting depth cap (${args.maxDepth}) exceeded.`);
    }
  }
  return db.page.create({
    data: {
      workspaceId: args.workspaceId,
      folderId: args.folderId,
      parentPageId: args.parentPageId,
      title: args.title ?? "",
      createdById: args.createdById,
    },
  });
}

async function nestedPageDepth(
  db: PrismaClient,
  workspaceId: string,
  pageId: string,
): Promise<number> {
  let depth = 0;
  let current: string | null = pageId;
  const guard = 100;
  while (current !== null && depth < guard) {
    const p: {
      parentPageId: string | null;
      folderId: string | null;
      workspaceId: string;
    } | null = await db.page.findUnique({
      where: { id: current },
      select: { parentPageId: true, folderId: true, workspaceId: true },
    });
    if (!p || p.workspaceId !== workspaceId) return Number.POSITIVE_INFINITY;
    depth += 1;
    if (p.folderId !== null) {
      return depth + (await folderDepth(db, workspaceId, p.folderId));
    }
    current = p.parentPageId;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Effective permission — delegates to the SQL function (sql/effective-permission.sql).
// ---------------------------------------------------------------------------

export interface EffectivePermissionArgs {
  workspaceId: string;
  userId: string;
  resourceType: ResourceType;
  resourceId: string | null;
  maxDepth?: number;
}

/**
 * Run the `effective_permission(...)` SQL function. Returns the strongest grant
 * on the path as one of 'none' | 'reader' | 'commenter' | 'editor'. The caller
 * (packages/auth) checks owner/admin bypass first and folds in 'manage'.
 *
 * Tenancy + soft-delete are enforced inside the function (🔒 guards inline).
 */
export async function queryEffectivePermission(
  db: PrismaClient,
  args: EffectivePermissionArgs,
): Promise<"none" | "reader" | "commenter" | "editor"> {
  const rows = await db.$queryRaw<{ effective_permission: string | null }[]>`
    SELECT effective_permission(
      ${args.workspaceId}::uuid,
      ${args.userId}::uuid,
      ${args.resourceType}::text,
      ${args.resourceId ?? null}::uuid,
      ${args.maxDepth ?? 32}::int
    ) AS effective_permission
  `;
  const value = rows[0]?.effective_permission;
  if (
    value === "reader" ||
    value === "commenter" ||
    value === "editor"
  ) {
    return value;
  }
  return "none";
}

// ---------------------------------------------------------------------------
// Search — centralized, permission-scoped (🔒 SECURITY-REVIEW: one function).
// ---------------------------------------------------------------------------

export interface SearchPagesArgs {
  workspaceId: string;
  /** The user running the query — for inline permission scoping. */
  userId: string;
  query: string;
  maxResults: number;
  /** Nesting-depth cap forwarded to the CTE (env MAX_NESTING_DEPTH). */
  maxNestingDepth: number;
}

/**
 * The ONE search function (ticket 0008). Permission-scoped inline: the join
 * against `effective_permission(...)` excludes pages the user can't read.
 * Never write ad-hoc FTS elsewhere.
 */
export async function searchPages(db: PrismaClient, args: SearchPagesArgs) {
  const tsQuery = args.query.trim();
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      title: string;
      rank: number;
      snippet: string;
    }>
  >`
    WITH visible AS (
      SELECT p.id, p.title, p.search_tsv
        FROM pages p
       WHERE p.workspace_id = ${args.workspaceId}::uuid
         AND p.deleted_at IS NULL
         AND (
           -- Owner/Admin bypass the share model entirely (ticket 0002):
           -- they read every page in the workspace regardless of shares.
           -- (The SQL effective_permission() returns only none/reader/
           -- commenter/editor; the manage bypass lives in the TS engine, so
           -- we replicate the bypass condition here.)
           EXISTS (
             SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = ${args.workspaceId}::uuid
                AND wm.user_id = ${args.userId}::uuid
                AND wm.role IN ('owner', 'admin')
           )
           OR effective_permission(
               ${args.workspaceId}::uuid,
               ${args.userId}::uuid,
               'page',
               p.id,
               ${args.maxNestingDepth}::int
             ) IN ('reader', 'commenter', 'editor')
         )
    )
    SELECT v.id,
           v.title,
           ts_rank(v.search_tsv, websearch_to_tsquery('simple', ${tsQuery})) AS rank,
           ts_headline('simple', coalesce((SELECT body_text FROM pages WHERE id = v.id), ''),
                       websearch_to_tsquery('simple', ${tsQuery}), 'MaxWords=35, MinWords=15') AS snippet
      FROM visible v
     WHERE v.search_tsv @@ websearch_to_tsquery('simple', ${tsQuery})
     ORDER BY rank DESC
     LIMIT ${args.maxResults}::int
  `;
  return rows;
}

// ---------------------------------------------------------------------------
// Member search — for @user mention typeahead (🔒 0005 #3: permission-scoped).
// ---------------------------------------------------------------------------

export interface SearchMembersArgs {
  workspaceId: string;
  /** The user running the query — must themselves be a member to see anyone. */
  userId: string;
  query: string;
  maxResults: number;
}

/**
 * Search a workspace's members + groups by name/email for the @user mention
 * typeahead (🔒 SECURITY-REVIEW 0005 #3). Permission-scoped: the caller must be
 * a member of the workspace (guests see only members of workspaces they're in;
 * the membership check below is the gate). No cross-tenant name leaks.
 *
 * Returns members (not groups) for v1 — a member mention resolves to a user.
 * Group mentions are a post-v1 concern (the share model targets groups, but the
 * mention typeahead is person-oriented).
 */
export async function searchMembers(db: PrismaClient, args: SearchMembersArgs) {
  // 🔒 Permission gate: the caller must be a member of this workspace. A
  // non-member gets nothing (no name leak across the tenant boundary).
  const membership = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: args.workspaceId, userId: args.userId },
    },
    select: { role: true },
  });
  if (!membership) return [];

  const pattern = `%${args.query.replace(/[%_]/g, (m) => "\\" + m)}%`;
  const rows = await db.$queryRaw<
    Array<{ id: string; name: string | null; email: string; role: string }>
  >`
    SELECT u.id, u.name, u.email, wm.role
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = ${args.workspaceId}::uuid
       AND (u.name ILIKE ${pattern} ESCAPE '\' OR u.email ILIKE ${pattern} ESCAPE '\')
     ORDER BY
       CASE WHEN u.email ILIKE ${pattern} ESCAPE '\' THEN 0 ELSE 1 END,
       u.name NULLS LAST
     LIMIT ${args.maxResults}::int
  `;
  return rows;
}

// ---------------------------------------------------------------------------
// Attachments (ticket 0007).
// ---------------------------------------------------------------------------

/**
 * Sum of attachment sizes for a workspace, for quota enforcement (ticket 0007 #2).
 * Counts only 'ready' attachments (pending uploads don't count until verified).
 * Returns 0n for an empty workspace.
 */
export async function workspaceAttachmentBytes(
  db: PrismaClient,
  workspaceId: string,
): Promise<bigint> {
  const result = await db.attachment.aggregate({
    where: { workspaceId, status: "ready" },
    _sum: { sizeBytes: true },
  });
  return result._sum.sizeBytes ?? 0n;
}

/** Fetch an attachment by id. */
export async function getAttachment(db: PrismaClient, attachmentId: string) {
  return db.attachment.findUnique({ where: { id: attachmentId } });
}

// ---------------------------------------------------------------------------
// Shares (ticket 0002 — the ACL management surface).
// ---------------------------------------------------------------------------

/**
 * Create a share. Caller must have already verified owner/admin (only they can
 * create shares). 🔒 HIGH #1: asserts the target resource belongs to the
 * workspace before inserting.
 */
export async function createShare(
  db: PrismaClient,
  args: {
    workspaceId: string;
    resourceType: ResourceType;
    resourceId: string | null;
    principalUserId: string | null;
    principalGroupId: string | null;
    level: string;
    createdById: string;
  },
) {
  // 🔒 HIGH #1: the resource must belong to this workspace.
  if (args.resourceId !== null) {
    const ok = await assertResourceInWorkspace(
      db,
      args.workspaceId,
      args.resourceType,
      args.resourceId,
    );
    if (!ok) throw new Error("Resource not found in workspace.");
  }
  return db.share.create({
    data: {
      workspaceId: args.workspaceId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      principalUserId: args.principalUserId,
      principalGroupId: args.principalGroupId,
      level: args.level,
      createdById: args.createdById,
    },
  });
}

/** List all shares on a resource (workspace-scoped). */
export async function listShares(
  db: PrismaClient,
  workspaceId: string,
  resourceType: ResourceType,
  resourceId: string | null,
) {
  return db.share.findMany({
    where: { workspaceId, resourceType, resourceId },
    orderBy: { createdAt: "desc" },
  });
}

/** Delete a share by id (workspace-scoped — HIGH #1). */
export async function deleteShare(db: PrismaClient, workspaceId: string, shareId: string) {
  return db.share.deleteMany({ where: { id: shareId, workspaceId } });
}

/** User ids currently in a group (live membership for notify targets). */
export async function listGroupMemberUserIds(
  db: PrismaClient,
  groupId: string,
): Promise<string[]> {
  const rows = await db.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Resolve notifyPermChange targets for a share create/delete so realtime
 * live-revocation fires for both user and group principals.
 *
 * - User principal → that userId
 * - Group principal → every current group member (empty group → no-op notify)
 * - Page resource → also include pageId for precise doc kill
 */
export async function resolveShareNotifyTargets(
  db: PrismaClient,
  share: {
    principalUserId: string | null;
    principalGroupId: string | null;
    resourceType: string;
    resourceId: string | null;
  },
): Promise<{ userIds: string[]; pageIds: string[] }> {
  let userIds: string[] = [];
  if (share.principalUserId) {
    userIds = [share.principalUserId];
  } else if (share.principalGroupId) {
    userIds = await listGroupMemberUserIds(db, share.principalGroupId);
  }
  const pageIds =
    share.resourceType === "page" && share.resourceId ? [share.resourceId] : [];
  return { userIds, pageIds };
}

// ---------------------------------------------------------------------------
// Workspaces (ticket 0006 — provisioning + onboarding).
// ---------------------------------------------------------------------------

/**
 * Create a workspace. The creator becomes its Owner. Also creates the
 * all-members group + the Owner membership (the trigger syncs the group).
 */
export async function createWorkspace(
  db: PrismaClient,
  args: { name: string; slug: string; ownerId: string },
) {
  return db.workspace.create({
    data: {
      name: args.name,
      slug: args.slug,
      createdById: args.ownerId,
      ownerId: args.ownerId,
      members: {
        create: { userId: args.ownerId, role: "owner" },
      },
    },
    include: { members: true },
  });
}

/** List workspaces the user is a member of, with their role in each. */
export async function listUserWorkspaces(db: PrismaClient, userId: string) {
  const memberships = await db.workspaceMember.findMany({
    where: { userId },
    include: { workspace: { select: { id: true, name: true, slug: true } } },
  });
  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    role: m.role,
  }));
}

/**
 * Count total workspaces. Used by the first-user bootstrap: if 0, the signing-up
 * user is the first on a fresh install → promoted to Owner of the default
 * "OpenNote" workspace (ticket 0006 §3).
 */
export async function countWorkspaces(db: PrismaClient): Promise<number> {
  return db.workspace.count();
}


// ---------------------------------------------------------------------------
// Sidebar — the visible page/folder tree, plus per-user Recent + Favorites.
//
// 🔒 SECURITY: every listing here is **per-node permission-scoped**. Unlike the
// `listFolderChildren` accessor (which returns all children of a readable parent
// and relies on the union rule's monotonicity), these run the
// owner/admin-bypass-OR-effective_permission() filter against EACH node, the
// same pattern as `searchPages`. A page the user cannot read never appears in
// the sidebar — not even its id/title.
// ---------------------------------------------------------------------------

export interface VisibleTreeArgs {
  workspaceId: string;
  /** The user running the query — for inline permission scoping. */
  userId: string;
  /** Nesting-depth cap forwarded to the CTE (env MAX_NESTING_DEPTH). */
  maxNestingDepth: number;
}

/**
 * The full visible content tree for a workspace, as two flat sets (folders +
 * pages). The client nests them. Mirrors `searchPages`' permission filter:
 * owner/admin see everything; everyone else sees only pages/folders on a path
 * where they hold reader/commenter/editor. Soft-deleted nodes excluded.
 *
 * Folder visibility uses the same `effective_permission(..., 'folder', id)` the
 * doc-load path uses, so the sidebar can never reveal a folder the user can't
 * open.
 */
export async function listVisibleTree(db: PrismaClient, args: VisibleTreeArgs) {
  // Two parallel queries keep the SQL readable (folders vs pages differ in the
  // resource_type argument + columns). Both reuse the identical permission
  // predicate as `searchPages`.
  const [folders, pages] = await Promise.all([
    db.$queryRaw<
      Array<{
        id: string;
        workspace_id: string;
        parent_id: string | null;
        name: string;
        created_by: string;
        deleted_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT f.id, f.workspace_id, f.parent_id, f.name,
             f.created_by, f.deleted_at, f.created_at, f.updated_at
        FROM folders f
       WHERE f.workspace_id = ${args.workspaceId}::uuid
         AND f.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = ${args.workspaceId}::uuid
                AND wm.user_id = ${args.userId}::uuid
                AND wm.role IN ('owner', 'admin')
           )
           OR effective_permission(
               ${args.workspaceId}::uuid,
               ${args.userId}::uuid,
               'folder',
               f.id,
               ${args.maxNestingDepth}::int
             ) IN ('reader', 'commenter', 'editor')
         )
       ORDER BY f.name ASC
    `,
    db.$queryRaw<
      Array<{
        id: string;
        workspace_id: string;
        folder_id: string | null;
        parent_page_id: string | null;
        title: string;
        icon: string | null;
        created_by: string;
        deleted_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT p.id, p.workspace_id, p.folder_id, p.parent_page_id,
             p.title, p.icon, p.created_by, p.deleted_at,
             p.created_at, p.updated_at
        FROM pages p
       WHERE p.workspace_id = ${args.workspaceId}::uuid
         AND p.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = ${args.workspaceId}::uuid
                AND wm.user_id = ${args.userId}::uuid
                AND wm.role IN ('owner', 'admin')
           )
           OR effective_permission(
               ${args.workspaceId}::uuid,
               ${args.userId}::uuid,
               'page',
               p.id,
               ${args.maxNestingDepth}::int
             ) IN ('reader', 'commenter', 'editor')
         )
       ORDER BY p.title ASC
    `,
  ]);
  return { folders, pages };
}

/**
 * Record that a user opened a page — upserts `page_visits`. The caller MUST have
 * already proven `can_read` for the page (no visit row for an unreadable page).
 * `workspaceId` is denormalized onto the row so the recent query can scope by
 * workspace without a join.
 */
export async function recordPageVisit(
  db: PrismaClient,
  args: { userId: string; pageId: string; workspaceId: string },
): Promise<void> {
  await db.pageVisit.upsert({
    where: {
      userId_pageId: { userId: args.userId, pageId: args.pageId },
    },
    create: {
      userId: args.userId,
      pageId: args.pageId,
      workspaceId: args.workspaceId,
      lastVisitedAt: new Date(),
    },
    update: { lastVisitedAt: new Date() },
  });
}

/**
 * The user's recently-visited pages in a workspace, newest first. Permission-
 * scoped: a page whose share was revoked drops out (the join against the same
 * owner/admin-bypass-OR-effective_permission() predicate excludes it), so a
 * stale `page_visits` row is harmless.
 *
 * Ordered by `last_visited_at DESC`; ties broken by title for stable output.
 */
export async function listRecentPages(
  db: PrismaClient,
  args: {
    workspaceId: string;
    userId: string;
    limit: number;
    maxNestingDepth: number;
  },
) {
  return db.$queryRaw<
    Array<{
      id: string;
      title: string;
      icon: string | null;
      last_visited_at: Date;
    }>
  >`
    SELECT p.id, p.title, p.icon, pv.last_visited_at
      FROM page_visits pv
      JOIN pages p ON p.id = pv.page_id
     WHERE pv.user_id = ${args.userId}::uuid
       AND pv.workspace_id = ${args.workspaceId}::uuid
       AND p.deleted_at IS NULL
       AND (
         EXISTS (
           SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = ${args.workspaceId}::uuid
              AND wm.user_id = ${args.userId}::uuid
              AND wm.role IN ('owner', 'admin')
         )
         OR effective_permission(
             ${args.workspaceId}::uuid,
             ${args.userId}::uuid,
             'page',
             p.id,
             ${args.maxNestingDepth}::int
           ) IN ('reader', 'commenter', 'editor')
       )
     ORDER BY pv.last_visited_at DESC, p.title ASC
     LIMIT ${args.limit}::int
  `;
}

/**
 * The user's pinned (favorited) pages in a workspace. Same permission-scoping as
 * {@link listRecentPages}: a revoked share removes the page from Favorites even
 * though the `favorite_pages` row lingers.
 */
export async function listFavoritePages(
  db: PrismaClient,
  args: {
    workspaceId: string;
    userId: string;
    maxNestingDepth: number;
  },
) {
  return db.$queryRaw<
    Array<{
      id: string;
      title: string;
      icon: string | null;
      created_at: Date;
    }>
  >`
    SELECT p.id, p.title, p.icon, fp.created_at
      FROM favorite_pages fp
      JOIN pages p ON p.id = fp.page_id
     WHERE fp.user_id = ${args.userId}::uuid
       AND fp.workspace_id = ${args.workspaceId}::uuid
       AND p.deleted_at IS NULL
       AND (
         EXISTS (
           SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = ${args.workspaceId}::uuid
              AND wm.user_id = ${args.userId}::uuid
              AND wm.role IN ('owner', 'admin')
         )
         OR effective_permission(
             ${args.workspaceId}::uuid,
             ${args.userId}::uuid,
             'page',
             p.id,
             ${args.maxNestingDepth}::int
           ) IN ('reader', 'commenter', 'editor')
       )
     ORDER BY fp.created_at DESC, p.title ASC
  `;
}

/** Pin a page (idempotent on the composite PK). Caller proves can_read first. */
export async function addFavorite(
  db: PrismaClient,
  args: { userId: string; pageId: string; workspaceId: string },
): Promise<void> {
  await db.favoritePage.upsert({
    where: {
      userId_pageId: { userId: args.userId, pageId: args.pageId },
    },
    create: {
      userId: args.userId,
      pageId: args.pageId,
      workspaceId: args.workspaceId,
    },
    update: {}, // already favorited — no-op
  });
}

/** Unpin a page (no-op if not pinned). */
export async function removeFavorite(
  db: PrismaClient,
  args: { userId: string; pageId: string },
): Promise<void> {
  try {
    await db.favoritePage.delete({
      where: {
        userId_pageId: { userId: args.userId, pageId: args.pageId },
      },
    });
  } catch (err) {
    // P2025 = record not found; unpinning something not pinned is a no-op.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Page docs (Y-doc state) — ticket 0004.
// ---------------------------------------------------------------------------

export async function getPageDocState(
  db: PrismaClient,
  pageId: string,
): Promise<Buffer | null> {
  const doc = await db.pageDoc.findUnique({
    where: { pageId },
    select: { state: true },
  });
  return doc?.state ?? null;
}

export async function upsertPageDocState(
  db: PrismaClient,
  pageId: string,
  state: Buffer,
  /** 🔒 REALTIME_DOC_MAX_BYTES — reject oversize writes (caller enforces). */
  maxBytes: number,
): Promise<void> {
  if (state.byteLength > maxBytes) {
    throw new Error(
      `Page doc state exceeds cap (${state.byteLength} > ${maxBytes} bytes).`,
    );
  }
  await db.pageDoc.upsert({
    where: { pageId },
    create: { pageId, state },
    update: { state },
  });
}

// ---------------------------------------------------------------------------
// Live-revocation NOTIFY (ticket 0010 decision #3). apps/realtime LISTENs.
// ---------------------------------------------------------------------------

/**
 * Notify apps/realtime that permissions may have changed for the named users
 * and/or pages, so it can close now-stale connections (proactive kill). Call
 * AFTER the mutating transaction commits. Empty arrays → no-op.
 *
 * The NOTIFY is transactional in the helper's own statement; for true
 * commit-bound semantics, call this from within the mutating transaction (the
 * notify_perm_change() SQL function fires on its enclosing commit).
 */
export async function notifyPermChange(
  db: PrismaClient,
  args: { userIds?: string[]; pageIds?: string[] },
): Promise<void> {
  const userIds = args.userIds ?? [];
  const pageIds = args.pageIds ?? [];
  if (userIds.length === 0 && pageIds.length === 0) return;
  await db.$executeRawUnsafe(
    `SELECT notify_perm_change($1::text[], $2::text[])`,
    userIds,
    pageIds,
  );
}
