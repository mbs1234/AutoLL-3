import { RequestControl, RequestNotSent } from '@/api/client';
import { LLMP } from '@/api/itinerary';
import {
  Guest,
  Guests,
  Offer,
  OfferError,
  OfferExperience,
  OfferItineraryItem,
} from '@/api/ll';
import { ParkTime } from '@/datetime';
import { RateLimitExceeded } from '@/ratelimit';

import { REFUSAL_STATUS } from './refusal';
import { WatchTarget, inWindow } from './watchlist';

/**
 * Backpressure status: retrying is the one guaranteed way to make it worse.
 * Kept beside `REFUSAL_STATUS` (imported, not redefined) so the two together
 * are the one place "which status means stop asking" is decided.
 */
const THROTTLE_STATUS = 429;

/**
 * Consecutive plans polls that must show an attraction unheld before its
 * booking lock is released.
 *
 * One is not enough: a booking made moments before a fetch can be absent from
 * that response while Disney catches up, and acting on a single gap would
 * rebook something already held. Two is the smallest value that survives that
 * race, and costs only a poll interval of latency on a genuine cancellation.
 */
export const CONFIRM_ABSENT_POLLS = 2;

export type SkipReason =
  | 'not-enabled'
  | 'no-longer-wanted'
  | 'already-attempted'
  | 'waiting-to-retry'
  | 'no-eligible-guests'
  | 'partial-party'
  | 'offer-outside-window'
  | 'overlaps-plans';

export type AutoBookOutcome =
  | { status: 'booked'; booking: LLMP; returnTime: ParkTime }
  | { status: 'skipped'; reason: SkipReason }
  | {
      status: 'failed';
      error: string;
      /** The HTTP status, when there was one. */ httpStatus?: number;
      /** Whether nothing was booked, so trying again is safe. */
      rejected?: boolean;
      /** Dispatched, and no answer came back. Set by the provider, not here. */
      unknown?: boolean;
    };

/**
 * Whether a failed action provably changed nothing on Disney's side.
 *
 * The ledger takes its lock *before* the request goes out, because a booking
 * that times out may still have succeeded and repeating it would spend a
 * second entitlement. That is right when the outcome is unknown, and needless
 * when it is not: losing a race for an offer somebody else committed a
 * few hundred milliseconds earlier is the ordinary way a contested drop goes,
 * and it must not permanently retire an attraction from a search whose whole
 * purpose is to keep trying.
 *
 * Three cases say nothing happened:
 *
 * - `RequestNotSent`, which the mutation lifecycle throws when its final
 *   dispatch revalidation refuses the call.
 * - `RateLimitExceeded`, which our own limiter throws at the actual send
 *   boundary, before anything is sent.
 * - A client error the server returned, other than the two that mean stop
 *   asking. `REFUSAL_STATUS` is the bot filter, which `refusal.ts` watches and
 *   which is made worse by hammering; `THROTTLE_STATUS` is being throttled,
 *   where retrying is the one guaranteed way to make it worse still.
 *
 * Everything else -- no response at all, or a 5xx -- leaves the outcome
 * genuinely unknown, and the lock stands.
 *
 * This says only that a retry would be *safe*. It says nothing about how soon
 * one should happen: a rejection usually leaves every input to the decision
 * unchanged, so an immediate retry would re-run the same request against the
 * same evidence. Pacing is the caller's problem; see `RETRY_AFTER_MS`.
 */
export function actionWasRejected(error: unknown): boolean {
  if (error instanceof RequestNotSent) return true;
  if (error instanceof RateLimitExceeded) return true;
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status === undefined) return false;
  if (status === REFUSAL_STATUS || status === THROTTLE_STATUS) return false;
  return status >= 400 && status < 500;
}

/**
 * Put fallible local attempt persistence before the irreversible transport
 * marker, and roll it back if final dispatch authorization refuses the send.
 */
export function withAttemptDispatch(
  control: RequestControl | undefined,
  markAttempt: () => () => void,
  afterDispatch?: () => void
): RequestControl | undefined {
  if (!control) {
    markAttempt();
    afterDispatch?.();
    return undefined;
  }
  return {
    ...control,
    onDispatch: () => {
      const rollback = markAttempt();
      try {
        // The operation's dispatched marker is deliberately last among work
        // that may prevent fetch. A synchronous persistence failure above
        // therefore proves that no HTTP request started and cannot manufacture
        // a doubt.
        control.onDispatch?.();
      } catch (error) {
        try {
          rollback();
        } catch (rollbackError) {
          console.error(rollbackError);
        }
        throw error;
      }
      // Compatibility observer only; no production caller uses it. Once the
      // operation is marked sent, an observer failure cannot cancel the fetch
      // and turn a known local error into an unknown mutation outcome.
      try {
        afterDispatch?.();
      } catch (error) {
        console.error(error);
      }
    },
  };
}

/**
 * Whether a return time collides with plans already made.
 *
 * Passed in rather than computed here so the helpers stay pure and the
 * provider owns the day's plans. The optional itinerary is the offer's own
 * view of the conflict, which is unioned with plans: a booking made a minute
 * ago can be in one and not the other.
 *
 * `release` is the reservation about to be given up -- the one being moved,
 * or the one a swap trades away. It cannot clash with its own replacement, and
 * counting it would refuse every swap into the slot it currently occupies.
 */
export type ClashCheck = (
  time: ParkTime,
  itinerary?: OfferItineraryItem[],
  release?: Pick<LLMP, 'id' | 'facilityId'>
) => boolean;

/** The two things autopilot can do to a reservation slot. */
export type ActionKind = 'book' | 'modify' | 'swap';

/**
 * The kind half of a lock key.
 *
 * Only action kinds now. There was briefly a `change` member here, meant to
 * lock a *reservation* rather than an attraction -- but mutual exclusion does
 * not belong in this set at all. An attempt lock is anti-thrash: session-scoped,
 * shared as a union, never given back for a modify, and therefore unable to say
 * whether anything is happening *now*. Exclusion lives in `lease.ts`, which is
 * exclusive, expiring and owned by an instance. Keeping the two apart is what
 * stopped a search deferring to a marker for work that finished at 9am, and
 * then stopped a retained marker locking a ride until the 4am rollover.
 */
export type LockKind = ActionKind;

/** Every lock kind, for the sweeps that have to ask about all of them. */
const LOCK_KINDS: readonly LockKind[] = ['book', 'modify', 'swap'];

