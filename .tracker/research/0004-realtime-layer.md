# 0004 — Real-time layer: Hocuspocus + Yjs

Research for wayfinder ticket 0004. Stack is locked: Yjs + Hocuspocus (realtime), BlockNote (editor), one Y-doc per page, long-lived Docker processes. All sources verified July 2026. Hocuspocus is **actively maintained** — v4.4.0 shipped 2026-07-13, v4.3.0 2026-06-18.

---

## 1. Persistence adapter

**Answer.** Use option (a): write the binary Y-doc to Postgres `bytea` via the official **`Database` extension** (which wraps `onLoadDocument` + `onStoreDocument` for you) — *not* a hand-rolled hook pair, and *not* the dedicated Postgres/Redis/LevelDB extensions.

What exists today:
- **`@hocuspocus/extension-database`** — generic driver. You supply a `fetch({ documentName })` returning a `Uint8Array | null` and a `store({ documentName, state })` writing the bytes. The docs explicitly name "PostgreSQL, MySQL, MongoDB, S3 …" as targets. It internally drives `onLoadDocument` / `onStoreDocument` and respects the server's debounce setting.
- **`extension-sqlite`** — ready-to-use, but file-based SQLite; not a fit for a Postgres deployment.
- **`extension-redis`** — **not persistence**; it's a pub/sub bridge for horizontal scaling (syncs updates + awareness *between* server instances, "does not store anything"). Don't confuse it with a durability layer.
- There is **no official `extension-postgres`** package. Older blog posts referencing one are outdated.

The Y-doc is persisted as binary via `Y.encodeStateAsUpdate(doc)` → store bytes → restore with `Y.applyUpdate(doc, new Uint8Array(bytes))`. The Hocuspocus FAQ is explicit: **do not** serialize to JSON and rebuild on connect — it causes merge errors and duplicate content. Store `bytea`, full stop.

**Recommendation.** Adopt `extension-database` with a Postgres `page_docs` table (`page_id`, `state bytea`, `updated_at`). Inside `fetch`, `SELECT state FROM page_docs WHERE page_id = $1`; inside `store`, `UPSERT` the `Uint8Array` (Node `Buffer` is a `Uint8Array` subclass — write directly). Reserve a hand-written `onStoreDocument` hook only if you later need to also bump a `pages.updated_at` column or push to a search index on save.

**Sources**
- https://tiptap.dev/docs/hocuspocus/guides/persistence
- https://tiptap.dev/docs/hocuspocus/server/extensions/database
- https://tiptap.dev/docs/hocuspocus/server/extensions/redis
- https://docs.yjs.dev/api/document-updates

---

## 2. Save cadence / batching

**Answer.** Hocuspocus has built-in debouncing on the **store** path; you should not write your own. Two server settings control it:

- **`debounce`** — "Debounces the call of the `onStoreDocument` hook." **Default 2000 ms.**
- **`maxDebounce`** — guarantees the store hook eventually fires even under continuous typing. **Default 10000 ms.**

So during active editing, a Postgres write happens at most roughly once every 2 s of idle, and at least once every 10 s no matter what. `onChange` fires on *every* update with no debounce — use it only for side effects (audit log, search reindex of a throttled derived value), never for the primary persistence write.

**Worst-case data-loss window.** If the process is killed (OOM, `SIGKILL`, host crash) between flushes, you lose up to **`maxDebounce` = 10 s** of edits, *plus* any updates clients had sent that the server received but not yet merged when it died (sub-second). The default ceiling is therefore ~10 s. Note: clients retain their full local Y-doc state, so on reconnect each client ships its missing updates back and the doc self-heals — the 10 s loss is only for edits from clients that *also* disconnect and never reconnect. In practice the durable loss is near-zero for the common "server restarts, users stay connected" case.

**Recommendation.** Keep defaults (`debounce: 2000`, `maxDebounce: 10000`) for v1. Add a **graceful-shutdown hook** (`Server` flushes pending debounced `onStoreDocument` calls on `SIGTERM` — confirmed in the Hocuspocus source) so Docker `stop` (10 s grace before `SIGKILL`) doesn't drop the final write. If Postgres write latency or `page_docs` size becomes an issue, *then* investigate the update-log + snapshot hybrid (append each `update` to a log table, snapshot periodically and prune the log) — but that's an optimization, not a v1 need.

**Sources**
- https://tiptap.dev/docs/hocuspocus/server/configuration
- https://tiptap.dev/docs/hocuspocus/server/hooks
- https://github.com/ueberdosis/hocuspocus/blob/main/packages/server/src/Hocuspocus.ts

---

## 3. Authentication hooks

**Answer.** Two hooks matter, in this order:

