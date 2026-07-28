/**
 * apps/web — shared attachment upload helper (ticket 0007, used by file block +
 * the image block's uploadFile callback).
 *
 * Runs the 3-step presigned-PUT flow (request → upload bytes → complete/verify)
 * and returns the attachmentId + a fresh signed-GET URL for rendering. Both the
 * FileBlock toolbar button and BlockNote's image-block `uploadFile` callback use
 * this so images go through the same permission gate + verification as files.
 */

/**
 * Upload a file via the presigned-PUT flow.
 * @returns the signed-GET URL to render/download, or null on failure.
 */
export async function uploadAttachment(
  pageId: string,
  file: File,
): Promise<{ attachmentId: string; url: string } | null> {
  try {
    // 1. request presigned PUT
    const req = await fetch(`/api/pages/${pageId}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      }),
    });
    if (!req.ok) return null;
    const { attachmentId, uploadUrl } = (await req.json()) as {
      attachmentId: string;
      uploadUrl: string;
    };
    // 2. upload bytes direct to S3
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) return null;
    // 3. complete (HEAD-verify + activate)
    const complete = await fetch(`/api/attachments/${attachmentId}/complete`, {
      method: "POST",
    });
    if (!complete.ok) return null;
    // 4. fetch a signed-GET URL for rendering
    const urlRes = await fetch(`/api/attachments/${attachmentId}/url`);
    if (!urlRes.ok) return null;
    const { url } = (await urlRes.json()) as { url: string };
    return { attachmentId, url };
  } catch {
    return null;
  }
}
