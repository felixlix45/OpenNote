/**
 * apps/web — GET /api/mentions/users : @user mention typeahead (ticket 0005).
 *
 * 🔒 SECURITY-REVIEW 0005 #3: permission-scoped. Reuses {@link searchMembers},
 * which gates on the caller being a member of the workspace (no cross-tenant
 * name leaks). Members of a workspace can see each other by design (the
 * "open workspace" rule, CONTEXT.md); privacy between members is achieved with
 * separate workspaces.
 */
import { NextResponse } from "next/server";
import { UserMentionInput } from "@opennote/shared";
import { db, searchMembers, permissions, env } from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

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
  const parsed = UserMentionInput.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? "",
    q: url.searchParams.get("q") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 🔒 Defense in depth: searchMembers already gates on membership, but we also
  // confirm the caller can_read the workspace root (the membership check is the
  // real gate; this is a belt-and-suspenders for guests who are members).
  const canRead = await permissions.canRead({
    workspaceId: parsed.data.workspaceId,
    userId: user.id,
    resourceType: "folder",
    resourceId: null, // workspace-root sentinel
  });
  if (!canRead) {
    return NextResponse.json({ users: [] });
  }

  const members = await searchMembers(db, {
    workspaceId: parsed.data.workspaceId,
    userId: user.id,
    query: parsed.data.q,
    maxResults: env.SEARCH_MAX_RESULTS,
  });

  return NextResponse.json({
    users: members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role as "guest" | "member" | "admin" | "owner",
    })),
  });
}
