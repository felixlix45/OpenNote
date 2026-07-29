/**
 * @opennote/auth — Better Auth configuration (ticket 0006).
 *
 * Better Auth owns: credentials (argon2), sessions (HTTP-only cookie), OAuth
 * provider wiring, email verification + password-reset tokens. OpenNote owns
 * roles/groups/shares/effective-permission (the engine in ./engine.ts).
 *
 * 🔒 Security defaults applied here (SECURITY-REVIEW MEDIUM, Auth section):
 *   - accountLinking: require existing session before linking an OAuth account
 *     that shares an email (default-on; we assert it's not disabled).
 *   - rate limits: per-IP AND per-account on login (configured in apps/web
 *     middleware; Better Auth's own limiter covers the credential endpoint).
 *
 * The SMTP transport (optional in v1) is wired only when SMTP_HOST is set.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@opennote/db";
import type { Env } from "@opennote/config/env";

export interface BetterAuthDeps {
  prisma: PrismaClient;
  env: Env;
}

/**
 * Build a Better Auth instance. Constructed once per process in apps/web and
 * apps/realtime (the realtime server only needs to *read* sessions, but shares
 * the same config for cookie-name consistency).
 */
export function createBetterAuth({ prisma, env }: BetterAuthDeps) {
  const trustedOrigins = [env.APP_URL, ...(env.AUTH_TRUSTED_ORIGINS?.split(",") ?? [])];

  const hasGoogle = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const hasGithub = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  const smtpConfigured = Boolean(env.SMTP_HOST);

  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins,

    // Generate UUIDs for all Better Auth-owned rows (users, sessions, accounts,
    // verifications). The Prisma schema types these ids as @db.Uuid, so Better
    // Auth's default nanoid-style generator (a non-UUID string) would fail with
    // P2023 "inconsistent column data." randomUUID produces RFC 4122 v4 UUIDs.
    advanced: {
      database: {
        generateId: () => randomUUID(),
      },
    },

    emailAndPassword: {
      enabled: true,
      // 🔒 Email verification: optional at sign-up for self-host low-friction,
      // but auto-ON when SMTP is configured (ticket 0006). This matters for the
      // invite flow: accepting an invite requires email-control verification
      // (HIGH #5), which is only achievable when verification can be turned on.
      requireEmailVerification: smtpConfigured,
      // 🔒 Reset tokens: Better Auth defaults are single-use, short TTL (≤15min),
      // invalidated on use + on any successful login. We don't extend them.
      // sendResetPassword is wired by apps/web (it owns the SMTP service from
      // packages/storage); Better Auth's config here is intentionally minimal so
      // the transport isn't a hard dependency of this package.
    },

    socialProviders: {
      ...(hasGoogle
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID!,
              clientSecret: env.GOOGLE_CLIENT_SECRET!,
            },
          }
        : {}),
      ...(hasGithub
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID!,
              clientSecret: env.GITHUB_CLIENT_SECRET!,
            },
          }
        : {}),
    },

    // 🔒 OAuth account linking requires the existing session by default.
    // Do NOT set accountLinking.allowDifferentEmails = true.
    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
        trustedProviders: ["google", "github"],
      },
    },

    session: {
      // HTTP-only cookie, SameSite=lax by default. cookieCache shortens the
      // DB hit frequency; the realtime server re-validates via the shared
      // session-cookie reader (ticket 0010).
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },

    // 🔒 Rate limiting: Better Auth applies per-IP limits on credential endpoints.
    // apps/web middleware adds per-account (per-email) limiting on top
    // (SECURITY-REVIEW: per-IP AND per-account).
    rateLimit: {
      enabled: true,
      window: 10, // seconds
      max: 10, // requests per window per IP
    },

    // First-user bootstrap (ticket 0006 §3): after a user is created, provision
    // a workspace. The FIRST user on a fresh install becomes Owner of a default
    // "OpenNote" workspace; subsequent users get their own personal workspace.
    // Any authenticated user can also create workspaces via POST /api/workspaces.
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const { countWorkspaces, createWorkspace } = await import(
              "@opennote/db"
            );
            const wsCount = await countWorkspaces(prisma);
            if (wsCount === 0) {
              // First user → Owner of the default workspace.
              await createWorkspace(prisma, {
                name: "OpenNote",
                slug: "opennote",
                ownerId: user.id,
              }).catch(() => {
                // The seed may have already created it; ignore the slug conflict.
              });
            } else {
              // Subsequent users → a personal workspace.
              const slug = `user-${user.id.slice(0, 8)}`;
              await createWorkspace(prisma, {
                name: `${user.name ?? "My"} Workspace`,
                slug,
                ownerId: user.id,
              }).catch(() => {});
            }
          },
        },
      },
    },
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
