import { Experience, FlexExperience } from '@/api/ll';
import { ParkTime } from '@/datetime';
import kvdb from '@/kvdb';

export const WATCHLIST_KEY = 'autoll3.autopilot.watchlist';

/**
 * Where a build keeps its watch list.
 *
 * Parameterised because more than one bookmarklet runs on Disney's origin and
 * they therefore share one `localStorage`. NextLL sets a single target for a
 * single goal; without its own key it would silently overwrite the list
 * Autopilot had been carrying all day.
 */
export type WatchListKey = string;

export interface WatchTarget {
  experienceId: string;
  /** Human-readable fallback when Disney does not list this ID today. */
  name?: string;
  /**
   * Smallest gain, in minutes, worth moving this reservation for.
   *
   * Absent means the engine's own default (30), which exists to stop an
   * unattended Autopilot churning a reservation for a few minutes at a time.
   * A search the user started by naming a time is the opposite case -- they
   * are standing there asking for that slot -- so it supplies a low value and
   * the bounds do the work of deciding what is acceptable.
   *
   * Only ever set by a foreground search. An Autopilot watch-list target
   * leaves it undefined and behaves exactly as before.
   */
  minImprovementMinutes?: number;
  /** A plan belongs to one park and one park day; absent means legacy/global. */
  parkId?: string;
  date?: string;
  /** User preference within this day plan. Lower ranks are tried first. */
  rank?: number;
  /** Book this easy early attraction first to unlock the day's Tier 1 strategy. */
  passkey?: boolean;
  /** Earliest acceptable return time, inclusive. */
  after?: ParkTime;
  /** Latest acceptable return time, inclusive. */
  before?: ParkTime;
  /**
   * Book this automatically when it appears within the window.
   *
   * Opt-in per attraction, and off by default: alerting is cheap to get wrong
   * while booking is not, so the two are deliberately separate decisions.
   */
  autoBook?: boolean;
  /**
   * Move an existing reservation for this attraction to a better time.
   *
   * Separate from `autoBook` on purpose. Booking risks spending an
   * entitlement you did not have; modifying puts one you already hold through
   * a round trip, and a bad modify can leave the day worse than before. Some
   * people will want one and not the other.
   */
  autoModify?: boolean;
  /**
   * Book any available time first, then move it toward the window.
   *
   * Wait Magic's "start wide, then narrow in": a wide search finds
   * availability far more often than a narrow one, and holding *something*
   * beats holding nothing while waiting for the perfect time. With nothing
   * held, this books whatever is offered regardless of the window; once
   * something is held, the window becomes the goal the modify step works
   * toward. Implies both booking and moving.
   */
  bookThenMove?: boolean;
  /**
   * Keep watching and alerting, but take no action.
   *
   * For controlling order by hand: pause the lesser attractions so a
   * higher-priority one gets booked first, then resume them. A paused
   * attraction also stops causing a Tier 1 hold for others, since pausing it
   * is a statement that it should not be booked right now.
   */
  paused?: boolean;
  /**
   * When the party is full, give up its worst-ranked reservation for this one.
   *
   * Wait Magic's "Attraction Swap", and the safe form of its "don't be afraid
   * to cancel" advice: the swap is a single atomic request on Disney's side,
   * so the old reservation is released only if the new one is secured. Applies
   * only when all slots are held -- with one free, a plain booking keeps both.
   * Implies booking when a slot is free.
   */
  autoSwap?: boolean;
}

export interface WatchHit {
  target: WatchTarget;
  experience: FlexExperience;
  returnTime: ParkTime;
  /**
   * Whether `returnTime` falls inside the target's window.
   *
   * Carried rather than filtered on, so the window can govern *acting* while
   * alerts stay wide. A window that also silenced alerts would hide the one
   * thing worth knowing -- that the ride came back at all -- and leave the
   * user staring at a screen that says nothing happened.
   */
  inWindow: boolean;
}

/** Whether a target belongs to the park/date currently being operated. */
export function targetApplies(
  target: WatchTarget,
  parkId: string,
  date: string
): boolean {
  return (
    (!target.parkId || target.parkId === parkId) &&
    (!target.date || target.date === date)
  );
}

/**
 * An experience with a Lightning Lane actually on offer.
 *
 * `FlexExperience` only makes `flex` required -- `nextAvailableTime` stays
 * optional within it -- so it is not enough to guarantee a return time. This
 * narrows both, which is the invariant a `WatchHit` depends on.
 */
type FlexOffer = FlexExperience & {
  flex: FlexExperience['flex'] & { nextAvailableTime: ParkTime };
};

function hasFlexOffer(exp: Experience): exp is FlexOffer {
  return !!exp.flex?.available && !!exp.flex.nextAvailableTime;
}

/**
 * Whether a return time falls inside a target's window.
 *
 * Comparison goes through `ParkTime.valueOf()`, which measures from a 4am day
 * start, so a window ending after midnight still orders correctly.
 */
export function inWindow(returnTime: ParkTime, target: WatchTarget): boolean {
  if (target.after && +returnTime < +target.after) return false;
  if (target.before && +returnTime > +target.before) return false;
  return true;
}

/**
 * Watched experiences that are bookable right now.
 *
 * Every available match is returned, each flagged with whether its return time
 * falls inside the target's window; the caller decides what the window gates.
 * Pure: takes the experience list the poller just fetched and returns matches,
 * so the interesting logic is testable without a clock, a network, or React.
 */
