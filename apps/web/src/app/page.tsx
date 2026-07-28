/**
 * apps/web — landing/home route.
 *
 * For the spine milestone this just routes to the auth handler + shows the
 * build status. A proper workspace-switcher home is part of the editor ticket.
 */
import Link from "next/link";
import { getSessionUser } from "@/lib/session";

export default async function Home() {
  const user = await getSessionUser();
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "3rem 1.5rem" }}>
      <h1 style={{ fontSize: 32, marginBottom: "0.25rem" }}>OpenNote</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
        Self-hostable, multi-tenant, real-time notes. v1 in development.
      </p>
      {user ? (
        <p>
          Signed in as <strong>{user.email}</strong>.{" "}
          <Link href="/api/auth/sign-out">Sign out</Link>
        </p>
      ) : (
        <p>
          <Link href="/auth">Create an account / Sign in</Link>
        </p>
      )}
      <hr
        style={{
          border: "none",
          borderTop: "1px solid var(--border)",
          margin: "2rem 0",
        }}
      />
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Spine milestone: schema + permission engine + auth + page editor
        surface. Realtime collaboration, the BlockNote editor, attachments, and
        search layer on next.
      </p>
    </main>
  );
}
