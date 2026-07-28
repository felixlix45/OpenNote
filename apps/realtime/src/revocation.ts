/**
 * apps/realtime — live revocation via Postgres LISTEN/NOTIFY (ticket 0010
 * decision #3, 🔒 req #5).
 *
 * When a share/group/role/delete mutation commits in apps/web, it NOTIFYs on
 * the `perm_change` channel with a JSON payload naming the affected userIds +
 * pageIds. This module LISTENs and asks the server to close the matching open
 * connections. On reconnect, `onAuthenticate` re-runs and the user is rejected
 * or downgraded.
 *
 * Residual risk (documented): if apps/realtime crashes between the mutation
 * and the kill, a revoked editor keeps writing until their client reconnects.
 * Bounded, not unbounded — acceptable for v1; a periodic re-auth sweep is
 * post-v1.
 *
 * Uses a SEPARATE Prisma connection for LISTEN (a LISTENing connection blocks
 * on notifications and can't serve queries). The kill callback closes the
 * connections via the Hocuspocus instance.
 */
import { PrismaClient } from "@opennote/db";

/** The Postgres channel name. Mutating endpoints NOTIFY on this. */
export const PERM_CHANGE_CHANNEL = "perm_change";

export interface PermChangePayload {
  /** User ids whose effective permission may have changed. */
  userIds?: string[];
  /** Page ids whose access set may have changed. */
  pageIds?: string[];
}

export interface RevocationHandler {
  (payload: PermChangePayload): void;
}

/**
 * Start listening for permission-change notifications. Returns a stop function
 * that releases the dedicated LISTEN connection. The handler is invoked for
 * each notification.
 *
 * This uses a raw connection string so it can open a dedicated libpq
 * connection that's unaffected by the main Prisma client's pool.
 */
export async function startRevocationListener(
  databaseUrl: string,
  handler: RevocationHandler,
  onError?: (err: unknown) => void,
): Promise<{ stop: () => Promise<void> }> {
  // Lazy import so packages that only typecheck (no pg installed in this pkg)
  // don't fail. pg is a dependency of @opennote/db transitively via Prisma's
  // driver, but importing it explicitly keeps the realtime package honest.
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`LISTEN ${PERM_CHANGE_CHANNEL}`);

  client.on("notification", (msg) => {
    try {
      if (!msg.payload) return;
      const payload = JSON.parse(msg.payload) as PermChangePayload;
      handler(payload);
    } catch (err) {
      onError?.(err);
    }
  });
  client.on("error", (err) => onError?.(err));

  return {
    async stop() {
      try {
        await client.query(`UNLISTEN ${PERM_CHANGE_CHANNEL}`);
        await client.end();
      } catch {
        // best-effort on shutdown
      }
    },
  };
}
