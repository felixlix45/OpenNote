/**
 * apps/realtime — Hocuspocus WebSocket server entrypoint (ticket 0004/0009).
 *
 * This is a SEPARATE long-lived process from apps/web — it doesn't fit Next.js's
 * per-request lifecycle and must scale/restart independently. Fronted by the
 * reverse proxy in compose.prod.yml; the editor connects via a relative WS path.
 *
 * Spine status: this file wires env + the permission engine + a minimal server
 * that boots and refuses unauthenticated connections. The full onAuthenticate
 * + extension-database persistence (ticket 0004/0010) is the next layer.
 */
import { Server } from "@hocuspocus/server";
import { loadEnv } from "@opennote/config/env";
import { prisma } from "@opennote/db";
import {
  createPermissionEngine,
  createPrismaPermissionStore,
} from "@opennote/auth";

const env = loadEnv(process.env);

const permissionStore = createPrismaPermissionStore(prisma);
const permissions = createPermissionEngine(permissionStore, {
  maxNestingDepth: env.MAX_NESTING_DEPTH,
});

const server = Server.configure({
  port: env.REALTIME_PORT,
  extensions: [],
  async onAuthenticate(data) {
    // 🔒 ticket 0010: read the Better Auth session cookie (shared origin via
    // reverse proxy), parse page:{uuid} from documentName, run effective().
    //   none → reject connection
    //   reader/commenter → connection.readOnly = true
    //   editor → read/write
    //   owner/admin (manage) → bypass
    // Spine milestone: reject everything until the cookie-reader + page-name
    // parser land (next layer). Refusing-by-default is the safe posture.
    const docName = data.documentName;
    const match = /^page:([0-9a-f-]{36})$/i.exec(docName);
    if (!match) {
      throw new Error("Unauthorized: invalid document name");
    }
    // TODO(ticket 0010): read session cookie → user, then permissions.effective.
    // Until then, no connection is authorized.
    void permissions;
    void env;
    throw new Error("Unauthorized: realtime auth not yet wired (ticket 0010)");
  },
});

server.listen().then(() => {
  console.log(`[realtime] Hocuspocus listening on :${env.REALTIME_PORT}`);
});

// Graceful-shutdown flush (ticket 0004): on SIGTERM, the debounced
// onStoreDocument fires a final save before exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[realtime] ${signal} received, shutting down…`);
    server.destroy().then(() => process.exit(0));
  });
}
