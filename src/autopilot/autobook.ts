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
 * Cap on automatic actions per park day.
 *
 * A runaway booker is expensive in a way a runaway poller is not: every action
 * consumes a real entitlement and may displace one already held. So there is a
 * cap, and bookings, moves and swaps share it.
 *
 * It counts the *day*, not the session, because a session-scoped cap did not
 * bound anything. The ledger lived in a `useRef`, so turning autopilot off and
 * on refilled it -- and so did a plain page reload, which on a phone that
 * backgrounds a tab mid-day is the ordinary path rather than the exotic one.
 * The number that was meant to be a safety limit was in practice a limit on
 * how many actions could happen between reloads, which is not a quantity
 * anyone cares about.
 *
 * Ten rather than three: a day-scoped budget has to cover a whole park day of
 * legitimate booking, and three was calibrated against a cap that refilled
 * itself. Refills are still available, deliberately, but now they are a
 * decision rather than a side effect of the page reloading.
 */
export const DEFAULT_ACTIONS_PER_DAY = 10;

/** Floor and ceiling on the day's allowance, applied to every path that sets it. */
export const MIN_ACTIONS_PER_DAY = 1;
/**
 * The day's hard ceiling, enforced on the effective budget rather than only on
 * the setting.
 *
 * The setting, the persisted refill total, and their sum are each clamped to
 * it. Clamping only the setting would leave the refill total -- a number
 * persisted in localStorage and therefore editable -- able to remove the limit
 * entirely, which is the exact failure the ceiling exists to prevent.
 *
 * It is a headroom limit, not a recommendation: the default of ten is what
 * anyone gets without asking, and this only bounds how far someone who has
 * decided otherwise can raise it. Fifty is well above a plausible park day,
 * which is the point -- it should never be the thing standing between a real
 * day's booking and a top-up, only between a bug and the whole day.
 */
export const MAX_ACTIONS_PER_DAY = 50;

/** How many actions one refill grants, up to `MAX_ACTIONS_PER_DAY`. */
export const REFILL_ACTIONS = 3;

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
  | 'budget-exhausted'
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
 * - `RateLimitExceeded`, which our own limiter throws as the first statement
 *   of `ApiClient.request`, before anything is sent.
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
  if (error instanceof RateLimitExceeded) return true;
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status === undefined) return false;
  if (status === REFUSAL_STATUS || status === THROTTLE_STATUS) return false;
  return status >= 400 && status < 500;
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
 * Per-session record of what the booker has done.
 *
 * Attempts are recorded per action kind, not per attraction. Booking an
 * attraction and later moving that same booking to a better time are two
 * distinct, each-once actions -- and the book-then-move strategy depends on
 * the second not being blocked by the first. Thrash is still bounded: at most
 * one booking and one move per attraction per session.
 */
export class AutoBookLedger {
  protected attempted = new Set<string>();
  protected booked = 0;
  /**
   * Booking attempts committed but not yet confirmed either way.
   *
   * A booking request that throws leaves real doubt: it may have succeeded
   * server-side. Until a later plans poll settles it, such an attempt counts
   * against the session allowance exactly as a confirmed booking does, so the
   * cap bounds *entitlements possibly spent* rather than only those observed.
   * Keyed by experience id; only `book` attempts land here, since only they
   * can create an entitlement that nothing else accounts for.
   */
  protected unresolved = new Set<string>();
  /** Consecutive polls each attraction has been observed unheld. */
  protected absences = new Map<string, number>();
  /**
   * Bookings seen held in plans at least once.
   *
   * The gate on releasing a lock. Absence only means "cancelled" for a
   * reservation we watched exist; for one we never saw, it is indistinguishable
   * from an itinerary that has not caught up yet -- and releasing on that would
   * rebook something already held.
   */
  protected confirmed = new Set<string>();
  /**
   * Dry-run marks: log-once bookkeeping for a request that never went out.
   *
   * Held apart from real attempts so a rehearsal neither consumes the session
   * allowance nor takes part in settling, which would re-log it every time the
   * lock released.
   */
  protected rehearsed = new Set<string>();
  /**
   * Locks this instance has explicitly let go of (`releaseAttempt`, or
   * `resolveBook` settling a cancellation), kept for the life of the instance.
   *
   * `adoptAttempted` consults this so that re-reading a lock another tab (or
   * an earlier save from this one) persisted cannot resurrect a lock this
   * instance already decided was safe to retry.
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
   * @param budget         today's ceiling: the setting plus any refills granted.
   * @param carried        actions already charged earlier today, from storage.
   * @param onSpend        called with the new total whenever the charge
   *                       changes, so the day's spend survives the reload
   *                       that used to reset it.
   * @param onAttemptChange called whenever a lock is taken or released, so a
   *                       caller sharing this state across tabs can persist
   *                       and re-read it -- see `attemptedKeys`/`adoptAttempted`.
   *                       Its argument lists keys to *remove* from the shared
   *                       copy: adding is inferred from `attemptedKeys()`, but a
   *                       release has to be stated, or a union-only write can
   *                       never let one go.
   */
  constructor(
    protected budget = DEFAULT_ACTIONS_PER_DAY,
    protected carried = 0,
    protected readonly onSpend: (spent: number) => void = () => undefined,
    protected readonly onAttemptChange: (
      released?: readonly string[]
    ) => void = () => undefined
  ) {}

