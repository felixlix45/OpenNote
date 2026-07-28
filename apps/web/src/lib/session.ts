/**
 * apps/web — session helper.
 *
 * Wraps Better Auth's session reader for use in Server Components / route
 * handlers. Returns the user or null; route handlers branch on null → 401.
 */
import "server-only";
import { headers } from "next/headers";
import { auth } from "./services";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  /** Avatar URL (users.avatar_url) — surfaced for the sidebar profile bar. */
  image: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    emailVerified: Boolean(session.user.emailVerified),
    image: (session.user as { image?: string | null }).image ?? null,
  };
}

/** Like {@link getSessionUser} but throws 401-style when unauthenticated. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}

export class UnauthenticatedError extends Error {
  status = 401 as const;
  constructor() {
    super("Unauthenticated");
  }
}
