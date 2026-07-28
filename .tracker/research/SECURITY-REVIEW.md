# OpenNote v1 — Security Review

A threat-model pass over the 9 resolved wayfinder decisions, done *after* the
map closed in response to the standing preference: **always consider security
when planning anything.** The *decisions* in the tickets are unchanged; this
review extracts the **security requirements** flowing from each decision and
flags where a decision was **under-specified** in a security-critical way
(a builder could implement the letter of the spec and still ship a vuln).

Read this alongside the ticket resolutions. Findings marked **[GAP]** were
folded back into the relevant ticket as explicit requirements; the rest are
implementation hardening the builder must apply.

## Threat model (the short version)

- **Trust boundaries:** (1) anonymous internet ↔ reverse proxy; (2) authenticated
  user ↔ app (session cookie); (3) workspace member ↔ other workspaces
  (tenant isolation); (4) editor ↔ realtime server (Yjs updates); (5) app ↔ S3 /
  SMTP / OAuth providers.
- **Crown jewels:** Y-doc contents (pages), user credentials, the permission
  engine's correctness. A bug in the permission engine or tenant isolation is
  the worst class — it leaks data across the strongest boundary.
- **Attacker profiles:** an authenticated low-privilege user (member/guest)
  trying to escalate; a malicious editor (authenticated, with write access)
  abusing the realtime/editor; an outsider with an intercepted URL/token.

---

## HIGH — genuine spec gaps (folded into tickets)

### 1. Tenant isolation on polymorphic `shares.resource_id` → ticket 0003 [GAP]
`shares.resource_id` has no FK (polymorphic), so nothing structurally prevents a
share from referencing a folder/page in **another workspace**. If any permission
query forgets to scope by `workspace_id` AND validate `resource_id ∈ workspace`,
a principal could be granted access across the tenant boundary.
**Requirement (added to 0003):** every permission/share query must (a) filter
`shares.workspace_id = $W` and (b) confirm the target resource's `workspace_id`
matches before use. Consider a `CHECK`/trigger asserting `resource_id` belongs
to `workspace_id`, or a generated column binding them.

### 2. `readOnly` must be enforced on the update path → ticket 0010 [GAP]
Setting `connection.readOnly = true` on connect is necessary but not sufficient.
A reader's connection must **also** reject the updates it produces, in
`onChange`/onUpdate (Hocuspocus), not only at `onAuthenticate`. If only the
connect-time flag is checked, a reader can write.
**Requirement (added to 0010):** enforce readOnly in **two** places —
`onAuthenticate` (connect) and the update hook (every produced update).

### 3. Embed block = iframe = XSS/clickjacking surface → ticket 0005 [GAP]
The widened-scope **embed** block (YouTube/Figma/etc.) renders an iframe from a
URL. An unrestricted iframe is an XSS/clickjacking vector.
**Requirement (added to 0005):** embed URLs must match a **domain allowlist**
(YouTube, Vimeo, Figma, Loom, …); the iframe must carry `sandbox` (no
`allow-scripts`/`allow-same-origin` together); URL scheme allowlisted to https.

### 4. Attachment `s3_key` path traversal → ticket 0007 [GAP]
The key format `${wsId}/${id}/${filename}` is vulnerable if `filename` contains
`../` — it can escape the workspace prefix in some S3-compatible stores.
**Requirement (added to 0007):** the key must use **only the uuid** for the path
(`${wsId}/${attachmentId}`), with the original filename stored as metadata and
served via `Content-Disposition`; OR strip all path separators from `filename`.

### 5. Invite-token security + email-control verification → ticket 0006 [GAP]
Invite tokens are an account-onboarding path = account-takeover vector if
predictable, and email-verification is optional (off by default).
**Requirement (added to 0006):** invite tokens must be **cryptographically
random** (`crypto.randomUUID()` / `crypto.randomBytes`), expiring, revocable,
and **single-use on accept**; **accepting an invite must verify the invitee
controls the invite's email** (the invite was sent to email E → the accepting
account must have a verified E). Rate-limit invite-accept per IP+token.

---

## MEDIUM — implementation hardening (builder must apply)

### Realtime (0004/0010)
- **CRDT update flooding / DoS:** a malicious editor can flood Yjs updates → CPU
  + DB write amplification. Per-connection rate-limit on updates in Hocuspocus
  (`onChange`), plus a **per-page Y-doc size cap** (reject updates that would
  push `state` beyond N MB — also bounds `page_docs.state bytea` growth).
- **Doc-name spoofing:** the client requests `page:{id}`; confirm `id` is parsed
  **only** from `documentName` and never trusted from a client-supplied param
  elsewhere. `onAuthenticate` runs `can_read(id)` — that's the gate.
