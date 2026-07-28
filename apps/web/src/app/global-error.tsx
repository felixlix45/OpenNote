/**
 * apps/web — global error boundary (replaces the root layout on error).
 *
 * Catches errors that escape route-level error.tsx, including errors in the
 * root layout itself. MUST render its own <html>/<body> (it replaces layout).
 */
"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          margin: 0,
          padding: "4rem 1.5rem",
          maxWidth: 480,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        <h1 style={{ fontSize: 22 }}>Application error</h1>
        <p style={{ color: "#6b7280" }}>
          {error.message || "A critical error occurred."}
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            background: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
