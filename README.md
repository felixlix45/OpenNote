# OpenNote

Self-hostable, multi-tenant, real-time, Notion-style notes.

**Status:** v1 in development. The architecture is fully specified (9 resolved
decision tickets in `.tracker/`); this repo is the implementation.

## Quick start

Requires Node ≥20 and Docker. pnpm is provided via corepack (no global install):

```bash
# 1. deps
corepack enable  # one-time, if you want the `pnpm` shim (optional; `corepack pnpm` works too)
corepack pnpm install

# 2. infra (Postgres + MinIO)
docker compose up -d

# 3. env
cp .env.example .env
# edit AUTH_SECRET: openssl rand -base64 32

# 4. database (schema + raw SQL + seed, one command)
corepack pnpm db:setup           # db push + apply all SQL + seed (idempotent)

# 5. run everything
corepack pnpm dev               # web :3000, realtime :4321, worker
```

Open http://localhost:3000.

## Monorepo layout

```
apps/
  web/         Next.js (UI + route handlers + editor)
  realtime/    Hocuspocus WebSocket server (separate process)
  worker/      background jobs (trash purge, thumbnails, quota)
packages/
  db/          Prisma schema + client + effective-permission CTE + repository
  auth/        RBAC permission engine (security boundary) + Better Auth + invites
  shared/      Zod schemas + types + domain enums
  storage/     S3 client/presigning + SMTP
  ui/          shared React components
  config/      TS presets + the single-source Zod env schema
.tracker/      the wayfinder spec (9 resolved tickets + security review)
CONTEXT.md     the ubiquitous-language glossary
```

## Architecture & decisions

Every architectural decision is recorded as a closed ticket in `.tracker/issues/`:

- **0002** permission & sharing model (union inheritance, roles, groups)
- **0003** data model (Prisma schema + effective-permission CTE)
- **0004** realtime layer (Hocuspocus + Yjs persistence)
- **0005** block editor scope (BlockNote + custom blocks)
- **0006** auth (Better Auth, global identity, invites)
- **0007** attachments (S3-compatible, presigned PUT, quotas)
- **0008** search (Postgres FTS, inline permission scoping)
- **0009** monorepo & structure (pnpm + Turborepo)
- **0010** realtime authorization (session-cookie auth, readOnly gating)

🔒 A threat-model pass lives at `.tracker/research/SECURITY-REVIEW.md`. The 5
HIGH spec-gaps are folded into tickets 0003/0005/0006/0007/0010 as mandatory
**🔒 Security requirements**; the ~18 MEDIUM items are an implementation
checklist applied throughout the code (see the 🔒 comments).

## Testing

```bash
corepack pnpm test          # all packages
corepack pnpm typecheck     # all packages
```

The permission engine (`packages/auth`) is the security boundary and is
unit-tested exhaustively (mandatory per ticket 0009). Integration tests against
a real Postgres run via Vitest in `packages/db`; e2e (editor + realtime) via
Playwright as those layers land.
