/**
 * apps/web — PATCH/DELETE /api/workspaces/:ws/members/:userId : change role /
 * remove member (ticket 0002). Owner/admin only. Emits notifyPermChange so the
 * affected user's realtime connections close + re-check (live revocation).
 *
 * Guards: can't remove or demote the last owner (every workspace needs ≥1).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, notifyPermChange } from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ workspaceId: string; userId: string }>;
}

/** Check the caller is owner/admin of the workspace. */
async function requireAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return member?.role === "owner" || member?.role === "admin";
}

const ChangeRoleBody = z.object({
  role: z.enum(["guest", "member", "admin"]),
});

export async function PATCH(request: Request, context: RouteContext) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const { workspaceId, userId: targetUserId } = await context.params;
  if (!(await requireAdmin(workspaceId, user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = ChangeRoleBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Guard: can't demote the last owner. The Zod schema only allows
  // guest/member/admin (no owner promotion via this endpoint), so any role
  // change on an owner is a demotion.
  const target = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (target.role === "owner") {
    const ownerCount = await db.workspaceMember.count({
      where: { workspaceId, role: "owner" },
    });
    if (ownerCount <= 1) {
      return NextResponse.json({ error: "cannot_remove_last_owner" }, { status: 400 });
    }
  }

  await db.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    data: { role: parsed.data.role },
  });
  // The all-members trigger handles group sync. Trigger live revocation.
  await notifyPermChange(db, { userIds: [targetUserId] });

  return NextResponse.json({ ok: true });
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

  const { workspaceId, userId: targetUserId } = await context.params;
  if (!(await requireAdmin(workspaceId, user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Guard: can't remove the last owner.
  const target = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (target.role === "owner") {
    const ownerCount = await db.workspaceMember.count({
      where: { workspaceId, role: "owner" },
    });
    if (ownerCount <= 1) {
      return NextResponse.json({ error: "cannot_remove_last_owner" }, { status: 400 });
    }
  }

  await db.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });
  // The all-members trigger removes them from the group. Trigger live revocation.
  await notifyPermChange(db, { userIds: [targetUserId] });

  return NextResponse.json({ ok: true });
}
