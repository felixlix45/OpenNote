/**
 * @opennote/db — db:setup script.
 *
 * Runs the full local-DB setup in one command:
 *   1. prisma db push        (create/alter tables from schema.prisma)
 *   2. apply all raw SQL     (CHECKs, FTS generated column + GIN, triggers,
 *                             effective_permission(), notify_perm_change() — the
 *                             artifacts Prisma can't express and that `db push`
 *                             drops on schema changes)
 *   3. seed                  (dev data)
 *
 * The SQL files are applied with ON_ERROR_STOP and IF NOT EXISTS guards so this
 * is idempotent (safe to re-run). This closes the "raw SQL must be applied after
 * db push" gap that dropped the FTS column during development.
 *
 * Usage: pnpm --filter @opennote/db db:setup
 *   (DATABASE_URL must be set)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readFileSync as readFile } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dbRoot = resolve(here, "..");

// Load the repo-root .env so DATABASE_URL is available (pnpm run doesn't
// auto-load .env). Walk up to find it — same pattern as vitest.config.ts.
function loadEnvFile(p) {
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(resolve(dbRoot, "../../.env"));


const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required (set it in .env or pass it inline).");
  process.exit(1);
}

function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: dbRoot, shell: true });
}

// 1. Push the schema (create/alter tables from schema.prisma). --accept-data-loss
//    because dev data is re-seeded after; the warning is about type changes that
//    drop column values, which is fine in the dev setup path.
run("prisma", ["db", "push", "--accept-data-loss"], "1. prisma db push");

// 2. Apply all raw SQL files in sorted order, via a raw pg connection (supports
//    multi-statement queries; psql isn't host-installed in all envs, and Prisma's
//    $executeRaw is single-statement). Each file uses IF NOT EXISTS / CREATE OR
//    REPLACE so re-runs are safe.
const sqlDir = resolve(dbRoot, "prisma", "sql");
const sqlFiles = readdirSync(sqlDir)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // constraints.sql, effective-permission.sql, perm-change-notify.sql, triggers.sql
console.log(`\n=== 2. applying ${sqlFiles.length} SQL file(s) ===`);
const { Client } = await import("pg");
const pgClient = new Client({ connectionString: databaseUrl });
await pgClient.connect();
try {
  for (const f of sqlFiles) {
    const path = join(sqlDir, f);
    console.log(`  - ${f}`);
    const sql = readFileSync(path, "utf8");
    await pgClient.query(sql); // multi-statement; errors throw
  }
} finally {
  await pgClient.end();
}

// 3. Seed dev data (idempotent — safe to re-run).
run("tsx", ["prisma/seed.ts"], "3. seed");

console.log("\n✓ db:setup complete (schema + SQL + seed).");
