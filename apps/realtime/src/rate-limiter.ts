/**
 * apps/realtime — per-connection update rate-limiter (🔒 ticket 0010 req #2).
 *
 * A malicious editor can flood Yjs updates → CPU + DB write amplification. This
 * sliding-window counter caps updates per connection; the server's update hook
 * calls {@link check} and rejects the update (and the connection on repeat
 * violation) when it returns false.
 *
 * Pure over the clock (injectable via options for tests); no DB, no I/O. The
 * window is 1 second; entries older than that are pruned on each check.
 */
export interface RateLimiterOptions {
  /** Max updates a single connection may produce per rolling 1-second window. */
  maxUpdatesPerSecond: number;
  /** Inject the clock (tests). Defaults to Date.now. */
  now?: () => number;
}

export interface RateLimiter {
  /**
   * Record an update for `connectionId` and return whether it's within budget.
   * Side-effecting: pushes a timestamp. Call once per inbound update.
   */
  check(connectionId: string): boolean;
  /** Drop a connection's history on disconnect (bound memory). */
  forget(connectionId: string): void;
}

const WINDOW_MS = 1000;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const limit = options.maxUpdatesPerSecond;
  // Map<connectionId, number[]> — timestamps of recent updates within the window.
  const windows = new Map<string, number[]>();

  return {
    check(connectionId) {
      const t = now();
      let bucket = windows.get(connectionId);
      if (!bucket) {
        bucket = [];
        windows.set(connectionId, bucket);
      }
      // Prune entries older than the window (sliding window).
      const cutoff = t - WINDOW_MS;
      while (bucket.length > 0 && bucket[0]! <= cutoff) {
        bucket.shift();
      }
      if (bucket.length >= limit) {
        return false; // over budget
      }
      bucket.push(t);
      return true;
    },
    forget(connectionId) {
      windows.delete(connectionId);
    },
  };
}