/** A park date, and nothing else. */
const BOOKING_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The published shape of a lock key: booking date, action, attraction.
 *
 * Date first, the same way `leaseKey` does it (`lease.ts`), and for the reason
 * stated there -- a park date carries no colon, so the first one splits it and
 * whatever follows the kind is the id, however many colons it contains.
 *
 * Date first also decides what an older build makes of one of these. That build
 * tests the shared copy with `startsWith('book:')` and builds `book:${id}` to
 * look a lock up, so a date-first key matches neither and is simply invisible
 * there. Kind first would have matched the prefix test and been sliced into a
 * phantom experience id, which the old build would then have fed to
 * `findExistingLL` and counted absences against for the rest of the park day.
 */
const LOCK_KEY = /^(\d{4}-\d{2}-\d{2}):(book|modify|swap):(.+)$/;

/** The shape an older build published: the same key, with no date in it. */
const UNDATED_LOCK_KEY = /^(book|modify|swap):(.+)$/;

function assertBookingDate(date: string): string {
  // Loud on purpose. The date is now the only thing holding two booking dates
  // apart, and an empty one would quietly build `:book:80010114`, which
  // collides across dates in exactly the way this key shape exists to prevent
  // -- while passing every test that only ever supplies a real date.
  if (!BOOKING_DATE.test(date)) {
    throw new Error(`Not a booking date: ${JSON.stringify(date)}`);
  }
  return date;
}

/** One action on one attraction on one booking date. */
export function lockKey(
  date: string,
  kind: LockKind,
  experienceId: string
): string {
  return `${assertBookingDate(date)}:${kind}:${experienceId}`;
}

/** What a key names, or `undefined` if it is not one of ours. */
export function lockParts(
  key: string
): { date: string; kind: LockKind; experienceId: string } | undefined {
  if (!LOCK_KEY.test(key)) return undefined;
  // Split by position rather than by capture group, the way `leaseParts` does:
  // a park date is ten characters and carries no colon, and no kind carries one
  // either, so whatever follows the second colon is the id however many more it
  // contains.
  const rest = key.slice(11);
  const colon = rest.indexOf(':');
  return {
    date: key.slice(0, 10),
    kind: rest.slice(0, colon) as LockKind,
    experienceId: rest.slice(colon + 1),
  };
}

/** The key an older build would have published for the same action. */
function undatedKey(kind: LockKind, experienceId: string): string {
  return `${kind}:${experienceId}`;
}

/**
 * Where a lock's accumulated evidence is filed.
 *
 * For a dated lock this is the lock key itself. A date-less lock from an older
 * build has no date to key on, and its bare `book:80010114` would let an
 * absence seen while the picker was on the 18th and one seen on the 19th add up
 * to a release -- so its evidence is filed per date, under a prefix no real
 * lock key can take (`LOCK_KEY` requires a date first, so nothing dated can
 * ever be spelled `legacy:...`).
 */
function legacyEvidenceKey(date: string, undated: string): string {
  return `legacy:${date}:${undated}`;
}

/**
 * Per-session record of what the booker has done.
 *
 * Attempts are recorded per action kind, not per attraction. Booking an
 * attraction and later moving that same booking to a better time are two
 * distinct, each-once actions -- and the book-then-move strategy depends on
 * the second not being blocked by the first. Thrash is still bounded: at most
 * one booking and one move per attraction per session.
 *
 * Every record here is also scoped to a booking date, and that is what the
 * ledger was missing. A lock said "this action is done" while the evidence that
 * settles it -- `findExistingLL(plans, id, date)` -- answered a question about
 * one particular day, so booking for the 18th and moving the picker to the 19th
 * retired the attraction on a date nothing had been attempted for.
 *
 * The date is held on the instance rather than passed to each method, so that
 * the lock and the evidence read the same value from the same place. A method
 * taking a date would leave every call site free to pass a different one from
 * the one the settle loop asks plans about, which is the divergence this class
 * exists to close.
 *
 * ## Per reservation, or per lock
 *
 * Two different questions are asked here and they are keyed differently on
 * purpose, because collapsing them is how a lock gets released on evidence that
 * predates the request it is protecting.
 *
 * - **Per reservation, per date** is whether the party holds a pass for an
 *   attraction on a date. That is one fact, it comes from one
 *   `findExistingLL(plans, id, date)` lookup, and it is an *input*: it arrives
 *   as `stillHeld` on each `resolveHeld` call and is not stored. `settleableIds`
 *   yields one entry per attraction precisely because one lookup answers it for
 *   every lock on that attraction and date.
 * - **Per lock** is everything accumulated in order to give an action back:
 *   `confirmed`, `absences` and `unresolved`. A release hands back one action,
 *   and the only evidence that can justify that is evidence gathered *after
 *   that action's request went out*. Keyed per reservation-per-day instead,
 *   a `modify`-era observation certifies a `book` lock taken later on the same
 *   attraction and date -- so the booking whose response was lost is released
 *   on evidence from before it was sent, and the attraction is booked twice.
 *
 * Nothing is lost by counting absences per lock rather than per reservation:
 * `resolveHeld` runs once per attraction per poll, so each live lock's counter
 * advances at most once per poll either way.
 */
