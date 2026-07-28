/**
 * Sidebar — the page/folder tree (recursive).
 *
 * Renders the nested TreeNode structure from buildTree. Each node is a link
 * (pages → /p/:id) or a collapsible group (folders + pages-with-children).
 * Expand/collapse state lives in WorkspaceContext (persisted). The active page
 * is derived from the URL pathname so the row highlights on the open page.
 */
"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  FileText,
  Folder,
  Plus,
} from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { buildTree, type TreeNode } from "./buildTree";

const INDENT = 14; // px per depth level

function activePageIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/p\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

function NodeRow({
  node,
  depth,
  activePageId,
}: {
  node: TreeNode;
  depth: number;
  activePageId: string | null;
}) {
  const { expanded, toggleExpand } = useWorkspace();
  const hasChildren =
    node.folderChildren.length > 0 || node.pageChildren.length > 0;
  const isOpen = expanded.has(node.id);

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    paddingLeft: 8 + depth * INDENT,
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
    color: "var(--fg)",
    textDecoration: "none",
    background:
      node.kind === "page" && node.id === activePageId
        ? "var(--hover)"
        : "transparent",
    fontWeight: node.kind === "page" && node.id === activePageId ? 600 : 400,
  };
  const hoverBg = { background: "var(--hover)" } as const;

  const chevron = hasChildren ? (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleExpand(node.id);
      }}
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0,
        display: "flex",
        color: "var(--muted)",
        transform: isOpen ? "rotate(90deg)" : "none",
        transition: "transform 0.1s",
      }}
      aria-label={isOpen ? "Collapse" : "Expand"}
    >
      <ChevronRight size={14} />
    </button>
  ) : (
    <span style={{ width: 14, display: "inline-block" }} />
  );

  const icon =
    node.kind === "folder" ? (
      <Folder size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />
    ) : (
      <span style={{ fontSize: 14, flexShrink: 0 }}>
        {node.icon ?? <FileText size={14} style={{ color: "var(--muted)" }} />}
      </span>
    );

  const label = (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
      }}
    >
      {node.title}
    </span>
  );

  return (
    <>
      {node.kind === "page" ? (
        <Link
          href={`/p/${node.id}`}
          style={rowStyle}
          onMouseEnter={(e) => {
            if (node.id !== activePageId)
              Object.assign(e.currentTarget.style, hoverBg);
          }}
          onMouseLeave={(e) => {
            if (node.id !== activePageId)
              e.currentTarget.style.background = "transparent";
          }}
        >
          {chevron}
          {icon}
          {label}
        </Link>
      ) : (
        <div
          style={rowStyle}
          onClick={() => hasChildren && toggleExpand(node.id)}
          onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {chevron}
          {icon}
          {label}
        </div>
      )}
      {hasChildren && isOpen && (
        <div>
          {node.folderChildren.map((c) => (
            <NodeRow
              key={`f-${c.id}`}
              node={c}
              depth={depth + 1}
              activePageId={activePageId}
            />
          ))}
          {node.pageChildren.map((c) => (
            <NodeRow
              key={`p-${c.id}`}
              node={c}
              depth={depth + 1}
              activePageId={activePageId}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function PageTree() {
  const { sidebar, activeWorkspaceId } = useWorkspace();
  const pathname = usePathname();
  const activePageId = activePageIdFromPath(pathname);

  if (!sidebar || !activeWorkspaceId) return null;
  const tree = buildTree(sidebar.tree.folders, sidebar.tree.pages);

  if (tree.length === 0) {
    return (
      <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 13 }}>
        No pages yet.
      </div>
    );
  }

  return (
    <div>
      {tree.map((node) => (
        <NodeRow
          key={`${node.kind}-${node.id}`}
          node={node}
          depth={0}
          activePageId={activePageId}
        />
      ))}
    </div>
  );
}
