/**
 * apps/realtime — authorization resolver (ticket 0010 decision #2).
 *
 * Given a resolved user + page id, computes the realtime-relevant facts in one
 * pass: the effective permission level, and the derived `readOnly` flag for
 * the Hocuspocus connection.
 *
 *   none            → reject (handled by the caller before this returns)
 *   reader/commenter → readOnly = true  (receives the doc + live updates; own
 *                                          updates rejected in the update hook)
 *   editor          → readOnly = false
 *   manage (owner/admin bypass) → readOnly = false
 *
 * Doc-name is the ONLY trusted page identity (🔒 req #3): `pageId` here came
 * exclusively from {@link parseDocName}, never from another client channel.
 */
import type { PrismaClient } from "@opennote/db";
import type { PermissionEngine } from "@opennote/auth";
import type { EffectivePermission } from "@opennote/shared";

export interface ResolvedAuthorization {
  level: EffectivePermission;
  readOnly: boolean;
  workspaceId: string;
}

/**
 * Resolve the page row + run the permission engine. Returns null when the page
 * doesn't exist (or is trashed) — the caller treats that as a rejection.
 */
export async function resolveAuthorization(
  db: PrismaClient,
  permissions: PermissionEngine,
  args: { userId: string; pageId: string },
): Promise<ResolvedAuthorization | null> {
  const page = await db.page.findFirst({
    where: { id: args.pageId, deletedAt: null },
    select: { id: true, workspaceId: true },
  });
  if (!page) return null;

  const result = await permissions.effective({
    workspaceId: page.workspaceId,
    userId: args.userId,
    resourceType: "page",
    resourceId: page.id,
  });

  // reader/commenter → readOnly; editor/manage → read/write.
  const readOnly =
    result.level !== "editor" && result.level !== "manage";

  return {
    level: result.level,
    readOnly,
    workspaceId: page.workspaceId,
  };
}
