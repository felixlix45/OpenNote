/**
 * @opennote/shared — attachment MIME policy (ticket 0007 #6 + 🔒 SECURITY-
 * REVIEW #3).
 *
 * Two distinct concepts, both allowlists (never denylists):
 *
 *   - {@link ATTACHMENT_MIME_ALLOWLIST} / {@link isAllowedMime} — what the
 *     upload endpoint ACCEPTS. Permissive for v1 (docs, images, archives,
 *     media); no AV in v1.
 *   - {@link INLINE_IMAGE_ALLOWLIST} / {@link shouldRenderInline} — what
 *     renders INLINE from the app origin. Only png/jpg/gif/webp. SVG/HTML/PDF
 *     and any other type → Content-Disposition: attachment (stored-XSS
 *     mitigation: an SVG/HTML upload carrying <script> must download, not run).
 *
 * "image" as an inline set is an ALLOWLIST, not "anything image/*": svg, bmp,
 * tiff are all downloads in v1.
 */

/**
 * Permissive v1 upload allowlist by MIME type. No content sniffing, no AV
 * (post-v1). Acceptable types: documents, the 4 inline images, archives, media.
 */
export const ATTACHMENT_MIME_ALLOWLIST: readonly string[] = [
  // Documents
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/msword", // .doc
  "application/vnd.ms-excel", // .xls
  "application/vnd.ms-powerpoint", // .ppt
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  // Inline-renderable images (the ONLY set that renders inline)
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  // Archives
  "application/zip",
  "application/x-tar",
  "application/gzip",
  // Media
  "video/mp4",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  // Note: image/svg+xml and text/html are DELIBERATELY absent — they're a
  // stored-XSS vector. Even if a future allowlist added them for upload,
  // shouldRenderInline would still force them to download.
];

const ALLOWED_SET = new Set(
  ATTACHMENT_MIME_ALLOWLIST.map((m) => m.toLowerCase()),
);

/** True iff the MIME type is on the v1 upload allowlist (case-insensitive). */
export function isAllowedMime(mimeType: string): boolean {
  return ALLOWED_SET.has(mimeType.toLowerCase());
}

/**
 * The exact set of image types that render INLINE from the app origin.
 * 🔒 SECURITY-REVIEW 0007 #3: this is an allowlist (png/jpg/gif/webp), NOT
 * "anything image/*". SVG carries <script>; bmp/tiff aren't worth the surface.
 */
export const INLINE_IMAGE_ALLOWLIST: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const INLINE_SET = new Set(
  INLINE_IMAGE_ALLOWLIST.map((m) => m.toLowerCase()),
);

/** True iff the type is one of the 4 inline-renderable image types. */
export function isImageMime(mimeType: string): boolean {
  return INLINE_SET.has(mimeType.toLowerCase());
}

/**
 * True iff a file of this type should render inline (only the 4 image types).
 * Everything else — SVG, HTML, PDF, docs, archives — is forced to download via
 * Content-Disposition: attachment. 🔒 stored-XSS mitigation.
 */
export function shouldRenderInline(mimeType: string): boolean {
  return isImageMime(mimeType);
}
