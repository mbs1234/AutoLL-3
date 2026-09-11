import { DateTime, ParkTime } from '@/datetime';
import { now as syncedNow } from '@/timesync';

/**
 * How aggressively to poll right now.
 *
 * - `idle`     nothing interesting is near; keep data merely fresh
 * - `approach` a target is coming up; poll moderately so the list is warm
 * - `burst`    we are in the window around a target; poll hard
 */
export type PollMode = 'idle' | 'approach' | 'burst';

/**
 * Start bursting two minutes before the target. Disney sometimes releases
 * inventory early, and arriving warm beats arriving on time.
 */
export const BURST_LEAD_S = 120;
/**
 * Keep bursting after the target: dropped inventory trickles in rather than
 * appearing all at once, and the good return times get taken within a minute.
 */
export const BURST_TRAIL_S = 120;
/** Poll moderately this far ahead of a target. */
export const APPROACH_LEAD_S = 300;

/**
 * Floor on the poll interval, in ms.
 *
 * ApiClient shares a RateLimit(5) across every request, including the user's
 * own taps. Each poll costs 1-2 requests, and the scheduler runs strictly
 * sequentially (one poll in flight at a time), so a 1s floor bounds polling at
 * roughly 2 requests/second and leaves real headroom for user actions. Do not
 * lower this: tripping the limiter costs a cooldown, and near a drop that is
 * exactly when it hurts.
 */
export const MIN_INTERVAL_MS = 1000;

export const BURST_INTERVAL_MS = 1200;

/**
 * Interval and floor for a hand-started search.
 *
 * Faster than a drop burst, because the trade is different. A drop burst runs
 * unattended alongside the user's own tapping, so it leaves the shared
 * `RateLimit(5)` most of its headroom. A search in `rapid` mode is the only
 * thing running, the user is watching it rather than using the app, and it
 * lasts minutes.
 *
 * A tick costs about one request -- the tipboard -- with plans every tenth and
 * an occasional eligibility prewarm, so 600ms is roughly 1.7 requests/second
 * against a limit of 5. That leaves room for the prewarm and for the user
 * tapping something, which matters: exceeding the limit is not throttled, it
 * throws, and then costs a five-second cooldown at the moment being waited for.
 *
 * Not lowered further, and the limiter is not bypassed. Beyond this the ceiling
 * stops being ours: Disney's tipboard is served through a CDN and there is no
 * evidence it recomputes per request, so the extra calls would likely return
 * the same bytes while making the client conspicuous.
 */
export const RAPID_INTERVAL_MS = 600;
export const RAPID_MIN_INTERVAL_MS = 500;
export const APPROACH_INTERVAL_MS = 6000;
export const IDLE_INTERVAL_MS = 45_000;
/**
 * Tomorrow's inventory has no reliable minute-by-minute drop schedule, but
 * earlier-return releases are common during daytime. This remains deliberately
 * slower than a day-of drop burst and is used only while the user is actively
 * watching targets for tomorrow.
 */
export const TOMORROW_INTERVAL_MS = 15_000;

export interface CadenceInput {
  /** Current park time, ideally drift-corrected -- see `syncedParkTime()`. */
  now: ParkTime;
  /** Drop times for the park, e.g. `park.dropTimes`. */
  dropTimes?: ParkTime[];
  /**
   * Periods in which an attraction tends to be refilled rather than released
   * at one predictable instant. Unlike a drop time, a refill window stays at
   * the moderate approach cadence for its whole duration.
   */
  refillWindows?: RefillWindow[];
  /**
   * Poll as fast as the limiter allows, ignoring the schedule.
   *
   * The drop-aware cadence exists to spend requests where they pay: idle until
   * a known drop is near, then hard. That is right for a tool left running all
   * day. It is wrong for a search started by hand, in the park, for the next
   * few minutes -- there the user is standing still waiting, the thing being
   * waited for is somebody else cancelling, and a cancellation has no
   * schedule to approach. So: burst throughout, and the run is short because a
   * person is watching it.
   */
  rapid?: boolean;
  /** A deliberate tomorrow watch, paced for cancellation/earlier-time releases. */
  tomorrow?: boolean;
  /**
   * Every moment a booking window opens, from `LLClient.nextBookTimes`.
   *
   * Plural because a party's slots free at different times. Taking only the
   * first left the loop idling at 45 seconds through the rest.
   */
  nextBookTimes?: ParkTime[];
}

export interface RefillWindow {
  start: ParkTime;
  end: ParkTime;
}

export interface Cadence {
  mode: PollMode;
  intervalMs: number;
  /** The target driving this decision, if any. */
  target?: ParkTime;
  /**
   * Seconds until `target`. Negative once the target has passed and we are
   * still inside its trailing window.
   */
  secondsToTarget?: number;
  /** The refill period currently keeping the poller warm, if any. */
  refillWindow?: RefillWindow;
}

/** Drift-corrected current park time. */
export function syncedParkTime(): ParkTime {
  return DateTime.from(syncedNow()).time;
}

