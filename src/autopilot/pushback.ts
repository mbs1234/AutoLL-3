/**
 * Disney pushing back, and what every search and booking routine does about
 * it.
 *
 * Two answers mean Disney wants this app to stop asking. What each one does
 * was the owner's decision, made after a long NextLL search kept checking
 * through them and the account was paused for about half an hour:
 *
 * - **403, refused.** Everything stops at the first one: Autopilot, NextLL,
 *   Time Search and Change attraction. Starting again is allowed, with a
 *   warning, and the next 403 stops everything again -- no grace, no counting.
 *   `noteRefusal` is the one signal every routine watches, because the request
 *   Disney refused need not have been its own.
 * - **429, slow down.** Autopilot says so and waits, still on and armed, for
 *   Disney's Retry-After or `throttleWaitMs`, then carries on by itself. A
 *   search a person started stops and says why, and may be started again
 *   early. Each routine answers the 429s it receives, and no other.
 *
 * Only the routines' own requests count. A 403 on a screen being driven by
 * hand is shown on that screen, as it always was, and stops nothing else.
 */

export const REFUSED_STATUS = 403;
export const THROTTLED_STATUS = 429;

export type Pushback =
  | { kind: 'refused' }
  | { kind: 'throttled'; retryAfterMs?: number };

/** The pushback an HTTP status carries, if it is one. */
export function pushbackOfStatus(
  status: number | undefined,
  retryAfterMs?: number
): Pushback | undefined {
  if (status === REFUSED_STATUS) return { kind: 'refused' };
  if (status !== THROTTLED_STATUS) return undefined;
  return retryAfterMs === undefined
    ? { kind: 'throttled' }
    : { kind: 'throttled', retryAfterMs };
}

/** The pushback a thrown request error carries, if it is one. */
export function pushbackOf(error: unknown): Pushback | undefined {
  const response = (
    error as
      | { response?: { status?: number; retryAfterMs?: number } }
      | undefined
  )?.response;
  return pushbackOfStatus(response?.status, response?.retryAfterMs);
}

/** The last pushback any routine met, for the warning beside Start. */
export interface LastPushback {
  kind: Pushback['kind'];
  /** `Date.now()` when it came. */
  at: number;
  /** When Disney said to ask again, if it said. */
  until?: number;
}

let refusals = 0;
let last: LastPushback | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** Disney refused a routine's request, so every routine stops. */
export function noteRefusal(now = Date.now()): void {
  refusals += 1;
  last = { kind: 'refused', at: now };
  notify();
}

/**
 * Disney asked a routine to slow down.
 *
 * Recorded for the warning only. Nothing else reads it: each routine answers
 * its own 429s, so this must never be what pauses one.
 */
export function noteThrottle(retryAfterMs?: number, now = Date.now()): void {
  last = {
    kind: 'throttled',
    at: now,
    ...(retryAfterMs === undefined ? {} : { until: now + retryAfterMs }),
  };
  notify();
}

/**
 * How many refusals this page has seen.
 *
 * A routine notes the number when it starts. Any other number later means
 * Disney has refused a request since, and it stops.
 */
export function refusalCount(): number {
  return refusals;
}

export function lastPushback(): LastPushback | undefined {
  return last;
}

export function subscribePushback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * How long the warning beside Start lasts: about as long as the pause that
 * prompted all of this.
 */
export const PUSHBACK_WARNING_MS = 30 * 60_000;

/** The last pushback, while it is recent enough to warn about. */
export function recentPushback(
  pushback: LastPushback | undefined,
  now = Date.now()
): LastPushback | undefined {
  return pushback && now - pushback.at < PUSHBACK_WARNING_MS
    ? pushback
    : undefined;
}

/** Autopilot's wait after a 429 when Disney does not say: two minutes... */
export const THROTTLE_WAIT_FIRST_MS = 2 * 60_000;
/** ...doubling with each 429 in a row, to half an hour. */
export const THROTTLE_WAIT_MAX_MS = 30 * 60_000;
/**
 * And never less than this, whatever Disney says. A Retry-After of nothing
 * after a 429 would have Autopilot asking again at once, and a 429 is the one
 * answer that says not to.
 */
export const THROTTLE_WAIT_MIN_MS = 30_000;

/**
 * How long Autopilot waits after the `streak`th 429 in a row.
 *
 * Disney's own Retry-After wins when it sends one: it knows how long its pause
 * lasts and this build does not. Otherwise the wait doubles each time, since a
 * 429 straight after a wait means the last one was too short.
 */
export function throttleWaitMs(streak: number, retryAfterMs?: number): number {
  const wait =
    retryAfterMs ??
    THROTTLE_WAIT_FIRST_MS * 2 ** Math.max(0, Math.floor(streak) - 1);
  return Math.max(
    THROTTLE_WAIT_MIN_MS,
    retryAfterMs === undefined ? Math.min(THROTTLE_WAIT_MAX_MS, wait) : wait
  );
}

/** For tests: forget every pushback this page has seen. */
export function resetPushback(): void {
  refusals = 0;
  last = undefined;
  notify();
}
