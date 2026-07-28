/**
 * apps/web — @mention suggestion popup (ticket 0005 Layer 5b completion).
 *
 * Registers the `@` trigger character via BlockNote's SuggestionMenuController.
 * When the user types `@`, it queries BOTH typeahead endpoints (users + pages,
 * permission-scoped 🔒 0005 #3) and shows matches. Selecting inserts the mention
 * inline content ({ kind, id }) — the label resolves fresh at render so renames
 * propagate.
 *
 * Rendered as a child of BlockNoteView (controllers mount inside the editor).
 */
"use client";

import { SuggestionMenuController, type DefaultReactSuggestionItem } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";

interface MentionItem extends DefaultReactSuggestionItem {
  kind: "user" | "page";
  id: string;
}

export function MentionSuggestionMenu({
  editor,
  workspaceId,
}: {
  // Loosely typed — the editor carries a custom schema; we only call
  // insertInlineContent, which is schema-agnostic for our mention type.
  editor: BlockNoteEditor<any, any, any>;
  workspaceId: string;
}) {
  return (
    <SuggestionMenuController
      triggerCharacter="@"
      getItems={async (query) => {
        if (!query.trim() || !workspaceId) return [];
        // Query both @user and @page typeaheads in parallel (both permission-scoped).
        const [usersRes, pagesRes] = await Promise.all([
          fetch(
            `/api/mentions/users?workspaceId=${workspaceId}&q=${encodeURIComponent(query)}`,
          ).then((r) => r.json().catch(() => ({ users: [] }))),
          fetch(
            `/api/mentions/pages?workspaceId=${workspaceId}&q=${encodeURIComponent(query)}`,
          ).then((r) => r.json().catch(() => ({ pages: [] }))),
        ]);
        const users = (usersRes as { users: Array<{ id: string; name: string | null; email: string }> }).users;
        const pages = (pagesRes as { pages: Array<{ pageId: string; title: string }> }).pages;
        return [
          ...users.map((u): MentionItem => ({
            kind: "user",
            id: u.id,
            title: u.name || u.email,
            subtext: u.email,
            onItemClick: () =>
              editor.insertInlineContent([
                {
                  type: "mention",
                  props: { kind: "user", id: u.id },
                },
              ]),
          })),
          ...pages.map((p): MentionItem => ({
            kind: "page",
            id: p.pageId,
            title: p.title || "Untitled",
            subtext: "Page",
            onItemClick: () =>
              editor.insertInlineContent([
                {
                  type: "mention",
                  props: { kind: "page", id: p.pageId },
                },
              ]),
          })),
        ];
      }}
    />
  );
}
