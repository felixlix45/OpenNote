/**
 * apps/web — App Router error boundary (route-level).
 *
 * Catches runtime errors in a route segment and shows a recovery UI instead of
 * a blank page. Must be a client component.
 */
"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
      <p style={{ color: "var(--muted)" }}>
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        style={{
          marginTop: "1rem",
          padding: "0.5rem 1rem",
          background: "var(--accent)",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </main>
  );
}
