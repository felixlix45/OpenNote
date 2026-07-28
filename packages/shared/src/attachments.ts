import { z } from "zod";

/**
 * Attachment metadata (ticket 0007). The actual bytes live in S3-compatible
 * storage; `s3Key` is opaque (🔒 SECURITY-REVIEW HIGH #4: uuid-only key, no
 * client-controlled path segments).
 *
 * 🔒 The MIME/extension allowlist + SVG/HTML → Content-Disposition: attachment
 * rule is enforced in `packages/storage`, not here — this is the wire shape.
 */
export const Attachment = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  s3Key: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.bigint(),
  uploadedBy: z.string().uuid(),
  createdAt: z.date(),
});
export type Attachment = z.infer<typeof Attachment>;

/**
 * Step 1 of the upload flow (ticket 0007): client requests a presigned PUT URL.
 * The declared size + MIME are bound into the signed URL where the provider
 * supports it, and re-verified on `/complete` via a HEAD (🔒 SECURITY-REVIEW
 * MEDIUM: presigned-PUT type/size binding).
 */
export const CreateAttachmentInput = z.object({
  pageId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});
export type CreateAttachmentInput = z.infer<typeof CreateAttachmentInput>;

/** Response to step 1: where to PUT, and the attachment row's id. */
export const CreateAttachmentResponse = z.object({
  attachmentId: z.string().uuid(),
  uploadUrl: z.string().url(),
  /** Method + required headers for the PUT. */
  method: z.literal("PUT"),
  headers: z.record(z.string()).default({}),
});
export type CreateAttachmentResponse = z.infer<typeof CreateAttachmentResponse>;

/** Short-lived signed GET URL minted after `can_read` passes (ticket 0007). */
export const AttachmentDownloadResponse = z.object({
  url: z.string().url(),
  /** Same TTL as the signed URL; client may cache the metadata this long. */
  expiresInSeconds: z.number().int().positive(),
  filename: z.string(),
  mimeType: z.string(),
  /**
   * `true` for image types in the inline allowlist (png/jpg/gif/webp). All
   * other types (incl. SVG/HTML) are forced to download (🔒 stored-XSS).
   */
  inline: z.boolean(),
});
export type AttachmentDownloadResponse = z.infer<typeof AttachmentDownloadResponse>;