export function matchWatchList(
  experiences: Experience[],
  targets: WatchTarget[]
): WatchHit[] {
  if (targets.length === 0) return [];
  const byId = new Map(targets.map(t => [t.experienceId, t]));
  const hits: WatchHit[] = [];
  for (const experience of experiences) {
    const target = byId.get(experience.id);
    if (!target) continue;
    // `experienced` means the party has already used this attraction or hit
    // its limit, so an offer here is not actually bookable.
    if (experience.experienced) continue;
    if (!hasFlexOffer(experience)) continue;
    const returnTime = experience.flex.nextAvailableTime;
    hits.push({
      target,
      experience,
      returnTime,
      inWindow: inWindow(returnTime, target),
    });
  }
  return hits;
}

/**
 * Pick which hits are newly worth alerting on.
 *
 * Alerts are edge-triggered, keyed on experience id: in burst mode the poller
 * ticks about once a second, so alerting on every matching tick would fire
 * sixty notifications a minute for one available ride. An experience alerts
 * when it starts matching, stays quiet while it keeps matching, and becomes
 * eligible again only after it stops matching (sold out, moved outside the
 * window, or got booked).
 *
 * Returns the next "already alerted" set alongside the hits to fire, so the
 * caller holds the state and this stays a pure function.
 */
export function selectNewAlerts(
  hits: WatchHit[],
  alreadyAlerted: ReadonlySet<string>
): { toAlert: WatchHit[]; alerted: Set<string> } {
  const alerted = new Set(hits.map(h => h.experience.id));
  const toAlert = hits.filter(h => !alreadyAlerted.has(h.experience.id));
  return { toAlert, alerted };
}

interface StoredTarget {
  experienceId: string;
  name?: string;
  parkId?: string;
  date?: string;
  rank?: number;
  passkey?: boolean;
  after?: string;
  before?: string;
  minImprovementMinutes?: number;
  /**
   * Persisted so a party set up once keeps working all day. Safe because the
   * autopilot on/off state is deliberately *not* persisted -- nothing can book
   * until the user turns it on again, in person, after a reload.
   */
  autoBook?: boolean;
  autoModify?: boolean;
  bookThenMove?: boolean;
  paused?: boolean;
  autoSwap?: boolean;
}

/** `ParkTime.from` throws on garbage; treat an unparseable bound as absent. */
export function parseBound(value?: string): ParkTime | undefined {
  if (!value) return undefined;
  try {
    return ParkTime.from(value);
  } catch {
    return undefined;
  }
}

/**
 * Load the saved watch list.
 *
 * Stored as plain strings because `ParkTime` serializes to `"HH:MM:SS"` via
 * `toJSON()` but does not revive itself from JSON.
 *
 * Bounds are parsed independently of the entry: a corrupt `after`/`before`
 * drops just that bound and keeps the target. Dropping the whole target would
 * silently discard a watch the user deliberately set, and a missed alert is
 * harder to notice than an early one.
 */
export function loadWatchList(
  key: WatchListKey = WATCHLIST_KEY
): WatchTarget[] {
  const stored = kvdb.get<StoredTarget[]>(key);
  if (!Array.isArray(stored)) return [];
  return stored.flatMap(t => {
    if (typeof t?.experienceId !== 'string') return [];
    const after = parseBound(t.after);
    const before = parseBound(t.before);
    return [
      {
        experienceId: t.experienceId,
        ...(typeof t.name === 'string' ? { name: t.name } : {}),
        ...(typeof t.parkId === 'string' ? { parkId: t.parkId } : {}),
        ...(typeof t.date === 'string' ? { date: t.date } : {}),
        ...(typeof t.rank === 'number' && Number.isFinite(t.rank)
          ? { rank: t.rank }
          : {}),
        ...(typeof t.minImprovementMinutes === 'number' &&
        Number.isFinite(t.minImprovementMinutes)
          ? { minImprovementMinutes: t.minImprovementMinutes }
          : {}),
        ...(t.passkey === true ? { passkey: true } : {}),
        ...(after ? { after } : {}),
        ...(before ? { before } : {}),
        // Only a literal `true` enables booking. Anything else stored here --
        // a truthy string, a number from a hand-edited value -- reads as off,
        // since the failure mode of guessing wrong is an unwanted booking.
        ...(t.autoBook === true ? { autoBook: true } : {}),
        ...(t.autoModify === true ? { autoModify: true } : {}),
        ...(t.bookThenMove === true ? { bookThenMove: true } : {}),
        ...(t.paused === true ? { paused: true } : {}),
        ...(t.autoSwap === true ? { autoSwap: true } : {}),
      },
    ];
  });
}

export function saveWatchList(
  targets: WatchTarget[],
  key: WatchListKey = WATCHLIST_KEY
): void {
  kvdb.set<StoredTarget[]>(
    key,
    targets.map(t => ({
      experienceId: t.experienceId,
      ...(t.name ? { name: t.name } : {}),
      ...(t.parkId ? { parkId: t.parkId } : {}),
      ...(t.date ? { date: t.date } : {}),
      ...(typeof t.rank === 'number' ? { rank: t.rank } : {}),
      ...(typeof t.minImprovementMinutes === 'number'
        ? { minImprovementMinutes: t.minImprovementMinutes }
        : {}),
      ...(t.passkey ? { passkey: true } : {}),
      ...(t.after ? { after: String(t.after) } : {}),
      ...(t.before ? { before: String(t.before) } : {}),
      ...(t.autoBook ? { autoBook: true } : {}),
      ...(t.autoModify ? { autoModify: true } : {}),
      ...(t.bookThenMove ? { bookThenMove: true } : {}),
      ...(t.paused ? { paused: true } : {}),
      ...(t.autoSwap ? { autoSwap: true } : {}),
    }))
  );
}
