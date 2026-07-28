/**
 * apps/web — POST /api/invites/:token/accept : accept a workspace invite
 * (ticket 0006). Calls the previously-dead acceptInvite (🔒 HIGH #5: CSPRNG
 * token match, expiring, single-use, email-control verify).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/services";
import { acceptInvite } from "@opennote/auth";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const { token } = await context.params;

  const result = await acceptInvite(db, {
    token,
    acceptingUserId: user.id,
    acceptingUserEmailVerified: user.emailVerified,
    acceptingUserEmail: user.email,
  });

  if (!result.ok) {
    // Map the rejection reason to a status. All are "the invite is invalid" from
    // the user's perspective; the reason is for logging.
    const status =
      result.reason === "email_not_verified" ? 403 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    workspaceId: result.workspaceId,
    role: result.role,
  });
}
