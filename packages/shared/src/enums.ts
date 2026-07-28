import { z } from "zod";

/**
 * Workspace roles — the per-member, workspace-global capability ladder
 * (CONTEXT.md §Roles; ticket 0002). Listed weakest → strongest.
 *
 * `Guest` access is defined *entirely* by per-resource Shares; the role grants
 * nothing on its own. `Member` is Editor-everywhere via the all-members group.
 * `Owner`/`Admin` bypass the Share model entirely in the permission engine.
 */
export const WorkspaceRole = z.enum(["guest", "member", "admin", "owner"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

/** Ordered strength for comparisons: higher index = more powerful role. */
export const ROLE_STRENGTH: readonly WorkspaceRole[] = [
  "guest",
  "member",
  "admin",
  "owner",
] as const;
export function roleStrength(role: WorkspaceRole): number {
  return ROLE_STRENGTH.indexOf(role);
}

/**
 * Per-resource permission levels granted by a Share (CONTEXT.md §Permission
 * levels; ticket 0002). `none` is implicit (no Share). `commenter` is
 * **reserved in v1** — behaves as Reader until comments ship post-v1; the
 * enum value exists for forward compatibility.
 */
export const PermissionLevel = z.enum(["none", "reader", "commenter", "editor"]);
export type PermissionLevel = z.infer<typeof PermissionLevel>;

/**
 * Numeric strength used by the effective-permission union rule: the maximum
 * (strongest) grant anywhere on the path wins. `manage` is returned by the
 * engine for Owner/Admin bypass and is stronger than any Share level.
 *
 * Keep this ordering in sync with the Prisma/SQL CASE in the effective-permission
 * CTE (packages/db) — they must agree numerically.
 */
export const LEVEL_STRENGTH = {
  none: 0,
  reader: 1,
  commenter: 2,
  editor: 3,
  manage: 4,
} as const;

/** Owner/Admin bypass result — strictly stronger than any Share level. */
export const MANAGE_LEVEL = "manage" as const;

/**
 * The full set the permission engine can return: the three Share levels, plus
 * the implicit `none` and the Owner/Admin `manage` bypass.
 */
export const EffectivePermission = z.enum([
  "none",
  "reader",
  "commenter",
  "editor",
  "manage",
]);
export type EffectivePermission = z.infer<typeof EffectivePermission>;

export function permissionStrength(p: EffectivePermission): number {
  if (p === "manage") return LEVEL_STRENGTH.manage;
  return LEVEL_STRENGTH[p];
}

/**
 * Shareable resource types (CONTEXT.md §Resources; ticket 0003). A Workspace
 * root is modeled as a sentinel `resource_id = NULL` with `resource_type =
 * 'folder'`; see {@link WORKSPACE_ROOT_SENTINEL}.
 */
export const ResourceType = z.enum(["folder", "page"]);
export type ResourceType = z.infer<typeof ResourceType>;

/**
 * Sentinel `resource_id` value meaning "the workspace root" — the implicit
 * all-members → Editor share lives here (ticket 0002 "open-workspace rule";
 * ticket 0003 schema). The permission path-walk treats NULL as the root and
 * stops there.
 */
export const WORKSPACE_ROOT_SENTINEL = null;
export type WorkspaceRootSentinel = null;

/** Share principal discriminator — a Share targets either a User or a Group. */
export const PrincipalType = z.enum(["user", "group"]);
export type PrincipalType = z.infer<typeof PrincipalType>;

/**
 * Derived gating predicates (ticket 0010). `can_read` = effective ≥ Reader;
 * `can_write` = effective ≥ Editor. Owner/Admin (manage) trivially pass both.
 * Used by realtime `onAuthenticate`, attachment signed-URL mint, and search.
 */
export function canRead(p: EffectivePermission): boolean {
  return permissionStrength(p) >= LEVEL_STRENGTH.reader;
}
export function canWrite(p: EffectivePermission): boolean {
  return permissionStrength(p) >= LEVEL_STRENGTH.editor;
}
