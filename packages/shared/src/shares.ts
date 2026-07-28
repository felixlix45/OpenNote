import { z } from "zod";
export { entityId } from "./pages.js";

/**
 * Share input shape (CONTEXT.md §Shares; ticket 0003). Exactly one of
 * `principalUserId` / `principalGroupId` must be set — enforced here and by a
 * DB CHECK.
 *
 * 🔒 Tenant isolation (SECURITY-REVIEW HIGH #1): the API layer must additionally
 * assert that the resource identified by `(resourceType, resourceId)` belongs
 * to `workspaceId` before this input is ever written or read. The Zod schema
 * carries the workspaceId so the resolver can cross-check; it does not by
 * itself guarantee the resource is in that workspace.
 */

// Base object (before the exactly-one refine) — extended by `Share` below.
const ShareBase = z.object({
  workspaceId: z.string().uuid(),
  resourceType: z.enum(["folder", "page"]),
  resourceId: z.string().uuid(),
  principalUserId: z.string().uuid().nullable().optional(),
  principalGroupId: z.string().uuid().nullable().optional(),
  level: z.enum(["reader", "commenter", "editor"]),
});

/** A persisted Share row (the base + server-managed fields). */
export const Share = ShareBase.extend({
  id: z.string().uuid(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
});
export type Share = z.infer<typeof Share>;

/** Input for creating a Share — base + exactly-one-principal refinement. */
export const ShareInput = ShareBase.refine(
  (v) =>
    (v.principalUserId != null && v.principalGroupId == null) ||
    (v.principalUserId == null && v.principalGroupId != null),
  {
    message:
      "Exactly one of principalUserId / principalGroupId must be set (CHECK exactly-one).",
  },
);
export type ShareInput = z.infer<typeof ShareInput>;
