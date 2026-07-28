/**
 * apps/web — custom BlockNote blocks: callout, toggle, embed, subpage
 * (ticket 0005).
 *
 * Each is a ProseMirror node spec (createReactBlockSpec) + a React render
 * component. The schema is composed in {@link buildEditorSchema} by spreading
 * the BlockNote defaults + these.
 *
 * 🔒 Security (SECURITY-REVIEW 0005 #1, #2): the embed block renders an iframe,
 * so its render component calls the Layer 1 url-safety helpers AT RENDER TIME
 * (defense in depth — the editor schema alone isn't trusted). A non-allowlisted
 * URL or non-https scheme renders nothing, never the raw iframe.
 */
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import type { ReactNode } from "react";
import { resolveEmbed, buildEmbedSandbox, sanitizeUrl } from "@opennote/shared";
import { Mention } from "./mention-inline-content";

// ---------------------------------------------------------------------------
// Callout — an emphasized note box with an emoji icon + color.
// ---------------------------------------------------------------------------

const calloutColors = {
  blue: { bg: "#eff6ff", border: "#3b82f6" },
  green: { bg: "#f0fdf4", border: "#22c55e" },
  yellow: { bg: "#fefce8", border: "#eab308" },
  red: { bg: "#fef2f2", border: "#ef4444" },
  gray: { bg: "#f9fafb", border: "#9ca3af" },
} as const;

export const Callout = createReactBlockSpec(
  {
    type: "callout" as const,
    propSchema: {
      icon: { default: "💡" },
      color: {
        default: "gray",
        values: ["blue", "green", "yellow", "red", "gray"],
      },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => {
      const props = block.props as { icon: string; color: keyof typeof calloutColors };
      const c = calloutColors[props.color] ?? calloutColors.gray;
      return (
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            padding: "0.875rem 1rem",
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: 8,
            margin: "0.5rem 0",
          }}
        >
          <span style={{ fontSize: 18, lineHeight: "1.5rem" }}>{props.icon}</span>
          <div ref={contentRef} style={{ flex: 1 }} />
        </div>
      );
    },
  },
);

// ---------------------------------------------------------------------------
// Toggle — a collapsible summary line with nested content.
// ---------------------------------------------------------------------------

export const Toggle = createReactBlockSpec(
  {
    type: "toggle" as const,
    propSchema: {
      collapsed: { default: false },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef, editor }) => {
      const props = block.props as { collapsed: boolean };
      // Toggle collapse by flipping the prop. Read-only users can't toggle
      // (editor.isEditable is a getter, not a method).
      const toggle = () => {
        if (!editor.isEditable) return;
        editor.updateBlock(block, {
          type: "toggle",
          props: { collapsed: !props.collapsed },
        });
      };
      return (
        <div style={{ display: "flex", gap: "0.25rem", margin: "0.25rem 0" }}>
          <button
            type="button"
            onClick={toggle}
            aria-label={props.collapsed ? "Expand" : "Collapse"}
            style={{
              background: "none",
              border: "none",
              cursor: editor.isEditable ? "pointer" : "default",
              fontSize: 12,
              color: "var(--muted)",
              padding: 0,
              lineHeight: "1.5rem",
            }}
          >
            {props.collapsed ? "▶" : "▼"}
          </button>
          <div ref={contentRef} style={{ flex: 1 }} />
        </div>
      );
    },
  },
);

// ---------------------------------------------------------------------------
// Embed — a sandboxed iframe from an allowlisted provider (🔒 #1, #2).
// ---------------------------------------------------------------------------

export const Embed = createReactBlockSpec(
  {
    type: "embed" as const,
    // The raw URL is stored; the embed URL is resolved at render (so allowlist
    // changes / provider URL-shape fixes apply to existing blocks).
    propSchema: {
      url: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const props = block.props as { url: string };
      // 🔒 Defense in depth: resolve AT RENDER TIME. A non-allowlisted provider,
      // a non-https scheme, or a dangerous scheme (javascript:/data:) renders
      // the placeholder, never the iframe. Don't trust the editor schema alone.
      const resolved = props.url ? resolveEmbed(props.url) : null;
      if (!resolved) {
        return <EmbedPlaceholder url={props.url} invalid={Boolean(props.url)} />;
      }
      return (
        <div
          style={{
            position: "relative",
            paddingBottom: "56.25%" /* 16:9 */,
            height: 0,
            margin: "0.5rem 0",
            borderRadius: 8,
            overflow: "hidden",
            background: "#000",
          }}
        >
          <iframe
            src={resolved.url}
            title={`Embed from ${resolved.provider}`}
            // 🔒 req #1: restrictive sandbox (buildEmbedSandbox never combines
            // allow-scripts + allow-same-origin).
            sandbox={buildEmbedSandbox(resolved.provider)}
            allow="fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: 0,
            }}
          />
        </div>
      );
    },
  },
);

function EmbedPlaceholder({ url, invalid }: { url: string; invalid: boolean }): ReactNode {
  // 🔒 sanitizeUrl for the link href too (never a raw javascript: link).
  const safeHref = url ? sanitizeUrl(url) : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "1rem",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        color: "var(--muted)",
        margin: "0.5rem 0",
        fontSize: 14,
      }}
    >
      <span>🔗</span>
      {invalid ? (
        <span>
          Unsupported embed URL{safeHref ? <>: <a href={safeHref}>{url}</a></> : null}.
          Allowed: YouTube, Vimeo, Figma, Loom (https only).
        </span>
      ) : (
        <span>Empty embed — paste a YouTube / Vimeo / Figma / Loom URL.</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-page — a block that links to a nested page (decision #2: backend owns
// the parent edge; this block just references the pageId the backend returned).
// ---------------------------------------------------------------------------

export const SubPage = createReactBlockSpec(
  {
    type: "subpage" as const,
    propSchema: {
      pageId: { default: "" },
      title: { default: "Untitled" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const props = block.props as { pageId: string; title: string };
      // Navigate to the nested page on click. The pageId is the immutable pages
      // PK; the title is a snapshot refreshed from the doc on save.
      const go = () => {
        if (props.pageId) window.location.assign(`/p/${props.pageId}`);
      };
      return (
        <div
          onClick={go}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            margin: "0.25rem 0",
            borderRadius: 8,
            cursor: props.pageId ? "pointer" : "default",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            fontSize: 15,
          }}
          title={props.pageId ? "Open sub-page" : "Sub-page not yet created"}
        >
          <span>📄</span>
          <span>{props.title || "Untitled"}</span>
        </div>
      );
    },
  },
);

// ---------------------------------------------------------------------------
// Schema composition: BlockNote defaults + our custom blocks.
// ---------------------------------------------------------------------------

/**
 * Build the editor schema with the default blocks plus callout, toggle, embed,
 * and subpage. createReactBlockSpec returns a FACTORY, so each custom block
 * must be called (e.g. `Callout()`) to instantiate the spec.
 */
export function buildEditorSchema() {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      callout: Callout(),
      toggle: Toggle(),
      embed: Embed(),
      subpage: SubPage(),
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      mention: Mention,
    },
  });
}
