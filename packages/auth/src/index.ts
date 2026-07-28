/**
 * @opennote/auth — public surface.
 *
 * Two concerns:
 *   1. The RBAC permission engine (the security boundary, ticket 0002).
 *   2. Better Auth configuration (ticket 0006) + invite logic.
 */
export {
  createPermissionEngine,
  LEVEL_STRENGTH,
} from "./engine.js";
export type {
  PermissionEngine,
  PermissionEngineOptions,
  PermissionStore,
} from "./engine.js";

export { createPrismaPermissionStore } from "./store-prisma.js";

export {
  generateInviteToken,
  safeEqualToken,
  acceptInvite,
  INVITE_TTL_MS,
} from "./invites.js";
export type {
  AcceptInviteInput,
  AcceptInviteResult,
  InviteRejectReason,
} from "./invites.js";

export { createBetterAuth } from "./better-auth.js";
export type { BetterAuthInstance, BetterAuthDeps } from "./better-auth.js";