  /**
   * This instance's locks, for a caller to persist.
   *
   * A plain snapshot rather than a live reference: callers must not mutate
   * the ledger's own set through it.
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
   * Adopt locks taken elsewhere -- another tab's ledger, most often -- without
   * disturbing this instance's own bookkeeping for them.
   *
   * Union only: a key already held locally is left as this instance recorded
   * it, and nothing here is ever removed by adoption -- except a key this
   * instance has itself explicitly released (see `released`), which stays
   * released rather than being re-locked by a stale copy read back from
   * storage.
   */
  adoptAttempted(keys: Iterable<string>): void {
    for (const key of keys) {
      if (!this.released.has(key)) this.attempted.add(key);
    }
  }

  /** Everything charged against today: earlier runs, this run, and doubt-holds. */
  get spent(): number {
    return this.carried + this.booked + this.unresolved.size;
  }

  /** Today's ceiling, for display. */
  get budgetToday(): number {
    return this.budget;
  }

  /** Raise or lower the day's ceiling. Never changes what has been spent. */
  setBudget(budget: number): void {
    this.budget = budget;
  }

  /**
   * Start a new park day in place, for an instance that did not remount.
   *
   * Distinct from `reset()`, which deliberately keeps the day's spend: turning
   * autopilot off and on must not be a way to get more actions. A new park day
   * is the opposite case -- the allowance genuinely renews, and yesterday's
   * spend is not a charge against today. Everything day-scoped goes with it,
   * locks included, because a lock exists to stop a second action on an
   * attraction *today*.
   *
   * `released` is cleared too, so nothing carries a decision made yesterday
   * into a day it says nothing about.
   */
  startNewDay(carried = 0): void {
    this.carried = carried;
    this.attempted.clear();
    this.owned.clear();
    this.released.clear();
    this.unshared.clear();
    this.unresolved.clear();
    this.absences.clear();
    this.confirmed.clear();
    this.rehearsed.clear();
    this.booked = 0;
    this.notify();
  }

  protected notify(): void {
    this.onSpend(this.spent);
  }

  get bookedCount(): number {
    return this.booked;
  }

  get remaining(): number {
    return Math.max(0, this.budget - this.spent);
  }

  hasAttempted(experienceId: string, kind: ActionKind = 'book'): boolean {
    return this.attempted.has(`${kind}:${experienceId}`);
  }

