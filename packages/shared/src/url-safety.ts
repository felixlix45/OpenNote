/**
 * @opennote/shared — URL + embed safety for the editor (🔒 SECURITY-REVIEW
 * tickets 0005 #1, #2).
 *
 * The widened editor scope (embeds, links, images) renders URL-bearing content.
 * This module is the single source of truth for what's safe to render:
 *
 *   - {@link isSafeUrlScheme} / {@link sanitizeUrl} — reject `javascript:`,
 *     `data:`, `vbscript:`, `file:` on any URL attribute (image src, link href).
 *   - {@link resolveEmbed} + {@link EMBED_ALLOWLIST} — embeds render an iframe,
 *     so the provider must be on a finite allowlist AND the URL https.
 *   - {@link buildEmbedSandbox} — the iframe's `sandbox` attribute, never
 *     `allow-scripts` + `allow-same-origin` together (that combo = XSS escape).
 *
 * Custom block render components MUST call these at render time — defense in
 * depth, not relying on the editor/ProseMirror schema alone (🔒 req #2).
 */

/** Safe URL schemes for link/image/embed src/href. */
const SAFE_SCHEMES = new Set(["http:", "https:"]);

/**
 * True iff the URL's scheme is http(s). Rejects javascript:, data:, vbscript:,
 * file:, and anything without a parseable scheme. Case- and whitespace-insensitive
 * at the scheme boundary (attackers obfuscate with `JaVaScRiPt:` / leading spaces).
 */
export function isSafeUrlScheme(raw: string): boolean {
  const trimmed = raw.trimStart();
  try {
    // URL parsing normalizes the scheme to lowercase. A bare "example.com"
    // (no scheme) throws or resolves relative — both rejected here.
    const parsed = new URL(trimmed);
    return SAFE_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Return the cleaned http(s) URL, or null if the scheme is unsafe. Callers must
 * NOT render when this returns null (the whole point of the check).
 */
export function sanitizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isSafeUrlScheme(trimmed)) return null;
  return trimmed;
}

/** A known embed provider + how to turn its share URL into an embed URL. */
export interface EmbedProvider {
  /** Matches the provider when the hostname ends with this (e.g. "youtube.com"). */
  hostSuffix: string;
  /** Turn a share URL into the embeddable iframe URL, or null if unparseable. */
  toEmbed: (url: URL) => string | null;
}

/**
 * The embed allowlist (🔒 req #1). Finite and explicit — never "*". Add a
 * provider here only after verifying its embed URL is sandbox-safe.
 */
export const EMBED_PROVIDERS: readonly EmbedProvider[] = [
  {
    hostSuffix: "youtube.com",
    toEmbed: (u) => {
      // youtube.com/watch?v=ID → youtube.com/embed/ID
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    },
  },
  {
    hostSuffix: "youtu.be",
    toEmbed: (u) => {
      // youtu.be/ID → embed/ID
      const id = u.pathname.replace(/^\//, "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    },
  },
  {
    hostSuffix: "vimeo.com",
    toEmbed: (u) => {
      // vimeo.com/ID → player.vimeo.com/video/ID
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return /^\d+$/.test(id ?? "") ? `https://player.vimeo.com/video/${id}` : null;
    },
  },
  {
    hostSuffix: "figma.com",
    toEmbed: (u) =>
      // Figma supports an embed endpoint; pass the encoded original URL.
      `https://www.figma.com/embed?embed_host=opennote&url=${encodeURIComponent(u.toString())}`,
  },
  {
    hostSuffix: "loom.com",
    toEmbed: (u) => {
      // loom.com/share/ID → loom.com/embed/ID
      if (!u.pathname.startsWith("/share/")) return null;
      const id = u.pathname.replace("/share/", "").replace(/^\//, "");
      return id ? `https://www.loom.com/embed/${id}` : null;
    },
  },
];

/** Hostname suffixes that are allowlisted (for the sandbox test iteration). */
export const EMBED_ALLOWLIST: readonly string[] = EMBED_PROVIDERS.map(
  (p) => p.hostSuffix,
);

export interface ResolvedEmbed {
  url: string;
  provider: string;
}

/**
 * Resolve a user-supplied embed URL against the allowlist (🔒 req #1, #2).
 * Returns null when the provider isn't allowlisted, the URL isn't https, or the
 * share-URL shape can't be converted. Never returns a non-https URL.
 */
export function resolveEmbed(raw: string): ResolvedEmbed | null {
  if (!isSafeUrlScheme(raw)) return null; // rejects javascript:, data:, http, etc.
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  // 🔒 req #1: https only for embeds (already enforced by isSafeUrlScheme, but
  // re-state explicitly — http embeds would mix active content over insecure
  // transport and could be tampered).
  if (url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  for (const provider of EMBED_PROVIDERS) {
    if (host === provider.hostSuffix || host.endsWith("." + provider.hostSuffix)) {
      const embedUrl = provider.toEmbed(url);
      if (embedUrl) return { url: embedUrl, provider: provider.hostSuffix };
    }
  }
  return null;
}

/**
 * Build the iframe `sandbox` attribute for an embed provider (🔒 req #1).
 *
 * The cardinal rule: NEVER combine `allow-scripts` + `allow-same-origin` — that
 * pair lets framed content script its way to same-origin access (XSS escape /
 * clickjacking). For most providers we allow `allow-scripts` alone (the embed's
 * JS runs, but in a null origin so it can't touch the parent). `allow-popups`
 * and `allow-popups-to-escape-sandbox` cover "open in new tab" affordances.
 */
export function buildEmbedSandbox(_provider: string): string {
  // Scripts allowed (the embed needs them), but NOT same-origin → the framed
  // doc is treated as a unique origin, so document.cookie / parent access fail.
  // popups + popup-escape let "open original" work; presentation allows
  // fullscreen for video.
  return [
    "allow-scripts",
    "allow-popups",
    "allow-popups-to-escape-sandbox",
    "allow-presentation",
  ].join(" ");
}
