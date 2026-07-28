import { z } from "zod";
import { EffectivePermission } from "./enums.js";
export { EffectivePermission, PermissionLevel, WorkspaceRole } from "./enums.js";

/**
 * Result of the permission engine for one (user, resource) pair. Carries the
 * computed level plus the inputs that produced it, so callers (e.g. realtime
 * `onAuthenticate`, attachment signed-URL mint) can derive `readOnly` / gating
 * without re-querying.
 */
export const PermissionResult = z.object({
  /** The effective permission: the strongest grant on the path, or `manage`. */
  level: EffectivePermission,
  /** The workspace the check ran against (tenant boundary — never null). */
  workspaceId: z.string().uuid(),
  /** The user the check ran for. */
  userId: z.string().uuid(),
  /** The resource the check ran against (page or folder id). */
  resourceType: z.enum(["folder", "page"]),
  resourceId: z.string().uuid().nullable(),
  /**
   * True iff the user is Owner/Admin of the workspace → bypassed the Share
   * model. Useful for audit logs and to short-circuit downstream queries.
   */
  bypass: z.boolean(),
});
export type PermissionResult = z.infer<typeof PermissionResult>;

/** Input to the permission engine. */
export const PermissionQuery = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  resourceType: z.enum(["folder", "page"]),
  /**
   * The resource id, or `null` for the workspace-root sentinel (the implicit
   * all-members → Editor share; CONTEXT.md "open-workspace rule").
   */
  resourceId: z.string().uuid().nullable(),
});
export type PermissionQuery = z.infer<typeof PermissionQuery>;
