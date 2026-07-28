/**
 * apps/web — POST /api/pages/:pageId/subpages : create a nested sub-page
 * (ticket 0005 decision #2: the backend owns the parent_page_id edge).
 *
 * The editor requests "insert sub-page here"; this endpoint creates the pages
 * row with parent_page_id set (the tree edge the editor must NOT set itself),
 * enforces the nesting-depth cap, and returns the new pageId. The editor then
 * inserts a { type:'subpage', attrs:{ pageId } } block referencing it.
 *
 * Permission: can_write on the parent page (you can only nest under a page you
 * can edit). The new sub-page inherits visibility via the union rule (the path
 * includes the parent's shares).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, findPageById, createPage, permissions, env } from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

const SubPageBody = z.object({
  title: z.string().max(512).default(""),
});

interface RouteContext {
  params: Promise<{ pageId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const { pageId: parentPageId } = await context.params;
  const parsed = SubPageBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const parent = await findPageById(db, parentPageId);
  if (!parent) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Permission: must be able to write the parent page (nesting under a page you
  // can't edit would be a privilege escalation — the sub-page would inherit
  // the parent's visibility but you shouldn't be able to add to it).
  const canWrite = await permissions.canWrite({
    workspaceId: parent.workspaceId,
    userId: user.id,
    resourceType: "page",
    resourceId: parent.id,
  });
  if (!canWrite) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // createPage enforces the exactly-one-parent invariant (parentPageId set,
    // folderId null) + the nesting-depth cap (🔒 SECURITY-REVIEW DoS bound).
    const page = await createPage(db, {
      workspaceId: parent.workspaceId,
      folderId: null,
      parentPageId: parent.id,
      title: parsed.data.title,
      createdById: user.id,
      maxDepth: env.MAX_NESTING_DEPTH,
    });
    return NextResponse.json({ page }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Nesting depth cap")) {
      return NextResponse.json({ error: "nesting_too_deep" }, { status: 400 });
    }
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
