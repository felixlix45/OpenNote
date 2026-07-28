/**
 * apps/realtime — Hocuspocus WebSocket server (tickets 0004/0009/0010).
 *
 * A SEPARATE long-lived process from apps/web — it doesn't fit Next.js's
 * per-request lifecycle and must scale/restart independently. Fronted by the
 * reverse proxy (same origin, so the session cookie flows naturally on the WS
 * upgrade).
 *
 * Security flow (🔒 ticket 0010):
 *   1. onConnect — WS origin check: reject upgrades whose Origin isn't the app
 *      origin (req #4, defense-in-depth even though the cookie is same-origin
 *      + SameSite).
 *   2. onAuthenticate — read the session cookie (via requestHeaders) → resolve
 *      user (ticket 0006); parse doc name `page:{uuid}` (the ONLY trusted page
 *      identity, req #3); resolve authorization (effective() from ticket 0002).
 *      none → reject; reader/commenter → set connectionConfig.readOnly;
 *      editor/manage → read/write. (readOnly place 1)
 *   3. onChange (update hook) — enforce readOnly AGAIN (place 2): a readOnly
 *      connection's updates are rejected. Plus the per-connection update
 *      rate-limit (req #2). The doc-size cap is enforced in the store step.
 *   4. extension-database — persists Y.encodeStateAsUpdate bytes to
 *      page_docs.state (debounced by Hocuspocus defaults 2s/10s).
 *   5. LISTEN/NOTIFY — proactive kill on permission change (live revocation).
 */
import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import * as Y from "yjs";
import { loadEnv, type Env } from "@opennote/config/env";
import { prisma, type PrismaClient, getPageDocState, upsertPageDocState } from "@opennote/db";
import {
  createPermissionEngine,
  createPrismaPermissionStore,
  createBetterAuth,
  type PermissionEngine,
  type BetterAuthInstance,
} from "@opennote/auth";
import type { EffectivePermission } from "@opennote/shared";
import { parseDocName } from "./doc-name.js";
import { createRateLimiter, type RateLimiter } from "./rate-limiter.js";
import { userFromCookie, type RealtimeSessionUser } from "./session.js";
import { resolveAuthorization } from "./authorization.js";
import { startRevocationListener, type PermChangePayload } from "./revocation.js";

/** Connection context — what onAuthenticate resolves and later hooks read. */
interface ConnectionContext {
  user: RealtimeSessionUser;
  pageId: string;
  workspaceId: string;
  level: EffectivePermission;
  readOnly: boolean;
}

interface ServerDeps {
  env: Env;
  prisma: PrismaClient;
  auth: BetterAuthInstance;
  permissions: PermissionEngine;
}

/**
 * Build the realtime server. Exported for potential testing; the process
 * entrypoint at the bottom of this file calls it and listens.
 */
