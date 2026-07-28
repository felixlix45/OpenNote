/**
 * Sidebar — the full left nav, composed in Notion order (top → bottom):
 *
 *   WorkspaceSwitcher
 *   quick row (Search hint, New page)
 *   Favorites
 *   Recent
 *   PageTree
 *   ─────────── (flex-spacer)
 *   ProfileBar
 *
 * Collapsible (persisted width). The tree/expand state, favorites, and active
 * workspace all live in WorkspaceContext, so this is presentational.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Plus, Star, Clock, PanelLeftClose, PanelLeft } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import PageTree from "./PageTree";
import ProfileBar from "./ProfileBar";

const COLLAPSED_KEY = "opennote:sidebarCollapsed";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 10px 4px",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {children}
    </div>
  );
}

function PageQuickLink({
  id,
  title,
  icon,
  depth = 0,
}: {
  id: string;
  title: string;
  icon: string | null;
  depth?: number;
}) {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const active = pathname === `/p/${id}`;
  return (
    <Link
      href={`/p/${id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        marginLeft: depth * 4,
        borderRadius: 6,
        fontSize: 14,
        color: active ? "var(--fg)" : "var(--fg)",
        textDecoration: "none",
        background: active ? "var(--hover)" : "transparent",
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: 14, width: 16, textAlign: "center", flexShrink: 0 }}>
        {icon ?? "📄"}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {title || "Untitled"}
      </span>
    </Link>
  );
}

export default function Sidebar() {
  const { sidebar, activeWorkspaceId } = useWorkspace();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        title="Show sidebar"
        style={{
          width: 44,
          flexShrink: 0,
          background: "var(--sidebar-bg)",
          border: "none",
          borderRight: "1px solid var(--border)",
          cursor: "pointer",
          color: "var(--muted)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "10px 0",
        }}
      >
        <PanelLeft size={18} />
      </button>
    );
  }

  const handleNewPage = async () => {
    if (!activeWorkspaceId) return;
    const res = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: activeWorkspaceId, folderId: null, title: "" }),
    });
    if (res.ok) {
      const data = (await res.json()) as { page: { id: string } };
      window.location.href = `/p/${data.page.id}`;
    }
  };

  return (
    <aside
      style={{
        width: "var(--sidebar-w)",
        flexShrink: 0,
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
      }}
    >
      {/* Top: switcher + collapse toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 8px 4px",
        }}
      >
        <div style={{ flex: 1 }}>
          <WorkspaceSwitcher />
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Hide sidebar"
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 6,
            borderRadius: 6,
            color: "var(--muted)",
            display: "flex",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Quick row: search + new page */}
      <div style={{ padding: "4px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        <button
          type="button"
          onClick={() => {
            // Dispatch the ⌘K combo so the global SearchPalette opens.
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }),
            );
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            borderRadius: 6,
            color: "var(--fg)",
            fontSize: 14,
            textAlign: "left",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Search size={15} style={{ color: "var(--muted)" }} />
          Search
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
            ⌘K
          </span>
        </button>
        <button
          type="button"
          onClick={() => void handleNewPage()}
          disabled={!activeWorkspaceId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            border: "none",
            background: "transparent",
            cursor: activeWorkspaceId ? "pointer" : "not-allowed",
            borderRadius: 6,
            color: "var(--fg)",
            fontSize: 14,
            textAlign: "left",
            opacity: activeWorkspaceId ? 1 : 0.5,
          }}
          onMouseEnter={(e) =>
            activeWorkspaceId && (e.currentTarget.style.background = "var(--hover)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Plus size={15} style={{ color: "var(--muted)" }} />
          New page
        </button>
      </div>

      {/* Scrollable middle: favorites + recent + tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 4px" }}>
        {sidebar && sidebar.favorites.length > 0 && (
          <>
            <SectionLabel>
              <Star size={11} style={{ display: "inline", marginRight: 4 }} />
              Favorites
            </SectionLabel>
            {sidebar.favorites.map((f) => (
              <PageQuickLink key={f.id} id={f.id} title={f.title} icon={f.icon} />
            ))}
          </>
        )}

        {sidebar && sidebar.recent.length > 0 && (
          <>
            <SectionLabel>
              <Clock size={11} style={{ display: "inline", marginRight: 4 }} />
              Recent
            </SectionLabel>
            {sidebar.recent.map((r) => (
              <PageQuickLink key={r.id} id={r.id} title={r.title} icon={r.icon} />
            ))}
          </>
        )}

        <SectionLabel>Pages</SectionLabel>
        <PageTree />
      </div>

      {/* Bottom: profile */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: 6,
        }}
      >
        <ProfileBar />
      </div>
    </aside>
  );
}
