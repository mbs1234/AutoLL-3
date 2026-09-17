import type { RequestControl } from '@/api/client';
import { Booking, LLMP, isLLMP } from '@/api/itinerary';
import { Guest, Guests, Offer, OfferError, OfferExperience } from '@/api/ll';
import { ParkTime, parkDate } from '@/datetime';

import {
  AutoBookLedger,
  ClashCheck,
  actionWasRejected,
  withAttemptDispatch,
} from './autobook';
import { WatchTarget, inWindow } from './watchlist';

/**
 * Smallest gain worth modifying an existing booking for, in minutes.
 *
 * Modifying is not free: it spends requests, and it puts a reservation you
 * already hold through a round trip. Trading a 7:10pm return for a 6:55pm one
 * is not worth that, so small improvements are ignored.
 */
export const MIN_IMPROVEMENT_MINUTES = 30;

/**
 * The smallest gain a search the user named a time for will accept.
 *
 * One minute rather than zero: a "move" to the same time is not a move, and
 * spending a modify to achieve nothing is the one outcome worse than not
 * moving. What is *wanted* is decided by the target's bounds, which
 * `inWindow` already enforces in both directions; this only rules out the
 * no-op.
 */
export const MIN_TARGETED_IMPROVEMENT_MINUTES = 1;

/**
 * The bar this move has to clear.
 *
 * A target may ask for a lower bar than the unattended default, because a
 * person standing in front of the screen asking for a particular slot is not
 * the case the 30-minute rule was written for. It may not ask for a *higher*
 * one, and it may not ask for zero or a negative -- clamped here rather than
 * at the storage boundary so that every caller is covered, including a
 * hand-edited watch list.
 */
export function improvementBar(target: {
  minImprovementMinutes?: number;
}): number {
  const asked = target.minImprovementMinutes;
  if (asked === undefined || !Number.isFinite(asked)) {
    return MIN_IMPROVEMENT_MINUTES;
  }
  return Math.min(
    MIN_IMPROVEMENT_MINUTES,
    Math.max(MIN_TARGETED_IMPROVEMENT_MINUTES, asked)
  );
}

export type ModifySkipReason =
  | 'not-enabled'
  | 'no-longer-wanted'
  | 'no-existing-booking'
  | 'not-modifiable'
  | 'not-an-improvement'
  | 'offer-outside-window'
  | 'offer-not-an-improvement'
  | 'already-attempted'
  | 'no-eligible-guests'
  | 'partial-party'
  | 'overlaps-plans';

export type ModifyOutcome =
  | { status: 'modified'; booking: LLMP; from: ParkTime; to: ParkTime }
  | { status: 'skipped'; reason: ModifySkipReason }
  | {
      status: 'failed';
      error: string;
      /** The HTTP status, when there was one. */ httpStatus?: number;
      /** Whether the reservation certainly did not move, so a retry is safe. */
      rejected?: boolean;
    };

/**
 * The party's existing Multi Pass reservation for an attraction on a given
 * park day, if any.
 *
 * The date filter is not optional in practice. The itinerary request sends a
 * start date with no end date, so pre-booked selections for later days come
 * back alongside today's -- without this, watching Slinky Dog today could
 * match tomorrow's reservation and try to "improve" it with today's offer.
 * `parkDate` rather than the raw date: a 1am return time belongs to the
 * previous park day.
 */
export function findExistingLL(
  plans: Booking[],
  experienceId: string,
  date: string
): LLMP | undefined {
  return plans.find(
    (booking): booking is LLMP =>
      isLLMP(booking) &&
      booking.facilityId === experienceId &&
      parkDate(booking.start) === date
  );
}

/**
 * Minutes earlier `candidate` is than `current`. Negative means later.
 *
 * `ParkTime.valueOf()` measures from a 4am day start, so an evening booking
 * and an after-midnight one still compare in the right direction.
 */
export function improvementMinutes(
  current: ParkTime,
  candidate: ParkTime
): number {
  return (+current - +candidate) / 60;
}

/**
 * Whether an advertised time is worth trying to modify to, before spending
 * any request.
 */
