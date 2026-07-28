# @opennote/db

Prisma schema (source of truth, ticket 0003) + generated client + the
effective-permission CTE + a repository layer that centralizes the 🔒 security
invariants (tenant isolation, soft-delete discipline, nesting-depth cap).

## Layout

```
prisma/
  schema.prisma              # source of truth (all models)
  sql/
    constraints.sql          # XOR CHECKs, role/level enums, FTS generated col + GIN
    triggers.sql             # all-members group sync trigger
    effective-permission.sql # the effective_permission() SQL function (hot path)
  seed.ts                    # dev-only seed (idempotent)
src/
  generated/client/         # prisma generate output (gitignored)
  client.ts                  # PrismaClient singleton
  repository.ts              # content accessors + queryEffectivePermission + searchPages
  index.ts                   # public surface
```

## Migrations

Prisma generates the base migration from `schema.prisma`. The raw SQL in
`prisma/sql/` (CHECKs, generated column, GIN index, triggers, the
`effective_permission()` function) can't be expressed in Prisma's schema DSL,
so it's applied as the **final step** of each migration.

Workflow (dev):

```bash
corepack pnpm --filter @opennote/db db:generate   # regenerate the client
corepack pnpm db:migrate                           # create + apply migration
# then append the raw SQL to the new migration file:
cat packages/db/prisma/sql/constraints.sql >> packages/db/prisma/migrations/<ts>_init/migration.sql
cat packages/db/prisma/sql/triggers.sql >> packages/db/prisma/migrations/<ts>_init/migration.sql
cat packages/db/prisma/sql/effective-permission.sql >> packages/db/prisma/migrations/<ts>_init/migration.sql
corepack pnpm db:migrate:deploy                    # apply (idempotent)
corepack pnpm db:seed                              # dev data
```

For local dev without writing a real migration, `db:push` applies the schema
directly (skips the raw SQL — run it manually after, or use migrations).

## 🔒 Security invariants enforced here

Per `.tracker/research/SECURITY-REVIEW.md` (HIGH #1 + MEDIUM items):

- **Tenant isolation:** every content query in `repository.ts` is scoped by
  `workspaceId`; `assertResourceInWorkspace` cross-checks a polymorphic share's
  target before use.
- **Soft-delete discipline:** content reads filter `deletedAt: null`
  automatically via the repository — app code must not hand-roll these queries.
- **Nesting-depth cap:** `folderDepth` / `createPage` enforce `MAX_NESTING_DEPTH`.
- **Search centralization:** `searchPages` is the ONE FTS entrypoint; it joins
  against `effective_permission()` so results never leak across the tenant
  boundary.
