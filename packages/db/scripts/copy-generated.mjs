/**
 * Postbuild step: copy the Prisma-generated client (already valid JS) into
 * dist/generated so the built dist/client.js can resolve ./generated/client.
 *
 * tsc can't emit it (it's excluded from the build tsconfig to keep typecheck
 * fast), and the generator writes JS directly, so a recursive copy is the
 * simplest portable step. Uses Node's fs (no extra dep, works on win32 + unix).
 */
import { cp, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "src", "generated");
const dest = resolve(here, "..", "dist", "generated");

await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });
console.log("[db] copied src/generated → dist/generated");