1. **`onConnect`** — fires first, the instant the WebSocket opens. Payload: `documentName`, `request`, `requestHeaders`, `requestParameters`, `socketId`, `connection` (you can set `connection.readOnly = true` here), `instance`. No `token` field yet.
2. **`onAuthenticate`** — fires when the client's `HocuspocusProvider` sends its auth message. Payload: `documentName`, `token`, `requestHeaders`, `connection`, `socketId`.

**Reading "which page" and "which user":**
- **Page** = `data.documentName` (every hook carries it). See §4 for the naming scheme.
- **User** = decode/verify `data.token` (a JWT or opaque token the client passed via `HocuspocusProvider({ token })`) inside `onAuthenticate`, then **`return { user }`**. Hocuspocus stores that return value as the connection's **`context`**, and in Hocuspocus 4 every later hook payload carries it generically (`data.context.user`). `onConnect` runs *before* `onAuthenticate`, so `data.context` is **not yet populated in `onConnect`**.

**Denying access:** `throw` (or reject the returned Promise) in `onAuthenticate` → "the connection to the client will be terminated."

**Hook-ordering pitfalls (consume these into ticket 0010):**
- **Auth goes in `onAuthenticate`, not `onConnect`.** `onConnect` has no `token`; if you gate there you'll be reading headers/params and bypassing Hocuspocus's purpose-built flow. Use `onConnect` only for connection-level concerns (rate limiting, setting `readOnly`, logging `socketId`).
- **`context` isn't available in `onConnect`.** Any logic needing the resolved user (permission checks, audit rows) belongs in `onAuthenticate` or later hooks (`onChange`, `beforeHandleMessage`, `onDisconnect`), where `data.context.user` exists.
- **Re-auth over time is limited.** `onAuthenticate` runs once per connection handshake; there is no built-in periodic re-check (see GitHub issue #752). If a user's permission is revoked mid-session, the connection stays live until disconnect. For v1, mitigate by keeping sessions short / re-issuing the provider on token expiry; periodic reauth is a post-v1 hardening item. The provider has **no silent token refresh** — to rotate, destroy and recreate the provider (issue #755).
- **`onListen` is unrelated to auth** — it's the "server is now listening on this port" lifecycle hook (payload: `port`). Don't confuse it with per-document access control.
- **Gate on *load* too.** `onLoadDocument` runs after `onAuthenticate`, so `data.context.user` is available there — run the effective-permission check from ticket 0002 inside `onAuthenticate` (connect gate) and re-confirm in `onLoadDocument` (load gate) if a page's visibility rules can differ from its edit rules.

**Recommendation.** Single `onAuthenticate` hook: verify `token` → resolve user → look up `pages` row by `documentName` → run the 0002 effective-permission algorithm → set `connection.readOnly` for read-only roles → `return { user, pageId, role }`. Reuse that `context` everywhere downstream. Wire graceful re-auth (provider destroy/recreate) into the client, but defer periodic server-side reauth to post-v1.

**Sources**
- https://tiptap.dev/docs/hocuspocus/server/hooks
- https://tiptap.dev/docs/hocuspocus/guides/authentication
- https://tiptap.dev/docs/hocuspocus/provider/configuration
- https://github.com/ueberdosis/hocuspocus/issues/752
- https://github.com/ueberdosis/hocuspocus/issues/755

---

## 4. Doc identity

**Answer.** The client addresses a doc by the **`name`** passed to `HocuspocusProvider({ name, … })`. That string becomes `data.documentName` in every server hook — it's the *only* link between the WebSocket connection and your domain. Hocuspocus itself treats it as an opaque room identifier and supports arbitrary depth (e.g. `team-42.page-abc123`).

**Recommendation.** Use **`page:{uuid}`** as the doc name (e.g. `page:0a1b…`). Concretely:
- Doc name = `"page:" + pages.id` (the stable primary-key UUID).
- **Do not** use the slug — slugs are mutable (renames) and would orphan history. UUID is immutable.
- Optionally prefix with workspace/tenant (`ws:{tenantId}.page:{pageId}`) if you ever run a multi-tenant server and want doc-name-level namespacing for logs/metrics — but tenant isolation must still be enforced in `onAuthenticate`, never trusted from the name.
- The server maps `documentName → page_id` by stripping the prefix; `extension-database`'s `fetch`/`store` and the `pages` foreign key both key off `pages.id`.

BlockNote side: pass the same `name` into `withCollaboration`'s provider; BlockNote stores its content in a named XML fragment of the Y-doc, so multiple BlockNote concerns could share one doc if ever needed — but for v1, **one Y-doc per page** is correct and matches the ticket.

**Sources**
- https://tiptap.dev/docs/hocuspocus/provider/configuration
- https://www.blocknotejs.org/docs/features/collaboration
- https://tiptap.dev/docs/hocuspocus/server/hooks

---

## 5. Awareness / presence

**Answer.** **Yes — live cursors, selections, and who's-online are free; no extra server wiring required.** Hocuspocus relays Yjs awareness messages out of the box (the hooks reference documents `beforeHandleAwareness` and `onAwarenessUpdate`, confirming awareness is a first-class server concept). The `extension-redis` also syncs awareness across instances, so presence survives horizontal scaling.

On the client, BlockNote's `withCollaboration` accepts a `user: { name, color }` and a `showCursorLabels` option (`"activity"` | `"always"`), so remote cursors + name labels render with no additional code beyond passing the user info. BlockNote is built on Yjs awareness under the hood.

**Recommendation.** Live cursors and presence ship for zero marginal effort in v1. Just pass `{ name, color }` into `withCollaboration` from the authenticated session. One caveat to log for QA: a known Tiptap cursor-flicker bug (#4482) has appeared in some Hocuspocus Provider + awareness combinations — verify on the target versions, and if it recurs, throttle awareness updates client-side.

**Sources**
- https://www.blocknotejs.org/docs/features/collaboration
- https://tiptap.dev/docs/hocuspocus/server/hooks
- https://tiptap.dev/docs/hocuspocus/server/extensions/redis
- https://github.com/ueberdosis/tiptap/issues/4482

---

## 6. Scaling ceiling

**Answer.** Hocuspocus is a **single Node process** holding all open docs for that instance in memory. For v1 (single Docker container behind the load balancer) that's fine and is the documented happy path. Constraints to be aware of:
- Every open doc lives in RAM for the lifetime of its connected clients; memory scales with **(number of concurrently open pages) × (avg doc size)**.
- One process = one event loop; CPU-bound Yjs merge work on huge docs can tail-latency other docs. BlockNote page docs stay small, so this is a low risk for a notes app.
- The path to more capacity is documented and clean: run N instances behind a load balancer + **`extension-redis`**, which uses Redis pub/sub to broadcast updates and awareness across instances. No sticky sessions are *required* for correctness (Redis fans out every update to every instance), though sticky sessions reduce redundant cross-instance traffic and are mildly recommended.

When does it become necessary? Rule of thumb from community deployments: a single Hocuspocus instance comfortably handles thousands of concurrent connections and hundreds of actively-edited docs on modest hardware. A multi-tenant notes app in v1 won't approach that. OpenProject runs this exact stack (BlockNote + Hocuspocus) in production.

**Recommendation.** **Single instance for v1 — post-v1 for horizontal scaling.** Ship one Hocuspocus container. Add `extension-redis` + a second instance only when you observe a concrete ceiling (RAM growth, p99 sync latency, or HA requirements — a single instance is a SPOF for realtime). Keep the load balancer in front from day one so the cutover is config-only. Do **not** pre-build sharding-by-doc-name; Redis pub/sub already gives you correct multi-instance behavior without it.

**Sources**
- https://tiptap.dev/docs/hocuspocus/server/extensions/redis
- https://www.npmjs.com/package/@hocuspocus/extension-redis
- https://www.openproject.org/blog/real-time-collaboration-in-documents/

---

## Dependencies surfaced

**Ticket 0003 (data model) must reconcile with:**
- A `page_docs` table is required: at minimum `page_id uuid PK/FK→pages.id`, `state bytea NOT NULL`, `updated_at timestamptz`. The `state` column holds the raw `Y.encodeStateAsUpdate()` bytes — never JSON.
- `pages.id` (UUID) is the doc-name identity (prefixed `page:{id}`), so 0003 must guarantee `pages.id` is immutable and never reused.
- Optional: a `pages.updated_at` bump on each `onStoreDocument` if 0003 wants "last edited" to reflect realtime saves (vs only REST writes).

**Ticket 0010 (realtime auth) must reconcile with:**
- Auth lives in **`onAuthenticate`** (not `onConnect`); the resolved user/role is passed to later hooks via the returned `context`. The 0002 effective-permission algorithm should run inside `onAuthenticate` and optionally re-confirm in `onLoadDocument`.
- `connection.readOnly` is the lever for read-only roles — set it in `onAuthenticate`.
- No built-in periodic reauth (issue #752); token rotation = destroy + recreate the provider (issue #755). v1 should plan short-lived tokens + client-side provider recreation; periodic server-side reauth is post-v1.
- The doc-name → `page_id` mapping (§4) is what `onAuthenticate` uses to look up the `pages` row for the permission check, so 0003's primary key scheme is a hard dependency for 0010.