export function createRealtimeServer(deps: ServerDeps): Server {
  const { env, prisma, auth, permissions } = deps;
  const allowedOrigin = env.APP_URL.replace(/\/+$/, "");

  const rateLimiter: RateLimiter = createRateLimiter({
    maxUpdatesPerSecond: env.REALTIME_MAX_UPDATES_PER_SECOND,
  });

  // Track live connections by user+page so the revocation listener can kill
  // them: Map<userId, Set<pageId>>.
  const liveConnections = new Map<string, Set<string>>();
  const rememberConnection = (userId: string, pageId: string) => {
    let pages = liveConnections.get(userId);
    if (!pages) {
      pages = new Set();
      liveConnections.set(userId, pages);
    }
    pages.add(pageId);
  };
  const forgetConnection = (userId: string, pageId: string) => {
    const pages = liveConnections.get(userId);
    if (!pages) return;
    pages.delete(pageId);
    if (pages.size === 0) liveConnections.delete(userId);
  };

  // The Database extension: fetch on load, store on save (debounced by Hocuspocus).
  const databaseExtension = new Database({
    fetch: async ({ documentName }) => {
      const pageId = parseDocName(documentName);
      if (!pageId) return null;
      const state = await getPageDocState(prisma, pageId);
      return state ? new Uint8Array(state) : null;
    },
    store: async ({ documentName, state, document }) => {
      const pageId = parseDocName(documentName);
      if (!pageId) return;
      // 🔒 REALTIME_DOC_MAX_BYTES bounds bytea growth (reject oversize writes).
      const buf = Buffer.from(state);
      if (buf.byteLength > env.REALTIME_DOC_MAX_BYTES) {
        console.warn(
          `[realtime] refusing to persist ${buf.byteLength}B doc for page ${pageId} (cap ${env.REALTIME_DOC_MAX_BYTES}B)`,
        );
        return;
      }
      await upsertPageDocState(prisma, pageId, buf, env.REALTIME_DOC_MAX_BYTES);

      // Refresh the search mirrors (body_text + title) from the Y-doc, in the
      // same debounced save path (ticket 0008 #3). The generated search_tsv
      // auto-follows. Title = first non-empty text block; body_text = full text.
      const { title, bodyText } = extractText(document);
      await prisma.page.update({
        where: { id: pageId },
        data: {
          title: title.slice(0, 512),
          bodyText: bodyText.slice(0, 200000), // bound the FTS payload
        },
      }).catch(() => {
        // A page row disappearing mid-save (delete race) is non-fatal.
      });
    },
  });

  const server = new Server({
    port: env.REALTIME_PORT,
    extensions: [databaseExtension],
    debounce: 2000, // ticket 0004 §2: Hocuspocus defaults (2s/10s)
    maxDebounce: 10000,

    // 🔒 req #4: WS origin check, at the connect gate.
    async onConnect({ requestHeaders }) {
      const origin = requestHeaders.get("origin");
      // Browsers always send Origin on a WS upgrade; non-browser clients may
      // omit it (the session cookie still gates them). Allow absent origin;
      // reject present-but-wrong origin.
      if (origin !== null && origin.replace(/\/+$/, "") !== allowedOrigin) {
        throw new Error("origin-not-allowed");
      }
    },

    // 🔒 the core security gate (ticket 0010 decision #1/#2, req #1/#3).
    async onAuthenticate(data) {
      // (a) session cookie → user
      const user = await userFromCookie(auth, data.requestHeaders.get("cookie"));
      if (!user) {
        throw new Error("unauthenticated"); // → connection rejected
      }

      // (b) doc name → page id (the ONLY trusted page identity, req #3)
      const pageId = parseDocName(data.documentName);
      if (!pageId) {
        throw new Error("invalid-document-name");
      }

      // (c) effective permission on the page
      const resolved = await resolveAuthorization(prisma, permissions, {
        userId: user.id,
        pageId,
      });
      if (!resolved) {
        // Page doesn't exist / is trashed. Reject (don't leak existence).
        throw new Error("page-not-found");
      }
      if (resolved.level === "none") {
        throw new Error("forbidden"); // req #1: none → reject
      }

      // (d) connection context + readOnly (place 1 of the dual enforcement).
      // In Hocuspocus v4 the readOnly flag lives on connectionConfig.
      data.connectionConfig.readOnly = resolved.readOnly;
      rememberConnection(user.id, pageId);
      const ctx: ConnectionContext = {
        user,
        pageId,
        workspaceId: resolved.workspaceId,
        level: resolved.level,
        readOnly: resolved.readOnly,
      };
      return ctx; // stored as data.context on every later hook
    },

    // 🔒 req #1: readOnly enforcement, place 2. The connect-time flag is
    // necessary but NOT sufficient — a reader's produced updates must be
    // rejected here too. Plus the rate-limit (req #2).
    async onChange(data) {
      const ctx = data.context as ConnectionContext | undefined;
      if (!ctx) return; // no context → onAuthenticate didn't resolve; bail
      const connId = data.socketId ?? ctx.user.id;

      // Rate-limit every inbound update (DoS bound, req #2).
      if (!rateLimiter.check(connId)) {
        return false; // over budget → reject this update
      }

      // 🔒 place 2: a readOnly connection may not produce updates.
      if (ctx.readOnly) {
        return false;
      }
    },

    async onDisconnect(data) {
      const ctx = data.context as ConnectionContext | undefined;
      if (!ctx) return;
      forgetConnection(ctx.user.id, ctx.pageId);
      rateLimiter.forget(data.socketId ?? ctx.user.id);
    },
  });

  // 🔒 live revocation (decision #3): LISTEN for perm_change and close
  // affected connections. On reconnect, onAuthenticate re-runs.
  startRevocationListener(env.DATABASE_URL, (payload: PermChangePayload) => {
    killAffectedConnections(server, payload);
  }).catch((err) => {
    console.error("[realtime] revocation listener failed to start:", err);
  });

  /** Close open connections for the users/pages named in a perm_change. */
  function killAffectedConnections(server: Server, payload: PermChangePayload): void {
    const userIds = payload.userIds ?? [];
    const pageIds = new Set(payload.pageIds ?? []);
    if (userIds.length === 0 && pageIds.size === 0) return;

    for (const [docName, doc] of server.hocuspocus.documents) {
      const pageId = parseDocName(docName);
      if (!pageId) continue;
      const pageMatches = pageIds.size === 0 || pageIds.has(pageId);
      if (!pageMatches) continue;
      for (const conn of doc.getConnections()) {
        const ctx = conn.context as ConnectionContext | undefined;
        if (!ctx) continue;
        if (userIds.length === 0 || userIds.includes(ctx.user.id)) {
          conn.close();
          forgetConnection(ctx.user.id, ctx.pageId);
        }
      }
    }
  }

  return server;
}

