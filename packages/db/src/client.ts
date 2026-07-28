/**
 * @opennote/db — Prisma client singleton.
 *
 * One client per process (Hot Module Reload + serverless both want this).
 * `PrismaClient` is imported from the generated output so consumers don't all
 * pay the generate step independently.
 */
import { PrismaClient } from "./generated/client/index.js";

// Avoid creating multiple clients under Next.js fast refresh / Vitest isolation.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.DB_LOG_QUERIES === "true" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient, Prisma } from "./generated/client/index.js";
export type * from "./generated/client/index.js";
