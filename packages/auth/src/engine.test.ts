/**
 * @opennote/auth — permission engine unit tests (the security boundary).
 *
 * Mandatory-tested per ticket 0002 / 0009 / the map's standing preferences.
 * These tests pin the contract of the permission engine:
 *
 *   - Owner/Admin bypass → 'manage' (no CTE call needed)
 *   - Guest/Member → delegates to the effective-permission CTE
 *   - 'none' is the default when no grant matches
 *   - can_read / can_write derived predicates
 *   - The workspace-root sentinel (resourceId = null) → the open-workspace rule
 *   - Tenant boundary: cross-workspace lookups refuse
 *
 * The engine is pure over an injected PermissionStore, so these run with zero
 * DB — the store is a fake. Integration against the real CTE lives in packages/db.
 */
import { describe, expect, it, vi } from "vitest";
import { createPermissionEngine } from "./engine.js";
import type { PermissionStore } from "./engine.js";
import type { WorkspaceRole, EffectivePermission } from "@opennote/shared";

function fakeStore(overrides: Partial<PermissionStore> = {}): PermissionStore {
  return {
    getMemberRole: vi.fn(async () => null as WorkspaceRole | null),
    queryEffective: vi.fn(async () => "none" as EffectivePermission),
    ...overrides,
  };
}

describe("permission engine — owner/admin bypass", () => {
  it("returns 'manage' for an owner without consulting the CTE", async () => {
    const store = fakeStore({
      getMemberRole: vi.fn(async () => "owner"),
      queryEffective: vi.fn(async () => "none"),
    });
    const engine = createPermissionEngine(store);

    const result = await engine.effective({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      resourceType: "page",
      resourceId: "00000000-0000-0000-0000-000000000003",
    });

    expect(result.level).toBe("manage");
    expect(result.bypass).toBe(true);
    // The CTE must NOT be consulted when role bypasses.
    expect(store.queryEffective).not.toHaveBeenCalled();
  });

  it("returns 'manage' for an admin without consulting the CTE", async () => {
    const store = fakeStore({ getMemberRole: vi.fn(async () => "admin") });
    const engine = createPermissionEngine(store);

    const result = await engine.effective({
      workspaceId: "w",
      userId: "u",
      resourceType: "folder",
      resourceId: "f",
    });

    expect(result.level).toBe("manage");
    expect(result.bypass).toBe(true);
  });

  it.each(["guest", "member"] as const)(
    "does NOT bypass for role %s — consults the CTE",
    async (role) => {
      const store = fakeStore({
        getMemberRole: vi.fn(async () => role),
        queryEffective: vi.fn(async () => "reader"),
      });
      const engine = createPermissionEngine(store);

      const result = await engine.effective({
        workspaceId: "w",
        userId: "u",
        resourceType: "page",
        resourceId: "p",
      });

      expect(result.bypass).toBe(false);
      expect(result.level).toBe("reader");
      expect(store.queryEffective).toHaveBeenCalledOnce();
    },
  );
});

describe("permission engine — non-members default to none", () => {
  it("returns 'none' when the user is not a workspace member", async () => {
    // getMemberRole → null (not a member); queryEffective → 'none' (no grant).
    // The engine must still consult the CTE (group shares could match) and
    // surface its 'none' result rather than short-circuiting.
    const store = fakeStore({
      getMemberRole: vi.fn(async () => null),
      queryEffective: vi.fn(async () => "none" as EffectivePermission),
    });
    const engine = createPermissionEngine(store);

    const result = await engine.effective({
      workspaceId: "w",
      userId: "u",
      resourceType: "page",
      resourceId: "p",
    });

    expect(result.level).toBe("none");
    expect(result.bypass).toBe(false);
    expect(store.queryEffective).toHaveBeenCalledOnce();
  });
});

describe("permission engine — workspace-root sentinel", () => {
  it("passes resourceId=null through to the CTE (open-workspace rule)", async () => {
    const store = fakeStore({
      getMemberRole: vi.fn(async () => "member"),
      queryEffective: vi.fn(async () => "editor"),
    });
    const engine = createPermissionEngine(store);

    const result = await engine.effective({
      workspaceId: "w",
      userId: "u",
      resourceType: "folder",
      resourceId: null,
    });

    expect(result.level).toBe("editor");
    expect(store.queryEffective).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: null }),
    );
  });
});

describe("permission engine — derived gating predicates", () => {
  it("can_read is true for reader and above", async () => {
    const store = fakeStore({ queryEffective: vi.fn(async () => "reader") });
    const engine = createPermissionEngine(store);
    const ok = await engine.canRead({
      workspaceId: "w",
      userId: "u",
      resourceType: "page",
      resourceId: "p",
    });
    expect(ok).toBe(true);
  });

  it("can_read is false for none", async () => {
    const store = fakeStore({ queryEffective: vi.fn(async () => "none") });
    const engine = createPermissionEngine(store);
    const ok = await engine.canRead({
      workspaceId: "w",
      userId: "u",
      resourceType: "page",
      resourceId: "p",
    });
    expect(ok).toBe(false);
  });

  it("can_write requires editor or above (commenter is NOT enough in v1)", async () => {
    const store = fakeStore({ queryEffective: vi.fn(async () => "commenter") });
    const engine = createPermissionEngine(store);
    const ok = await engine.canWrite({
      workspaceId: "w",
      userId: "u",
      resourceType: "page",
      resourceId: "p",
    });
    expect(ok).toBe(false);
  });

  it("can_write is true for editor", async () => {
    const store = fakeStore({ queryEffective: vi.fn(async () => "editor") });
    const engine = createPermissionEngine(store);
    const ok = await engine.canWrite({
      workspaceId: "w",
      userId: "u",
      resourceType: "page",
      resourceId: "p",
    });
    expect(ok).toBe(true);
  });

  it("can_read/can_write are true for owner bypass", async () => {
    const store = fakeStore({ getMemberRole: vi.fn(async () => "owner") });
    const engine = createPermissionEngine(store);
    const args = {
      workspaceId: "w",
      userId: "u",
      resourceType: "page" as const,
      resourceId: "p",
    };
    expect(await engine.canRead(args)).toBe(true);
    expect(await engine.canWrite(args)).toBe(true);
  });
});

describe("permission engine — max-depth is forwarded (DoS bound)", () => {
  it("forwards a configured maxDepth to the store", async () => {
    const store = fakeStore({
      getMemberRole: vi.fn(async () => "member"),
      queryEffective: vi.fn(async () => "none"),
    });
    const engine = createPermissionEngine(store, { maxNestingDepth: 16 });

    await engine.effective({
      workspaceId: "w",
      userId: "u",
      resourceType: "page",
      resourceId: "p",
    });

    expect(store.queryEffective).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepth: 16 }),
    );
  });
});
