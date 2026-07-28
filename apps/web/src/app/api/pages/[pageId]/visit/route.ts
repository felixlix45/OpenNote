/**
 * apps/web — POST /api/pages/:pageId/visit : record a page open → Recent.
 *
 * The editor fires this on successful page load so the page appears in the
 * sidebar's Recent section. The permission gate runs FIRST: no visit row is
 * ever written for a page the user can't read (a revoked-share page must not
 * accumulate visit history).
 */
import { NextResponse } from "next/server";
import { db, findPageById, recordPageVisit, permissions } from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ pageId: string }>;
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
  const page = await findPageById(db, pageId);
  if (!page) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Permission gate: can_read before recording. 404 (not 403) to avoid leaking
  // existence, matching the [pageId] GET handler.
  const canRead = await permissions.canRead({
    workspaceId: page.workspaceId,
    userId: user.id,
    resourceType: "page",
    resourceId: page.id,
  });
  if (!canRead) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await recordPageVisit(db, {
    userId: user.id,
    pageId: page.id,
    workspaceId: page.workspaceId,
  });
  return NextResponse.json({ ok: true });
}