- **Live-revocation residual:** if `apps/realtime` crashes between a permission
  mutation and the `LISTEN/NOTIFY` kill, a revoked editor keeps writing until
  their client reconnects. Accepted for v1 — document the worst case explicitly
  to users/operators; a periodic re-auth sweep is post-v1.
- **WS origin check:** confirm the WS upgrade rejects connections whose `Origin`
  header isn't the app origin (defense even though the session cookie is
  same-origin + SameSite).

### Auth (0006)
- **OAuth account linking:** when a user has email/pw and links an OAuth
  provider with the same email, linking must require the existing session
  (else an attacker registers a Google account with a victim's email and links
  in). Verify Better Auth's `accountLinking` config enforces this.
- **Password reset tokens:** single-use, short TTL (≤15 min), invalidated on use
  and on any successful login. Standard — confirm Better Auth defaults.
- **Login rate-limiting:** per-IP **and** per-account (a single-IP limit is
  bypassable; a single-account limit prevents distributed spraying against one
  account).
- **First-user bootstrap = Owner:** on a *public* deploy this is a race
  (first signer-upper owns the default workspace). Fine for self-host behind a
  private network; **document** that public exposure requires gating sign-up or
  seeding the owner out-of-band.

### Attachments (0007)
- **Presigned-PUT type/size binding:** the presigned URL doesn't bind
  Content-Type/size — a client can upload a different type. On `/complete`,
  **HEAD the object** and verify MIME + size match the declared values; reject
  mismatch → delete the object.
- **Content-Disposition is mandatory for non-images:** confirm the signed-URL
  response sets `Content-Disposition: attachment` for **every non-image type**
  (SVG, HTML, PDF-with-script, etc.), and that "image" is an **allowlist**
  (png/jpg/gif/webp), not "anything not denied". SVG is a download, not inline.
- **Quota TOCTOU:** check-then-upload-then-recheck races let concurrent uploads
  overshoot quota. Acceptable for v1; document. A Postgres-triggered running
  total or post-hoc enforcement is the hard fix.
- **Signed-URL bearer window:** the 10-min GET URL is bearer-capable once
  minted (interceptable via logs/referrer). TTL = exposure window; document.

### Permission engine (0002) / data (0003)
- **Soft-delete filter discipline:** **every** content query filters
  `deleted_at IS NULL`. One missed filter = access to trashed pages. Enforce via
  Prisma query middleware / a repository layer that injects the filter
  automatically, not per-query by hand.
- **Soft-deleted resource shares:** decide whether shares on a trashed resource
  auto-expire (recommend: they're inactive while trashed, restored on restore —
  but record it so a restore doesn't silently re-grant access).
- **Nesting-depth DoS:** cap folder/page nesting depth (e.g. 32) to bound the
  recursive CTE and prevent pathological-tree DoS.
- **Open-workspace rule is intentional info-sharing:** within one workspace,
  Members can't have pages private from each other. This is **by design** (use
  separate workspaces for privacy) — document it so it's not mistaken for a bug.

### Search (0008)
- **Centralize the permission filter:** any search query that forgets the
  `can_read` join leaks titles+snippets across the tenant boundary. Provide
  **one** `searchPages(user, query)` function in `packages/db`, used everywhere;
  forbid ad-hoc FTS queries.
- **Result cap:** `LIMIT 20` (already in spec) bounds `ts_rank` cost.

### Cross-cutting (0009)
- **Secrets:** `AUTH_SECRET`, DB/S3/SMTP/OAuth creds — never committed (`.env`
  gitignored ✓). Document rotation; generate `AUTH_SECRET` with a strong CSPRNG
  at install, never reuse across deploys.
- **CORS / WS origin:** same-origin by design; if any API goes cross-origin,
  lock CORS to known origins explicitly.
- **Rate-limiting:** a **shared** rate-limit middleware (login, invite-accept,
  search, upload, WS updates), not ad-hoc per endpoint.
- **Supply chain:** pin lockfile; `pnpm audit` / dependabot on CI for v1.
- **Logging hygiene:** never log session cookies, signed URLs, Y-doc contents,
  or `page_docs.state`. Structured logs with a redaction layer.

---

## Summary

| Severity | Count | Disposition |
|---|---|---|
| HIGH (spec gaps) | 5 | Folded into tickets 0003, 0005, 0006, 0007, 0010 |
| MEDIUM (hardening) | ~18 | Listed here; builder applies during implementation |

The architecture is sound; no decision needs to be reversed. The HIGH findings
are **refinements that complete the spec** — they make explicit the security
requirements a builder must meet to implement each decision safely. Treat the
MEDIUM items as a security checklist for the implementation effort.
