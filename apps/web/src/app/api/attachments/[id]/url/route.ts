/**
 * apps/web — GET /api/attachments/:id/url : mint a short-lived signed GET URL
 * (ticket 0007 #3 — access control via signed URLs after a permission check).
 *
 * The bucket stays private (no public reads); the app server stays out of the
 * byte path. Every view re-mints a fresh signed URL through this endpoint, so a
 * leaked URL is useless after its TTL (10 min) and never bypasses RBAC — minting
 * requires an authenticated, authorized session. The signed URL carries a
 * Content-Disposition that forces download for every non-inline-image type
 * (🔒 #3: stored-XSS via SVG/HTML).
 */
import { NextResponse } from "next/server";
import {
  db,
  getAttachment,
  s3,
  permissions,
  env,
} from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ id: string }>;
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

  const { id: attachmentId } = await context.params;
  const attachment = await getAttachment(db, attachmentId);
  if (!attachment || attachment.status !== "ready") {
    // Don't leak existence/shape of pending/missing attachments.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 🔒 Permission: can_read on the page. The signed URL is the bearer once
  // minted, so the gate here is what stops an unauthorized user from getting one.
  const canRead = await permissions.canRead({
    workspaceId: attachment.workspaceId,
    userId: user.id,
    resourceType: "page",
    resourceId: attachment.pageId,
  });
  if (!canRead) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Mint the signed GET. presignGet enforces the inline-allowlist (🔒 #3):
  // only png/jpg/gif/webp render inline; everything else (SVG/HTML/PDF/…) is
  // forced to Content-Disposition: attachment.
  const { url, inline } = await s3.presignGet({
    s3Key: attachment.s3Key,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    ttlSeconds: env.ATTACHMENT_SIGNED_URL_TTL_SECONDS,
  });

  return NextResponse.json({
    url,
    inline,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    expiresInSeconds: env.ATTACHMENT_SIGNED_URL_TTL_SECONDS,
  });
}
