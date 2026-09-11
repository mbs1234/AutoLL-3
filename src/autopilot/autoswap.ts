import { Booking, LLMP, isLLMP, isMultipleExperiences } from '@/api/itinerary';
import { Guest, Guests, Offer, OfferError, OfferExperience } from '@/api/ll';
import { ParkTime, parkDate } from '@/datetime';

import { AutoBookLedger, ClashCheck, actionWasRejected } from './autobook';
import { comparePriority, isTier1 } from './priority';
import { WatchTarget, inWindow } from './watchlist';

/**
 * How many Multi Pass reservations a party can hold at once.
 *
 * Swapping only makes sense when the party is full: with a slot free, a fresh
 * booking keeps both attractions, so that is always the better move.
 */
export const MAX_HELD_MP = 3;

export type SwapSkipReason =
  | 'not-enabled'
  | 'no-longer-wanted'
  | 'already-held'
  | 'not-full'
  | 'no-worse-reservation'
  | 'offer-outside-window'
  | 'already-attempted'
  | 'budget-exhausted'
  | 'no-eligible-guests'
  | 'overlaps-plans';

export type SwapOutcome =
  | {
      status: 'swapped';
      booking: LLMP;
      replaced: { name: string; time: ParkTime };
      to: ParkTime;
    }
  | { status: 'skipped'; reason: SwapSkipReason }
  | {
      status: 'failed';
      error: string;
      /** The HTTP status, when there was one. */ httpStatus?: number;
      /** Whether nothing was swapped, so a retry is safe. */
      rejected?: boolean;
    };

/**
 * Every Multi Pass reservation that occupies one of the party's three slots
 * on a given park day.
 *
 * "Held" has to mean "still taking up a slot", not merely "present in the
 * itinerary", because this is what decides whether the party is full:
 *
 * - **Redeemed.** `Itinerary` drops guests with `redemptionsRemaining === 0`
 *   but keeps the booking, so a fully-redeemed reservation survives with an
 *   empty `guests` array. Counting it means that after the first tap-in of the
 *   day autopilot believes the party is full and swaps away a reservation it
 *   never needed to give up, rather than booking into the slot that just came
 *   free.
 * - **Not cancellable.** The same signal `LLTracker` already treats as "this
 *   still occupies a slot"; the two paths disagreeing about what held means is
 *   how the bug above went unnoticed.
 * - **Multiple Experiences Pass.** A replacement entitlement rather than one
 *   of the three selections. A guard at the boundary rather than a live fix:
 *   Disney converts a pass by changing its kind, so `isLLMP` above already
 *   rejects every such pass the parser can currently produce. It stays because
 *   this is where arbitrary plans enter, and because getting it wrong costs a
 *   real reservation to a needless swap.
 */
export function heldMPToday(plans: Booking[], date: string): LLMP[] {
  return plans.filter(
    (booking): booking is LLMP =>
      isLLMP(booking) &&
      parkDate(booking.start) === date &&
      !!booking.cancellable &&
      booking.guests.length > 0 &&
      !isMultipleExperiences(booking)
  );
}

type Ranked = Pick<OfferExperience, 'id' | 'priority' | 'tier' | 'avgWait'>;

/**
 * Which held reservation to give up for `incoming`, if any.
 *
 * Only a reservation ranked strictly worse than the incoming attraction is a
 * candidate -- swapping sideways or downward would spend a request to make the
 * day no better. Among candidates, prefer giving up a non-Tier-1 (Wait Magic:
 * "particularly a Tier 2 attraction, that isn't very hard to claim again
 * later"), then the worst-ranked. Unmodifiable reservations are excluded, as
 * Disney would refuse them anyway.
 */