export class AutoBookLedger {
  protected attempted = new Set<string>();
  protected booked = 0;
  /** The booking date every question below is asked about. */
  protected date: string;
  /**
   * Booking attempts committed but not yet confirmed either way.
   *
   * A booking request that throws leaves real doubt: it may have succeeded
   * server-side. Until a later plans poll settles it the attempt is neither a
   * booking nor a non-booking, so it is held here rather than counted. Only
   * `book` attempts land here, since only they can create an entitlement that
   * nothing else accounts for, so the key is always a `book` lock key.
   *
   * Per lock, which carries the date with it. Keyed per reservation-per-day, a
   * booking made for the 19th would settle the doubt held for the 18th,
   * discarding the one thing that stops a second entitlement being spent on the
   * attraction the owner cares most about.
   */
  protected unresolved = new Set<string>();
  /**
   * Consecutive polls each lock's reservation has been observed unheld.
   *
   * Per lock rather than per reservation-per-day, and the difference is the
   * whole point: a lock may only be released on absences observed *after its
   * own request went out*. A shared counter hands a lock taken this tick an
   * absence count accumulated before it existed, which turns
   * `CONFIRM_ABSENT_POLLS` into a single observation for it.
   *
   * No double counting follows from the split: `settleableIds` yields one entry
   * per attraction, so `resolveHeld` runs once per attraction per poll and each
   * live lock's counter advances at most once.
   */
  protected absences = new Map<string, number>();
  /**
   * Locks whose reservation has been seen held in plans at least once *since
   * that lock was taken*.
   *
   * The gate on releasing a lock. Absence only means "cancelled" for a
   * reservation we watched exist; for one we never saw, it is indistinguishable
   * from an itinerary that has not caught up yet -- and releasing on that would
   * rebook something already held.
   *
   * Per lock, and this is the dangerous direction to get wrong. "Seen held" is
   * the first of the two conditions a release needs, and a fact about the
   * reservation cannot certify an action that had not happened when it was
   * observed: a `modify` lock confirmed at 10:00 would satisfy it for a `book`
   * lock taken at 10:15 whose response was then lost, after which two absences
   * throw away the doubt-hold and the attraction is booked a second time.
   */
  protected confirmed = new Set<string>();
  /**
   * Dry-run marks: log-once bookkeeping for a request that never went out.
   *
   * Held apart from real attempts so a rehearsal does not take part in
   * settling, which would re-log it every time the lock released.
   *
   * Keyed by the full lock key, and recorded for every kind rather than `book`
   * alone. Both are forced by the settle sweep now covering `modify` and `swap`:
   * a rehearsed move recorded nowhere would enter that sweep as a real lock and
   * be re-logged on every release, and a rehearsal keyed by bare id would
   * suppress settling of a real attempt of a *different* kind on the same
   * attraction -- reachable because the dry-run setting is read live, so it can
   * be switched off between one mark and the next.
   */
  protected rehearsed = new Set<string>();
  /**
   * Locks read from the shared copy in the shape an older build published:
   * `${kind}:${experienceId}`, with no date in it.
   *
   * Kept apart rather than dated on the way in, because there is no honest date
   * to give one. The build that wrote it had no concept of a booking date, so
   * the key says only "some action was taken on this attraction today" -- and
   * the conservative reading of that, the one the writing build itself acts on,
   * is that it blocks on whatever date is being asked about.
   *
   * That makes an old key behave here exactly as it does today, in both
   * directions, and "exactly" is meant literally. A `book:` key blocks every
   * date and clears on the same evidence that clears an adopted key, in
   * `CONFIRM_ABSENT_POLLS` polls, because that is what the writing build does
   * with it. A `modify:` or `swap:` key blocks and is *not* settled here,
   * because the writing build sweeps `book:` alone and so holds those for the
   * rest of its park day -- settling them would release, on this build's
   * evidence, a lock the build still holding it considers live. Deliberate
   * asymmetry, in the blocking direction, for the one window where two builds
   * are running against the same store. `releaseAttempt` still drops any of
   * them, which is the escape a hand-started search needs.
   *
   * Never owned, for the reason `storage.ts` gives `LEGACY_OWNER` -- a key we
   * cannot interpret is not ours to publish or to withdraw on anyone else's
   * behalf.
   */
  protected legacy = new Set<string>();
  /**
   * Keys already complained about, so the per-tick adoption says it once.
   *
   * Adoption runs on every poll, so warning unconditionally would turn one
   * unreadable key into a console full of them within a minute.
   */
  protected readonly warned = new Set<string>();
  /**
   * Locks this instance has explicitly let go of (`releaseAttempt`, or
   * `resolveHeld` settling a cancellation).
   *
   * `adoptAttempted` consults this so that re-reading a lock another tab (or
   * an earlier save from this one) persisted cannot resurrect a lock this
   * instance already decided was safe to retry.
   *
   * Kept only while the shared copy still names the key -- see
   * `adoptAttempted`. It is a tombstone for one *lock*, not a veto on the key
   * for the life of the instance, and the difference is what stops two engines
   * acting on one reservation.
   */
  protected released = new Set<string>();
  /**
   * Locks this instance keeps for itself but must not publish.
   *
   * A lock is taken before the request goes out, so it reaches the shared copy
   * before anyone knows whether anything was booked. When the answer comes back
   * "nothing was" -- Disney refused the call, or our own limiter never sent it
   * -- the lock is still right *here* (one action per attraction per session)
   * and wrong *there*: nothing in the shared copy can release it, because
   * `adoptAttempted` never takes ownership, so every later mount and every
   * other tab inherits a lock for a booking that provably does not exist and
   * skips the attraction for the rest of the park day.
   */
  protected readonly unshared = new Set<string>();
  /**
   * Locks this instance took itself, as opposed to ones it adopted from
   * storage because another tab or a nested provider holds them.
   *
   * `reset()` needs the distinction. Clearing this run's locks must clear the
   * shared copy of the ones this instance put there, or the next
   * `adoptAttempted` reads them straight back and the reset is a no-op -- but
   * it must leave a lock another instance is genuinely holding alone, since
   * that one is still true.
   */
  protected owned = new Set<string>();

  /**
   * @param date the booking date to start on. Required, and first, so that
   *             `tsc` names every construction site rather than letting one
   *             inherit a default date nobody chose -- a string where a
   *             function used to go cannot compile by accident.
   * @param onAttemptChange called whenever a lock is taken or released, so a
   *                       caller sharing this state across tabs can persist
   *                       and re-read it -- see `publishableKeys`/`adoptAttempted`.
   *                       Its argument lists keys to *remove* from the shared
   *                       copy: adding is inferred from `publishableKeys()`, but
   *                       a release has to be stated, or a union-only write can
   *                       never let one go.
   */
  constructor(
    date: string,
    protected readonly onAttemptChange: (
      released?: readonly string[]
    ) => void = () => undefined
  ) {
    this.date = assertBookingDate(date);
  }

  /** The booking date every question is currently asked about. */
  get bookingDate(): string {
    return this.date;
  }

  /**
   * Move onto another booking date.
   *
   * Deliberately not a reset. Every record here already carries the date it
   * belongs to, so moving the picker changes which keys are consulted and
   * nothing else: the 18th's locks, doubts and absence counters are still there
   * on the way back, exactly as they were left.
   *
   * A reset would be the obvious alternative and is the dangerous one. It would
   * throw away `unresolved`, which is the record that a booking request whose
   * response was never seen may have succeeded -- so switching to the 19th and
   * back would have the engine forget it might already hold the attraction, and
   * book it again. The booking morning is several park days worked from one
   * picker, with the picker moved between them and back, which is precisely
   * when that would bite.
   */
  setBookingDate(date: string): void {
    this.date = assertBookingDate(date);
  }

