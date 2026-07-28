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

export async function listFolderChildren(
  db: PrismaClient,
  workspaceId: string,
  folderId: string | null,
) {
  // folderId === null → workspace root's direct children.
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
