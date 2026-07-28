/**
 * apps/web — GET /api/search?q=…&workspaceId=… : the cmd+K palette backend
 * (ticket 0008).
 *
 * 🔒 SECURITY-REVIEW 0008: permission-scoped inline. Reuses {@link searchPages},
 * which joins against the effective_permission() CTE (owner/admin bypass) so
 * results never include pages the user can't read. No cross-tenant title/snippet
 * leaks. Result count capped by SEARCH_MAX_RESULTS.
 *
 * Freshness (ticket 0008 #3): body_text + the generated search_tsv lag the
 * Y-doc by the realtime save-debounce window (~2s idle / 10s max, ticket 0004).
 * Search finds text "soon after" it's typed, not per-keystroke.
 */
import { NextResponse } from "next/server";
import { SearchInput } from "@opennote/shared";
import { db, searchPages, env } from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

export async function GET(request: Request) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const url = new URL(request.url);
  const parsed = SearchInput.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? "",
    query: url.searchParams.get("q") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const results = await searchPages(db, {
    workspaceId: parsed.data.workspaceId,
    userId: user.id,
    query: parsed.data.query,
    maxResults: env.SEARCH_MAX_RESULTS,
    maxNestingDepth: env.MAX_NESTING_DEPTH,
  });

  return NextResponse.json({
    results: results.map((r) => ({
      pageId: r.id,
      title: r.title,
      rank: r.rank,
      snippet: r.snippet,
    })),
    truncated: results.length >= env.SEARCH_MAX_RESULTS,
  });
}
