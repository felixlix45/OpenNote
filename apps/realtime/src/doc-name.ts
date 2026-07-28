/**
 * apps/realtime — doc-name parser (🔒 ticket 0010 req #3).
 *
 * The doc name `page:{uuid}` is the ONLY trusted source of the page id. The
 * client addresses a doc via `HocuspocusProvider({ name: "page:" + pageId })`;
 * that string becomes `documentName` on every server hook. `onAuthenticate`
 * parses it here and runs `can_read(pageId)` — never trust a page id from any
 * other client-supplied channel.
 *
 * Strict format: `page:` prefix (case-insensitive) + a lowercase UUID v4. We
 * normalize to lowercase so the Postgres uuid lookup is predictable.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_NAME = /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Parse a document name into the page id, or null if malformed.
 * Returns the lowercase uuid; never throws.
 */
export function parseDocName(documentName: string): string | null {
  const match = DOC_NAME.exec(documentName);
  if (!match) return null;
  // Double-check the captured group is a valid uuid (redundant with the regex,
  // but defense-in-depth — the regex is specific enough that this always passes).
  const id = match[1]!.toLowerCase();
  return UUID_V4.test(id) ? id : null;
}
