/**
 * apps/web — GET/POST /api/workspaces/:workspaceId/invites : list + create
 * invites (ticket 0006). Only owner/admin can manage invites.
 *
 * Create: generates a CSPRNG token (🔒 HIGH #5), 7-day TTL, optionally emails
 * it via SMTP. Returns the invite + the token (shown in-UI if SMTP unconfigured).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  permissions,
  smtp,
  env,
} from "@/lib/services";
import { generateInviteToken, INVITE_TTL_MS } from "@opennote/auth";
import { requireSessionUser, UnauthenticatedError } from "@/lib/session";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

const CreateInviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["guest", "member", "admin"]).default("member"),
});

/** Check the caller is owner/admin of the workspace. */
async function requireAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return member?.role === "owner" || member?.role === "admin";
}

export async function GET(_request: Request, context: RouteContext) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const { workspaceId } = await context.params;
  if (!(await requireAdmin(workspaceId, user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const invites = await db.workspaceInvite.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ invites });
}

export async function POST(request: Request, context: RouteContext) {
  let user;
  try {
    user = await requireSessionUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }

  const { workspaceId } = await context.params;
  if (!(await requireAdmin(workspaceId, user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = CreateInviteBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 🔒 HIGH #5: CSPRNG token, 7-day TTL.
  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invite = await db.workspaceInvite.create({
    data: {
      workspaceId,
      email: parsed.data.email,
      role: parsed.data.role,
      token,
      createdById: user.id,
      expiresAt,
    },
  });

  // Email the invite if SMTP is configured; otherwise the token is shown in-UI.
  if (smtp.isConfigured) {
    const inviteUrl = `${env.APP_URL}/api/invites/${token}/accept`;
    await smtp.send({
      to: parsed.data.email,
      subject: "You're invited to an OpenNote workspace",
      text: `You've been invited. Open this link to accept:\n${inviteUrl}`,
    });
  }

  // Return the token so the UI can show it (especially when SMTP is unconfigured).
  return NextResponse.json({ invite, token }, { status: 201 });
}
