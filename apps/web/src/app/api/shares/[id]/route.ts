/**
 * apps/web — DELETE /api/shares/:id : delete a share (ticket 0002).
 *
 * Only Owner/Admin. After delete, emit notifyPermChange so the revoked
 * principal's connections close (live revocation, ticket 0010 #3).
 */
import { NextResponse } from "next/server";
import {
  db,
  deleteShare,
  notifyPermChange,
  permissions,
  resolveShareNotifyTargets,
} from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const { id: shareId } = await context.params;

  // Fetch the share to learn the workspace + principal (for the perm check +
  // the revocation notify). Workspace-scoped.
  const share = await db.share.findFirst({ where: { id: shareId } });
  if (!share) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Only owner/admin of the workspace can delete shares.
  const perm = await permissions.effective({
    workspaceId: share.workspaceId,
    userId: user.id,
    resourceType: share.resourceType as "folder" | "page",
    resourceId: share.resourceId,
  });
  if (perm.level !== "manage") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Resolve notify targets BEFORE delete (group membership still readable).
  const targets = await resolveShareNotifyTargets(db, share);
  await deleteShare(db, share.workspaceId, shareId);
  await notifyPermChange(db, targets);

  return NextResponse.json({ ok: true });
}
