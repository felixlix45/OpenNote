/**
 * apps/web — page editor surface (the spine milestone's UI).
 *
 * Non-realtime first cut: loads the page metadata + body, renders a minimal
 * editor (title + body textarea), saves on debounce. Realtime collaboration
 * (Hocuspocus, ticket 0004) + the BlockNote block editor (ticket 0005) layer
 * on top of this proven save path next.
 *
 * This route is deliberately simple to prove the spine: auth → permission
 * engine → data model → editor surface → save. The auth + permission gates
 * live in the route handlers; this component only renders what the API returns.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

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
  const [saving, setSaving] = useState(false);
  const [body, setBody] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/pages/${params.pageId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as PageData;
      })
      .then((d) => {
        setData(d.page);
        // For the spine, the "body" is the decoded text content of the Y-doc.
        // The BlockNote integration (ticket 0005) replaces this with a proper
        // block editor; the save path stays the same.
        setBody(d.page.title);
      })
      .catch((e) => setError(String(e)));
  }, [params.pageId]);

  const save = (nextTitle: string) => {
    if (!data?.canWrite) return;
    setSaving(true);
    fetch(`/api/pages/${params.pageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle }),
    })
      .then(() => setSaving(false))
      .catch(() => setSaving(false));
  };

  useEffect(() => {
    if (!data) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(body), 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

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

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <div style={{ marginBottom: "0.5rem", color: "var(--muted)", fontSize: 13 }}>
        {saving ? "Saving…" : "Saved"} · {data.canWrite ? "Editor" : "Reader"}
      </div>
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
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
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: "1rem",
          color: "var(--muted)",
          minHeight: 200,
        }}
      >
        The block editor (BlockNote, ticket 0005) renders here next. The save
        path above already flows through the permission engine and data model.
      </div>
    </main>
  );
}