  /**
   * Experiences carrying a real `book` attempt, settled or not.
   *
   * Includes bookings that plainly succeeded, since those still need their
   * lock released once the reservation is cancelled by hand -- the ordinary
   * case for rebooking. Excludes dry-run marks, which stand for no request.
   */
  get attemptedBookIds(): string[] {
    const prefix = 'book:';
    return [...this.attempted]
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length))
      .filter(id => !this.rehearsed.has(id));
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
    kind: ActionKind = 'book',
    rehearsal = false
  ): void {
    const key = `${kind}:${experienceId}`;
    // A key locked again after being released is no longer released: leaving it
    // in the set would have `adoptAttempted` refuse to re-adopt this very lock,
    // and would have the next write subtract it again.
    this.released.delete(key);
    // A fresh request is a fresh doubt, so the lock is publishable again.
    this.unshared.delete(key);
    this.attempted.add(key);
    this.owned.add(key);
    this.onAttemptChange();
    if (kind !== 'book') return;
    // A dry run issues no request, so there is nothing to doubt and nothing to
    // settle -- it marks only so the rehearsal logs once.
    if (rehearsal) this.rehearsed.add(experienceId);
    else this.unresolved.add(experienceId);
    this.notify();
  }

  /**
   * Give back the doubt-hold for a book attempt that provably never landed.
   *
   * The hold exists because the lock is taken *before* the request goes out: a
   * timed-out booking may have succeeded server-side, so the allowance treats
   * it as spent until plans say otherwise. That is right when the outcome is
   * unknown and needless when it is not. Disney refusing the call outright, or
   * our own limiter never sending it, establishes that nothing was booked --
   * and leaving the hold then charged the day for a booking that does not
   * exist, which on the default allowance of ten is a tenth of the day gone per
   * lost race.
   *
   * The attempt lock is deliberately *not* released. Autopilot keeps one action
   * per attraction per session, which is what stops it thrashing a reservation
   * while availability shifts; only NextLL wants the retry, and it has
   * `releaseAttempt` for that. This gives back the charge without giving back
   * the action.
   */
  resolveRejected(experienceId: string): void {
    if (this.unresolved.delete(experienceId)) this.notify();
    // The lock stays here and leaves the shared copy. Keeping it locally is
    // the anti-thrash rule above; keeping it *shared* would hand a permanent
    // skip to every other instance, since only the instance that owns a lock
    // can withdraw one and a rejection is proof there is nothing to protect.
    const key = `book:${experienceId}`;
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
  releaseAttempt(experienceId: string, kind: ActionKind): void {
    const key = `${kind}:${experienceId}`;
    this.unshared.delete(key);
    this.attempted.delete(key);
    this.owned.delete(key);
    this.released.add(key);
    this.onAttemptChange([key]);
    // A book attempt also takes a doubt-hold against the allowance, on the
    // chance that a request whose outcome we never learned did succeed. This
    // is only ever called for one we did learn about -- Disney rejected it,
    // or our own limiter never sent it -- so there is nothing left to doubt,
    // and leaving the hold would charge the day for a booking that does not
    // exist.
    if (kind === 'book' && this.unresolved.delete(experienceId)) this.notify();
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
    if (experienceId !== undefined) this.unresolved.delete(experienceId);
    ++this.booked;
    this.notify();
  }

  /**
   * Settle a `book` attempt against observed plans.
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
   *   would be rejected anyway), and if the attempt was still in doubt, charge
   *   the allowance now, since `markBooked` never ran.
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
   */
  resolveBook(experienceId: string, stillHeld: boolean, spent = false): void {
    // A rehearsal stands for no request, so there is nothing to settle.
    // `attemptedBookIds` already excludes these; guarding here too keeps the
    // invariant true for any caller.
    if (this.rehearsed.has(experienceId)) return;
    if (stillHeld) {
      this.absences.delete(experienceId);
      this.confirmed.add(experienceId);
      if (this.unresolved.delete(experienceId)) ++this.booked;
      this.notify();
      return;
    }
    // A spent entitlement leaves plans exactly as a cancellation does, and
    // Disney will not sell it again: an unredeemed pass whose window lapses
    // counts as ridden. Releasing the lock here would spend the session
    // allowance rebooking something that cannot be rebooked -- but an
    // entitlement cannot be spent unless a booking created it, so an attempt
    // still in doubt is hereby confirmed rather than left uncounted.
    if (spent) {
      this.absences.delete(experienceId);
      if (this.unresolved.delete(experienceId)) {
        ++this.booked;
        this.notify();
      }
      return;
    }
    if (!this.confirmed.has(experienceId)) {
      // A lock this instance owns but has never seen held is still in doubt:
      // the request may have succeeded where the response was lost, and only
      // the doubt-hold settles that.
      if (this.owned.has(`book:${experienceId}`)) return;
      // An adopted one is different. Nothing here ever confirms it, the
      // instance that took it may be gone, and until this branch existed no
      // evidence could release it. Plans saying the reservation is not there
      // is the same evidence for an adopted lock as for one of ours, so it is
      // counted the same way.
      if (!this.attempted.has(`book:${experienceId}`)) return;
    }
    const seen = (this.absences.get(experienceId) ?? 0) + 1;
    if (seen < CONFIRM_ABSENT_POLLS) {
      this.absences.set(experienceId, seen);
      return;
    }
    this.absences.delete(experienceId);
    this.confirmed.delete(experienceId);
    this.unresolved.delete(experienceId);
    this.attempted.delete(`book:${experienceId}`);
    this.owned.delete(`book:${experienceId}`);
    this.unshared.delete(`book:${experienceId}`);
    this.released.add(`book:${experienceId}`);
    this.notify();
    // A cancellation settled here is a release like any other, and it has to
    // reach the shared copy. Without this the lock survives in storage and the
    // next mount adopts it, so the rebooking this branch exists to permit
    // never happens.
    this.onAttemptChange([`book:${experienceId}`]);
  }

  /**
   * Clear this run's locks, keeping the day's charge.
   *
   * The per-attraction locks are session state -- they exist so one run cannot
   * thrash a reservation -- and clearing them on every enable is right. What is
   * deliberately *not* cleared is the spend: it folds into `carried` first, so
   * turning autopilot off and on is no longer how you get more actions. That
   * used to be the only refill there was, and it came bundled with a wipe of
   * the drop-detection baseline, so buying three more actions cost the first
   * poll's ability to see a drop at all.
   */
  reset(): void {
    this.carried = this.spent;
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
    this.booked = 0;
    this.notify();
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
  ledger: Pick<AutoBookLedger, 'hasAttempted' | 'remaining'>
): { ok: true } | { ok: false; reason: SkipReason } {
  // bookThenMove and autoSwap both imply booking when a slot is free.
  if (!target.autoBook && !target.bookThenMove && !target.autoSwap) {
    return { ok: false, reason: 'not-enabled' };
  }
  if (ledger.hasAttempted(target.experienceId)) {
    return { ok: false, reason: 'already-attempted' };
  }
  if (ledger.remaining <= 0) return { ok: false, reason: 'budget-exhausted' };
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
  book: (offer: Offer<undefined>) => Promise<LLMP>;
  /** Cached or freshly fetched eligibility for this experience. */
  guests: Guests;
  ledger: AutoBookLedger;
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
    ledger.markAttempted(target.experienceId);
    const booking = await book(offer);
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