/**
 * Seconds from `now` until `target`; negative if `target` has passed.
 *
 * `ParkTime.valueOf()` measures from a 4am day start, so times after midnight
 * sort correctly after late-evening ones. This assumes both values fall within
 * the same park day, which holds for drop times and booking windows.
 */
export function secondsUntil(now: ParkTime, target: ParkTime): number {
  return +target - +now;
}

/**
 * Decide how fast to poll, given the current time and what is coming up.
 *
 * Deliberately pure: no clock, no randomness, no I/O. That keeps the policy
 * exhaustively testable, and it is the part most worth getting right --
 * cscull's fork polls a flat random 1-4s forever regardless of context, which
 * is simultaneously too fast when nothing is happening and no faster when a
 * drop is seconds away.
 */
export function cadence({
  now,
  dropTimes = [],
  refillWindows = [],
  nextBookTimes = [],
  rapid = false,
  tomorrow = false,
}: CadenceInput): Cadence {
  if (rapid) return { mode: 'burst', intervalMs: RAPID_INTERVAL_MS };
  if (tomorrow && now.hour >= 7 && now.hour < 22) {
    return { mode: 'approach', intervalMs: TOMORROW_INTERVAL_MS };
  }
  // Defaulting to empty arrays rather than testing for undefined keeps the
  // instantaneous target sources symmetrical below.
  const targets = [...dropTimes, ...nextBookTimes];

  let burst: { target: ParkTime; secondsToTarget: number } | undefined;
  let approach: { target: ParkTime; secondsToTarget: number } | undefined;

  for (const target of targets) {
    const secondsToTarget = secondsUntil(now, target);
    if (secondsToTarget <= BURST_LEAD_S && secondsToTarget >= -BURST_TRAIL_S) {
      // Prefer the nearest burst target, measured by absolute distance, so a
      // drop we are sitting on top of wins over one 30s out.
      if (
        !burst ||
        Math.abs(secondsToTarget) < Math.abs(burst.secondsToTarget)
      ) {
        burst = { target, secondsToTarget };
      }
    } else if (secondsToTarget > 0 && secondsToTarget <= APPROACH_LEAD_S) {
      if (!approach || secondsToTarget < approach.secondsToTarget) {
        approach = { target, secondsToTarget };
      }
    }
  }

  if (burst) return { mode: 'burst', intervalMs: BURST_INTERVAL_MS, ...burst };
  if (approach) {
    return { mode: 'approach', intervalMs: APPROACH_INTERVAL_MS, ...approach };
  }
  // A refill is a span, not a series of invented drop instants. Poll at the
  // existing 6-second approach rate while inside it; a real scheduled drop
  // still wins above and can use the shorter burst interval.
  const refillWindow = refillWindows.find(
    window => +now >= +window.start && +now <= +window.end
  );
  if (refillWindow) {
    return { mode: 'approach', intervalMs: APPROACH_INTERVAL_MS, refillWindow };
  }
  return { mode: 'idle', intervalMs: IDLE_INTERVAL_MS };
}

/**
 * Consecutive failures after which the poller stops rather than retrying.
 *
 * A stuck poller is worse than a stopped one: `ApiClient.request()` clears the
 * auth store on a 401, so a loop that keeps firing against expired
 * credentials generates noise and gets nowhere. Stopping surfaces the problem
 * instead of hiding it behind an endless retry.
 */
/**
 * How long one poll may take before it is abandoned as wedged.
 *
 * The loop is deliberately sequential: one tick at a time, the next scheduled
 * only when the last returns. A promise that neither resolves nor rejects
 * therefore parked it forever -- no failure counted, so no backoff, no failure
 * ceiling, and a status display frozen on whatever mode it was in. The
 * eight-second client timeout does not cover every path there: a captive portal
 * or a dropped connection can leave a fetch hanging, and the dynamic import of
 * the sensor-data module has no timeout at all.
 *
 * Twice the idle interval, so an unusually slow but working tick is never
 * mistaken for a wedged one. Exceeding it counts as a failure, which is what
 * lets the existing backoff and the failure ceiling do their job.
 */
export const TICK_DEADLINE_MS = 2 * IDLE_INTERVAL_MS;

export const MAX_CONSECUTIVE_FAILURES = 8;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 60_000;

/**
 * Delay before the next attempt after `consecutiveFailures` failures.
 *
 * Doubles from 2s, capped at 60s. The cap matters: without one, backoff after
 * a handful of failures would exceed the length of a drop window entirely.
 */
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(
    BACKOFF_CAP_MS,
    BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1)
  );
}

/**
 * Spread an interval by +/-20% so the request pattern has no fixed period.
 *
 * `rand` is injectable purely so tests can be deterministic.
 */
export function withJitter(
  intervalMs: number,
  rand = Math.random,
  minIntervalMs = MIN_INTERVAL_MS
): number {
  const spread = intervalMs * 0.2;
  const jittered = intervalMs - spread + rand() * spread * 2;
  return Math.max(minIntervalMs, Math.round(jittered));
}
