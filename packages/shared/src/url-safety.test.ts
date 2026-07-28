/**
 * @opennote/shared — url-safety tests (🔒 SECURITY-REVIEW: embed = iframe =
 * XSS/clickjacking surface; URL-scheme validation on all URL-bearing blocks).
 *
 * Pure, DB-free. Pins the contract that the embed/link/image render components
 * depend on: reject javascript:/data: schemes, https-only for embeds, a strict
 * domain allowlist, and a sandbox that never combines allow-scripts +
 * allow-same-origin.
 */
import { describe, expect, it } from "vitest";
import {
  isSafeUrlScheme,
  sanitizeUrl,
  resolveEmbed,
  EMBED_ALLOWLIST,
  buildEmbedSandbox,
} from "./url-safety.js";

describe("isSafeUrlScheme — reject dangerous schemes", () => {
  it("accepts http and https", () => {
    expect(isSafeUrlScheme("http://example.com")).toBe(true);
    expect(isSafeUrlScheme("https://example.com")).toBe(true);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["javascript: with space", "javascript: alert(1)"],
    ["data: html", "data:text/html,<script>alert(1)</script>"],
    ["data: image (still rejected at this layer)", "data:image/png;base64,xyz"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///etc/passwd"],
  ])("rejects %s", (_label, url) => {
    expect(isSafeUrlScheme(url)).toBe(false);
  });

  it("is case-insensitive on the scheme (JAVASCRIPT: rejected)", () => {
    expect(isSafeUrlScheme("JaVaScRiPt:alert(1)")).toBe(false);
  });

  it("rejects leading whitespace before a dangerous scheme", () => {
    expect(isSafeUrlScheme("   javascript:alert(1)")).toBe(false);
  });

  it("rejects relative-ish protocol-less that aren't http(s)", () => {
    expect(isSafeUrlScheme("//example.com")).toBe(false);
    expect(isSafeUrlScheme("example.com")).toBe(false);
  });
});

describe("sanitizeUrl — for link/image src/href", () => {
  it("returns the cleaned https/http URL", () => {
    expect(sanitizeUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
  });

  it("returns null for dangerous schemes (caller must NOT render)", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("data:text/html,<x>")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeUrl("  https://example.com  ")).toBe("https://example.com");
  });
});

describe("resolveEmbed — domain allowlist (🔒 req #1)", () => {
  it("accepts a YouTube watch URL and returns the embed URL", () => {
    const r = resolveEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r).not.toBeNull();
    expect(r!.url.startsWith("https://")).toBe(true);
    expect(r!.url).toContain("youtube.com");
  });

  it("accepts a Vimeo URL", () => {
    expect(resolveEmbed("https://vimeo.com/12345")).not.toBeNull();
  });

  it("accepts a Figma URL", () => {
    expect(resolveEmbed("https://www.figma.com/file/abc/Untitled")).not.toBeNull();
  });

  it("accepts a Loom URL", () => {
    expect(resolveEmbed("https://www.loom.com/share/abc")).not.toBeNull();
  });

  it("rejects an unknown provider", () => {
    expect(resolveEmbed("https://evil.example.com/video")).toBeNull();
  });

  it("rejects a non-https embed URL (🔒 req #1: https only)", () => {
    expect(resolveEmbed("http://www.youtube.com/watch?v=x")).toBeNull();
  });

  it("rejects a javascript: URL pretending to be an embed", () => {
    expect(resolveEmbed("javascript:alert(1)")).toBeNull();
  });

  it("the allowlist is a known finite set (no wildcard)", () => {
    // Sanity: the allowlist must be explicit providers, never "*".
    expect(EMBED_ALLOWLIST.length).toBeGreaterThan(0);
    expect(EMBED_ALLOWLIST).not.toContain("*");
  });
});

describe("buildEmbedSandbox — restrictive iframe sandbox (🔒 req #1)", () => {
  it("never combines allow-scripts + allow-same-origin (clickjacking/XSS)", () => {
    // The dangerous combination would let framed content same-origin-script out.
    for (const provider of EMBED_ALLOWLIST) {
      const sampleUrl = `https://${provider}`;
      const resolved = resolveEmbed(sampleUrl) ?? { url: sampleUrl, provider };
      const sandbox = buildEmbedSandbox(resolved.provider);
      const tokens = sandbox.split(" ");
      const both = tokens.includes("allow-scripts") && tokens.includes("allow-same-origin");
      expect(both).toBe(false);
    }
  });

  it("is a non-empty, restrictive sandbox string", () => {
    const sandbox = buildEmbedSandbox("youtube");
    expect(sandbox.length).toBeGreaterThan(0);
    // No allow-top-navigation (can't redirect the parent).
    expect(sandbox).not.toContain("allow-top-navigation");
  });
});