  /** This instance's key for one action, on the date it is currently on. */
  protected key(kind: LockKind, experienceId: string): string {
    return lockKey(this.date, kind, experienceId);
  }

  /**
   * This instance's locks, for a caller to persist.
   *
   * A plain snapshot rather than a live reference: callers must not mutate
   * the ledger's own set through it.
   *
   * Spans every booking date this instance has touched, not only the one it is
   * on. So do `ownedKeys` and `publishableKeys`, and for `publishableKeys`
   * that is load-bearing: the provider republishes what it owns on every tick
   * to heal a lost write, and a lock for the date the picker has just moved off
   * needs that healing exactly as much as one for the date it moved to.
   *
   * Locks adopted in an older build's date-less shape are not here. They are
   * nobody's to publish -- see `legacy`.
   */
  attemptedKeys(): string[] {
    return [...this.attempted].filter(key => !this.unshared.has(key));
  }

  /**
   * The subset of `attemptedKeys()` this instance took itself.
   *
   * Only these are this instance's to withdraw from the shared copy.
   */
  ownedKeys(): string[] {
    return [...this.owned];
  }

  /**
   * This instance's own locks, minus any it must not publish.
   *
   * What goes to the shared copy. `attemptedKeys()` is the wrong list for that
   * now that each key is stored against its holder: it includes locks adopted
   * from other instances, and re-publishing those under this instance's id
   * would quietly transfer ownership -- after which a release here would
   * withdraw a lock somebody else is relying on.
   */
  publishableKeys(): string[] {
    return [...this.owned].filter(key => !this.unshared.has(key));
  }

  /**
   * Whether this instance took the lock itself, as opposed to adopting it.
   *
   * The distinction a foreground claim turns on: taking over this engine's own
   * stale lock is the point of foreground precedence, while taking over one
   * another instance published is stepping on a live action.
   */
  owns(experienceId: string, kind: LockKind = 'book'): boolean {
    return this.owned.has(this.key(kind, experienceId));
  }

  /**
   * Whether the only thing blocking this action is a key from an older build.
   *
   * Asked so the screen can say which of the two it is. Both block, but one is
   * a live action somebody is taking and the other is a key this build cannot
   * interpret and is refusing to act against -- and the second is the single
   * case where this fix still costs a booking, so it must not be reported in
   * the words that mean the first.
   */
  hasUndatedLock(experienceId: string, kind: LockKind = 'book'): boolean {
    return this.legacy.has(undatedKey(kind, experienceId));
  }

  /**
   * Whether a lock naming this booking date blocks the action.
   *
   * The other half of the question `hasUndatedLock` asks. Both can be true at
   * once -- an un-reloaded tab's date-less key alongside a current-build tab's
   * dated one -- and in that case the live action is the thing to report, since
   * reloading the old tab would not unblock anything.
   */
  hasDatedLock(experienceId: string, kind: LockKind = 'book'): boolean {
    return this.attempted.has(this.key(kind, experienceId));
  }

  /**
   * Adopt locks taken elsewhere -- another tab's ledger, most often -- without
   * disturbing this instance's own bookkeeping for them.
   *
   * Union only: a key already held locally is left as this instance recorded
   * it, and nothing here is ever removed by adoption -- except a key this
   * instance has itself explicitly released (see `released`), which stays
   * released rather than being re-locked by a stale copy read back from
   * storage.
   *
   * A key routes by what it says about itself, never by the date this ledger
   * happens to be on. One naming another date is held for that date: it blocks
   * nothing today and blocks correctly the moment the picker moves. One with no
   * date at all cannot name a date and is kept apart as `legacy`. One in
   * neither shape is dropped and said out loud -- the shared copy is a place
   * another build writes to, and silently treating an unreadable string as a
   * lock would block an attraction for a reason nothing could explain.
   *
   * `keys` must be the *whole* shared copy, not a subset, because a key's
   * absence from it is read as evidence below. The one production caller passes
   * `loadLocks()`.
   */
  adoptAttempted(keys: Iterable<string>): void {
    const shared = new Set(keys);
    // Retire the release memory for anything the shared copy no longer names.
    //
    // `released` exists so a copy read back from storage cannot resurrect a
    // lock this instance has already decided is safe to retry -- and once the
    // key has gone from that copy there is nothing left to resurrect. Anything
    // published under it afterwards is a *different* lock, taken by an instance
    // that never heard this instance's decision and is acting on it right now.
    // Refusing that forever is how two engines end up working one reservation,
    // and the settle sweep reaching `modify` and `swap` is what made it
    // routine: this instance releases its own move lock on plans evidence, the
    // key leaves the store with that same write, another tab legitimately takes
    // the action, and `hasAttempted` stays false here for the rest of the
    // session.
    //
    // Held until then rather than dropped at the release, because a lock this
    // instance adopted stays in the shared copy under its own owner's name:
    // `saveLocks` removes owner-scoped, so our release cannot withdraw it and
    // the next read would hand it straight back.
    //
    // For `modify` and `swap` this is bookkeeping and not the guarantee. What
    // actually keeps two instances off one reservation is the lease -- taken in
    // `AutopilotProvider` and held across the send in `startWhileHeld`, and
    // exclusive, expiring and owned in a way an attempt lock is not (see
    // `LockKind`). Fresh bookings lease the attraction they are about to
    // create; modify and swap lease the reservation being replaced. The
    // action lock remains the durable anti-thrash and unknown-outcome record
    // after that short-lived dispatch lease is released.
    for (const key of this.released) {
      if (!shared.has(key)) this.released.delete(key);
    }
    for (const key of shared) {
      if (this.released.has(key)) continue;
      if (LOCK_KEY.test(key)) this.attempted.add(key);
      else if (UNDATED_LOCK_KEY.test(key)) this.legacy.add(key);
      else if (!this.warned.has(key)) {
        this.warned.add(key);
        console.warn(`Ignoring an action lock of no known shape: ${key}`);
      }
    }
  }

  /**
   * Start a new park day in place, for an instance that did not remount.
   *
   * Everything day-scoped goes, locks included, because a lock exists to stop a
   * second action on an attraction *today*.
   *
   * `released` is cleared too, so nothing carries a decision made yesterday
   * into a day it says nothing about.
   */
  startNewDay(): void {
    this.attempted.clear();
    this.owned.clear();
    this.released.clear();
    this.unshared.clear();
    this.unresolved.clear();
    this.absences.clear();
    this.confirmed.clear();
    this.rehearsed.clear();
    this.legacy.clear();
    this.warned.clear();
    this.booked = 0;
  }

