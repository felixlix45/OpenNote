/**
 * @opennote/shared — attachment MIME policy tests (🔒 SECURITY-REVIEW 0007 #3:
 * "image" is an allowlist, not a denylist; SVG/HTML forced to download).
 *
 * Pure, DB-free. The upload endpoint + the signed-GET endpoint both depend on
 * this: only allowlisted MIME types are accepted at upload, and only the inline
 * image set renders inline (everything else → Content-Disposition: attachment).
 */
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MIME_ALLOWLIST,
  isAllowedMime,
  shouldRenderInline,
  isImageMime,
} from "./attachment-policy.js";

describe("isAllowedMime — permissive v1 allowlist (ticket 0007 #6)", () => {
  it("accepts the document types", () => {
    for (const m of ["application/pdf", "text/plain", "text/markdown", "application/json"]) {
      expect(isAllowedMime(m)).toBe(true);
    }
  });
  it("accepts the image types (png/jpg/gif/webp)", () => {
    for (const m of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isAllowedMime(m)).toBe(true);
    }
  });
  it("accepts archives + media", () => {
    expect(isAllowedMime("application/zip")).toBe(true);
    expect(isAllowedMime("video/mp4")).toBe(true);
    expect(isAllowedMime("audio/mpeg")).toBe(true);
  });
  it("rejects unknown types", () => {
    expect(isAllowedMime("application/x-unknown")).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(isAllowedMime("IMAGE/PNG")).toBe(true);
    expect(isAllowedMime("Application/PDF")).toBe(true);
  });
});

describe("shouldRenderInline — image allowlist, SVG/HTML forced to download (🔒 #3)", () => {
  it("inlines png/jpeg/gif/webp only", () => {
    expect(shouldRenderInline("image/png")).toBe(true);
    expect(shouldRenderInline("image/jpeg")).toBe(true);
    expect(shouldRenderInline("image/gif")).toBe(true);
    expect(shouldRenderInline("image/webp")).toBe(true);
  });
  it("forces SVG to download (stored-XSS)", () => {
    expect(shouldRenderInline("image/svg+xml")).toBe(false);
  });
  it("forces HTML to download (stored-XSS)", () => {
    expect(shouldRenderInline("text/html")).toBe(false);
  });
  it("forces PDF to download", () => {
    expect(shouldRenderInline("application/pdf")).toBe(false);
  });
  it("forces unknown image-like types to download", () => {
    expect(shouldRenderInline("image/bmp")).toBe(false);
    expect(shouldRenderInline("image/tiff")).toBe(false);
  });
});

describe("isImageMime — the inline image set is exactly the 4 types", () => {
  it("is true for the 4 inline image types", () => {
    expect([...["image/png", "image/jpeg", "image/gif", "image/webp"]].filter(isImageMime)).toHaveLength(4);
  });
  it("is false for svg/bmp/tiff", () => {
    expect(isImageMime("image/svg+xml")).toBe(false);
    expect(isImageMime("image/bmp")).toBe(false);
  });
});

describe("ATTACHMENT_MIME_ALLOWLIST — finite, explicit", () => {
  it("is non-empty and contains no wildcard", () => {
    expect(ATTACHMENT_MIME_ALLOWLIST.length).toBeGreaterThan(0);
    expect(ATTACHMENT_MIME_ALLOWLIST).not.toContain("*/*");
    expect(ATTACHMENT_MIME_ALLOWLIST).not.toContain("image/*");
  });
});
