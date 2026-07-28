/**
 * apps/web — authenticated home (under the `(app)` shell).
 *
 * With the sidebar present, the home route is the empty state shown when no
 * page is selected: a prompt to create a first page or pick one from the tree.
 * The sidebar (workspace switcher, favorites, recent, tree) is the real nav.
 */
"use client";

import { FileText, Plus } from "lucide-react";
import { useWorkspace } from "@/components/sidebar/WorkspaceContext";

export default function Home() {
  const { activeWorkspaceId, user, loading } = useWorkspace();

  const handleNewPage = async () => {
    if (!activeWorkspaceId) return;
    const res = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        folderId: null,
        title: "",
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { page: { id: string } };
      window.location.href = `/p/${data.page.id}`;
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <FileText size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <h2 style={{ color: "var(--fg)", margin: "0 0 0.5rem", fontWeight: 600 }}>
            {user ? `Welcome back` : "Welcome"}
          </h2>
          <p style={{ margin: "0 0 1.5rem", maxWidth: 360 }}>
            Select a page from the sidebar, search with{" "}
            <kbd style={kbd}>⌘K</kbd>, or create a new page to get started.
          </p>
          {activeWorkspaceId && (
            <button
              type="button"
              onClick={() => void handleNewPage()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                border: "none",
                background: "var(--accent)",
                color: "white",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              <Plus size={16} />
              New page
            </button>
          )}
        </>
      )}
    </div>
  );
}

const kbd: React.CSSProperties = {
  background: "var(--hover)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "1px 6px",
  fontSize: 12,
  fontFamily: "ui-monospace, monospace",
};