  get bookedCount(): number {
    return this.booked;
  }

  /** Whether this action is already taken, on the date this ledger is on. */
  hasAttempted(experienceId: string, kind: LockKind = 'book'): boolean {
    return (
      this.attempted.has(this.key(kind, experienceId)) ||
      this.legacy.has(undatedKey(kind, experienceId))
    );
  }

  /**
   * Attractions with a real lock of any kind on the current booking date.
   *
   * Includes actions that plainly succeeded, since those still need their lock
   * released once the reservation is cancelled by hand -- the ordinary case for
   * rebooking. Excludes dry-run marks, which stand for no request.
   *
   * One entry per attraction rather than per lock, because the *evidence* is
   * per reservation: one `findExistingLL` lookup answers the question for every
   * lock on that attraction and date. Two entries would call `resolveHeld`
   * twice for one poll and advance every live lock's absence counter twice,
   * defeating `CONFIRM_ABSENT_POLLS`.
   *
   * This replaces a getter that returned `book` locks only, which is the whole
   * of the second half of the defect: nothing swept `modify` or `swap`, so a
   * move made for one date blocked that action on every other date for the rest
   * of the session, with no evidence able to clear it.
   */
  get settleableIds(): string[] {
    const ids = new Set<string>();
    for (const key of this.attempted) {
      if (this.rehearsed.has(key)) continue;
      const parts = lockParts(key);
      if (parts && parts.date === this.date) ids.add(parts.experienceId);
    }
    // A date-less `book:` key blocks whatever date is asked about, so it has to
    // be settleable on whatever date is asked about too -- otherwise it would
    // block until the park day turned, where in the build that wrote it it
    // clears in two polls. `modify:`/`swap:` are deliberately absent: that build
    // sweeps `book:` alone, so it holds those for the rest of its park day, and
    // clearing them here would release on our evidence a lock the build still
    // holding it considers live.
    for (const key of this.legacy) {
      if (key.startsWith('book:')) ids.add(key.slice('book:'.length));
    }
    return [...ids];
  }

  /**
   * The locks that stand for a real request on this attraction, this date.
   *
   * Rehearsals are left out here rather than guarded against at each call site,
   * so "what is there to settle" has one answer.
   *
   * `evidence` is where this lock's own `confirmed`/`absences` live. It is the
   * lock key for a dated lock, and a date-scoped alias for a date-less one --
   * see `legacyEvidenceKey`. Each lock carrying its own is what keeps one
   * action's observations from certifying another's.
   */
  protected liveLocks(experienceId: string): {
    key: string;
    kind: LockKind;
    evidence: string;
    owned: boolean;
    dated: boolean;
  }[] {
    const locks: ReturnType<AutoBookLedger['liveLocks']> = [];
    for (const kind of LOCK_KINDS) {
      const key = this.key(kind, experienceId);
      if (this.attempted.has(key) && !this.rehearsed.has(key)) {
        locks.push({
          key,
          kind,
          evidence: key,
          owned: this.owned.has(key),
          dated: true,
        });
      }
      // `book` alone: the build that published date-less keys settles `book:`
      // and nothing else, so its `modify:`/`swap:` keys are still live there
      // and are not ours to clear. See `legacy`.
      if (kind !== 'book') continue;
      const undated = undatedKey(kind, experienceId);
      // Never owned, so never a doubt-hold of ours and never republished.
      if (this.legacy.has(undated)) {
        locks.push({
          key: undated,
          kind,
          evidence: legacyEvidenceKey(this.date, undated),
          owned: false,
          dated: false,
        });
      }
    }
    return locks;
  }

  /**
   * Record an attempt.
   *
   * Marked before the request goes out, not after. If a booking request times
   * out, it may still have succeeded server-side, so retrying is the dangerous
   * option -- better to skip and let the user see it in their plans.
   */
  markAttempted(
    experienceId: string,
    kind: LockKind = 'book',
    rehearsal = false
  ): () => void {
    const key = this.key(kind, experienceId);
    const before = {
      attempted: this.attempted.has(key),
      owned: this.owned.has(key),
      released: this.released.has(key),
      unshared: this.unshared.has(key),
      unresolved: this.unresolved.has(key),
      rehearsed: this.rehearsed.has(key),
      confirmed: this.confirmed.has(key),
      absences: this.absences.get(key),
    };
    const restore = () => {
      const set = (values: Set<string>, value: string, present: boolean) => {
        if (present) values.add(value);
        else values.delete(value);
      };
      set(this.attempted, key, before.attempted);
      set(this.owned, key, before.owned);
      set(this.released, key, before.released);
      set(this.unshared, key, before.unshared);
      set(this.unresolved, key, before.unresolved);
      set(this.rehearsed, key, before.rehearsed);
      set(this.confirmed, key, before.confirmed);
      if (before.absences === undefined) this.absences.delete(key);
      else this.absences.set(key, before.absences);
    };
    // A key locked again after being released is no longer released: leaving it
    // in the set would have `adoptAttempted` refuse to re-adopt this very lock,
    // and would have the next write subtract it again.
    this.released.delete(key);
    // A fresh request is a fresh doubt, so the lock is publishable again.
    this.unshared.delete(key);
    this.attempted.add(key);
    this.owned.add(key);
    // A dry run issues no request, so there is nothing to doubt and nothing to
    // settle -- it marks only so the rehearsal logs once. Recorded for every
    // kind now that the settle sweep covers every kind: a rehearsed move left
    // unmarked would be swept as if a request had gone out.
    if (rehearsal) this.rehearsed.add(key);
    else {
      // A real request supersedes a rehearsal of the same action. The dry-run
      // setting is read live, so it can be switched off between the rehearsal
      // and the request, and a mark left behind would keep the real attempt out
      // of the settle sweep for the rest of the session.
      this.rehearsed.delete(key);
      // A new request is a new question, so this lock starts with no evidence
      // against it. The key is fresh the first time round, but the same one is
      // taken again whenever a lock is given back and re-taken -- a retry after
      // a rejection, or NextLL repeating a move -- and whatever was observed
      // while the *previous* request was outstanding says nothing about this
      // one. Left behind, an absence counted before this request existed counts
      // toward releasing it, turning `CONFIRM_ABSENT_POLLS` into one poll.
      this.confirmed.delete(key);
      this.absences.delete(key);
      // Only a booking can create an entitlement that nothing else accounts for.
      if (kind === 'book') this.unresolved.add(key);
    }
    try {
      this.onAttemptChange();
    } catch (error) {
      restore();
      throw error;
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const wasPublishable = before.owned && !before.unshared;
      restore();
      this.onAttemptChange(wasPublishable ? undefined : [key]);
    };
  }

