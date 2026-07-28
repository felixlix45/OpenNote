/**
 * apps/web — cmd+K search palette (ticket 0008 #4).
 *
 * Opens on ⌘K / Ctrl+K, queries GET /api/search (permission-scoped), shows page
 * title + snippet, and navigates to the page on select. Closes on Escape / blur.
 *
 * Client-only (DOM + keyboard listeners). The palette needs a workspaceId to
 * scope the search; it's passed as a prop, defaulting to the most-recent
 * workspace. If no workspaceId is known, the palette is a no-op until one is.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SearchResult {
  pageId: string;
  title: string;
  rank: number;
  snippet: string;
}

export default function SearchPalette({
  workspaceId: workspaceIdProp,
}: {
  workspaceId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the workspace: explicit prop takes priority; otherwise read the
  // last-known workspace from sessionStorage (the editor page writes it when a
  // page loads). Lets the global palette scope search without prop-drilling.
  // Done in an effect so SSR doesn't touch sessionStorage.
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(workspaceIdProp);
  useEffect(() => {
    if (workspaceIdProp) {
      setWorkspaceId(workspaceIdProp);
      return;
    }
    const stored = sessionStorage.getItem("opennote:workspaceId");
    if (stored) setWorkspaceId(stored);
  }, [workspaceIdProp]);

  // ⌘K / Ctrl+K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input when opening.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced search.
  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || !workspaceId) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&workspaceId=${workspaceId}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { results: SearchResult[] };
          setResults(data.results);
          setActiveIndex(0);
        }
      } catch {
        // network error → empty results
      } finally {
        setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Keyboard navigation within results.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      window.location.assign(`/p/${results[activeIndex]!.pageId}`);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: "min(560px, 90vw)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            workspaceId
              ? "Search pages…"
              : "Open a workspace to search"
          }
          disabled={!workspaceId}
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            padding: "1rem 1.25rem",
            fontSize: 16,
            background: "transparent",
            color: "var(--fg)",
            borderBottom: "1px solid var(--border)",
          }}
        />
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: "1rem", color: "var(--muted)", fontSize: 14 }}>
              Searching…
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div style={{ padding: "1rem", color: "var(--muted)", fontSize: 14 }}>
              No pages found.
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={r.pageId}
              onClick={() => window.location.assign(`/p/${r.pageId}`)}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                padding: "0.75rem 1.25rem",
                cursor: "pointer",
                background: i === activeIndex ? "var(--accent)" : "transparent",
                color: i === activeIndex ? "white" : "var(--fg)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.title || "Untitled"}</div>
              {r.snippet && (
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.8,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              )}
            </div>
          ))}
        </div>
        <div
          style={{
            padding: "0.5rem 1.25rem",
            fontSize: 11,
            color: "var(--muted)",
            borderTop: "1px solid var(--border)",
          }}
        >
          ↑↓ navigate · ⏎ open · esc close
        </div>
      </div>
    </div>
  );
}
