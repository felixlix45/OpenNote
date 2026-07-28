/**
 * @opennote/storage — S3 helper unit tests (🔒 HIGH #4 path-traversal + XSS).
 */
import { describe, expect, it } from "vitest";
import {
  buildS3Key,
  shouldInline,
  sanitizeFilename,
  INLINE_MIME_ALLOWLIST,
} from "./s3.js";

describe("s3_key — uuid-only, no path traversal (HIGH #4)", () => {
  it("builds a key from workspaceId + attachmentId only", () => {
    expect(buildS3Key("ws-uuid", "att-uuid")).toBe("ws-uuid/att-uuid");
  });

  it("never incorporates the client filename", () => {
    // The dangerous case from SECURITY-REVIEW: filename="../../etc/passwd"
    // must NOT appear in the key. buildS3Key takes no filename at all.
    const key = buildS3Key("ws", "att");
    expect(key).toBe("ws/att");
    expect(key).not.toContain("..");
  });
});

describe("inline allowlist — images only, SVG/HTML forced to download", () => {
  it("inlines png/jpeg/gif/webp", () => {
    for (const m of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(shouldInline(m)).toBe(true);
    }
  });

  it("forces SVG to download (stored-XSS mitigation)", () => {
    expect(shouldInline("image/svg+xml")).toBe(false);
  });

  it("forces HTML to download", () => {
    expect(shouldInline("text/html")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(shouldInline("IMAGE/PNG")).toBe(true);
  });

  it("the allowlist is exactly the 4 image types", () => {
    expect([...INLINE_MIME_ALLOWLIST].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});

describe("sanitizeFilename — Content-Disposition injection guard", () => {
  it("strips quotes and control chars", () => {
    expect(sanitizeFilename('a"b\\c\rd\ne')).toBe("abcde");
  });

  it("preserves normal filenames", () => {
    expect(sanitizeFilename("report (final).pdf")).toBe("report (final).pdf");
  });

  it("caps length at 255", () => {
    const long = "a".repeat(1000);
    expect(sanitizeFilename(long).length).toBe(255);
  });
});
