/**
 * @opennote/config — the single-source Zod env schema (ticket 0009).
 *
 * Every app imports and calls {@link loadEnv} at boot. Missing or malformed
 * required vars fail the process *before* any request is served, never at
 * runtime. Optional vars resolve to documented defaults.
 *
 * This file consolidates every env var surfaced across the v1 tickets:
 *   - DATABASE_URL        (0003 — Postgres)
 *   - AUTH_SECRET         (0006 — Better Auth cookie signing)
 *   - S3_*                (0007 — S3-compatible storage)
 *   - SMTP_*              (0006 — transactional email transport)
 *   - HOCUSPOCUS_*       (0004 — realtime WS server)
 *   - ATTACHMENT_* quotas (0007)
 *   - SEARCH_*            (0008)
 *   - OAuth providers     (0006 — optional)
 *   - NODE_ENV, PORT, APP_URL
 *
 * Standing security preference (0001 map): never log secrets. Structured logs
 * must redact these — see `loggableEnv()`.
 */
import { z } from "zod";

const Deployment = z.enum(["development", "test", "staging", "production"]);

const envSchema = z.object({
  /** Runtime environment. Defaults to development when unset. */
  NODE_ENV: Deployment.default("development"),

  /**
   * Public, canonical origin of the web app, including scheme and host, no
   * trailing slash. Used for cookie domain, OAuth redirects, CORS/WS origin
   * checks (🔒 SECURITY-REVIEW WS origin check), and invite/reset email links.
   * @example "https://notes.example.com"
   */
  APP_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, "")),

  /** Port the realtime WebSocket server binds to. */
  REALTIME_PORT: z.coerce.number().int().positive().default(4321),
  /**
   * The WebSocket URL the BROWSER editor connects to (ticket 0005). In dev this
   * points at the realtime process directly; in prod it's a relative path
   * mapped by the reverse proxy so the session cookie flows same-origin and the
   * WS origin check (🔒 0010 #4) passes. Must resolve to the {@link APP_URL}
   * origin (via proxy) for the cookie + origin check to work.
   * @example "/collab" (dev + prod behind proxy, same-origin) | "ws://rt:4321"
   */
  NEXT_PUBLIC_REALTIME_WS_URL: z.string().default("/collab"),

  /** ---------- Database (ticket 0003) ---------- */
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (libpq connection string)"),
  /**
   * Connection pool / Prisma query log threshold. Prisma logs queries in dev.
   */
  DB_LOG_QUERIES: z.coerce.boolean().default(false),

  /** ---------- Auth (ticket 0006) ---------- */
  /**
   * High-entropy secret used to sign Better Auth session cookies. Generate with
   * a CSPRNG (`openssl rand -base64 32`); never reuse across deploys.
   */
  AUTH_SECRET: z
    .string()
    .min(16, "AUTH_SECRET must be at least 16 chars (use `openssl rand -base64 32`)"),
  /**
   * Trusted origins for Better Auth (cookie domain + CSRF). Defaults to
   * {@link APP_URL}. Multi-origin self-host can append comma-separated values.
   */
  AUTH_TRUSTED_ORIGINS: z.string().optional(),

  /** Optional OAuth providers (ticket 0006). Presence enables the provider. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  /** ---------- SMTP / transactional email (ticket 0006) ---------- */
  /** When unset, SMTP is treated as unconfigured → invite links shown in-UI; reset disabled. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** "From" address for reset/invite email. Required when SMTP_HOST is set. */
  SMTP_FROM: z.string().email().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),

  /** ---------- Storage / attachments (ticket 0007) ---------- */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  /** Per-file max upload size, bytes. Default 25 MB (ticket 0007). */
  ATTACHMENT_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  /** Per-workspace cumulative quota, bytes. Default 5 GB (ticket 0007). */
  ATTACHMENT_WORKSPACE_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024 * 1024),
  /** Signed GET URL lifetime, seconds. Default 600 (10 min) (ticket 0007). */
  ATTACHMENT_SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(600),

  /** ---------- Search (ticket 0008) ---------- */
  /** Max results returned from a single search query (🔒 result cap). */
  SEARCH_MAX_RESULTS: z.coerce.number().int().positive().default(20),

  /** ---------- Realtime (ticket 0004 / 0010) ---------- */
  /**
   * Per-connection Y-doc update rate-limit, updates per second. A malicious
   * editor can flood updates → CPU + DB write amplification (🔒 SECURITY-REVIEW).
   */
  REALTIME_MAX_UPDATES_PER_SECOND: z.coerce.number().int().positive().default(50),
  /** Hard cap on a single page's persisted Y-doc state, bytes (🔒 CTE/bytea DoS bound). */
  REALTIME_DOC_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  /** Maximum folder/page nesting depth (🔒 SECURITY-REVIEW nesting-depth DoS bound). */
  MAX_NESTING_DEPTH: z.coerce.number().int().positive().default(32),

  /** Soft-delete trash auto-purge age, days (ticket 0003). */
  TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;
