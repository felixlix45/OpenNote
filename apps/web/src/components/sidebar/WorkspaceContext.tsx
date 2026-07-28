/**
 * Sidebar — workspace + sidebar-data context (client).
 *
 * One provider wraps the whole app shell so sidebar state (active workspace,
 * the visible tree, recents, favorites, expand/collapse) survives navigation
 * between / and /p/[pageId]. Matches the codebase's no-state-lib convention
 * (local useState + fetch).
 *
 * Data sources:
 *   - /api/me            → user identity (profile bar)
 *   - /api/workspaces    → the workspace list (switcher)
 *   - /api/workspaces/:id/sidebar → { tree, recent, favorites }
 *
 * The active workspace is seeded from localStorage (last-used), falling back to
 * the first workspace; switching updates localStorage + refetches the sidebar.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface SidebarUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface SidebarWorkspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

// Flat rows straight from the repository's raw queries (snake_case columns).
export interface SidebarFolder {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
}
export interface SidebarPage {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  parent_page_id: string | null;
  title: string;
  icon: string | null;
}
export interface SidebarRecentItem {
  id: string;
  title: string;
  icon: string | null;
  last_visited_at: string;
}
export interface SidebarFavoriteItem {
  id: string;
  title: string;
  icon: string | null;
}

interface SidebarData {
  tree: { folders: SidebarFolder[]; pages: SidebarPage[] };
  recent: SidebarRecentItem[];
  favorites: SidebarFavoriteItem[];
}

interface WorkspaceContextValue {
  user: SidebarUser | null;
  workspaces: SidebarWorkspace[];
  activeWorkspaceId: string | null;
  sidebar: SidebarData | null;
  loading: boolean;
  expanded: Set<string>;
  /** Toggle a tree node's expand/collapse (persisted to localStorage). */
  toggleExpand: (id: string) => void;
  /** Switch the active workspace (persists + refetches sidebar). */
  switchWorkspace: (workspaceId: string) => void;
  /** Set the active workspace without refetching (used on editor mount). */
  setActiveWorkspaceId: (workspaceId: string) => void;
  /** Refetch the sidebar payload for the active workspace. */
  refresh: () => Promise<void>;
  /** Star/unstar a page; updates favorites optimistically + refetches. */
  toggleFavorite: (pageId: string) => Promise<void>;
  /** Whether a page is currently in favorites. */
  isFavorite: (pageId: string) => boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const ACTIVE_WS_KEY = "opennote:activeWorkspaceId";
const EXPANDED_KEY = "opennote:sidebarExpanded";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SidebarUser | null>(null);
  const [workspaces, setWorkspaces] = useState<SidebarWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(
    null,
  );
  const [sidebar, setSidebar] = useState<SidebarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Seed expand state from localStorage so the tree remembers its shape.
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(EXPANDED_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  // Initial load: user + workspaces, then resolve the active workspace.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [meRes, wsRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/workspaces"),
        ]);
        if (cancelled) return;
        if (meRes.ok) {
          const me = (await meRes.json()) as { user: SidebarUser };
          setUser(me.user);
        }
        if (wsRes.ok) {
          const ws = (await wsRes.json()) as { workspaces: SidebarWorkspace[] };
          setWorkspaces(ws.workspaces);
          // Resolve active workspace: stored > first > null.
          const stored =
            typeof window !== "undefined"
              ? localStorage.getItem(ACTIVE_WS_KEY)
              : null;
          const first = ws.workspaces[0]?.id ?? null;
          const resolved =
            (stored && ws.workspaces.some((w) => w.id === stored) && stored) ||
            first;
          if (resolved) setActiveWorkspaceIdState(resolved);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the sidebar payload whenever the active workspace changes.
  const loadSidebar = useCallback(async (workspaceId: string) => {
    const res = await fetch(`/api/workspaces/${workspaceId}/sidebar`);
    if (res.ok) {
      setSidebar((await res.json()) as SidebarData);
    } else {
      setSidebar(null);
    }
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setSidebar(null);
      return;
    }
    // Mirror sessionStorage for the global SearchPalette (legacy bridge).
    try {
      sessionStorage.setItem("opennote:workspaceId", activeWorkspaceId);
    } catch {
      // ignore
    }
    void loadSidebar(activeWorkspaceId);
  }, [activeWorkspaceId, loadSidebar]);

  const switchWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceIdState(workspaceId);
    try {
      localStorage.setItem(ACTIVE_WS_KEY, workspaceId);
    } catch {
      // ignore
    }
  }, []);

  const setActiveWorkspaceId = useCallback((workspaceId: string) => {
    setActiveWorkspaceIdState((current) => {
      if (current === workspaceId) return current;
      try {
        localStorage.setItem(ACTIVE_WS_KEY, workspaceId);
      } catch {
        // ignore
      }
      return workspaceId;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (activeWorkspaceId) await loadSidebar(activeWorkspaceId);
  }, [activeWorkspaceId, loadSidebar]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (pageId: string) =>
      sidebar?.favorites.some((f) => f.id === pageId) ?? false,
    [sidebar],
  );

  const toggleFavorite = useCallback(
    async (pageId: string) => {
      const wasFav = sidebar?.favorites.some((f) => f.id === pageId) ?? false;
      // Optimistic update.
      setSidebar((prev) => {
        if (!prev) return prev;
        if (wasFav) {
          return {
            ...prev,
            favorites: prev.favorites.filter((f) => f.id !== pageId),
          };
        }
        // Promote from recent/tree if present so the row has title/icon.
        const known =
          prev.recent.find((r) => r.id === pageId) ??
          prev.tree.pages.find((p) => p.id === pageId);
        return {
          ...prev,
          favorites: [
            ...prev.favorites,
            {
              id: pageId,
              title: known?.title ?? "Untitled",
              icon: known?.icon ?? null,
            },
          ],
        };
      });
      try {
        const res = await fetch(`/api/pages/${pageId}/favorite`, {
          method: wasFav ? "DELETE" : "POST",
        });
        if (!res.ok) void refresh(); // rollback on failure
      } catch {
        void refresh();
      }
    },
    [sidebar, refresh],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      user,
      workspaces,
      activeWorkspaceId,
      sidebar,
      loading,
      expanded,
      toggleExpand,
      switchWorkspace,
      setActiveWorkspaceId,
      refresh,
      toggleFavorite,
      isFavorite,
    }),
    [
      user,
      workspaces,
      activeWorkspaceId,
      sidebar,
      loading,
      expanded,
      toggleExpand,
      switchWorkspace,
      setActiveWorkspaceId,
      refresh,
      toggleFavorite,
      isFavorite,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}
