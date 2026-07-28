/**
 * apps/realtime — session reader (ticket 0010 decision #4).
 *
 * The realtime process shares the Better Auth config with apps/web (same DB +
 * same AUTH_SECRET). The editor's WS upgrade carries the HTTP-only session
 * cookie (same-origin behind the reverse proxy); this module reads it and
 * resolves the user via `auth.api.getSession`.
 *
 * `disableRefresh: true` keeps this strictly read-only — the realtime server
 * must not rewrite sessions on the WS path (the Set-Cookie it'd generate has
 * nowhere to go on an upgrade).
 */
import type { BetterAuthInstance } from "@opennote/auth";

export interface RealtimeSessionUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

/**
 * Resolve the authenticated user from a raw Cookie header string, or null.
 * Never throws — invalid/expired/missing sessions all yield null, which the
 * caller treats as "reject the connection."
 */
export async function userFromCookie(
  auth: BetterAuthInstance,
  cookieHeader: string | null | undefined,
): Promise<RealtimeSessionUser | null> {
  if (!cookieHeader) return null;
  const headers = new Headers();
  headers.set("cookie", cookieHeader);
  try {
    const session = await auth.api.getSession({
      headers,
      // Read-only: don't refresh expiring sessions or rewrite the cookie cache
      // on the WS path (there's no response to carry a Set-Cookie).
      query: { disableRefresh: true },
    });
    if (!session?.user) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      emailVerified: Boolean(session.user.emailVerified),
    };
  } catch {
    return null;
  }
}
