/**
 * apps/web — GET /api/me : the current user's identity for the sidebar.
 *
 * Returns id/email/name/image. The sidebar profile bar uses this; the editor
 * and other surfaces already get identity implicitly via authenticated calls.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { UnauthenticatedError } from "@/lib/session";

export async function GET() {
  let user;
  try {
    user = await getSessionUser();
    if (!user) throw new UnauthenticatedError();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    },
  });
}
