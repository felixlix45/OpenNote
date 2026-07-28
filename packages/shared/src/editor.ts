/**
 * @opennote/shared — editor block schema + mention contracts (ticket 0005).
 *
 * These are the wire types for the custom BlockNote blocks (sub-page, file,
 * callout, toggle, mention, embed) and the @mention typeahead. They're shared
 * between the editor (client) and the typeahead endpoints (server) so the two
 * agree on shapes. The BlockNote-specific ProseMirror schema lives in apps/web;
 * these are the attribute/IO types that cross the boundary.
 */
import { z } from "zod";

/** A workspace member, for @user mention typeahead results. */
export const Member = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.enum(["guest", "member", "admin", "owner"]),
});
export type Member = z.infer<typeof Member>;

/** @user mention typeahead request. */
export const UserMentionInput = z.object({
  workspaceId: z.string().uuid(),
  q: z.string().min(1).max(128),
});
export type UserMentionInput = z.infer<typeof UserMentionInput>;

/** @user mention typeahead response. */
export const UserMentionResponse = z.object({
  users: Member.array(),
});
export type UserMentionResponse = z.infer<typeof UserMentionResponse>;

/** @page mention typeahead reuses the search shapes (search.ts). */

/**
 * Custom-block attribute shapes. These live inside the Y-doc as block attrs;
 * they're also the shapes the slash-menu insert commands produce.
 */

/** Sub-page block: references a nested page (backend owns the parent edge). */
export const SubPageAttrs = z.object({
  pageId: z.string().uuid(),
  /** Snapshot of the title at insert time; resolved fresh at render. */
  title: z.string().default(""),
});
export type SubPageAttrs = z.infer<typeof SubPageAttrs>;

/** File block: references an attachment row (couples to ticket 0007). */
export const FileAttrs = z.object({
  attachmentId: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.bigint(),
});
export type FileAttrs = z.infer<typeof FileAttrs>;

/** Callout block: an emphasized note box with an emoji icon. */
export const CalloutAttrs = z.object({
  icon: z.string().default("💡"),
  color: z.enum(["blue", "green", "yellow", "red", "gray"]).default("gray"),
});
export type CalloutAttrs = z.infer<typeof CalloutAttrs>;

/** Toggle block: a collapsible summary with nested content. */
export const ToggleAttrs = z.object({
  /** Collapsed state is per-user in v1? No — persisted in the doc for v1. */
  collapsed: z.boolean().default(false),
});
export type ToggleAttrs = z.infer<typeof ToggleAttrs>;

/**
 * Mention (inline): an @user or @page reference. Stored as a mark so it flows
 * with the text. `kind` discriminates the two; the id resolves at render time
 * so renames propagate (the doc never stores the display name durably).
 */
export const MentionAttrs = z.object({
  kind: z.enum(["user", "page"]),
  id: z.string().uuid(),
});
export type MentionAttrs = z.infer<typeof MentionAttrs>;

/** Embed block: a sandboxed iframe from an allowlisted provider. */
export const EmbedAttrs = z.object({
  /** The original URL the user pasted (kept for editing). */
  url: z.string().url(),
  /** The resolved embed URL (allowlisted provider, https). Render this in src. */
  embedUrl: z.string().url(),
  provider: z.string(),
});
export type EmbedAttrs = z.infer<typeof EmbedAttrs>;
