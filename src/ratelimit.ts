export class RateLimitExceeded extends Error {
  readonly name = 'RateLimitExceeded';
}

/**
 * Seconds to keep rejecting requests after the burst limit is exceeded.
 *
 * Short on purpose. This is backpressure, not punishment: long enough to break
 * a runaway request loop, short enough that tripping it near a Lightning Lane
 * drop does not cost the drop. A loop that keeps misbehaving simply re-trips,
 * which throttles it to a trickle rather than stopping it forever.
 */
export const COOLDOWN_SECONDS = 5;

export class RateLimit {
  protected lastRequestTime = 0;
  protected requestCount = 0;
  protected limitExceededTime: number | undefined;

  constructor(protected requestsPerSecond = 0) {}

  enforce() {
    const now = Math.floor(performance.now() / 1000);

    // Recover once the cooldown has elapsed.
    //
    // Upstream set `limitExceededTime` on the first violation and never
    // cleared it, so a single burst permanently rejected every subsequent
    // request for the life of the client -- no refreshes and no bookings until
    // the page was reloaded. ApiClient.request() calls enforce() before every
    // call, so the blast radius was the whole API surface. That is survivable
    // for a human tapping a button, but not for a background poller, where a
    // trip at 6:59 would silently forfeit a 7:00 drop.
    if (this.limitExceededTime !== undefined) {
      if (now - this.limitExceededTime < COOLDOWN_SECONDS) {
        throw new RateLimitExceeded();
      }
      this.limitExceededTime = undefined;
      this.lastRequestTime = now;
      this.requestCount = 0;
    }

    if (this.lastRequestTime !== now) {
      this.lastRequestTime = now;
      this.requestCount = 0;
    }
    if (++this.requestCount > this.requestsPerSecond) {
      this.limitExceededTime = now;
      throw new RateLimitExceeded();
    }
  }
}
