/**
 * apps/web — GET/POST /api/workspaces : list + create workspaces (ticket 0006).
 *
 * Any authenticated user can create a workspace (becomes its Owner). GET lists
 * the workspaces the user is a member of + their role in each.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, createWorkspace, listUserWorkspaces } from "@/lib/services";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

const CreateWorkspaceBody = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric + dashes"),
});

export async function GET() {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const workspaces = await listUserWorkspaces(db, user.id);
  return NextResponse.json({ workspaces });
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const parsed = CreateWorkspaceBody.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const workspace = await createWorkspace(db, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      ownerId: user.id,
    });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (err) {
    // Unique slug violation → 409.
    return NextResponse.json({ error: "slug_taken" }, { status: 409 });
  }
}
