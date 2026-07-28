/**
 * apps/web — boot-time env validation (ticket 0009).
 *
 * Loads + validates process.env once via the single-source Zod schema in
 * @opennote/config. Invalid/missing required vars throw at boot — never at
 * runtime. This file is the only place apps/web touches process.env directly.
 *
 * In development the env is loaded fresh per import; in production it's cached.
 */
import { loadEnv, type Env } from "@opennote/config/env";

// `globalThis` cache survives Next.js hot reload in dev.
const globalForEnv = globalThis as unknown as { __opennoteEnv?: Env };

export const env: Env = globalForEnv.__opennoteEnv ?? loadEnv(process.env);

if (process.env.NODE_ENV !== "production") {
  globalForEnv.__opennoteEnv = env;
}
