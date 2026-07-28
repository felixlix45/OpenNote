/**
 * @opennote/auth — the RBAC permission engine (the security boundary).
 *
 * Implements the effective-permission algorithm from ticket 0002 / CONTEXT.md:
 *
 *   effective(U, R):
 *     if U is Owner/Admin of R.workspace: return 'manage'   # bypass
 *     return max(grants on path root → R, for U ∪ groups(U)) # union, live
 *
 * The SQL CTE that does the path walk + live group resolution lives in
 * @opennote/db (`queryEffectivePermission`). This module is the thin decision
 * layer: it (1) checks role bypass in one indexed lookup, then (2) delegates
 * to the CTE, then (3) surfaces derived predicates can_read / can_write.
 *
 * 🔒 Security invariants this module owns:
 *   - Bypass is decided ONLY by workspace_members.role, never by client input.
 *   - The workspaceId flows into every downstream call — no cross-tenant path.
 *   - resourceId = null is the workspace-root sentinel (open-workspace rule),
 *     passed through to the CTE which knows how to interpret it.
 *
 * The engine is pure over an injected {@link PermissionStore}, which makes the
 * decision logic unit-testable without a database (see engine.test.ts). The
 * production store adapter lives in `./store-prisma.ts`.
 */
import type {
  EffectivePermission,
  PermissionQuery,
  PermissionResult,
  ResourceType,
  WorkspaceRole,
} from "@opennote/shared";
import {
  canRead as sharedCanRead,
  canWrite as sharedCanWrite,
  LEVEL_STRENGTH,
} from "@opennote/shared";

/** The subset of the data layer the engine needs. Injected for testability. */
export interface PermissionStore {
  /** The user's workspace role, or null if they're not a member. */
  getMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null>;
  /** The effective-permission CTE result (strongest grant on the path). */
  queryEffective(args: {
    workspaceId: string;
    userId: string;
    resourceType: ResourceType;
    resourceId: string | null;
    maxDepth: number;
  }): Promise<EffectivePermission>;
}

export interface PermissionEngineOptions {
  /**
   * Nesting-depth cap forwarded to the CTE (🔒 DoS bound; env MAX_NESTING_DEPTH).
   * Defaults to 32, matching the SQL function's default.
   */
  maxNestingDepth?: number;
}

export interface PermissionEngine {
  effective(query: PermissionQuery): Promise<PermissionResult>;
  canRead(query: PermissionQuery): Promise<boolean>;
  canWrite(query: PermissionQuery): Promise<boolean>;
}

/** Default nesting-depth cap when none is configured (🔒 DoS bound). */
const DEFAULT_MAX_NESTING_DEPTH = 32;

export function createPermissionEngine(
  store: PermissionStore,
  options: PermissionEngineOptions = {},
): PermissionEngine {
  const maxNestingDepth = options.maxNestingDepth ?? DEFAULT_MAX_NESTING_DEPTH;
  async function effective(query: PermissionQuery): Promise<PermissionResult> {
    const role = await store.getMemberRole(query.workspaceId, query.userId);

    // Owner/Admin bypass the Share model entirely (full manage on everything).
    if (role === "owner" || role === "admin") {
      return {
        level: "manage",
        workspaceId: query.workspaceId,
        userId: query.userId,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        bypass: true,
      };
    }

    // Guest/Member (or non-member): delegate to the CTE. The CTE evaluates
    // live group membership and applies the union rule; it returns 'none' when
    // no grant on the path matches.
    const level = await store.queryEffective({
      workspaceId: query.workspaceId,
      userId: query.userId,
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      maxDepth: maxNestingDepth,
    });

    return {
      level,
      workspaceId: query.workspaceId,
      userId: query.userId,
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      bypass: false,
    };
  }

  return {
    effective,
    async canRead(query) {
      return sharedCanRead((await effective(query)).level);
    },
    async canWrite(query) {
      return sharedCanWrite((await effective(query)).level);
    },
  };
}

/** Convenience: the strength ordering, re-exported for callers that need it. */
export { LEVEL_STRENGTH };
