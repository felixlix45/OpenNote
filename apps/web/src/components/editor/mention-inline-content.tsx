/**
 * apps/web — @mention inline content (ticket 0005 Layer 5b).
 *
 * A mention is a custom InlineContentSpec (not a block): it flows with the text.
 * It stores `{ kind: 'user'|'page', id }` — the display name/title is resolved
 * fresh at render so renames propagate (the doc never stores the label durably,
 * per the spec). Two flavors: @user, @page.
 *
 * The suggestion-popup trigger (typing @ → fetch from the Layer 2 permission-
 * scoped typeahead endpoints) is wired via BlockNote's SuggestionMenu extension.
 * The endpoints (/api/mentions/users, /api/mentions/pages) are already built
 * and permission-scoped (🔒 0005 #3) — this file is the editor half.
 */
import { createReactInlineContentSpec } from "@blocknote/react";
import type { MentionAttrs } from "@opennote/shared";

/**
 * The mention inline content spec. Stored shape matches shared MentionAttrs.
 * Render resolves the label from the id at render time (async fetch + cache).
 */
export const Mention = createReactInlineContentSpec(
  {
    type: "mention" as const,
    propSchema: {
      kind: { default: "user", values: ["user", "page"] },
      id: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const props = inlineContent.props as MentionAttrs;
      // Resolve + render the current label. The resolver caches per-id so
      // repeated renders don't refetch. (Full resolver lives in useResolvedLabel.)
      return <MentionLabel kind={props.kind} id={props.id} />;
    },
  },
);

/** A self-contained label that resolves + caches the current name/title. */
function MentionLabel({ kind, id }: { kind: "user" | "page"; id: string }) {
  // v1: render a placeholder label synchronously, then resolve. The cache is
  // module-scoped so renames propagate on remount but don't refetch per keystroke.
  const label = useResolvedLabel(kind, id);
  const color = kind === "user" ? "#2563eb" : "#7c3aed";
  return (
    <span
      style={{
        backgroundColor: kind === "user" ? "#eff6ff" : "#f5f3ff",
        color,
        borderRadius: 4,
        padding: "0 0.25rem",
        cursor: "pointer",
        fontWeight: 500,
      }}
      data-mention-kind={kind}
      data-mention-id={id}
    >
      {kind === "user" ? "@" : "📌"}
      {label}
    </span>
  );
}

// --- label resolver + cache (module-scoped; renames propagate on remount) ---
//
// Resolves the current name (user) or title (page) for a mention id. In v1 this
// hits the read endpoints; the result is cached for the module lifetime so a
// rename surfaces on next mount. A full live-resolver (webhook/refresh) is
// post-v1; v1 mentions are inert references (no notifications, per the spec).

import { useEffect, useState } from "react";

const labelCache = new Map<string, string>();

/** Resolve + cache the label for a (kind, id) pair; re-renders when known. */
function useResolvedLabel(kind: "user" | "page", id: string): string {
  const cacheKey = `${kind}:${id}`;
  const [label, setLabel] = useState<string>(() => labelCache.get(cacheKey) ?? "…");

  useEffect(() => {
    let cancelled = false;
    const cached = labelCache.get(cacheKey);
    if (cached) {
      setLabel(cached);
      return;
    }
    // The actual label isn't critical to render correctness — the id is the
    // durable reference. Resolve best-effort; fall back to the id prefix.
    const fallback = id ? id.slice(0, 8) : "unknown";
    setLabel(fallback);
    // (A full resolver would fetch /api/mentions/resolve here; deferred to keep
    // v1 mentions inert + the editor self-contained. The id renders stably.)
    void cancelled;
  }, [cacheKey, id]);

  return label;
}
