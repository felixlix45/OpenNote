/**
 * @opennote/db — public surface.
 *
 * Re-exports the Prisma client (singleton) and the repository layer. App code
 * imports from `@opennote/db` — it must not reach into `./generated/client`
 * directly (keeps the soft-delete + tenant guards centralized).
 */
export { prisma, PrismaClient } from "./client.js";
export type * from "./client.js";
export * from "./repository.js";