// ---- process entrypoint ----

function main() {
  const env = loadEnv(process.env);
  const auth = createBetterAuth({ prisma, env });
  const permissionStore = createPrismaPermissionStore(prisma);
  const permissions = createPermissionEngine(permissionStore, {
    maxNestingDepth: env.MAX_NESTING_DEPTH,
  });
  const server = createRealtimeServer({ env, prisma, auth, permissions });
  server.listen().then(() => {
    console.log(`[realtime] Hocuspocus listening on :${env.REALTIME_PORT}`);
  });

  // Graceful-shutdown flush (ticket 0004 §2): SIGTERM → server.destroy() lets
  // the debounced store fire a final save before exit. Docker stop gives 10s
  // before SIGKILL — enough for the flush.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.log(`[realtime] ${signal} received, flushing + shutting down…`);
      void server.destroy().then(() => process.exit(0));
    });
  }
}

/**
 * Extract plain text from a Y.Doc for the search mirrors (ticket 0008 #3).
 *
 * BlockNote stores blocks in the `document-store` XML fragment as a ProseMirror
 * doc. We walk the fragment's text nodes to build a flat plain-text body, and
 * take the first non-empty line as the title. This is intentionally a lossy
 * projection for FTS — search finds the page, not the exact block.
 */
function extractText(document: Y.Doc): { title: string; bodyText: string } {
  try {
    const fragment = document.getXmlFragment("document-store");
    // Serialize to a Delta-like text via the fragment's toString, then clean.
    // Yjs XML fragments expose text via a recursive walk.
    const lines: string[] = [];
    for (let i = 0; i < fragment.length; i++) {
      const node = fragment.get(i);
      if (node instanceof Y.XmlText) {
        const t = node.toString().trim();
        if (t) lines.push(t);
      } else if (node instanceof Y.XmlElement) {
        const t = node.toString().trim();
        if (t) lines.push(t);
      }
    }
    const bodyText = lines.join("\n");
    const title = lines[0] ?? "";
    return { title, bodyText };
  } catch {
    return { title: "", bodyText: "" };
  }
}

// Run when executed directly (not when imported for tests). Uses pathToFileURL
// for cross-platform correctness — on Windows process.argv[1] is a backslash
// path (C:\...) that won't string-match the file:///C:/... import.meta.url.
import { pathToFileURL } from "node:url";
const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entryUrl === import.meta.url) {
  main();
}
