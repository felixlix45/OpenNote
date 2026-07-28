/**
 * apps/web — POST/GET /api/shares : create + list shares (ticket 0002).
 *
 * Only Owner/Admin can manage shares (the engine's 'manage' level). After a
 * create/delete, emit notifyPermChange → apps/realtime closes affected
 * connections (live revocation, ticket 0010 #3).
 */
import { NextResponse } from "next/server";
import { ShareInput } from "@opennote/shared";
import {
  db,
  createShare,
  listShares,
  notifyPermChange,
  permissions,
  env,
} from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

export async function POST(request: Request) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const parsed = ShareInput.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { workspaceId, resourceType, resourceId, principalUserId, principalGroupId, level } =
    parsed.data;

  // Only owner/admin can create shares (CONTEXT.md: "Only Owner/Admin create Shares").
  const perm = await permissions.effective({
    workspaceId,
    userId: user.id,
    resourceType,
    resourceId,
  });
  if (perm.level !== "manage") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const share = await createShare(db, {
      workspaceId,
      resourceType,
      resourceId,
      principalUserId: principalUserId ?? null,
      principalGroupId: principalGroupId ?? null,
      level,
      createdById: user.id,
    });
    // Trigger live revocation so any affected connections re-check on reconnect.
    await notifyPermChange(db, {
      userIds: principalUserId ? [principalUserId] : [],
    });
    return NextResponse.json({ share }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found in workspace")) {
      return NextResponse.json({ error: "resource_not_in_workspace" }, { status: 400 });
    }
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}

/** GET /api/shares?workspaceId=…&resourceType=…&resourceId=… : list shares. */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const resourceType = url.searchParams.get("resourceType") as "folder" | "page" | null;
  const resourceId = url.searchParams.get("resourceId");
  if (!workspaceId || !resourceType) {
    return NextResponse.json({ error: "workspaceId + resourceType required" }, { status: 400 });
  }

  // Only owner/admin can list shares (the full ACL is admin-only info).
  const perm = await permissions.effective({
    workspaceId,
    userId: user.id,
    resourceType,
    resourceId,
  });
  if (perm.level !== "manage") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const shares = await listShares(db, workspaceId, resourceType, resourceId);
  void env;
  return NextResponse.json({ shares });
}
