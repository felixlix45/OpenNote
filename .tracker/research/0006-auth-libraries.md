# 0006 — Auth Library Research (Lucia vs Auth.js vs field)

Status as of **July 2026**. Findings for OpenNote: self-hostable, multi-tenant, Next.js (App Router) + TypeScript, email/password baseline + pluggable OAuth (Google/GitHub), HTTP-only cookie sessions, RBAC as app logic.

---

## 1. Lucia's current status

**Deprecated. End of maintenance was March 2025.**

- The `lucia` npm package (latest `3.2.2`) is marked `deprecated` by its maintainer (pilcrowOnPaper), pointing to the migration guide. Registry `time.modified` is **2025-06-06** — no new publish since.
- The deprecation was announced in Oct 2024 (Discussion #1714, "A fresh start"); bugfix-only maintenance ended **March 2025**.
- The repo/site has been **repurposed as an educational resource** ("learn to build auth from scratch"), not a maintained library. pilcrowOnPaper launched **no successor library**.
- **No actively-maintained community fork exists** with meaningful signal. Community consensus migration target is Better Auth (see §5).

**Recommendation:** Treat Lucia as a non-option. Do not start a new multi-tenant product on it.

**Sources:**
- https://github.com/lucia-auth/lucia/discussions/1714
- https://github.com/lucia-auth/lucia/discussions/1707
- https://www.npmjs.com/package/lucia (deprecated notice)
- https://lucia-auth.com/ (now a learning resource)

---

## 2. Auth.js (NextAuth v5) current status

**Stable but effectively in maintenance under new stewardship.**

- `next-auth` latest stable is **`4.24.15`** (modified 2026-07-20). **Auth.js v5 is still `5.0.0-beta.32`** — it never left beta; there is no `5.x` "latest" tag.
- **Sept 22, 2025:** Auth.js was formally transferred to the **Better Auth team**. Their README now states verbatim: *"We recommend new projects to start with Better Auth unless there are some very specific feature gaps."* The team will continue security patches only.
- App Router is supported (the universal `auth()` helper works in RSCs and proxy/middleware), but 2026 write-ups report real friction on Next.js 16: broken `proxy.ts` export pattern, Prisma v7 schema-url conflicts, redirect loops from broad matchers, and DB sessions requiring a per-request query (no edge).
- Maintenance signal: low trajectory. New-feature energy has moved to Better Auth.

**Recommendation:** Viable for existing v4/v5 codebases, but not the best bet for a greenfield 2026 product given the explicit "start elsewhere" guidance from its own maintainers.

**Sources:**
- https://www.npmjs.com/package/next-auth (dist-tags: latest 4.24.15, beta 5.0.0-beta.32)
- https://github.com/nextauthjs/next-auth (README: "Auth js is now part of Better Auth")
- https://www.better-auth.com/blog/authjs-joins-better-auth (Sept 22, 2025)
- https://blog.logrocket.com/best-auth-library-nextjs-2026/

---

## 3. Self-hostability comparison

**Both Lucia and Auth.js run with zero external accounts — but so does the stronger third option (§5).** None of these three forces Clerk/Auth0-style cloud accounts.

- **Lucia:** pure library, your DB, your code. Fully self-hosted.
- **Auth.js:** no cloud account required; providers configured via env keys. Self-hostable.
- **Better Auth (see §5):** self-hosted, "you own your data and DB," OAuth providers declared in code with no dashboard dependency.

All three pass the self-hosting bar.

---

## 4. Email/password + OAuth fit

**Lucia is "just sessions"** — confirmed. It gives you session management and leaves **everything else** to you: password hashing (you bring bcrypt/argon2), credential storage, the entire OAuth flow (token exchange, callback, user record linkage). More control, more code. This is a real cost for a multi-tenant baseline.

**Auth.js provides providers** — `CredentialsProvider`, `GoogleProvider`, `GitHubProvider` ship built-in; cookie sessions are default. Lower ceremony for the exact feature set OpenNote wants, though the `Credentials` provider is somewhat second-class (the maintainers historically discouraged it) and DB-session wiring is manual.

**Recommendation:** Of the original two, Auth.js fits the email/password+OAuth baseline far better than Lucia. But see §5.

---

## 5. A stronger 2026 option you're missing: Better Auth

**Better Auth** (`better-auth`, latest **`1.6.25`**, modified 2026-07-23 — actively shipping) is now the community default for self-hosted Next.js + email/password, and is the project that the Auth.js maintainers themselves point new projects to.

- **Built-in email/password** authenticator (argon2 hashing) — no DIY.
- **Built-in social/OAuth** providers (Google, GitHub, etc.) via `socialProviders` in code.
- **DB-backed opaque sessions in HTTP-only cookies** (not stateless JWTs) → immediate invalidation, which matters for multi-tenant RBAC changes.
- TypeScript-first, framework-agnostic (Next.js 16 supported), fully self-hosted, no cloud account.
- Caveats: an email is required on every user record; minor edge-case gaps (no built-in email-domain allow/deny lists). Mature but younger than Auth.js.

**Sources:**
- https://www.better-auth.com/docs/authentication/email-password
- https://better-auth.com/docs/integrations/next
- https://github.com/better-auth/better-auth
- https://blog.logrocket.com/best-auth-library-nextjs-2026/ ("strongest default for self-hosted Next.js in 2026")
- https://www.devtoolsacademy.com/blog/betterauth-vs-nextauth

---

## Bottom line

**Recommendation: Better Auth** for OpenNote's exact constraints.

**Single decisive reason:** Both original candidates are out of the running — **Lucia is deprecated** (no successor) and **Auth.js v5 is parked in beta under security-only maintenance, with its own README redirecting new projects to Better Auth**. Better Auth gives OpenNote the precise feature set it needs — built-in email/password + OAuth + DB-backed HTTP-only cookie sessions, fully self-hosted with zero cloud dependency — and is the most actively-maintained option in this space as of July 2026.

If the team explicitly wants to honor the original Lucia/NextAuth shortlist, the answer collapses to **Auth.js v5 (beta)** as the only live one of the two — but accepting Better Auth is the higher-EV choice.
