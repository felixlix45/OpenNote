/**
 * apps/web — middleware (🔒 0006 #5: per-account login rate-limiting).
 *
 * Better Auth applies a per-IP rate limit on credential endpoints. This
 * middleware adds a PER-ACCOUNT limit on top (a single-IP limit is bypassable;
 * a single-account limit prevents distributed spraying against one account).
 *
 * Limits: 5 sign-in attempts per email per 5-minute window. In-memory
 * (process-scoped) — acceptable for v1 single-instance; a shared store (Redis)
 * is post-v1 when horizontal scaling matters.
 *
 * Only intercepts POST /api/auth/sign-in/email; all other requests pass through.
 */
import { NextRequest, NextResponse } from "next/server";

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

// Map<email, number[]> — timestamps of recent attempts within the window.
const attempts = new Map<string, number[]>();

export async function middleware(request: NextRequest) {
  // Only rate-limit the sign-in endpoint.
  if (
    request.method !== "POST" ||
    !request.nextUrl.pathname.endsWith("/api/auth/sign-in/email")
  ) {
    return NextResponse.next();
  }

  // Extract the email from the request body. Middleware can clone + read it.
  let email: string | null = null;
  try {
    const cloned = request.clone();
    const body = (await cloned.json()) as { email?: string };
    email = body.email?.toLowerCase().trim() ?? null;
  } catch {
    // Malformed body → let the route handle the 400.
    return NextResponse.next();
  }

  if (!email) return NextResponse.next();

  // Prune + check.
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let bucket = attempts.get(email);
  if (!bucket) {
    bucket = [];
    attempts.set(email, bucket);
  }
  // Prune entries older than the window (sliding window).
  bucket = bucket.filter((t) => t > cutoff);
  attempts.set(email, bucket);

  if (bucket.length >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "too_many_attempts", message: "Too many sign-in attempts. Try again later." },
      { status: 429 },
    );
  }

  // Record this attempt.
  bucket.push(now);
  return NextResponse.next();
}

export const config = {
  // Run only on the auth sign-in path.
  matcher: "/api/auth/sign-in/email",
};
