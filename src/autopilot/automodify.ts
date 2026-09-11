import { Booking, LLMP, isLLMP } from '@/api/itinerary';
import { Guest, Guests, Offer, OfferError, OfferExperience } from '@/api/ll';
import { ParkTime, parkDate } from '@/datetime';

import { AutoBookLedger, ClashCheck, actionWasRejected } from './autobook';
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
  | 'budget-exhausted'
  | 'no-eligible-guests'
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
  ledger: Pick<AutoBookLedger, 'hasAttempted' | 'remaining'>,
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
  if (ledger.remaining <= 0) return { ok: false, reason: 'budget-exhausted' };
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
  book: (offer: Offer<LLMP>) => Promise<LLMP>;
  guests: Guests;
  ledger: AutoBookLedger;
  minImprovementMinutes?: number;
  /** Optional; when it reports a clash, the move is abandoned. */
  clashes?: ClashCheck;
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

    /**
     * What is *actually* held, taken from the offer's own itinerary in
     * preference to the plans snapshot this tick started with.
     *
     * "Never trade down" is only as good as the time it compares against, and
     * plans are polled every tenth tick -- around seven and a half minutes apart
     * at the idle cadence, and this same function is what moves the reservation
     * in between. So the snapshot could name a return time nobody held any more,
     * and the comparison was then against fiction: a genuinely better offer
     * reading as a downgrade and being refused, or in the mirror case a worse
     * one reading as a gain and being taken. The offer response carries Disney's
     * own view as of the offer, which is the freshest thing available and costs
     * no extra request.
     *
     * Matched on `facilityId` because `OfferItineraryItem` carries no
     * entitlement id. The clash check below already relies on this itinerary
     * containing the reservation being modified -- that is what it excludes by
     * `release` -- so it is normally present.
     *
     * Falls back to the snapshot when it is absent rather than refusing to act.
     * Absence probably means the reservation is genuinely gone, but if Disney
     * ever omits the item under modification instead, skipping here would stop
     * every move working, and that is the more expensive way to be wrong. The
     * fallback is no worse than the behaviour this replaces.
     */
    const heldNow = offer.itinerary.find(
      item => item.facilityId === allowed.existing.facilityId
    );
    const from = heldNow?.startTime ?? allowed.existing.start.time;

    if (offer.guests.eligible.length === 0) {
      return { status: 'skipped', reason: 'no-eligible-guests' };
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
    ledger.markAttempted(target.experienceId, 'modify');
    const booking = await book(offer);
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