export function chooseSwapVictim(
  held: LLMP[],
  incoming: Ranked
): LLMP | undefined {
  return held
    .filter(
      b =>
        b.modifiable &&
        // An attraction the resort data does not rank cannot be compared, and
        // `comparePriority` sorts a missing priority last -- so an unranked
        // reservation read as the worst thing held. Worse, `Itinerary` synthesises
        // an experience for an unknown facility id with neither `priority` nor
        // `tier`, so it also passed the non-Tier-1 preference below: a renamed
        // id, a new ride or a seasonal overlay produced the ideal swap victim.
        // Refusing to rank it costs one swap; guessing costs the reservation.
        b.experience.priority !== undefined &&
        comparePriority(incoming, b.experience) < 0
    )
    .sort(
      (a, b) =>
        Number(isTier1(a.experience)) - Number(isTier1(b.experience)) ||
        comparePriority(b.experience, a.experience)
    )[0];
}

/**
 * Whether to try swapping at all, before spending any request.
 */
export function shouldSwap(
  target: WatchTarget,
  incoming: Ranked,
  held: LLMP[],
  ledger: Pick<AutoBookLedger, 'hasAttempted' | 'remaining'>
): { ok: true; victim: LLMP } | { ok: false; reason: SwapSkipReason } {
  if (!target.autoSwap) return { ok: false, reason: 'not-enabled' };
  // Already holding it makes this a move, not a swap; that path handles it.
  if (held.some(b => b.facilityId === incoming.id)) {
    return { ok: false, reason: 'already-held' };
  }
  if (held.length < MAX_HELD_MP) return { ok: false, reason: 'not-full' };
  if (ledger.hasAttempted(target.experienceId, 'swap')) {
    return { ok: false, reason: 'already-attempted' };
  }
  if (ledger.remaining <= 0) return { ok: false, reason: 'budget-exhausted' };
  const victim = chooseSwapVictim(held, incoming);
  if (!victim) return { ok: false, reason: 'no-worse-reservation' };
  return { ok: true, victim };
}

export interface AutoSwapDeps {
  /**
   * LLClient.offer bound with the reservation being given up. The mod endpoint
   * takes both the new experience and the original, which is what makes a swap
   * one atomic request rather than a cancel followed by a book.
   */
  createSwapOffer: (
    incoming: OfferExperience,
    guests: Guest[],
    victim: LLMP
  ) => Promise<Offer<LLMP>>;
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
  /** Optional; when it reports a clash, the swap is abandoned. */
  clashes?: ClashCheck;
}

/**
 * Replace the party's worst reservation with a better attraction.
 *
 * The swap is atomic on Disney's side -- the old reservation is released only
 * if the new one is secured -- which is precisely what makes this safe where
 * "cancel it and search for something better" is not. The offer that comes back
 * is still re-checked against the incoming attraction's window before being
 * committed, for the same reason booking and moving re-check theirs.
 */
export async function attemptAutoSwap(
  target: WatchTarget,
  incoming: OfferExperience,
  held: LLMP[],
  { createSwapOffer, book, guests, ledger, clashes, stillWanted }: AutoSwapDeps
): Promise<SwapOutcome> {
  const allowed = shouldSwap(target, incoming, held, ledger);
  if (!allowed.ok) return { status: 'skipped', reason: allowed.reason };
  if (guests.eligible.length === 0) {
    return { status: 'skipped', reason: 'no-eligible-guests' };
  }
  const { victim } = allowed;

  try {
    const offer = await createSwapOffer(incoming, guests.eligible, victim);
    if (offer.guests.eligible.length === 0) {
      return { status: 'skipped', reason: 'no-eligible-guests' };
    }
    if (!inWindow(offer.start.time, target)) {
      return { status: 'skipped', reason: 'offer-outside-window' };
    }
    // The victim is excluded: it is released by this very request, so the
    // slot it occupies is not a conflict with what replaces it.
    if (clashes?.(offer.start.time, offer.itinerary, victim)) {
      return { status: 'skipped', reason: 'overlaps-plans' };
    }

    // Marked before committing: a timed-out swap may still have applied.
    if (stillWanted && !stillWanted(offer.start.time)) {
      return { status: 'skipped', reason: 'no-longer-wanted' };
    }
    ledger.markAttempted(target.experienceId, 'swap');
    const booking = await book(offer);
    ledger.markBooked();
    return {
      status: 'swapped',
      booking,
      replaced: { name: victim.name, time: victim.start.time },
      to: offer.start.time,
    };
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
