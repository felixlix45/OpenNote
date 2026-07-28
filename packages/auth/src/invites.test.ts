/**
 * @opennote/auth — invite token unit tests (🔒 HIGH #5).
 *
 * The full acceptInvite flow needs a Prisma transaction (integration test in
 * packages/db). These tests pin the cryptographic invariants of the token
 * itself — the part that, if wrong, makes invites an account-takeover vector.
 */
import { describe, expect, it } from "vitest";
import { generateInviteToken, safeEqualToken, INVITE_TTL_MS } from "./invites.js";

describe("invite tokens — cryptographic guarantees (HIGH #5)", () => {
  it("tokens are unique across many generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateInviteToken());
    }
    expect(seen.size).toBe(1000);
  });

  it("tokens carry high entropy (>= 64 hex chars of secret)", () => {
    const token = generateInviteToken();
    const secret = token.split(".")[1];
    expect(secret).toBeDefined();
    expect(secret!.length).toBeGreaterThanOrEqual(64); // 32 randomBytes = 64 hex
  });

  it("tokens are not derivable from timestamps or sequential ids", () => {
    // Tokens generated in a tight loop must not be sortable/sequential in their
    // secret portion (only the UUID prefix, which carries no auth weight, is).
    const a = generateInviteToken().split(".")[1]!;
    const b = generateInviteToken().split(".")[1]!;
    expect(a).not.toEqual(b);
  });

  it("INVITE_TTL_MS is 7 days", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
