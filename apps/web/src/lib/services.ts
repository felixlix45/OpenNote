/**
 * apps/web — the service composition root.
 *
 * Wires the env-validated config to the Prisma client, the permission engine,
 * Better Auth, and the storage layer. Server-only (this file imports the
 * Prisma client + secrets); never import from a Client Component.
 */
import "server-only";
import { env } from "./env";
import { prisma } from "@opennote/db";
import {
  createPage,
  findPageById,
  getPage,
  listFolderChildren,
  upsertPageDocState,
  PrismaClient,
} from "@opennote/db";
import {
  createPermissionEngine,
  createPrismaPermissionStore,
  createBetterAuth,
} from "@opennote/auth";
import { createS3Service, createSmtpService } from "@opennote/storage";

// Annotated with the exported type so TS can name it portably (the inferred
// type reaches into the Prisma generated runtime, which isn't importable here).
export const db: PrismaClient = prisma;

export const auth = createBetterAuth({ prisma, env });

const permissionStore = createPrismaPermissionStore(prisma);
export const permissions = createPermissionEngine(permissionStore, {
  maxNestingDepth: env.MAX_NESTING_DEPTH,
});

export const s3 = createS3Service(env);
export const smtp = createSmtpService(env);

// Re-export the repository content accessors so route handlers go through the
// soft-delete + tenant-scoped layer (🔒 SECURITY-REVIEW) instead of db.page.*.
export { createPage, findPageById, getPage, listFolderChildren, upsertPageDocState };
export { env };