  /**
   * Settle a book attempt that provably never landed.
   *
   * The doubt exists because the lock is taken *before* the request goes out:
   * a timed-out booking may have succeeded server-side, so until a plans poll
   * says otherwise the attempt is neither a booking nor a non-booking. Disney
   * refusing the call outright, or our own limiter never sending it,
   * establishes that nothing was booked, so there is nothing left to settle.
   *
   * The attempt lock is deliberately *not* released. Autopilot keeps one action
   * per attraction per session, which is what stops it thrashing a reservation
   * while availability shifts; only NextLL wants the retry, and it has
   * `releaseAttempt` for that. This resolves the doubt without giving back the
   * action.
   */
  resolveRejected(experienceId: string): void {
    const key = this.key('book', experienceId);
    this.unresolved.delete(key);
    // The lock stays here and leaves the shared copy. Keeping it locally is
    // the anti-thrash rule above; keeping it *shared* would hand a permanent
    // skip to every other instance, since only the instance that owns a lock
    // can withdraw one and a rejection is proof there is nothing to protect.
    if (this.owned.has(key) && !this.unshared.has(key)) {
      this.unshared.add(key);
      this.onAttemptChange([key]);
    }
  }

  /**
   * Forget one action lock, so the same action can be taken again.
   *
   * Autopilot never does this: one booking and one move per attraction per
   * session is what stops it thrashing a reservation while availability
   * shifts. NextLL is the opposite case -- "keep moving it earlier" is its
   * entire purpose, a person is watching it, and every move still has to clear
   * the 30-minute improvement bar, so it converges on the earliest time
   * available rather than oscillating.
   */
  releaseAttempt(experienceId: string, kind: LockKind): void {
    const key = this.key(kind, experienceId);
    this.unshared.delete(key);
    this.attempted.delete(key);
    this.owned.delete(key);
    this.released.add(key);
    // This lock's own absence count goes with it. Left behind it is inherited
    // by the next lock on the same action -- which is reachable, because the
    // release memory above lasts only while the shared copy still names the
    // key: once this withdrawal has landed, another instance can take the same
    // action and this one adopts it. That fresh lock starting on a count this
    // one banked turns `CONFIRM_ABSENT_POLLS` into a single observation for it.
    //
    // `confirmed` is deliberately not dropped here, and it is not an omission.
    // It is read in one place, gated on the lock being *owned*, and a key
    // becomes owned only through `markAttempted`, which clears it there. A copy
    // left behind is unreachable, and a line that cannot be reached is a line a
    // later reader will preserve in place of the one that matters.
    this.absences.delete(key);
    const removals = [key];
    // A lock adopted in an older build's shape has no dated key to drop, and
    // dropping it here is what keeps this escape working as it did: before the
    // key carried a date, an adopted lock and this one were the same string, so
    // a release cleared both at once. Without it a search told to try again
    // would skip the attraction for the rest of the park day.
    const undated = undatedKey(kind, experienceId);
    if (this.legacy.delete(undated)) {
      this.released.add(undated);
      // Same rule, same reason: the count goes, and there is no `confirmed` to
      // drop because a date-less lock is never owned and so never consults one.
      this.absences.delete(legacyEvidenceKey(this.date, undated));
      removals.push(undated);
    }
    this.onAttemptChange(removals);
    // A book attempt is also held in doubt, on the chance that a request whose
    // outcome we never learned did succeed. This is only ever called for one we
    // did learn about -- Disney rejected it, or our own limiter never sent it --
    // so there is nothing left to doubt.
    if (kind === 'book') this.unresolved.delete(key);
  }

  /**
   * Record a confirmed booking.
   *
   * `experienceId` settles the matching unresolved attempt, and so is passed
   * only by the `book` path -- modifying and swapping never create doubt-holds
   * of their own, and passing an id from either would clear a *booking's*
   * outstanding doubt on that same attraction without accounting for it.
   */
  markBooked(experienceId?: string): void {
    if (experienceId !== undefined) {
      this.unresolved.delete(this.key('book', experienceId));
    }
    ++this.booked;
  }

