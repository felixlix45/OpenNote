/**
 * Sidebar — nest the flat {folders, pages} sets into a renderable tree.
 *
 * The repository returns two flat arrays (permission-scoped). A node's parent
 * is a folder (`folder_id` / `parent_id`) or another page (`parent_page_id`).
 * Root nodes have a null parent. Folders always sit in folders (never under a
 * page); a page sits either directly in a folder or under another page.
 *
 * Result: an ordered list of root TreeNodes; each node carries its children.
 */
import type {
  SidebarFolder,
  SidebarPage,
} from "./WorkspaceContext";

export type TreeNodeKind = "folder" | "page";

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  title: string;
  icon: string | null;
  /** Pages nested under this node (folders have none — folders hold pages only at their own level). */
  pageChildren: TreeNode[];
  /** Folder children (folders only). */
  folderChildren: TreeNode[];
}

export function buildTree(folders: SidebarFolder[], pages: SidebarPage[]): TreeNode[] {
  const folderNodes = new Map<string, TreeNode>();
  const pageNodes = new Map<string, TreeNode>();

  for (const f of folders) {
    folderNodes.set(f.id, {
      id: f.id,
      kind: "folder",
      title: f.name,
      icon: "📁",
      pageChildren: [],
      folderChildren: [],
    });
  }
  for (const p of pages) {
    pageNodes.set(p.id, {
      id: p.id,
      kind: "page",
      title: p.title || "Untitled",
      icon: p.icon,
      pageChildren: [],
      folderChildren: [],
    });
  }

  const roots: TreeNode[] = [];

  // Attach folders to their parent folder (or root).
  for (const f of folders) {
    const node = folderNodes.get(f.id)!;
    if (f.parent_id && folderNodes.has(f.parent_id)) {
      folderNodes.get(f.parent_id)!.folderChildren.push(node);
    } else {
      roots.push(node);
    }
  }

  // Attach pages to their folder, their parent page, or root.
  for (const p of pages) {
    const node = pageNodes.get(p.id)!;
    if (p.parent_page_id && pageNodes.has(p.parent_page_id)) {
      pageNodes.get(p.parent_page_id)!.pageChildren.push(node);
    } else if (p.folder_id && folderNodes.has(p.folder_id)) {
      folderNodes.get(p.folder_id)!.pageChildren.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