export const envSchemaRef = envSchema;

/**
 * Parse and validate `process.env`. Throws on the first invalid/missing value
 * with a human-readable message — call once at the top of each app's entrypoint.
 *
 * Optional cross-field validation (e.g. SMTP_FROM required when SMTP_HOST set)
 * is applied after the schema parse.
 */
export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(input);

  // Cross-field: SMTP_FROM is required when SMTP_HOST is configured.
  if (parsed.SMTP_HOST && !parsed.SMTP_FROM) {
    throw new Error(
      "SMTP_FROM is required when SMTP_HOST is set (transactional email needs a From address).",
    );
  }
  // OAuth provider is "on" only when both halves of its creds are present.
  // (No hard failure — the provider simply isn't advertised.)
  return parsed;
}

/**
 * A redacted, loggable projection of the env. **Never** log the raw Env object.
 * Returns the secret-bearing fields as boolean presence flags only.
 */
export function loggableEnv(env: Env): Record<string, unknown> {
  return {
    NODE_ENV: env.NODE_ENV,
    APP_URL: env.APP_URL,
    REALTIME_PORT: env.REALTIME_PORT,
    DB_LOG_QUERIES: env.DB_LOG_QUERIES,
    SMTP_CONFIGURED: Boolean(env.SMTP_HOST),
    SMTP_SECURE: env.SMTP_SECURE,
    S3_ENDPOINT: env.S3_ENDPOINT ?? "(managed)",
    S3_REGION: env.S3_REGION,
    S3_BUCKET: env.S3_BUCKET,
    S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
    GOOGLE_OAUTH_ENABLED: Boolean(
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
    ),
    GITHUB_OAUTH_ENABLED: Boolean(
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
    ),
    ATTACHMENT_MAX_FILE_BYTES: env.ATTACHMENT_MAX_FILE_BYTES,
    ATTACHMENT_WORKSPACE_QUOTA_BYTES: env.ATTACHMENT_WORKSPACE_QUOTA_BYTES,
    SEARCH_MAX_RESULTS: env.SEARCH_MAX_RESULTS,
    REALTIME_MAX_UPDATES_PER_SECOND: env.REALTIME_MAX_UPDATES_PER_SECOND,
    REALTIME_DOC_MAX_BYTES: env.REALTIME_DOC_MAX_BYTES,
    MAX_NESTING_DEPTH: env.MAX_NESTING_DEPTH,
    TRASH_RETENTION_DAYS: env.TRASH_RETENTION_DAYS,
    // Secret-bearing fields: presence flags only.
    HAS_AUTH_SECRET: true,
    HAS_DB_URL: true,
    HAS_S3_CREDS: true,
    HAS_SMTP_PASS: Boolean(env.SMTP_PASSWORD),
  };
}
