import { z } from "zod";

/**
 * A UUID v4 string at the API boundary — Prisma's `@db.Uuid` maps to this shape.
 * Used for all entity ids (users, pages, folders, workspaces, …). Resource ids
 * and other entity ids share this type intentionally; the permission engine
 * prevents cross-entity confusion at the query layer, not the type layer.
 */
export const entityId = z.string().uuid();
export type EntityId = z.infer<typeof entityId>;

/** ---------- Page tree (ticket 0003) ---------- */

export const Folder = z.object({
  id: entityId,
  workspaceId: entityId,
  parentId: entityId.nullable(),
  name: z.string().min(1).max(255),
  createdBy: entityId,
  deletedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Folder = z.infer<typeof Folder>;

/**
 * A page row. `title` and `bodyText` are denormalized mirrors refreshed from
 * the Y-doc on save (ticket 0003 decision #2). The Y-doc itself is the source
 * of truth for body content.
 */
export const Page = z.object({
  id: entityId,
  workspaceId: entityId,
  folderId: entityId.nullable(),
  parentPageId: entityId.nullable(),
  title: z.string().default(""),
  bodyText: z.string().default(""),
  icon: z.string().nullable(),
  createdBy: entityId,
  deletedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Page = z.infer<typeof Page>;

/** Create a top-level page (in a folder) — the spine's first editor surface. */
export const CreatePageInput = z.object({
  workspaceId: entityId,
  folderId: entityId.nullable().default(null),
  title: z.string().max(512).default(""),
});
export type CreatePageInput = z.infer<typeof CreatePageInput>;

/** Move a page (or re-parent) — server owns the tree edge (ticket 0005). */
export const UpdatePageInput = z.object({
  title: z.string().max(512).optional(),
  icon: z.string().max(64).nullable().optional(),
  folderId: entityId.nullable().optional(),
  parentPageId: entityId.nullable().optional(),
});
export type UpdatePageInput = z.infer<typeof UpdatePageInput>;

/**
 * Sidebar children response — the flat list of folders + pages under one parent
 * (ticket 0003 hot path). The sidebar tree is built client-side by recursing
 * into `listFolderChildren` per expanded folder, not from a pre-materialized
 * nested tree (keeps the payload small for large workspaces).
 */
export const SidebarChildren = z.object({
  folders: Folder.array(),
  pages: Page.array(),
});
export type SidebarChildren = z.infer<typeof SidebarChildren>;