  /**
   * Settle every action lock on one attraction against observed plans.
   *
   * Disney permits booking, cancelling, and rebooking the same attraction; the
   * only hard rule is that it can be *redeemed* once per day. A permanent
   * attempt lock is therefore stricter than the rules require, and costs a
   * genuine opportunity: cancel a late return time by hand and the earlier one
   * that drops an hour later would never be taken.
   *
   * So the lock is released by evidence rather than held for the session:
   *
   * - `stillHeld` -- the reservation exists. Keep the lock (a second booking
   *   would be rejected anyway), and if the attempt was still in doubt, count it
   *   as booked now, since `markBooked` never ran.
   * - `!stillHeld` -- nothing is held, so the attempt either failed or has been
   *   cancelled since. Both make rebooking legal.
   *
   * Two conditions gate a release, and both are needed:
   *
   * 1. The reservation must have been **seen held at least once**. For a
   *    booking never observed, absence cannot distinguish "it failed" from "the
   *    itinerary has not caught up", and acting on the latter rebooks something
   *    already held. An attempt that never confirms therefore keeps its lock for
   *    the session -- the conservative pre-existing behaviour, and no real loss:
   *    either it is held, making `modify` the useful action anyway, or it truly
   *    failed and next session retries it.
   * 2. Absence must then be seen `CONFIRM_ABSENT_POLLS` times running, so a
   *    single flaky itinerary response cannot release a live reservation.
   *
   * Poll count rather than elapsed time is deliberate but worth knowing. Plans
   * are fetched every tenth poll tick, so they are ~7.5 minutes apart at the
   * idle cadence and ~12 seconds apart in a drop burst; the two absences a
   * release needs therefore take ~15 minutes idle and ~24 seconds mid-drop. A
   * cancellation is noticed far faster during a drop, which is when it matters,
   * and condition 1 is what makes that 37x compression safe.
   *
   * `spent` closes the third case: an entitlement that has been redeemed, or
   * has expired unredeemed, is gone rather than cancelled. Eligibility usually
   * stops a rebooking attempt first, but not always -- and the lock is the
   * cheaper place to be certain.
   *
   * All three kinds are swept together, because the *observation* is one fact
   * about the reservation. Each lock is then judged on its own, against the
   * evidence gathered since it was taken, because a release hands back one
   * action:
   *
   * - For `modify` the reservation demonstrably existed when the lock was taken
   *   -- the provider only chooses that kind having found one -- so the very
   *   next poll confirms it and the lock then releases only once the reservation
   *   is genuinely gone, at which point there is nothing left to move.
   * - For `swap` the gained attraction was *not* held when the lock was taken,
   *   so absence cannot tell a failed swap from one that succeeded and was
   *   cancelled from an itinerary that has not caught up -- which is `book`'s
   *   situation exactly, and condition 1 handles it the same way.
   *
   * What it must not do is let one lock's evidence settle another's. A `modify`
   * lock confirmed at 10:00 is not a statement about a `book` request sent at
   * 10:15 whose response was lost; treating it as one releases the doubt-hold
   * on evidence from before the booking existed, and the attraction is booked a
   * second time. Hence `confirmed`/`absences` per lock -- see the class note.
   */
  resolveHeld(experienceId: string, stillHeld: boolean, spent = false): void {
    // A rehearsal stands for no request, so there is nothing to settle, and an
    // attraction carrying only rehearsals has nothing here at all.
    // `settleableIds` already excludes these; asking again keeps the invariant
    // true for any caller.
    const live = this.liveLocks(experienceId);
    if (live.length === 0) return;
    const booking = this.key('book', experienceId);
    if (stillHeld) {
      // Held is evidence for every live lock: it says the reservation each of
      // them acted on exists right now.
      for (const lock of live) {
        this.absences.delete(lock.evidence);
        this.confirmed.add(lock.evidence);
      }
      if (this.unresolved.delete(booking)) ++this.booked;
      return;
    }
    // A spent entitlement leaves plans exactly as a cancellation does, and
    // Disney will not sell it again: an unredeemed pass whose window lapses
    // counts as ridden. Releasing the lock here would have the booker keep
    // trying to rebook something that cannot be rebooked -- but an entitlement
    // cannot be spent unless a booking created it, so an attempt still in doubt
    // is hereby confirmed rather than left uncounted.
    if (spent) {
      for (const lock of live) this.absences.delete(lock.evidence);
      if (this.unresolved.delete(booking)) {
        ++this.booked;
      }
      return;
    }
    // Only the keys actually released are dropped and stated. Withdrawing all
    // three kinds regardless would put a key this instance never took into
    // `released`, and `adoptAttempted` would then refuse a later, legitimate
    // lock another instance takes on that action -- leaving two engines free to
    // act on it. This is now the ordinary way a `modify` or `swap` lock ends,
    // so how long that refusal lasts matters: see `adoptAttempted`, and note
    // there that for those two kinds the guarantee is the reservation lease and
    // this lock is anti-thrash bookkeeping on top of it.
    const removals: string[] = [];
    for (const lock of live) {
      // A lock this instance owns and has not seen held since taking it is
      // still in doubt: its request may have succeeded where the response was
      // lost, and only the doubt-hold settles that. An adopted one is different
      // -- nothing here ever confirms it, the instance that took it may be
      // gone, and plans saying the reservation is not there is the same
      // evidence for it as for one of ours. Judged lock by lock, so an owned
      // lock held in doubt no longer suppresses the release of an adopted lock
      // of another kind that this instance can say nothing about.
      if (lock.owned && !this.confirmed.has(lock.evidence)) continue;
      const seen = (this.absences.get(lock.evidence) ?? 0) + 1;
      if (seen < CONFIRM_ABSENT_POLLS) {
        this.absences.set(lock.evidence, seen);
        continue;
      }
      this.absences.delete(lock.evidence);
      this.confirmed.delete(lock.evidence);
      if (lock.dated) {
        this.attempted.delete(lock.key);
        this.owned.delete(lock.key);
        this.unshared.delete(lock.key);
        // Giving back the booking gives back its doubt with it: the lock was
        // the doubt-hold, and it only got here having been seen held and then
        // absent twice, which is the answer the doubt was waiting for.
        if (lock.kind === 'book') this.unresolved.delete(lock.key);
      } else {
        this.legacy.delete(lock.key);
      }
      this.released.add(lock.key);
      removals.push(lock.key);
    }
    // A cancellation settled here is a release like any other, and it has to
    // reach the shared copy. Without this the lock survives in storage and the
    // next mount adopts it, so the rebooking this branch exists to permit
    // never happens.
    if (removals.length > 0) this.onAttemptChange(removals);
  }

  /**
   * Clear this run's locks.
   *
   * The per-attraction locks are session state -- they exist so one run cannot
   * thrash a reservation -- and clearing them on every enable is right.
   */
  reset(): void {
    // Withdraw only what this instance put there. Clearing `attempted` alone
    // leaves the shared copy intact, and the first tick of the new run adopts
    // it straight back -- which made this reset a no-op for any lock that had
    // been persisted. A lock another instance holds is left alone: it is still
    // true, and that instance is still the one to release it.
    const mine = [...this.owned];
    this.attempted.clear();
    this.owned.clear();
    this.unshared.clear();
    this.unresolved.clear();
    this.absences.clear();
    this.confirmed.clear();
    this.rehearsed.clear();
    // Dropped like any other adopted lock, and re-read on the next tick for the
    // same reason: this instance never owned it, so it is not ours to withdraw
    // from the shared copy, and while it is still there it is still true.
    this.legacy.clear();
    this.warned.clear();
    this.booked = 0;
    if (mine.length > 0) this.onAttemptChange(mine);
  }
}

/**
 * Whether to try booking this target at all, before spending any request.
 *
 * Pure, so every guard is testable without a network or a clock.
 */
export function shouldAttempt(
  target: WatchTarget,
  ledger: Pick<AutoBookLedger, 'hasAttempted'>
): { ok: true } | { ok: false; reason: SkipReason } {
  // bookThenMove and autoSwap both imply booking when a slot is free.
  if (!target.autoBook && !target.bookThenMove && !target.autoSwap) {
    return { ok: false, reason: 'not-enabled' };
  }
  if (ledger.hasAttempted(target.experienceId)) {
    return { ok: false, reason: 'already-attempted' };
  }
  return { ok: true };
}

