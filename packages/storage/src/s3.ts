/**
 * @opennote/storage — S3-compatible client + presigning (ticket 0007).
 *
 * 🔒 Security requirements (SECURITY-REVIEW HIGH #4 + MEDIUM attachment items):
 *   - **uuid-only s3_key**: the key is `{workspaceId}/{attachmentId}` — the
 *     original filename is metadata only, served via Content-Disposition. No
 *     client-controlled path segments → no path-traversal escape from the
 *     workspace prefix.
 *   - **inline allowlist**: only png/jpg/gif/webp render inline; everything
 *     else (SVG, HTML, PDF-with-script, …) is forced to `Content-Disposition:
 *     attachment` (stored-XSS mitigation).
 *   - **presigned-PUT + HEAD re-verify**: the signed PUT does NOT bind
 *     Content-Type/Length (binding ContentLength caused SignatureDoesNotMatch
 *     with MinIO). Instead, the client uploads, then `/complete` HEADs the
 *     object and verifies MIME + size match the declared values (the authoritative
 *     check); on mismatch the object is deleted + the row rejected.
 *     is HEADed and MIME+size re-verified before the attachment row is activated.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "@opennote/config/env";

/** MIME types permitted to render inline. Everything else → download. */
export const INLINE_MIME_ALLOWLIST = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function shouldInline(mimeType: string): boolean {
  return INLINE_MIME_ALLOWLIST.has(mimeType.toLowerCase());
}

/**
 * Build the uuid-only s3_key. 🔒 HIGH #4: no client-controlled segments.
 * The filename never enters the key — it's served via Content-Disposition.
 */
export function buildS3Key(workspaceId: string, attachmentId: string): string {
  return `${workspaceId}/${attachmentId}`;
}

export interface S3Service {
  /** Presign a PUT URL for the client to upload the attachment bytes. */
  presignPut(args: {
    s3Key: string;
    mimeType: string;
    sizeBytes: number;
    ttlSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;

  /** Presign a GET URL minted AFTER can_read passes. */
  presignGet(args: {
    s3Key: string;
    filename: string;
    mimeType: string;
    ttlSeconds: number;
  }): Promise<{ url: string; inline: boolean }>;

  /** 🔒 Re-verify MIME + size on upload completion (HEAD before activate). */
  verifyUpload(args: {
    s3Key: string;
    expectedMimeType: string;
    expectedSizeBytes: number;
  }): Promise<{ ok: boolean; actualMimeType?: string; actualSizeBytes?: number }>;

  /** Delete an object (used on verify-fail + trash purge). */
  deleteObject(s3Key: string): Promise<void>;
}

export function createS3Service(env: Env): S3Service {
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  return {
    async presignPut({ s3Key, mimeType, sizeBytes, ttlSeconds }) {
      void sizeBytes; // size is bounded by the quota check + re-verified on /complete (HEAD),
      // not bound into the presigned signature — binding ContentLength causes
      // SignatureDoesNotMatch with MinIO when the client's actual Content-Length
      // header is computed slightly differently (chunked uploads, etc.).
      const command = new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: s3Key,
        ContentType: mimeType,
      });
      const url = await getSignedUrl(client, command, { expiresIn: ttlSeconds });
      // Client must send Content-Type to match the signature binding.
      return { url, headers: { "Content-Type": mimeType } };
    },

    async presignGet({ s3Key, filename, mimeType, ttlSeconds }) {
      const inline = shouldInline(mimeType);
      const command = new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: s3Key,
        // 🔒 Force download for non-images (SVG/HTML/etc.) to stop stored-XSS.
        ResponseContentDisposition: inline
          ? undefined
          : `attachment; filename="${sanitizeFilename(filename)}"`,
        ResponseContentType: mimeType,
      });
      const url = await getSignedUrl(client, command, { expiresIn: ttlSeconds });
      return { url, inline };
    },

    async verifyUpload({ s3Key, expectedMimeType, expectedSizeBytes }) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key }),
        );
        const actualMimeType = head.ContentType ?? "";
        const actualSizeBytes = head.ContentLength ?? 0;
        const ok =
          actualMimeType.toLowerCase() === expectedMimeType.toLowerCase() &&
          actualSizeBytes === expectedSizeBytes;
        return { ok, actualMimeType, actualSizeBytes };
      } catch {
        return { ok: false };
      }
    },

    async deleteObject(s3Key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key }),
      );
    },
  };
}

/** Strip quotes + control chars so Content-Disposition can't be injected. */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "").slice(0, 255);
}
