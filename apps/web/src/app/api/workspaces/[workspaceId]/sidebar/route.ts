/**
 * apps/web — GET /api/workspaces/:workspaceId/sidebar : the sidebar payload.
 *
 * Returns the full visible page/folder tree, the user's recent pages, and their
 * favorited pages for one workspace — in a single call (the sidebar mounts in
 * one render, not three). All three are per-node permission-scoped in the
 * repository (🔒 a page the user can't read never appears), so the only gate
 * here is workspace membership.
 *
 * Owner/admin short-circuit inside the repository (they see the whole tree);
 * members/guests see only their share-visible nodes.
 */
import { NextResponse } from "next/server";
import {
  db,
  permissions,
  env,
  listVisibleTree,
  listRecentPages,
  listFavoritePages,
} from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

const RECENT_LIMIT = 10;

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const { workspaceId } = await context.params;

  // Membership gate: any member (incl. guest) may open the sidebar for a
  // workspace they belong to; a non-member gets 403 (not 404 — the workspace
  // id is not a secret once you're a member of the tenant).
  const canReadWorkspace = await permissions.canRead({
    workspaceId,
    userId: user.id,
    resourceType: "folder",
    resourceId: null, // workspace-root sentinel → the open-workspace rule
  });
  if (!canReadWorkspace) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const maxNestingDepth = env.MAX_NESTING_DEPTH;
  const [tree, recent, favorites] = await Promise.all([
    listVisibleTree(db, { workspaceId, userId: user.id, maxNestingDepth }),
    listRecentPages(db, {
      workspaceId,
      userId: user.id,
      limit: RECENT_LIMIT,
      maxNestingDepth,
    }),
    listFavoritePages(db, { workspaceId, userId: user.id, maxNestingDepth }),
  ]);

  return NextResponse.json({ tree, recent, favorites });
}
