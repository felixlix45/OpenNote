/**
 * Sidebar — workspace switcher (top of the sidebar).
 *
 * Shows the active workspace name; a dropdown lists all the user's workspaces
 * (switch), plus a "Create workspace" action. Switching updates the context,
 * which refetches the sidebar payload for the new workspace.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Plus, Check } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";

export default function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, switchWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  const slugFromName = (n: string) =>
    n
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);

  const handleCreate = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, slug: slugFromName(trimmed) }),
    });
    if (res.ok) {
      const data = (await res.json()) as { workspace: { id: string } };
      setCreating(false);
      setName("");
      // Refetch workspaces then switch to the new one.
      const wsRes = await fetch("/api/workspaces");
      if (wsRes.ok) {
        // switchWorkspace will refetch sidebar; the workspace list refresh
        // happens via a full reload of context on next mount, but switching
        // is the priority action.
        switchWorkspace(data.workspace.id);
        window.location.reload();
      }
    } else if (res.status === 409) {
      setError("That workspace name is taken.");
    } else {
      setError("Couldn't create workspace.");
    }
  };

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
          padding: "8px 10px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderRadius: 6,
          color: "var(--fg)",
          fontWeight: 600,
          fontSize: 14,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "var(--accent)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {(active?.name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {active?.name ?? "Select workspace"}
        </span>
        <ChevronsUpDown size={15} style={{ color: "var(--muted)" }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            zIndex: 100,
            padding: 4,
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                switchWorkspace(w.id);
                setOpen(false);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 8px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                borderRadius: 6,
                color: "var(--fg)",
                fontSize: 13,
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {w.name}
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "capitalize" }}>
                {w.role}
              </span>
              {w.id === activeWorkspaceId && <Check size={14} style={{ color: "var(--accent)" }} />}
            </button>
          ))}

          <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />

          {creating ? (
            <div style={{ padding: "6px 8px" }}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Workspace name"
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 13,
                  background: "var(--bg)",
                  color: "var(--fg)",
                  outline: "none",
                }}
              />
              {error && (
                <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{error}</div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  style={{
                    padding: "4px 10px",
                    border: "none",
                    background: "var(--accent)",
                    color: "white",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  style={{
                    padding: "4px 10px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--fg)",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 8px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                borderRadius: 6,
                color: "var(--fg)",
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Plus size={15} style={{ color: "var(--muted)" }} />
              Create workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}