export function shouldModify(
  target: WatchTarget,
  existing: LLMP | undefined,
  candidateTime: ParkTime,
  ledger: Pick<AutoBookLedger, 'hasAttempted'>,
  minImprovementMinutes = improvementBar(target)
): { ok: true; existing: LLMP } | { ok: false; reason: ModifySkipReason } {
  // bookThenMove implies moving.
  if (!target.autoModify && !target.bookThenMove) {
    return { ok: false, reason: 'not-enabled' };
  }
  if (!existing) return { ok: false, reason: 'no-existing-booking' };
  // Redemption state, park-hopping rules and Disney's own flags can all make a
  // reservation fixed; the API would reject the attempt anyway.
  if (!existing.modifiable) return { ok: false, reason: 'not-modifiable' };
  if (ledger.hasAttempted(target.experienceId, 'modify')) {
    return { ok: false, reason: 'already-attempted' };
  }
  if (!inWindow(candidateTime, target)) {
    return { ok: false, reason: 'offer-outside-window' };
  }
  if (
    improvementMinutes(existing.start.time, candidateTime) <
    minImprovementMinutes
  ) {
    return { ok: false, reason: 'not-an-improvement' };
  }
  return { ok: true, existing };
}

/**
 * What Disney itself says is held, as of the offer -- or nothing, if the offer
 * did not say.
 *
 * The offer response carries Disney's own view at the moment the offer was
 * made, which is the freshest thing available and costs no extra request.
 * Matched on `facilityId` because `OfferItineraryItem` carries no entitlement
 * id. The clash check relies on this itinerary containing the reservation being
 * changed -- that is what it excludes by `release` -- so it is normally present.
 *
 * Undefined when it is not. The decision may fall back to the caller's
 * snapshot, but the user-facing mutation record must not present a stale
 * snapshot as something the offer itself established.
 */
export function offerBaseline(
  offer: Pick<Offer<LLMP>, 'itinerary'>,
  held: Pick<LLMP, 'facilityId'>
): ParkTime | undefined {
  return offer.itinerary.find(item => item.facilityId === held.facilityId)
    ?.startTime;
}

/**
 * The return time to *decide* against: Disney's view where it gave one, and the
 * caller's snapshot where it did not.
 *
 * "Never trade down" is only as good as the time it compares against, and plans
 * are polled every tenth tick -- around seven and a half minutes apart at the
 * idle cadence, and these helpers are what move the reservation in between. So
 * the snapshot could name a return time nobody held any more, and the
 * comparison was then against fiction: a genuinely better offer reading as a
 * downgrade and being refused, or in the mirror case a worse one reading as a
 * gain and being taken.
 *
 * Falling back to the snapshot is right *here*. Absence probably means the
 * reservation is genuinely gone, but if Disney ever omits the item under
 * modification instead, refusing would stop every move working, and that is the
 * more expensive way to be wrong.
 *
 * It is not reported as the offer's own baseline, which is why
 * `onCommitting` uses `offerBaseline` instead. Quarantine now clears only on
 * the exact requested destination, but its explanation should still distinguish
 * what Disney vouched for from what came from an older Plans snapshot.
 */
export function commitBaseline(
  offer: Pick<Offer<LLMP>, 'itinerary'>,
  held: Pick<LLMP, 'facilityId' | 'start'>
): ParkTime {
  return offerBaseline(offer, held) ?? held.start.time;
}

export interface AutoModifyDeps {
  /** LLClient.offer bound with the existing booking, so it hits /mod. */
  createModifyOffer: (
    experience: OfferExperience,
    guests: Guest[],
    booking: LLMP
  ) => Promise<Offer<LLMP>>;
  /** LLClient.book -- routes to modify() when the offer carries a booking. */
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
  book: (offer: Offer<LLMP>, control?: RequestControl) => Promise<LLMP>;
  /** Build transport control after every offer guard has passed. */
  requestControl?: (change: {
    from?: ParkTime;
    to: ParkTime;
  }) => RequestControl;
  guests: Guests;
  ledger: AutoBookLedger;
  minImprovementMinutes?: number;
  /** Optional; when it reports a clash, the move is abandoned. */
  clashes?: ClashCheck;
  /**
   * Whether the party the offer actually covers is acceptable.
   *
   * The same re-check `attemptAutoBook` makes, for the same reason: the guards
   * upstream run on a cached eligibility prediction, and Disney can return an
   * offer covering fewer guests than that. It was wired to booking only, so
   * "whole party only" -- whose own wording promises autopilot "will not book,
   * move, or swap unless everyone in your party is eligible" -- let a move or a
   * swap split the group it exists to keep together.
   *
   * Optional, and only passed when the setting is on.
   */
  partyIsAcceptable?: (guests: Guests) => boolean;
  /**
   * What the request is about to do, reported at the instant it goes out.
   *
   * `from` is the reservation's return time as the *offer* reported it, and is
   * absent when the offer did not name it -- deliberately, because the caller's
   * snapshot is not something the offer vouched for. `to` is the exact time
   * being committed to and the only automatic Plans evidence for a modify.
   *
   * With a controlled request this is called by `ApiClient` after sensor
   * generation, on the last instruction before the fetch starts. Without one
   * it falls back to immediately before `book()` for legacy callers.
   */
  onCommitting?: (change: { from?: ParkTime; to: ParkTime }) => void;
}

