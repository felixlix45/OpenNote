/**
 * apps/web — POST/DELETE /api/pages/:pageId/favorite : pin / unpin a page.
 *
 * POST   → add to the user's Favorites (idempotent).
 * DELETE → remove from Favorites (no-op if not pinned).
 *
 * Both gate on can_read first: you can't favorite a page you aren't allowed to
 * see. The repository's listFavoritePages re-checks permission at read time, so
 * a later share revocation drops the page from Favorites even if the favorite
 * row lingers — this endpoint just records the intent.
 */
import { NextResponse } from "next/server";
import {
  db,
  findPageById,
  addFavorite,
  removeFavorite,
  permissions,
} from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ pageId: string }>;
}

async function loadReadablePage(
  userId: string,
  pageId: string,
): Promise<{ id: string; workspaceId: string } | { error: Response }> {
  const page = await findPageById(db, pageId);
  if (!page) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  const canRead = await permissions.canRead({
    workspaceId: page.workspaceId,
    userId,
    resourceType: "page",
    resourceId: page.id,
  });
  if (!canRead) {
    // 404 (not 403) to avoid leaking existence.
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  return { id: page.id, workspaceId: page.workspaceId };
}

export async function POST(_request: Request, context: RouteContext) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const { pageId } = await context.params;
  const result = await loadReadablePage(user.id, pageId);
  if ("error" in result) return result.error;

  await addFavorite(db, {
    userId: user.id,
    pageId: result.id,
    workspaceId: result.workspaceId,
  });
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

  const { pageId } = await context.params;
  // Unpinning does not require can_read (a user may unpin a page whose share
  // was revoked); removeFavorite is a no-op if the row is absent.
  await removeFavorite(db, { userId: user.id, pageId });
  return NextResponse.json({ ok: true });
}
