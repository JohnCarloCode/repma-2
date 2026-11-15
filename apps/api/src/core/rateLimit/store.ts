export interface RateLimitHit {
  count: number; // hits in the current window, including this one
  resetInMs: number; // time left until the window resets
}

// AD-16 — the limiter only talks to this interface, so the in-memory store can
// be swapped for Redis without touching any consumer.
export interface RateLimitStore {
  // Counts one hit for `key` in its current fixed window.
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

// Documented limitation (AD-16): counters live in this process's memory —
// they reset on restart and are NOT shared between instances. Correct for
// the single-instance deployment; horizontal scaling needs a shared store.
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private nextSweepAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = this.now();
    this.sweepExpired(now, windowMs);

    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return { count: window.count, resetInMs: window.resetAt - now };
  }

  // Bounded memory: at most once per window, drop every expired key (per-IP
  // keys on public routes would otherwise accumulate forever).
  private sweepExpired(now: number, windowMs: number): void {
    if (now < this.nextSweepAt) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    this.nextSweepAt = now + windowMs;
  }
}
