/**
 * apps/realtime — per-connection update rate-limiter tests (🔒 ticket 0010
 * req #2: a malicious editor can flood Yjs updates → CPU + DB write amp).
 *
 * The limiter is a pure sliding-window counter per connection. It does NOT do
 * the rejection (that's the server's job in the update hook); it just answers
 * "is this connection over its budget right now?" so the hook can reject.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "./rate-limiter.js";

describe("updateRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("allows up to the configured budget per second", () => {
    const limiter = createRateLimiter({ maxUpdatesPerSecond: 10 });
    for (let i = 0; i < 10; i++) {
      expect(limiter.check("conn-1")).toBe(true);
    }
  });

  it("rejects updates beyond the budget", () => {
    const limiter = createRateLimiter({ maxUpdatesPerSecond: 5 });
    for (let i = 0; i < 5; i++) limiter.check("conn-1");
    expect(limiter.check("conn-1")).toBe(false); // 6th → over
    expect(limiter.check("conn-1")).toBe(false);
  });

  it("allows again after the window slides past a second", () => {
    const limiter = createRateLimiter({ maxUpdatesPerSecond: 5 });
    for (let i = 0; i < 5; i++) limiter.check("conn-1");
    expect(limiter.check("conn-1")).toBe(false);
    vi.advanceTimersByTime(1001); // window slides
    expect(limiter.check("conn-1")).toBe(true);
  });

  it("tracks connections independently", () => {
    const limiter = createRateLimiter({ maxUpdatesPerSecond: 3 });
    for (let i = 0; i < 3; i++) limiter.check("conn-A");
    expect(limiter.check("conn-A")).toBe(false); // A exhausted
    expect(limiter.check("conn-B")).toBe(true); // B unaffected
  });

  it("forgets a connection on disconnect (no unbounded memory growth)", () => {
    const limiter = createRateLimiter({ maxUpdatesPerSecond: 3 });
    limiter.check("conn-X");
    limiter.forget("conn-X");
    // Re-checking re-seeds the counter (the window is fresh).
    expect(limiter.check("conn-X")).toBe(true);
  });

  it("uses a sliding window, not fixed buckets", () => {
    // Send 5 at t=0, then 5 more spread across the next second — the sliding
    // window should allow them as the early ones age out.
    const limiter = createRateLimiter({ maxUpdatesPerSecond: 5 });
    for (let i = 0; i < 5; i++) limiter.check("conn-1");
    expect(limiter.check("conn-1")).toBe(false); // t=0: full
    vi.advanceTimersByTime(500);
    expect(limiter.check("conn-1")).toBe(false); // t=500: still 5 in last 1000ms
    vi.advanceTimersByTime(501); // t=1001: the t=0 burst has aged out
    expect(limiter.check("conn-1")).toBe(true); // now there's room
  });
});
