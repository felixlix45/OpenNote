/**
 * apps/web — GET /api/mentions/pages : @page mention typeahead (ticket 0005).
 *
 * 🔒 SECURITY-REVIEW 0005 #3: permission-scoped. Reuses {@link searchPages},
 * which joins against the effective_permission() CTE (with the owner/admin
 * bypass) so results never include pages the user can't read. No cross-tenant
 * title leaks. This is the same scoping as the cmd+K palette (ticket 0008).
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
    pages: results.map((r) => ({
      pageId: r.id,
      title: r.title,
    })),
  });
}
