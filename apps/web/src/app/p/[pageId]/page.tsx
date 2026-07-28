/**
 * apps/web — page route that mounts the BlockNote editor (ticket 0005).
 *
 * Loads the page metadata + Y-doc snapshot via the permission-gated API, then
 * mounts {@link OpenNoteEditor} dynamically (BlockNote is client-only — can't
 * SSR). The editor connects to the realtime server for live collaboration; the
 * snapshot is just for fast first paint.
 */
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

// BlockNote touches the DOM/ProseMirror — load the editor client-side only.
const OpenNoteEditor = dynamic(() => import("@/components/editor/OpenNoteEditor"), {
  ssr: false,
  loading: () => <p style={{ color: "var(--muted)" }}>Loading editor…</p>,
});

interface PageData {
  page: {
    id: string;
    workspaceId: string;
    title: string;
    icon: string | null;
    docStateBase64: string | null;
    canWrite: boolean;
  };
}

export default function PageEditor() {
  const params = useParams<{ pageId: string }>();
  const [data, setData] = useState<PageData["page"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titleSaving, setTitleSaving] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    fetch(`/api/pages/${params.pageId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as PageData;
      })
      .then((d) => {
        setData(d.page);
        setTitle(d.page.title);
      })
      .catch((e) => setError(String(e)));
  }, [params.pageId]);

  // Title save (debounced). The body is persisted via the realtime server
  // (Y-doc → page_docs.state); the title is a denormalized mirror refreshed
  // from the doc, but a user can also set it directly here.
  useEffect(() => {
    if (!data || title === data.title) return;
    setTitleSaving(true);
    const id = setTimeout(() => {
      fetch(`/api/pages/${params.pageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
        .then(() => setTitleSaving(false))
        .catch(() => setTitleSaving(false));
    }, 1000);
    return () => clearTimeout(id);
  }, [title, data, params.pageId]);

  if (error) {
    return (
      <main style={{ padding: "2rem" }}>
        <h1>Couldn&apos;t load this page</h1>
        <p style={{ color: "var(--muted)" }}>{error}</p>
        <p>
          Sign in via <a href="/api/auth/sign-in">/api/auth/sign-in</a> first.
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main style={{ padding: "2rem" }}>
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </main>
    );
  }

  const realtimeWsUrl =
    process.env.NEXT_PUBLIC_REALTIME_WS_URL ?? "/collab";

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <div style={{ marginBottom: "0.5rem", color: "var(--muted)", fontSize: 13 }}>
        {titleSaving ? "Saving title…" : "Saved"} · {data.canWrite ? "Editor" : "Reader"}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        readOnly={!data.canWrite}
        placeholder="Untitled"
        style={{
          width: "100%",
          fontSize: 30,
          fontWeight: 700,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--fg)",
          padding: "0.25rem 0",
          marginBottom: "1rem",
        }}
      />
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
        <OpenNoteEditor
          pageId={data.id}
          workspaceId={data.workspaceId}
          docStateBase64={data.docStateBase64}
          editable={data.canWrite}
          realtimeWsUrl={realtimeWsUrl}
        />
      </div>
    </main>
  );
}
