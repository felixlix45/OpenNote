import { z } from "zod";

/**
 * Search request (ticket 0008). Postgres FTS, title-weighted, with **inline**
 * permission scoping — the query joins against the effective-permission CTE so
 * a user never sees titles/snippets for pages they can't read (🔒
 * SECURITY-REVIEW: centralize the permission filter).
 *
 * Result count is capped by `SEARCH_MAX_RESULTS` (default 20, env-tunable).
 */
export const SearchInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(512).trim(),
});
export type SearchInput = z.infer<typeof SearchInput>;

export const SearchResult = z.object({
  pageId: z.string().uuid(),
  title: z.string(),
  /** Path: workspace root → … → page (breadcrumb). Empty segments omitted. */
  breadcrumb: z.array(z.string()),
  /** ts_rank, higher = more relevant. */
  rank: z.number(),
  /**
   * Best matching text snippet, already permission-scoped (the snippet comes
   * from the same FTS query, never from a separate unscoped fetch).
   */
  snippet: z.string(),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({
  results: SearchResult.array(),
  /** Whether the result cap was hit (UI may prompt to refine). */
  truncated: z.boolean(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
