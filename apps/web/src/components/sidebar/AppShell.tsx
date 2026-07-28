/**
 * Sidebar — the app shell.
 *
 * Client component that composes the sidebar with the page content and hosts
 * the WorkspaceProvider (so sidebar state survives client-side navigation).
 * Mounted by the (app) route-group layout, which auth-gates and renders this
 * around its children (the home + editor routes).
 *
 * Collapsible: the sidebar can be hidden to its rail; the toggle is persisted.
 */
"use client";

import type { ReactNode } from "react";
import { WorkspaceProvider } from "./WorkspaceContext";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