/**
 * Try to move an existing reservation to a better time.
 *
 * The guard that matters more here than anywhere else: the modify offer that
 * comes back can carry a *different* time than the tipboard advertised, and
 * it can be later than the reservation already held. Booking that would
 * actively make the day worse -- trading an 11am return for a 7pm one -- which
 * is a failure mode plain booking does not have. So the offer's real time is
 * re-checked for both the window and the improvement threshold before
 * anything is committed.
 *
 * Attempts share the booking ledger, so autopilot takes at most one action per
 * attraction per session. That prevents thrash -- repeatedly modifying the
 * same reservation as times shift around -- and keeps modifications inside the
 * same session cap as fresh bookings.
 */
export async function attemptAutoModify(
  target: WatchTarget,
  experience: OfferExperience,
  existing: LLMP | undefined,
  candidateTime: ParkTime,
  {
    createModifyOffer,
    book,
    stillWanted,
    guests,
    ledger,
    minImprovementMinutes = improvementBar(target),
    clashes,
    partyIsAcceptable,
    onCommitting,
    requestControl,
  }: AutoModifyDeps
): Promise<ModifyOutcome> {
  const allowed = shouldModify(
    target,
    existing,
    candidateTime,
    ledger,
    minImprovementMinutes
  );
  if (!allowed.ok) return { status: 'skipped', reason: allowed.reason };
  if (guests.eligible.length === 0) {
    return { status: 'skipped', reason: 'no-eligible-guests' };
  }

  try {
    const offer = await createModifyOffer(
      experience,
      guests.eligible,
      allowed.existing
    );
    const to = offer.start.time;

    // The decision baseline. The mutation record below separately reports only
    // the offer's own view, so its explanation never invents a `from` value.
    const from = commitBaseline(offer, allowed.existing);

    if (offer.guests.eligible.length === 0) {
      return { status: 'skipped', reason: 'no-eligible-guests' };
    }
    // The party the offer would commit, not the eligibility the guards ran on.
    if (partyIsAcceptable && !partyIsAcceptable(offer.guests)) {
      return { status: 'skipped', reason: 'partial-party' };
    }
    if (!inWindow(to, target)) {
      return { status: 'skipped', reason: 'offer-outside-window' };
    }
    // Never trade down. This is the whole point of re-checking.
    if (improvementMinutes(from, to) < minImprovementMinutes) {
      return { status: 'skipped', reason: 'offer-not-an-improvement' };
    }
    // An earlier time that lands on top of dinner is not an improvement.
    if (clashes?.(to, offer.itinerary, allowed.existing)) {
      return { status: 'skipped', reason: 'overlaps-plans' };
    }

    // Marked before committing: a timed-out modify may still have applied, and
    // re-running it could move a reservation twice.
    if (stillWanted && !stillWanted(to)) {
      return { status: 'skipped', reason: 'no-longer-wanted' };
    }
    const change = { from: offerBaseline(offer, allowed.existing), to };
    const built = requestControl?.(change);
    const control = withAttemptDispatch(
      built,
      () => ledger.markAttempted(target.experienceId, 'modify'),
      () => onCommitting?.(change)
    );
    const booking = await book(offer, control);
    ledger.markBooked();
    return { status: 'modified', booking, from, to };
  } catch (error) {
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
