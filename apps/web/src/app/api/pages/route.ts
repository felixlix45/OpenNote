/**
 * apps/web — POST/GET /api/pages : create + list pages (spine milestone).
 *
 * Permission model (ticket 0002): create requires can_write on the parent
 * (folder or workspace root); list requires can_read on the parent. The
 * open-workspace rule means Members get Editor on the root by default.
 *
 * All content reads/writes go through the @opennote/db repository layer — it
 * centralizes the 🔒 soft-delete + tenant-isolation invariants (SECURITY-REVIEW
 * MEDIUM: "not per-query by hand"). Route handlers must not call db.page.*
 * directly.
 */
import { NextResponse } from "next/server";
import { CreatePageInput } from "@opennote/shared";
import { db, createPage, listFolderChildren, getOrCreateDefaultFolder, permissions, env } from "@/lib/services";
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

  const body = CreatePageInput.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: body.error.flatten() },
      { status: 400 },
    );
  }
  const { workspaceId, folderId, title } = body.data;

  // Permission gate: can_write on the parent (folder, or workspace root).
  const canWrite = await permissions.canWrite({
    workspaceId,
    userId: user.id,
    resourceType: "folder",
    resourceId: folderId, // null = workspace-root sentinel → open-workspace rule
  });
  if (!canWrite) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // The schema's exactly-one-parent CHECK forbids a parentless page: a page
    // must live in a folder or under another page. folderId null here means
    // "no folder picked" (the sidebar New page button), so resolve a default
    // root folder for the workspace (creating one if none exists).
    const resolvedFolderId =
      folderId ?? (await getOrCreateDefaultFolder(db, workspaceId, user.id)).id;
    // Through the repository: enforces the exactly-one-parent invariant +
    // the nesting-depth cap (🔒 SECURITY-REVIEW nesting-depth DoS bound).
    const page = await createPage(db, {
      workspaceId,
      folderId: resolvedFolderId,
      parentPageId: null, // top-level page via this endpoint
      title,
      createdById: user.id,
      maxDepth: env.MAX_NESTING_DEPTH,
    });
    return NextResponse.json({ page }, { status: 201 });
  } catch (err) {
    // Don't leak internal error text to the client.
    if (err instanceof Error && err.message.includes("Nesting depth cap")) {
      return NextResponse.json({ error: "nesting_too_deep" }, { status: 400 });
    }
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}

/** GET /api/pages?workspaceId=…&folderId=… : list children (permission-scoped). */
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
  const folderId = url.searchParams.get("folderId"); // null → workspace root
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  // Permission gate: must be able to read the parent to list its children.
  const canRead = await permissions.canRead({
    workspaceId,
    userId: user.id,
    resourceType: "folder",
    resourceId: folderId,
  });
  if (!canRead) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Through the repository: soft-delete + tenant scoped.
  const { folders, pages } = await listFolderChildren(db, workspaceId, folderId);
  return NextResponse.json({ folders, pages });
}
