/**
 * apps/web — the BlockNote collaborative editor (ticket 0005 core).
 *
 * Mounts BlockNote over a Y-doc backed by a HocuspocusProvider, connecting to
 * the realtime server (same-origin via the Caddy/proxy path so the session
 * cookie flows). Read-only users get a non-editable editor (the server's
 * readOnly enforcement in onAuthenticate/onChange is the real gate; this is
 * the UX surface).
 *
 * This is the core: default BlockNote schema (paragraph, headings, lists, todo,
 * quote, code, divider, table, image) + the 6 marks + color/highlight (req #5)
 * + markdown input/paste (req #6). Custom blocks (callout/toggle/embed/mention/
 * sub-page) layer on in tickets via the schema's `blockSpecs` override — kept
 * separate so this file stays the stable core.
 *
 * Client-only: BlockNote touches the DOM and must not SSR. Mounted via a
 * dynamic import (ssr: false) from the page route.
 */
"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { BlockNoteView } from "@blocknote/shadcn";
import { useCreateBlockNote } from "@blocknote/react";
import { withCollaboration } from "@blocknote/core/yjs";
import { buildEditorSchema } from "./custom-blocks";
import { uploadAttachment } from "./upload";
import { MentionSuggestionMenu } from "./MentionSuggestionMenu";
// BlockNote's CSS — pulls in the editor + shadcn theme.
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

export interface OpenNoteEditorProps {
  pageId: string;
  workspaceId: string;
  /** base64-encoded Y.encodeStateAsUpdate(doc) — seeds fast first paint. */
  docStateBase64: string | null;
  /** From the page's effective permission; readers get a non-editable editor. */
  editable: boolean;
  /**
   * The realtime WS URL (NEXT_PUBLIC_REALTIME_WS_URL). Same-origin /collab path
   * in dev/prod behind the proxy; the session cookie rides the upgrade.
   */
  realtimeWsUrl: string;
}

export default function OpenNoteEditor({
  pageId,
  workspaceId,
  docStateBase64,
  editable,
  realtimeWsUrl,
}: OpenNoteEditorProps) {
  // One Y-doc + provider per page. Kept in refs so they survive re-renders and
  // are torn down exactly once on unmount.
  const doc = useMemo(() => new Y.Doc(), []);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const [connected, setConnected] = useState(false);

  // Seed the doc from the REST snapshot for fast first paint, BEFORE the
  // provider connects (avoids a flash of empty content while the WS handshake
  // + extension-database fetch round-trips).
  useEffect(() => {
    if (!docStateBase64) return;
    try {
      const bytes = Uint8Array.from(atob(docStateBase64), (c) => c.charCodeAt(0));
      Y.applyUpdate(doc, bytes, "rest-snapshot");
    } catch {
      // Bad snapshot → let the provider's fetch populate it.
    }
  }, [docStateBase64, doc]);

  // Construct the provider. The doc name `page:{uuid}` is the ONLY page
  // identity the realtime server trusts (🔒 0010 #3).
  useEffect(() => {
    // Resolve the WS URL: a relative path (/collab) becomes ws(s)://<current
    // origin>/collab so the cookie + origin match the realtime origin check.
    const url = resolveWsUrl(realtimeWsUrl);
    const provider = new HocuspocusProvider({
      url,
      name: `page:${pageId}`,
      document: doc,
      onStatus: ({ status }) => setConnected(status === "connected"),
    });
    providerRef.current = provider;
    return () => {
      provider.destroy();
      providerRef.current = null;
    };
  }, [pageId, doc, realtimeWsUrl]);

  // The editor. withCollaboration wraps the editor options with the Yjs
  // collaboration config. BlockNote's `provider` field is structurally
  // `{ awareness: YjsAwareness }` — we pass the Hocuspocus provider's awareness
  // directly (it relays cursor state). The fragment is the named XML slot
  // BlockNote stores blocks in; `user` drives cursor labels.
  const provider = providerRef.current;
  const schema = useMemo(() => buildEditorSchema(), []);
  const editor = useCreateBlockNote(
    provider?.awareness
      ? withCollaboration({
          schema,
          // BlockNote's default image block calls uploadFile when a user
          // drags/pastes an image. Wire it to the same presigned-upload flow as
          // file blocks (permission gate + S3 + HEAD-verify + signed-GET URL).
          uploadFile: async (file) => {
            const result = await uploadAttachment(pageId, file);
            return result?.url ?? "";
          },
          collaboration: {
            provider: { awareness: provider.awareness },
            fragment: doc.getXmlFragment("document-store"),
            user: { name: "You", color: "#2563eb" },
            showCursorLabels: "activity",
          },
        })
      : { schema },
    [provider, schema],
  );

  // Insert a sub-page: backend creates the pages row with parent_page_id (the
  // edge the editor must NOT set itself, decision #2), returns the pageId, then
  // we insert a subpage block referencing it. Read-only users can't.
  const insertSubPage = async () => {
    if (!editable) return;
    try {
      const res = await fetch(`/api/pages/${pageId}/subpages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });
      if (!res.ok) return;
      const { page } = (await res.json()) as { page: { id: string; title: string } };
      editor.insertBlocks(
        [{ type: "subpage", props: { pageId: page.id, title: page.title || "Untitled" } }],
        editor.getTextCursorPosition().block,
        "after",
      );
    } catch {
      // Surface is the toolbar; a failed insert is a no-op for v1.
    }
  };

  // Upload a file: presigned-PUT flow (ticket 0007). Hidden <input type=file>
  // triggers the 3-step flow: request presigned PUT → upload bytes → /complete
  // (HEAD-verify) → insert a file block. Read-only users can't.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!editable) return;
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be picked again
    if (!file) return;
    // Shared presigned-upload flow → insert a file block referencing the attachment.
    const result = await uploadAttachment(pageId, file);
    if (!result) return;
    editor.insertBlocks(
      [
        {
          type: "file",
          props: {
            attachmentId: result.attachmentId,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          },
        },
      ],
      editor.getTextCursorPosition().block,
      "after",
    );
  };

  return (
    <div className="opennote-editor" data-workspace={workspaceId}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          fontSize: 12,
          color: "var(--muted)",
          padding: "0.25rem 0",
        }}
      >
        <span aria-hidden>{connected ? "● Connected" : "○ Connecting…"}</span>
        {editable ? (
          <>
            <button
              type="button"
              onClick={insertSubPage}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.15rem 0.5rem",
                cursor: "pointer",
                color: "var(--fg)",
                fontSize: 12,
              }}
              title="Create a nested sub-page"
            >
              + Sub-page
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.15rem 0.5rem",
                cursor: "pointer",
                color: "var(--fg)",
                fontSize: 12,
              }}
              title="Upload a file"
            >
              📎 File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={onFilePicked}
              style={{ display: "none" }}
            />
          </>
        ) : null}
      </div>
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme="light"
        // Slash menu + drag handle = BlockNote defaults (decision #3).
      >
        {/* @mention popup: triggers on @, queries the permission-scoped typeaheads */}
        <MentionSuggestionMenu editor={editor} workspaceId={workspaceId} />
      </BlockNoteView>
    </div>
  );
}

/** Turn a relative WS path into an absolute ws(s) URL using the page origin. */
function resolveWsUrl(realtimeWsUrl: string): string {
  if (/^wss?:\/\//.test(realtimeWsUrl)) return realtimeWsUrl; // already absolute
  // Relative path (e.g. /collab) → ws(s)://<origin>/collab.
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${realtimeWsUrl}`;
}
