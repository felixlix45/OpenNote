/**
 * @opennote/shared — types + Zod schemas shared end-to-end (ticket 0009).
 *
 * Single source for domain enums, the permission model's value types, and the
 * Zod request/response shapes consumed at API boundaries. Types are derived
 * from the Zod schemas so client + server agree.
 *
 * The authoritative definitions of *meaning* live in CONTEXT.md; this file
 * only encodes them.
 */

export * from "./enums.js";
export * from "./permission.js";
export * from "./pages.js";
export * from "./shares.js";
export * from "./attachments.js";
export * from "./search.js";
export * from "./editor.js";
export * from "./url-safety.js";
export * from "./attachment-policy.js";
