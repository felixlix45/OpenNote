/**
 * apps/web — POST /api/pages/:pageId/attachments : request a presigned PUT URL
 * (ticket 0007 #4 — presigned-URL direct-to-S3 upload).
 *
 * Flow: check write-permission on the page → validate MIME against the allowlist
 * (🔒 #6) → check size ≤ max (🔒 #2) → check workspace quota (🔒 #2) → create a
 * `pending` attachment row with a uuid-only s3_key (🔒 HIGH #4 — no client
 * filename in the key) → mint a presigned PUT → return { attachmentId, uploadUrl }.
 *
 * The client uploads bytes directly to S3, then calls POST /api/attachments/:id/
 * complete to verify + activate the row (Layer 3).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedMime } from "@opennote/shared";
import { buildS3Key } from "@opennote/storage";
import {
  db,
  findPageById,
  permissions,
  s3,
  workspaceAttachmentBytes,
  env,
} from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

const CreateAttachmentBody = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
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

  const { pageId } = await context.params;
  const parsed = CreateAttachmentBody.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { filename, mimeType, sizeBytes } = parsed.data;

  // 🔒 MIME allowlist (ticket 0007 #6). Reject anything not on the list.
  if (!isAllowedMime(mimeType)) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }

  // 🔒 Max file size (ticket 0007 #2).
  if (sizeBytes > env.ATTACHMENT_MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", maxBytes: env.ATTACHMENT_MAX_FILE_BYTES },
      { status: 413 },
    );
  }

  // Resolve the page + check write-permission (you can only upload to a page
  // you can edit). Soft-delete filtered via the repository.
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

  // 🔒 Workspace quota (ticket 0007 #2). Check-then-upload; re-checked on
  // /complete against the verified size (TOCTOU window accepted for v1, #4).
  const used = await workspaceAttachmentBytes(db, page.workspaceId);
  const quota = env.ATTACHMENT_WORKSPACE_QUOTA_BYTES;
  if (used + BigInt(sizeBytes) > quota) {
    return NextResponse.json(
      { error: "quota_exceeded", used: used.toString(), quota },
      { status: 413 },
    );
  }

  // Create the attachment row first so we have the uuid for the s3_key.
  // 🔒 HIGH #4: uuid-only key — buildS3Key takes NO filename.
  const attachment = await db.attachment.create({
    data: {
      pageId: page.id,
      workspaceId: page.workspaceId,
      s3Key: "", // set below after we know the id
      filename,
      mimeType,
      sizeBytes: BigInt(sizeBytes),
      status: "pending",
      uploadedById: user.id,
    },
  });
  const s3Key = buildS3Key(page.workspaceId, attachment.id);
  await db.attachment.update({ where: { id: attachment.id }, data: { s3Key } });

  // Mint the presigned PUT. The client must send the matching Content-Type
  // header; size is bounded by the Content-Length the presigned URL encodes.
  const { url: uploadUrl } = await s3.presignPut({
    s3Key,
    mimeType,
    sizeBytes,
    ttlSeconds: 300, // 5 min to complete the upload
  });

  return NextResponse.json(
    { attachmentId: attachment.id, uploadUrl },
    { status: 201 },
  );
}
