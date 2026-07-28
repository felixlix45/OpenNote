/**
 * @opennote/auth — invite token + invite-accept logic (ticket 0006).
 *
 * 🔒 SECURITY-REVIEW HIGH #5: invite tokens are an account-onboarding path =
 * account-takeover vector if predictable. All tokens are CSPRNG-generated,
 * expiring, revocable, and single-use on accept.
 *
 * 🔒 HIGH #5 (email-control verify on accept): accepting an invite sent to
 * email E requires the accepting account to control E. We enforce this here
 * — the accepting user's email must equal the invite's email AND the account
 * must be email-verified (or verification is forced at accept time).
 */
import { randomUUID, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@opennote/db";

/** Invite-token lifetime: 7 days (ticket 0006). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a cryptographically unguessable invite token.
 *
 * Format: `<randomUUID>.<randomBytes hex>` — 256 bits of entropy total, urlsafe.
 * We combine a UUID (human-distinguishable prefix) with raw CSPRNG bytes so the
 * token is unguessable and not derivable from any DB id or timestamp.
 * 🔒 Never use DB ids or timestamps as tokens.
 */
export function generateInviteToken(): string {
  const salt = randomUUID();
  const secret = randomBytes(32).toString("hex");
  return `${salt}.${secret}`;
}

export interface AcceptInviteInput {
  /** The opaque token from the invite URL. */
  token: string;
  /** The authenticated user accepting the invite. */
  acceptingUserId: string;
  /** Whether the accepting user's email is currently verified. */
  acceptingUserEmailVerified: boolean;
  /** The accepting user's email. */
  acceptingUserEmail: string;
}

export type AcceptInviteResult =
  | { ok: true; workspaceId: string; role: string }
  | { ok: false; reason: InviteRejectReason };

export type InviteRejectReason =
  | "not_found" // no invite with this token (or already revoked)
  | "expired" // past expires_at
  | "already_accepted" // single-use: accepted_at set
  | "email_mismatch" // invite email ≠ accepting email (🔒 HIGH #5)
  | "email_not_verified"; // accepting account hasn't verified control of the email

/**
 * Accept an invite transactionally. Enforces all of HIGH #5's requirements:
 * CSPRNG token match, not-expired, not-already-accepted, email-control verify.
 *
 * On success, the user is added to the workspace at the invite's role and the
 * invite is marked accepted (single-use). Idempotency is *not* provided — a
 * second accept with the same token returns `already_accepted`.
 */
export async function acceptInvite(
  prisma: PrismaClient,
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<AcceptInviteResult> => {
    // Look up by token. We don't reveal whether the token exists vs. is
    // expired vs. already accepted to the caller uniformly — they get a
    // generic reason for logging but the public message is "invalid".
    const invite = await tx.workspaceInvite.findUnique({
      where: { token: input.token },
    });
    if (!invite) return { ok: false, reason: "not_found" };
    if (invite.acceptedAt) return { ok: false, reason: "already_accepted" };
    if (invite.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: "expired" };
    }

    // 🔒 Email-control verification (HIGH #5). The invite was sent to
    // invite.email; the accepting account must control it.
    if (
      invite.email.trim().toLowerCase() !==
      input.acceptingUserEmail.trim().toLowerCase()
    ) {
      return { ok: false, reason: "email_mismatch" };
    }
    if (!input.acceptingUserEmailVerified) {
      // Verification must be forced here — otherwise an attacker registers with
      // a victim's email and steals their invite.
      return { ok: false, reason: "email_not_verified" };
    }

    // Add the user to the workspace at the invite's role (idempotent on
    // membership; the invite itself stays single-use).
    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: invite.workspaceId,
          userId: input.acceptingUserId,
        },
      },
      update: { role: invite.role },
      create: {
        workspaceId: invite.workspaceId,
        userId: input.acceptingUserId,
        role: invite.role,
      },
    });

    // Single-use: mark accepted. Re-accept attempts are rejected above.
    await tx.workspaceInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    return { ok: true, workspaceId: invite.workspaceId, role: invite.role };
  });
}
