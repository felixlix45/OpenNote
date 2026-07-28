/**
 * apps/web — auth page (sign-up + sign-in).
 *
 * Better Auth provides the API (/api/auth/sign-up/email, /api/auth/sign-in/email)
 * but no default HTML form. This is the minimal UI: a single page with a toggle
 * between sign-up and sign-in, posting to the Better Auth endpoints. On success
 * it redirects to the home page (which reflects the authenticated state).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const endpoint =
      mode === "signup" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";
    const body: Record<string, string> = { email, password };
    if (mode === "signup" && name) body.name = name;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? `Request failed (${res.status})`);
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Is the server running?");
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        maxWidth: 360,
        margin: "8vh auto",
        padding: "0 1.5rem",
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: "0.25rem" }}>OpenNote</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem", fontSize: 14 }}>
        {mode === "signup" ? "Create an account" : "Welcome back"}
      </p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {mode === "signup" && (
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={inputStyle}
        />
        {error && (
          <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.6rem",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: loading ? "wait" : "pointer",
            fontSize: 15,
            fontWeight: 500,
          }}
        >
          {loading
            ? "…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>
      <p style={{ marginTop: "1rem", fontSize: 13, color: "var(--muted)" }}>
        {mode === "signup" ? "Already have an account?" : "Need an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            padding: 0,
            fontSize: 13,
            textDecoration: "underline",
          }}
        >
          {mode === "signup" ? "Sign in" : "Sign up"}
        </button>
      </p>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 15,
  background: "var(--bg)",
  color: "var(--fg)",
  outline: "none",
};
