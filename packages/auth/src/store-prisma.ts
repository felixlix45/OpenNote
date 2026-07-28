/**
 * @opennote/auth — Prisma-backed {@link PermissionStore} adapter.
 *
 * Production wiring for the permission engine. The engine itself is store-
 * agnostic (unit-tested with a fake); this adapter is the only place that
 * touches Prisma for permission checks.
 */
import type { PrismaClient } from "@opennote/db";
import { queryEffectivePermission } from "@opennote/db";
import type { PermissionStore } from "./engine.js";
import type { ResourceType, WorkspaceRole } from "@opennote/shared";

export function createPrismaPermissionStore(prisma: PrismaClient): PermissionStore {
  return {
    async getMemberRole(workspaceId, userId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      });
      return (member?.role as WorkspaceRole | null) ?? null;
    },

    async queryEffective(args) {
      // queryEffectivePermission already returns the EffectivePermission union
      // (none/reader/commenter/editor); no cast needed.
      return queryEffectivePermission(prisma, {
        workspaceId: args.workspaceId,
        userId: args.userId,
        resourceType: args.resourceType as ResourceType,
        resourceId: args.resourceId,
        maxDepth: args.maxDepth,
      });
    },
  };
}
