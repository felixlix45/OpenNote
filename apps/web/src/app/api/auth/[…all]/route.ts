/**
 * apps/web — Better Auth catch-all route handler (ticket 0006).
 *
 * Mounts Better Auth at /api/auth/*. It owns sign-up/in/out, OAuth callbacks,
 * email verification, and password reset. RBAC is layered on top in our route
 * handlers — Better Auth authenticates, OpenNote authorizes.
 */
import { auth } from "@/lib/services";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
