/**
 * apps/web — GET/PUT /api/pages/:pageId : read + update a page (spine milestone).
 *
 * GET: returns the page metadata + its Y-doc body as base64 (the editor boots
 *      from this initial state; realtime takes over once connected).
 * PUT:  persists the page title (mirror refreshed from the Y-doc on save) +
 *       the Y-doc state. The realtime server is the primary writer in v1; this
 *       endpoint serves the non-realtime fallback + the initial save path that
 *       proves the spine end-to-end.
 *
 * Permission (ticket 0002): GET requires can_read; PUT requires can_write.
 * Content access goes through the repository (🔒 soft-delete + tenant scoped).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  findPageById,
  upsertPageDocState,
  permissions,
  env,
} from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ pageId: string }>;
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

  const { pageId } = await context.params;
  // Page lookup via the repository (soft-delete filtered). We don't know the
  // workspace yet, so the tenant boundary is enforced by the permission gate
  // below (cross-workspace → can_read fails → 404).
  const page = await findPageById(db, pageId);
  if (!page) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Permission gate: can_read on the page.
  // Run effective() once + derive both canRead and canWrite from the single
  // result (avoids running the CTE twice — review finding #8).
  const perm = await permissions.effective({
    workspaceId: page.workspaceId,
    userId: user.id,
    resourceType: "page",
    resourceId: page.id,
  });
  const canRead = perm.level !== "none";
  if (!canRead) {
    // Don't leak existence → 404 (not 403) to unauthorized users.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const canWrite = perm.level === "editor" || perm.level === "manage";

  // Only now (authorized) load the Y-doc body bytes.
  const doc = await db.pageDoc.findUnique({
    where: { pageId: page.id },
    select: { state: true },
  });
  const docStateBase64 = doc?.state?.toString("base64") ?? null;

  return NextResponse.json({
    page: {
      id: page.id,
      workspaceId: page.workspaceId,
      title: page.title,
      icon: page.icon,
      // Y-doc state as base64; the client decodes to a Uint8Array for Yjs.
      docStateBase64,
      canWrite,
    },
  });
}

const UpdatePageBody = z.object({
  title: z.string().max(512).optional(),
  // base64-encoded Y.encodeStateAsUpdate(doc) bytes.
  docStateBase64: z.string().optional(),
});

export async function PUT(request: Request, context: RouteContext) {
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
  const parsed = UpdatePageBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Fetch via the repository (soft-delete filtered) to learn the workspace;
  // the permission gate enforces tenant scoping.
  const page = await findPageById(db, pageId);
  if (!page) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const canWrite = await permissions.canWrite({
    workspaceId: page.workspaceId,
    userId: user.id,
    resourceType: "page",
    resourceId: page.id,
  });
  if (!canWrite) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (parsed.data.title !== undefined) {
    await db.page.update({ where: { id: page.id }, data: { title: parsed.data.title } });
  }

  if (parsed.data.docStateBase64 !== undefined) {
    const state = Buffer.from(parsed.data.docStateBase64, "base64");
    // Through the repository: enforces the doc-size cap (🔒 DoS bound).
    await upsertPageDocState(db, page.id, state, env.REALTIME_DOC_MAX_BYTES).catch(
      (err) => {
        if (err instanceof Error && err.message.includes("exceeds cap")) {
          throw new DocTooLargeError();
        }
        throw err;
      },
    );
  }

  return NextResponse.json({ ok: true });
}

class DocTooLargeError extends Error {
  status = 413 as const;
  constructor() {
    super("doc_too_large");
  }
}
