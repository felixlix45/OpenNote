/**
 * Sidebar — profile bar (bottom of the sidebar).
 *
 * Shows the user's avatar (or initial), name, and email. A dropdown offers
 * Sign out (POSTs to the Better Auth sign-out endpoint). Settings is a v1 stub
 * (no settings page yet) — shown disabled.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";

function initials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return email.slice(0, 1).toUpperCase();
}

export default function ProfileBar() {
  const { user } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!user) return null;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } finally {
      window.location.href = "/auth";
    }
  };

  const Avatar = user.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={user.image}
      alt=""
      style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }}
    />
  ) : (
    <span
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "var(--accent)",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials(user.name, user.email)}
    </span>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderRadius: 6,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {Avatar}
        <span style={{ flex: 1, overflow: "hidden", textAlign: "left" }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              color: "var(--fg)",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.name || user.email}
          </span>
          {user.name && (
            <span
              style={{
                display: "block",
                fontSize: 11,
                color: "var(--muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user.email}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            zIndex: 100,
            padding: 4,
          }}
        >
          <div
            style={{
              padding: "8px 10px",
              fontSize: 12,
              color: "var(--muted)",
              borderBottom: "1px solid var(--border)",
              marginBottom: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={user.email}
          >
            {user.email}
          </div>
          <button
            type="button"
            disabled
            title="Settings coming soon"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 8px",
              border: "none",
              background: "transparent",
              borderRadius: 6,
              color: "var(--muted)",
              fontSize: 13,
              cursor: "not-allowed",
              opacity: 0.6,
            }}
          >
            <Settings size={15} />
            Settings
          </button>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 8px",
              border: "none",
              background: "transparent",
              cursor: signingOut ? "wait" : "pointer",
              borderRadius: 6,
              color: "var(--fg)",
              fontSize: 13,
            }}
            onMouseEnter={(e) =>
              !signingOut && (e.currentTarget.style.background = "var(--hover)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <LogOut size={15} />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
