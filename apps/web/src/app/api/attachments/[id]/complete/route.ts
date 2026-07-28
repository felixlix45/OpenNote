/**
 * apps/web — POST /api/attachments/:id/complete : verify + activate an upload
 * (ticket 0007 🔒 #2 — re-verify type + size on completion).
 *
 * The presigned PUT URL doesn't bind Content-Type/size, so a client can upload a
 * different type than declared. On /complete we HEAD the S3 object and verify
 * the real MIME + size match the declared values. On mismatch → delete the
 * object + reject. On match → re-check quota against the verified size, mark the
 * row 'ready', and return { attachmentId } (the client then inserts the block +
 * fetches a signed GET from Layer 4).
 */
import { NextResponse } from "next/server";
import {
  db,
  getAttachment,
  s3,
  permissions,
  workspaceAttachmentBytes,
  env,
} from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ id: string }>;
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

  const { id: attachmentId } = await context.params;
  const attachment = await getAttachment(db, attachmentId);
  if (!attachment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (attachment.status === "ready") {
    // Idempotent: already completed.
    return NextResponse.json({ attachmentId: attachment.id, ready: true });
  }

  // The completer must be able to write the page (only the uploader or another
  // editor can finalize; a reader can't). This also stops a reader from
  // activating an attachment on a page they can't edit.
  const canWrite = await permissions.canWrite({
    workspaceId: attachment.workspaceId,
    userId: user.id,
    resourceType: "page",
    resourceId: attachment.pageId,
  });
  if (!canWrite) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 🔒 Re-verify type + size via HEAD (the presigned PUT didn't bind them).
  const verify = await s3.verifyUpload({
    s3Key: attachment.s3Key,
    expectedMimeType: attachment.mimeType,
    expectedSizeBytes: Number(attachment.sizeBytes),
  });
  if (!verify.ok) {
    // Mismatch (or object missing): delete the object + the row. Don't keep a
    // half-uploaded/typed-wrong attachment around.
    await s3.deleteObject(attachment.s3Key).catch(() => {});
    await db.attachment.delete({ where: { id: attachmentId } }).catch(() => {});
    return NextResponse.json(
      {
        error: "upload_verification_failed",
        actualMimeType: verify.actualMimeType,
        actualSizeBytes: verify.actualSizeBytes,
      },
      { status: 422 },
    );
  }

  // 🔒 Re-check quota against the verified size (closes part of the TOCTOU gap).
  const used = await workspaceAttachmentBytes(db, attachment.workspaceId);
  if (used + attachment.sizeBytes > env.ATTACHMENT_WORKSPACE_QUOTA_BYTES) {
    await s3.deleteObject(attachment.s3Key).catch(() => {});
    await db.attachment.delete({ where: { id: attachmentId } }).catch(() => {});
    return NextResponse.json(
      { error: "quota_exceeded", used: used.toString() },
      { status: 413 },
    );
  }

  await db.attachment.update({
    where: { id: attachmentId },
    data: { status: "ready" },
  });

  return NextResponse.json({ attachmentId: attachment.id, ready: true });
}