/**
 * Whether a generated offer is actually acceptable.
 *
 * This is the load-bearing guard. Matching runs against the tipboard's
 * `nextAvailableTime`, but the offer that comes back can carry a different --
 * usually later -- return time, because inventory moves between the two
 * requests and because the system sometimes places a third Lightning Lane
 * between two existing ones. Booking whatever came back would hand the user a
 * time they explicitly excluded, and a Lightning Lane is not free to undo.
 */
export function offerIsAcceptable(
  offer: Pick<Offer, 'start' | 'guests'>,
  target: WatchTarget
): { ok: true } | { ok: false; reason: SkipReason } {
  if (offer.guests.eligible.length === 0) {
    return { ok: false, reason: 'no-eligible-guests' };
  }
  if (!inWindow(offer.start.time, target)) {
    return { ok: false, reason: 'offer-outside-window' };
  }
  return { ok: true };
}

/**
 * What an action helper needs from the ledger, and nothing else.
 *
 * Structural rather than the class itself -- as `shouldAttempt`'s parameter
 * already is -- so a caller can hand in a wrapper instead of the instance.
 * `AutopilotProvider` does exactly that: the ledger holds one booking date at a
 * time and ticks overlap, so a helper's ledger calls have to be pinned to the
 * date the tick that started them captured. `markBooked` is the one that makes
 * this necessary: it runs *after* the booking round trip, and it clears the
 * doubt-hold for a lost response -- on whatever date the ledger happens to be
 * on by then, which need not be the date the booking was for.
 */
export type BookLedger = Pick<
  AutoBookLedger,
  'hasAttempted' | 'markAttempted' | 'markBooked' | 'bookedCount'
>;

export interface AutoBookDeps {
  /** Usually LLClient.offer, bound. */
  createOffer: (
    experience: OfferExperience,
    guests: Guest[]
  ) => Promise<Offer<undefined>>;
  /** Usually LLClient.book, bound. */
  /**
   * Whether the action is still wanted, asked immediately before committing.
   *
   * Generating an offer is a round trip, and the caller's guards were all
   * evaluated before it. Turning autopilot off, changing the day, pausing the
   * attraction or switching this action off during that window left the
   * booking to go through on a plan that no longer existed. This is the last
   * gate before an entitlement is spent, so it is asked last.
   *
   * Receives the offer's *real* return time, which is the only one worth
   * validating: the tipboard advertises a time, the offer can come back with
   * a later one, and a window narrowed while the offer was in flight has to
   * be judged against what would actually be booked.
   *
   * Optional: callers that have nothing to re-check may omit it.
   */
  stillWanted?: (returnTime: ParkTime) => boolean;
  book: (offer: Offer<undefined>, control?: RequestControl) => Promise<LLMP>;
  /** Built only after every offer guard passes, at the real dispatch boundary. */
  requestControl?: (returnTime: ParkTime) => RequestControl;
  /** Cached or freshly fetched eligibility for this experience. */
  guests: Guests;
  ledger: BookLedger;
  /** Optional; when it reports a clash, the offer is abandoned unbooked. */
  clashes?: ClashCheck;
  /**
   * Whether the party the offer would actually commit is acceptable.
   *
   * Distinct from the `guests` above, which is the eligibility the caller's
   * guards ran on. That is a prediction; the offer is the commitment, and the
   * two can disagree -- Disney can return an offer covering three of five when
   * eligibility said all five were fine. Checking only the prediction meant
   * "whole party only" could still book a Lightning Lane that split the group,
   * which is the one thing it exists to prevent.
   *
   * Optional, and only passed when the setting is on.
   */
  partyIsAcceptable?: (guests: Guests) => boolean;
}

/**
 * Try to book one matched attraction.
 *
 * Sequence is deliberate: check the cheap guards first, then generate the
 * offer, then re-check the offer's real return time, and only then book. An
 * offer that falls outside the window is abandoned rather than adjusted --
 * `changeOfferTime` costs another round trip and may not find anything better,
 * and the next poll tick will try again in about a second anyway.
 */
export async function attemptAutoBook(
  target: WatchTarget,
  experience: OfferExperience,
  {
    createOffer,
    book,
    guests,
    ledger,
    clashes,
    stillWanted,
    partyIsAcceptable,
    requestControl,
  }: AutoBookDeps
): Promise<AutoBookOutcome> {
  const allowed = shouldAttempt(target, ledger);
  if (!allowed.ok) return { status: 'skipped', reason: allowed.reason };

  if (guests.eligible.length === 0) {
    return { status: 'skipped', reason: 'no-eligible-guests' };
  }

  try {
    const offer = await createOffer(experience, guests.eligible);
    const acceptable = offerIsAcceptable(offer, target);
    if (!acceptable.ok) {
      return { status: 'skipped', reason: acceptable.reason };
    }
    // Re-checked against the offer's real time, not the advertised one: the
    // time that comes back is often later, and a Lightning Lane on top of a
    // dining reservation spends a slot to gain nothing.
    if (clashes?.(offer.start.time, offer.itinerary)) {
      return { status: 'skipped', reason: 'overlaps-plans' };
    }

    // The party the offer would commit, not the eligibility the guards ran on.
    // Asked here because the offer is the first thing that says who is actually
    // covered.
    if (partyIsAcceptable && !partyIsAcceptable(offer.guests)) {
      return { status: 'skipped', reason: 'partial-party' };
    }

    // Mark before booking: a timed-out request may still have succeeded, and
    // a duplicate booking is worse than a missed retry.
    if (stillWanted && !stillWanted(offer.start.time)) {
      return { status: 'skipped', reason: 'no-longer-wanted' };
    }
    const built = requestControl?.(offer.start.time);
    const control = withAttemptDispatch(built, () =>
      ledger.markAttempted(target.experienceId)
    );
    const booking = await book(offer, control);
    ledger.markBooked(target.experienceId);
    return { status: 'booked', booking, returnTime: offer.start.time };
  } catch (error) {
    // OfferError means no offer exists for this party right now, which is an
    // ordinary outcome mid-drop rather than a fault worth reporting loudly.
    if (error instanceof OfferError) {
      return { status: 'skipped', reason: 'no-eligible-guests' };
    }
    console.error(error);
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      // Carried out rather than left inside the message: a refusal is told
      // apart from an ordinary failure by its status, and reading that back
      // out of a formatted string would be guesswork.
      httpStatus: (error as { response?: { status?: number } })?.response
        ?.status,
      rejected: actionWasRejected(error),
    };
  }
}
