import { RequestError, RequestNotSent } from '@/api/client';
import { LLMP } from '@/api/itinerary';
import { Guest, Guests, Offer, OfferError } from '@/api/ll';
import { DateTime, ParkTime } from '@/datetime';
import { RateLimitExceeded } from '@/ratelimit';

import {
  AutoBookLedger,
  CONFIRM_ABSENT_POLLS,
  actionWasRejected,
  attemptAutoBook,
  lockKey,
  offerIsAcceptable,
  outcomeIsUnknown,
  shouldAttempt,
} from './autobook';
import { wholePartyEligible } from './party';
import { WatchTarget } from './watchlist';

const BZ = '80010114';
/** A second attraction, for asserting one lock does not move another. */
const HM = '80010208';
const DATE = '2026-09-04';

const at = (h: number, m = 0) => new ParkTime(h, m);
const guest = (id: string) => ({ id, name: id }) as Guest;
const party = (eligible: Guest[] = [guest('a')]) =>
  ({ eligible, ineligible: [] }) as Guests;

const target = (rest: Partial<WatchTarget> = {}): WatchTarget => ({
  experienceId: BZ,
  autoBook: true,
  ...rest,
});

const experience = { id: BZ, name: 'Ride', park: { id: 'p' } } as never;

function offerAt(time: ParkTime, guests = party()) {
  return {
    id: 'offer-1',
    offerSetId: 'set-1',
    start: new DateTime(DATE, time),
    end: new DateTime(DATE, time.add({ hours: 1 })),
    guests,
    experience,
    itinerary: [],
    booking: undefined,
  } as unknown as Offer<undefined>;
}

const booking = { id: 'ent-1' } as LLMP;

function deps(overrides: Partial<Parameters<typeof attemptAutoBook>[2]> = {}) {
  return {
    createOffer: jest.fn(async () => offerAt(at(11))),
    book: jest.fn(async () => booking),
    guests: party(),
    ledger: new AutoBookLedger(DATE),
    ...overrides,
  } as Parameters<typeof attemptAutoBook>[2];
}

describe('AutoBookLedger', () => {
  it('counts bookings', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markBooked();
    expect(ledger.bookedCount).toBe(1);
    ledger.markBooked();
    expect(ledger.bookedCount).toBe(2);
  });

  it('remembers attempts', () => {
    const ledger = new AutoBookLedger(DATE);
    expect(ledger.hasAttempted(BZ)).toBe(false);
    ledger.markAttempted(BZ);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // Booking and moving the same attraction are separate each-once actions.
  it('tracks booking and moving independently', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ, 'book');
    expect(ledger.hasAttempted(BZ, 'book')).toBe(true);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
    ledger.markAttempted(BZ, 'modify');
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
  });

  it('defaults to the booking kind', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    expect(ledger.hasAttempted(BZ, 'book')).toBe(true);
  });

  it('resets', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked();
    ledger.reset();
    expect(ledger.hasAttempted(BZ)).toBe(false);
    expect(ledger.bookedCount).toBe(0);
  });
});

/**
 * A booking request whose fate is unknown, and the release of the attempt lock
 * once plans settle it. Disney allows booking, cancelling and rebooking the
 * same attraction, so the lock covers doubt rather than the whole session.
 */
describe('AutoBookLedger doubt-holds', () => {
  /** Observe the attraction unheld often enough to clear its lock. */
  function seeAbsent(ledger: AutoBookLedger, times = CONFIRM_ABSENT_POLLS) {
    for (let i = 0; i < times; ++i) ledger.resolveHeld(BZ, false);
  }

  /** Plans reporting the reservation, which is what arms a later release. */
  const seeHeld = (ledger: AutoBookLedger) => ledger.resolveHeld(BZ, true);

  it('does not count an attempt that never confirmed as booked', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    // The request may have landed. Until plans say otherwise the lock stands,
    // so nothing else attempts the same attraction.
    expect(ledger.hasAttempted(BZ)).toBe(true);
    expect(ledger.bookedCount).toBe(0);
  });

  it('does not double-count an attempt that confirmed', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    expect(ledger.bookedCount).toBe(1);
  });

  it('counts an unconfirmed attempt once plans show it landed', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.resolveHeld(BZ, true);
    expect(ledger.bookedCount).toBe(1);
  });

  it('leaves a confirmed booking alone when plans agree', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.resolveHeld(BZ, true);
    expect(ledger.bookedCount).toBe(1);
  });

  it('keeps the lock while the reservation is held', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.resolveHeld(BZ, true);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // A pass that has been redeemed -- or has simply expired unredeemed, which
  // Disney counts the same way -- leaves plans looking exactly like a
  // cancelled one. Releasing the lock there would spend the session allowance
  // rebooking something Disney will not sell again.
  it('keeps the lock when the entitlement was spent rather than cancelled', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    seeHeld(ledger);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS + 2; ++i) {
      ledger.resolveHeld(BZ, false, true);
    }
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // Absences seen while the pass was still live must not carry over: the
  // release needs CONFIRM_ABSENT_POLLS *consecutive* ones.
  it('forgets earlier absences once an entitlement is spent', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    seeHeld(ledger);
    ledger.resolveHeld(BZ, false);
    ledger.resolveHeld(BZ, false, true);
    ledger.resolveHeld(BZ, false);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // The reason any of this exists: cancel a late return time by hand and the
  // better one that drops later must still be bookable.
  it('releases the lock after an observed booking is cancelled', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    seeHeld(ledger);
    seeAbsent(ledger);
    expect(ledger.hasAttempted(BZ)).toBe(false);
  });

  // The guard that makes the poll-count release safe. Plans polls are ~24
  // seconds apart in a drop burst, and a booking made moments before a fetch
  // can be missing from it -- so absence alone, for a reservation never seen,
  // cannot be told apart from an itinerary that has not caught up. Releasing
  // on that would rebook a Lightning Lane already held.
  it('never releases a booking it has not seen held', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS * 10);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('keeps an unconfirmed attempt locked however long it is absent', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS * 10);
    expect(ledger.hasAttempted(BZ)).toBe(true);
    expect(ledger.bookedCount).toBe(0);
  });

  // Disney can omit a just-made booking from a single plans response. Acting
  // on one gap would rebook something still held.
  it('requires consecutive absences before releasing', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    seeHeld(ledger);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS - 1);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('restarts the count when the reservation reappears', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    seeHeld(ledger);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS - 1);
    seeHeld(ledger);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS - 1);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // A rehearsal issues no request, so it must neither count as a booking nor
  // take part in settling -- otherwise the dry-run entry re-logs every time
  // the lock releases, and the README's "none of it counts" becomes false.
  it('keeps dry-run marks out of the booking count', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ, 'book', true);
    expect(ledger.bookedCount).toBe(0);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('keeps dry-run marks out of settling', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ, 'book', true);
    expect(ledger.settleableIds).toEqual([]);
    seeHeld(ledger);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS * 5);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // Settled or not makes no difference: a booking that plainly succeeded still
  // needs its lock released once the reservation is cancelled by hand.
  it('reports unsettled and settled attempts alike', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    expect(ledger.settleableIds).toEqual([BZ]);
  });

  // It used to report `book` locks only, which is why a move had no release
  // path at all: nothing swept it, so no evidence could ever clear it.
  it('reports an attraction carrying only a move', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted('other', 'modify');
    expect(ledger.settleableIds).toEqual(['other']);
  });

  // One entry per attraction, not per lock. Two entries would have the settle
  // loop count one poll's absence twice and release after a single observation.
  it('reports an attraction holding two kinds of lock once', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markAttempted(BZ, 'modify');
    expect(ledger.settleableIds).toEqual([BZ]);
  });

  // Moving and swapping create no doubt-hold of their own, so neither may
  // settle a booking's: the move is counted, and the booking stays in doubt
  // until plans speak for it.
  it('leaves booking doubt untouched when a move confirms', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markAttempted(BZ, 'modify');
    ledger.markBooked();
    expect(ledger.bookedCount).toBe(1);
    ledger.resolveHeld(BZ, true);
    expect(ledger.bookedCount).toBe(2);
  });

  it('clears absence counts on reset', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    seeHeld(ledger);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS - 1);
    ledger.reset();
    ledger.markAttempted(BZ);
    seeHeld(ledger);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS - 1);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });
});

describe('shouldAttempt()', () => {
  it('refuses when the target has booking off', () => {
    const result = shouldAttempt(
      target({ autoBook: false }),
      new AutoBookLedger(DATE)
    );
    expect(result).toEqual({ ok: false, reason: 'not-enabled' });
  });

  it('refuses when autoBook is simply absent', () => {
    expect(
      shouldAttempt({ experienceId: BZ }, new AutoBookLedger(DATE))
    ).toEqual({
      ok: false,
      reason: 'not-enabled',
    });
  });

  it('allows an enabled, unattempted target', () => {
    expect(shouldAttempt(target(), new AutoBookLedger(DATE))).toEqual({
      ok: true,
    });
  });

  it('is enabled by bookThenMove alone', () => {
    const t = target({ autoBook: false, bookThenMove: true });
    expect(shouldAttempt(t, new AutoBookLedger(DATE))).toEqual({ ok: true });
  });

  // A timed-out booking request may still have succeeded server-side, so a
  // retry risks double-booking.
  it('refuses a second attempt at the same attraction', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    expect(shouldAttempt(target(), ledger)).toEqual({
      ok: false,
      reason: 'already-attempted',
    });
  });
});

describe('offerIsAcceptable()', () => {
  it('accepts an offer inside the window', () => {
    const t = target({ after: at(10), before: at(12) });
    expect(offerIsAcceptable(offerAt(at(11)), t)).toEqual({ ok: true });
  });

  it('accepts any time when the target has no window', () => {
    expect(offerIsAcceptable(offerAt(at(21)), target())).toEqual({ ok: true });
  });

  // The tipboard time we matched on and the offer we actually get can differ:
  // inventory moves between requests, and a third Lightning Lane sometimes
  // gets placed between two existing ones.
  it('rejects an offer later than the window', () => {
    const t = target({ before: at(12) });
    expect(offerIsAcceptable(offerAt(at(15)), t)).toEqual({
      ok: false,
      reason: 'offer-outside-window',
    });
  });

  it('rejects an offer earlier than the window', () => {
    const t = target({ after: at(14) });
    expect(offerIsAcceptable(offerAt(at(9)), t)).toEqual({
      ok: false,
      reason: 'offer-outside-window',
    });
  });

  it('rejects an offer with nobody eligible', () => {
    expect(offerIsAcceptable(offerAt(at(11), party([])), target())).toEqual({
      ok: false,
      reason: 'no-eligible-guests',
    });
  });
});

describe('attemptAutoBook()', () => {
  it('books an acceptable offer', async () => {
    const d = deps();
    const result = await attemptAutoBook(target(), experience, d);
    expect(result).toEqual({
      status: 'booked',
      booking,
      returnTime: at(11),
    });
    expect(d.book).toHaveBeenCalled();
    expect(d.ledger.bookedCount).toBe(1);
  });

  it('spends no request when the guards refuse', async () => {
    const d = deps();
    const result = await attemptAutoBook(
      target({ autoBook: false }),
      experience,
      d
    );
    expect(result).toEqual({ status: 'skipped', reason: 'not-enabled' });
    expect(d.createOffer).not.toHaveBeenCalled();
  });

  it('skips when nobody is eligible before offering', async () => {
    const d = deps({ guests: party([]) });
    const result = await attemptAutoBook(target(), experience, d);
    expect(result).toEqual({
      status: 'skipped',
      reason: 'no-eligible-guests',
    });
    expect(d.createOffer).not.toHaveBeenCalled();
  });

  // The load-bearing guard: generate the offer, then refuse to book it if the
  // real return time falls outside what the user asked for.
  it('refuses to book an offer outside the window', async () => {
    const d = deps({ createOffer: jest.fn(async () => offerAt(at(20))) });
    const result = await attemptAutoBook(
      target({ before: at(12) }),
      experience,
      d
    );
    expect(result).toEqual({
      status: 'skipped',
      reason: 'offer-outside-window',
    });
    expect(d.book).not.toHaveBeenCalled();
    expect(d.ledger.bookedCount).toBe(0);
  });

  it('leaves an out-of-window attraction retryable', async () => {
    const d = deps({ createOffer: jest.fn(async () => offerAt(at(20))) });
    await attemptAutoBook(target({ before: at(12) }), experience, d);
    expect(d.ledger.hasAttempted(BZ)).toBe(false);
  });

  it('marks the attempt before booking, so a failure is not retried', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = deps({
      book: jest.fn(async () => {
        throw new Error('boom');
      }),
    });
    const result = await attemptAutoBook(target(), experience, d);
    // `rejected: false` is the load-bearing half: an error with no response
    // may have booked anyway, so the lock has to stand.
    expect(result).toEqual({
      status: 'failed',
      error: 'boom',
      rejected: false,
    });
    expect(d.ledger.hasAttempted(BZ)).toBe(true);
    expect(d.ledger.bookedCount).toBe(0);
  });

  it('takes no attempt lock when transport refuses before dispatch', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const ledger = new AutoBookLedger(DATE);
    const d = deps({
      ledger,
      requestControl: () => ({
        signal: new AbortController().signal,
        start: async () => {
          throw new RequestNotSent('lease refused before send');
        },
      }),
      book: jest.fn(async (_offer, control) =>
        control!.start!(() => Promise.resolve(booking))
      ),
    });

    const result = await attemptAutoBook(target(), experience, d);

    expect(result).toMatchObject({ status: 'failed', rejected: true });
    expect(ledger.hasAttempted(BZ, 'book')).toBe(false);
    expect(ledger.bookedCount).toBe(0);
  });

  it('takes no attempt lock when the lifecycle refuses the dispatch instruction', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const ledger = new AutoBookLedger(DATE);
    const d = deps({
      ledger,
      requestControl: () => ({
        signal: new AbortController().signal,
        start: send => send(),
        onDispatch: () => {
          throw new RequestNotSent('operation already abandoned');
        },
      }),
      book: jest.fn(async (_offer, control) =>
        control!.start!(async () => {
          control!.onDispatch?.();
          return booking;
        })
      ),
    });

    const result = await attemptAutoBook(target(), experience, d);

    expect(result).toMatchObject({ status: 'failed', rejected: true });
    expect(ledger.hasAttempted(BZ, 'book')).toBe(false);
  });

  it('does not mark dispatch when attempt persistence fails first', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const ledger = new AutoBookLedger(DATE, () => {
      throw new Error('storage unavailable');
    });
    const markDispatched = jest.fn();
    const fetchStarted = jest.fn();
    const d = deps({
      ledger,
      requestControl: () => ({
        signal: new AbortController().signal,
        start: send => send(),
        onDispatch: markDispatched,
      }),
      book: jest.fn(async (_offer, control) =>
        control!.start!(async () => {
          control!.onDispatch?.();
          fetchStarted();
          return booking;
        })
      ),
    });

    const result = await attemptAutoBook(target(), experience, d);

    expect(result).toMatchObject({ status: 'failed' });
    expect(markDispatched).not.toHaveBeenCalled();
    expect(fetchStarted).not.toHaveBeenCalled();
    expect(ledger.hasAttempted(BZ)).toBe(false);
  });

  // The other half: Disney answered, and the answer was no. Nothing was
  // booked, so the caller is free to try again later.
  it('reports a rejection as one, so it can be tried again', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = deps({
      book: jest.fn(async () => {
        throw new RequestError({ ok: false, status: 410, data: {} });
      }),
    });
    const result = await attemptAutoBook(target(), experience, d);
    expect(result).toMatchObject({
      status: 'failed',
      httpStatus: 410,
      rejected: true,
    });
    // Still held: releasing is the caller's decision, and only under
    // `repeatMoves`.
    expect(d.ledger.hasAttempted(BZ)).toBe(true);
  });

  // No offer for this party right now is an ordinary mid-drop outcome, not a
  // fault worth surfacing as an error.
  it('treats OfferError as a skip', async () => {
    const d = deps({
      createOffer: jest.fn(async () => {
        throw new OfferError(party([]));
      }),
    });
    const result = await attemptAutoBook(target(), experience, d);
    expect(result).toEqual({
      status: 'skipped',
      reason: 'no-eligible-guests',
    });
  });

  it('reports an unexpected failure', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = deps({
      createOffer: jest.fn(async () => {
        throw new Error('network down');
      }),
    });
    const result = await attemptAutoBook(target(), experience, d);
    expect(result).toEqual({
      status: 'failed',
      error: 'network down',
      rejected: false,
    });
  });
});

describe('AutoBookLedger.releaseAttempt()', () => {
  // For the search that exists to keep improving one reservation. Autopilot
  // never releases: one move per attraction per session is what stops it
  // thrashing.
  it('lets an action be taken again', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ, 'modify');
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
    ledger.releaseAttempt(BZ, 'modify');
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
  });

  it('releases only the kind named, and only that attraction', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ, 'modify');
    ledger.markAttempted(BZ, 'book');
    ledger.releaseAttempt(BZ, 'modify');
    expect(ledger.hasAttempted(BZ, 'book')).toBe(true);
  });

  // A released booking keeps whatever it already confirmed. Releasing is about
  // the lock, not about unwinding a booking that happened.
  it('keeps the booking count across a release', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ, 'modify');
    ledger.markBooked();
    ledger.releaseAttempt(BZ, 'modify');
    expect(ledger.bookedCount).toBe(1);
  });

  // Releasing is only ever done for an attempt whose fate we learned -- Disney
  // refused it, or our own limiter never sent it -- so the doubt goes with the
  // lock. Left behind, a later plans poll seeing the attraction held would
  // count a booking this attempt provably never made.
  it('clears the doubt a book attempt was holding', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.releaseAttempt(BZ, 'book');
    expect(ledger.hasAttempted(BZ)).toBe(false);
    ledger.resolveHeld(BZ, true);
    expect(ledger.bookedCount).toBe(0);
  });

  // A modify puts a reservation already held through a round trip. It creates
  // no entitlement and takes no doubt-hold, so there is none to clear.
  it('leaves the booking count alone for a modify', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ, 'modify');
    ledger.releaseAttempt(BZ, 'modify');
    expect(ledger.bookedCount).toBe(0);
  });
});

// The ledger takes its lock before the request goes out, so a failure leaves
// it held. `repeatMoves` gives it back only where nothing can have happened.
describe('actionWasRejected()', () => {
  const withStatus = (status: number) =>
    new RequestError({ ok: false, status, data: {} });

  // The ordinary way a fast search loses: the offer it was holding went to
  // somebody else between generating it and committing it.
  it.each([400, 404, 409, 410, 422])('is true for a %i', status => {
    expect(actionWasRejected(withStatus(status))).toBe(true);
  });

  // Thrown at ApiClient's actual send boundary before anything is sent -- so
  // this is the most certain "nothing happened" of the lot, and it is the one
  // that used to read as unknown because it carries no response.
  it('is true when our own limiter refused to send it', () => {
    expect(actionWasRejected(new RateLimitExceeded())).toBe(true);
  });

  // No response at all. The request may well have applied, and repeating it
  // would book or move a second time.
  it.each([
    ['a network failure', new Error('Network request failed')],
    ['nothing at all', undefined],
  ])('is false for %s', (_, error) => {
    expect(actionWasRejected(error)).toBe(false);
  });

  // The server broke after receiving it, so the outcome is just as unknown.
  it.each([500, 502, 503])('is false for a %i', status => {
    expect(actionWasRejected(withStatus(status))).toBe(false);
  });

  // Both mean stop asking. A 403 is the bot filter, which refusal.ts watches
  // and which hammering makes worse; a 429 is being throttled.
  it.each([403, 429])('is false for a %i', status => {
    expect(actionWasRejected(withStatus(status))).toBe(false);
  });
});

/**
 * Sharing locks with another instance -- a second tab, or the provider NextLL
 * nests inside the app's own -- and letting a release survive the trip.
 *
 * `onAttemptChange` is the persister's hook. Adding is inferred from
 * `attemptedKeys()`, but a release has to be *stated*, or a union-only write
 * can never let a lock go: it comes straight back on the next
 * `adoptAttempted` and the attraction is dead for the park day.
 */
describe('AutoBookLedger shared locks', () => {
  /** A ledger plus the release lists its persister was handed, in order. */
  function watched() {
    const removals: (readonly string[] | undefined)[] = [];
    const ledger = new AutoBookLedger(DATE, released =>
      removals.push(released)
    );
    return { ledger, removals };
  }

  /** Every key the persister was told to drop, flattened. */
  const dropped = (removals: (readonly string[] | undefined)[]) =>
    removals.flatMap(r => [...(r ?? [])]);

  // The park failure this block was extended for. A lock reaches the shared
  // copy before the request's outcome is known, and nothing in that copy can
  // release it: `adoptAttempted` never takes ownership, so the instance that
  // inherits a lock can never withdraw it. A rejection is proof there is
  // nothing to protect, so the lock stops being shared at that moment.
  it('withdraws a rejected attempt from the shared copy', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.resolveRejected(BZ);
    expect(dropped(removals)).toContain(`${DATE}:book:${BZ}`);
    expect(ledger.attemptedKeys()).toEqual([]);
  });

  // Locally the lock stands: one action per attraction per session is what
  // stops this run thrashing a reservation while availability moves.
  it('keeps a rejected attempt locked for this run', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.resolveRejected(BZ);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // The lock must not come back by the side door: the next write publishes
  // `attemptedKeys()`, and a rejected key still in that list would be shared
  // again by the very next attempt on any other attraction.
  it('does not republish a rejected attempt on the next write', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.resolveRejected(BZ);
    ledger.markAttempted(HM, 'book');
    expect(ledger.attemptedKeys()).toEqual([`${DATE}:book:${HM}`]);
  });

  it('shares the lock again if the same attraction is attempted again', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.resolveRejected(BZ);
    ledger.releaseAttempt(BZ, 'book');
    ledger.markAttempted(BZ, 'book');
    expect(ledger.attemptedKeys()).toContain(`${DATE}:book:${BZ}`);
  });

  // An adopted lock used to be permanent: nothing here confirms it, so the
  // absence branch returned early every time. Plans saying the reservation is
  // not there is the same evidence for an adopted lock as for one of ours.
  it('releases an adopted lock once plans settle it as absent', () => {
    const { ledger, removals } = watched();
    ledger.adoptAttempted([`${DATE}:book:${BZ}`]);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; i++) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(false);
    expect(dropped(removals)).toContain(`${DATE}:book:${BZ}`);
  });

  // The step before that one, and the only thing that ever gives back a lock
  // left by a tab that has since closed: an adopted key has to reach the settle
  // sweep at all. Narrow this to locks the instance owns and every adopted
  // dated lock becomes permanent -- while `resolveHeld` goes on passing its own
  // tests, because they call it directly.
  it('offers an adopted lock to the settle sweep', () => {
    const { ledger } = watched();
    ledger.adoptAttempted([`${DATE}:book:${BZ}`]);
    expect(ledger.settleableIds).toEqual([BZ]);
  });

  it('holds an adopted lock until the absences add up', () => {
    const { ledger } = watched();
    ledger.adoptAttempted([`${DATE}:book:${BZ}`]);
    ledger.resolveHeld(BZ, false);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // This instance's own unsettled attempt is a different case: the request may
  // have succeeded where the response was lost, so absence is not proof.
  it('keeps an unsettled attempt of its own through the same absences', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    for (let i = 0; i < CONFIRM_ABSENT_POLLS + 1; i++) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('reports a lock it took as its own', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    expect(ledger.attemptedKeys()).toEqual([`${DATE}:book:${BZ}`]);
    expect(ledger.ownedKeys()).toEqual([`${DATE}:book:${BZ}`]);
  });

  // Adoption is how another instance's lock gets here, and it is not this
  // instance's to withdraw.
  it('does not claim an adopted lock as its own', () => {
    const { ledger } = watched();
    ledger.adoptAttempted([`${DATE}:book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(true);
    expect(ledger.ownedKeys()).toEqual([]);
  });

  it('states the key when an attempt is released by hand', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ, 'modify');
    ledger.releaseAttempt(BZ, 'modify');
    expect(dropped(removals)).toContain(`${DATE}:modify:${BZ}`);
    expect(ledger.ownedKeys()).toEqual([]);
  });

  // The regression this block exists for. `resolveHeld` settling a
  // cancellation used to call `notify()` alone, so the release never reached
  // storage: the lock survived, the next mount adopted it, and the rebooking
  // the release branch exists to permit never happened.
  it('states the key when a cancellation settles the lock', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.resolveHeld(BZ, true);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(false);
    expect(dropped(removals)).toContain(`${DATE}:book:${BZ}`);
  });

  // reset() is called on every enable, and clearing `attempted` alone left the
  // shared copy intact -- so the first tick of the new run adopted every lock
  // straight back and the reset did nothing.
  it('withdraws its own locks on reset', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.markAttempted('OTHER', 'swap');
    removals.length = 0;
    ledger.reset();
    expect(dropped(removals).sort()).toEqual([
      `${DATE}:book:${BZ}`,
      `${DATE}:swap:OTHER`,
    ]);
    expect(ledger.ownedKeys()).toEqual([]);
  });

  it('leaves an adopted lock in the shared copy on reset', () => {
    const { ledger, removals } = watched();
    ledger.adoptAttempted([`${DATE}:book:${BZ}`]);
    removals.length = 0;
    ledger.reset();
    expect(dropped(removals)).toEqual([]);
  });

  // A release is remembered so a stale read cannot resurrect it...
  it('refuses to re-adopt a lock it released', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.releaseAttempt(BZ, 'book');
    ledger.adoptAttempted([`${DATE}:book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(false);
  });

  // ...and the memory lasts exactly as long as the thing it is about. Once the
  // key has gone from the shared copy there is no stale lock left to resurrect,
  // so anything published under it afterwards is a *different* lock another
  // instance is acting on right now. Refusing that leaves two engines free to
  // work one reservation -- which the settle sweep reaching `modify` and `swap`
  // made routine, since this is now how a move lock ordinarily ends.
  it('adopts a fresh lock taken after its own release left the copy', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'modify');
    ledger.resolveHeld(BZ, true);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
    // The next tick reads a copy this instance's own withdrawal has left, so
    // the key is not in it.
    ledger.adoptAttempted([]);
    // Another tab now takes the action and publishes it.
    ledger.adoptAttempted([`${DATE}:modify:${BZ}`]);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
  });

  // ...but locking it again deliberately has to lift that memory, or the
  // refusal outlives the decision that caused it. Once this instance has let
  // the lock go again -- here by a reset -- a lock another instance is
  // genuinely holding must still be adoptable, and a stale `released` entry
  // would silently ignore it and let both instances act on the attraction.
  it('lifts the release when the same action is locked again', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.releaseAttempt(BZ, 'book');
    ledger.markAttempted(BZ, 'book');
    expect(ledger.ownedKeys()).toEqual([`${DATE}:book:${BZ}`]);
    ledger.reset();
    ledger.adoptAttempted([`${DATE}:book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(true);
    expect(ledger.ownedKeys()).toEqual([]);
  });
});

/**
 * The offer's party, checked before committing.
 *
 * `guests` is the eligibility the caller's guards ran on -- a prediction. The
 * offer is the commitment, and the two can disagree: Disney can return an offer
 * covering three of five when eligibility said all five were fine. Checking only
 * the prediction meant "whole party only" could still book the split party it
 * exists to prevent.
 */
describe('attemptAutoBook() party re-check', () => {
  const full = (): Guests => ({
    eligible: [
      { id: 'g1', name: 'A' },
      { id: 'g2', name: 'B' },
    ] as Guest[],
    ineligible: [],
  });
  const partial = (): Guests => ({
    eligible: [{ id: 'g1', name: 'A' }] as Guest[],
    ineligible: [
      { id: 'g2', name: 'B', ineligibleReason: 'TOO_EARLY' },
    ] as Guest[],
  });

  /** An offer whose own party differs from the eligibility handed in. */
  function offerWithParty(guests: Guests) {
    return {
      id: 'offer-1',
      start: new DateTime(DATE, at(11)),
      end: new DateTime(DATE, at(12)),
      guests,
      itinerary: [],
    } as unknown as Offer<undefined>;
  }

  it('refuses to commit an offer that covers only part of the party', async () => {
    const book = jest.fn();
    const outcome = await attemptAutoBook(
      { experienceId: BZ, autoBook: true },
      experience,
      {
        createOffer: async () => offerWithParty(partial()),
        book,
        guests: full(),
        ledger: new AutoBookLedger(DATE),
        partyIsAcceptable: wholePartyEligible,
      }
    );
    expect(outcome).toEqual({ status: 'skipped', reason: 'partial-party' });
    expect(book).not.toHaveBeenCalled();
  });

  it('commits when the offer covers the whole party', async () => {
    const outcome = await attemptAutoBook(
      { experienceId: BZ, autoBook: true },
      experience,
      {
        createOffer: async () => offerWithParty(full()),
        book: async () => ({}) as never,
        guests: full(),
        ledger: new AutoBookLedger(DATE),
        partyIsAcceptable: wholePartyEligible,
      }
    );
    expect(outcome.status).toBe('booked');
  });

  // Refusing before the lock is taken matters: a skip must not retire the
  // attraction for the session or charge the allowance.
  it('takes no lock and no charge when it refuses', async () => {
    const ledger = new AutoBookLedger(DATE);
    await attemptAutoBook({ experienceId: BZ, autoBook: true }, experience, {
      createOffer: async () => offerWithParty(partial()),
      book: jest.fn(),
      guests: full(),
      ledger,
      partyIsAcceptable: wholePartyEligible,
    });
    expect(ledger.hasAttempted(BZ)).toBe(false);
    expect(ledger.bookedCount).toBe(0);
  });

  it('commits a partial offer when the setting is off', async () => {
    const outcome = await attemptAutoBook(
      { experienceId: BZ, autoBook: true },
      experience,
      {
        createOffer: async () => offerWithParty(partial()),
        book: async () => ({}) as never,
        guests: full(),
        ledger: new AutoBookLedger(DATE),
      }
    );
    expect(outcome.status).toBe('booked');
  });
});

/**
 * The doubt-hold, and clearing it when there is nothing left to doubt.
 *
 * The lock is taken before the request goes out, because a timed-out booking may
 * have succeeded. When the failure proves nothing was booked, the doubt has to
 * go, or a later plans poll counts a booking this attempt never made.
 */
describe('AutoBookLedger.resolveRejected()', () => {
  it('settles an attempt that never landed', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.resolveRejected(BZ);
    // Plans finding the attraction held now says nothing about this attempt:
    // whatever is there, this request did not put it there.
    ledger.resolveHeld(BZ, true);
    expect(ledger.bookedCount).toBe(0);
  });

  // Autopilot keeps one action per attraction per session; only NextLL retries.
  it('keeps the attempt lock', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.resolveRejected(BZ);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it.each(['modify', 'swap'] as const)(
    'keeps a rejected %s locally but removes it from the publishable set',
    kind => {
      const ledger = new AutoBookLedger(DATE);
      ledger.markAttempted(BZ, kind);
      ledger.resolveRejected(BZ, kind);

      expect(ledger.hasAttempted(BZ, kind)).toBe(true);
      expect(ledger.publishableKeys()).not.toContain(`${DATE}:${kind}:${BZ}`);
    }
  );

  it('does nothing for an attraction with no hold', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.resolveRejected(BZ);
    expect(ledger.bookedCount).toBe(0);
  });

  // A confirmed booking is a real booking, not a doubt.
  it('does not unwind a booking that confirmed', () => {
    const ledger = new AutoBookLedger(DATE);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.resolveRejected(BZ);
    expect(ledger.bookedCount).toBe(1);
  });
});

/**
 * Roadmap item 10: an action lock is about one booking date, and so is the
 * evidence that settles it.
 *
 * The defect was that a lock said only "book, Buzz Lightyear" while the settle
 * loop asked `findExistingLL(plans, id, date)` -- a date-scoped question. Book
 * for one day, move the picker to the next, and the attraction was skipped as
 * already-attempted on a date nothing had been attempted for.
 *
 * `hasAttempted` takes no date and never will: the date lives on the instance
 * precisely so the lock and the evidence cannot be given different ones.
 */
describe('AutoBookLedger booking dates', () => {
  const D1 = '2031-02-17';
  const D2 = '2031-02-18';

  /** Every key the persister was told to drop, flattened. */
  const dropped = (removals: (readonly string[] | undefined)[]) =>
    removals.flatMap(r => [...(r ?? [])]);

  function watched(date = D1) {
    const removals: (readonly string[] | undefined)[] = [];
    const ledger = new AutoBookLedger(date, released =>
      removals.push(released)
    );
    return { ledger, removals };
  }

  // The roadmap's own "done means", stated as it states it.
  it('does not let a lock for one date block another', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ);
    ledger.setBookingDate(D2);
    expect(ledger.hasAttempted(BZ)).toBe(false);
    ledger.setBookingDate(D1);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // The half with no release path at all: a move made for one date blocked
  // that action on every other date for the rest of the session.
  it('does not let a move for one date block another', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'modify');
    ledger.setBookingDate(D2);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
  });

  // Pinned at the consumer rather than the ledger, because `shouldAttempt` is
  // what the provider actually asks and `already-attempted` is what the screen
  // actually said.
  it('offers an attraction attempted on another date', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ);
    expect(shouldAttempt(target(), ledger)).toEqual({
      ok: false,
      reason: 'already-attempted',
    });
    ledger.setBookingDate(D2);
    expect(shouldAttempt(target(), ledger)).toEqual({ ok: true });
  });

  it('publishes the date as part of the key', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ);
    expect(ledger.publishableKeys()).toEqual([`${D1}:book:${BZ}`]);
  });

  // The per-tick republish is what heals a write two instances interleaved and
  // lost. It has to cover the date the picker just moved off as much as the one
  // it moved to, or moving the picker quietly abandons a live lock.
  it('publishes locks for every date it holds', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ);
    ledger.setBookingDate(D2);
    ledger.markAttempted(HM);
    expect(ledger.publishableKeys().sort()).toEqual([
      `${D1}:book:${BZ}`,
      `${D2}:book:${HM}`,
    ]);
  });

  // Routed by what the key says about itself, never by the date this ledger
  // happens to be on -- which is what makes two tabs on two dates safe.
  it('adopts a key into the date it names', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`${D2}:book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(false);
    ledger.setBookingDate(D2);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // Switching away and back must restore what was known, because the thing
  // being restored is the record that a request whose response was lost may
  // have succeeded. A ledger that reset on a date change would forget it and
  // rebook -- the exact case this must not get wrong.
  it('keeps a doubt-hold through a trip to another date and back', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ);
    ledger.setBookingDate(D2);
    ledger.setBookingDate(D1);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS + 1; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // Absence evidence is date-scoped, so the counter must be. Undated, one
  // absence seen on each of two dates reaches CONFIRM_ABSENT_POLLS and releases
  // a live lock on a single observation per date.
  it('does not add an absence on one date to the count on another', () => {
    const ledger = new AutoBookLedger(D1);
    // Booked and seen held on both dates, so both locks are one absence short
    // of a release and the two counters are the only thing keeping them apart.
    ledger.markAttempted(BZ);
    ledger.resolveHeld(BZ, true);
    ledger.setBookingDate(D2);
    ledger.markAttempted(BZ);
    ledger.resolveHeld(BZ, true);

    ledger.setBookingDate(D1);
    ledger.resolveHeld(BZ, false);
    ledger.setBookingDate(D2);
    ledger.resolveHeld(BZ, false);

    expect(ledger.hasAttempted(BZ)).toBe(true);
    ledger.setBookingDate(D1);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // The dangerous direction. "Seen held at least once" is the first of the two
  // conditions a release needs; satisfied from the wrong day, two absences
  // release a lock on a booking that may well exist, and the engine rebooks it.
  it('does not let being held on one date release a lock on another', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ);
    ledger.resolveHeld(BZ, true);
    ledger.setBookingDate(D2);
    ledger.markAttempted(BZ);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // A doubt-hold is per reservation per date too: a booking that landed on the
  // second day says nothing about the request for the first whose reply was lost.
  it('does not let a booking on one date settle a doubt on another', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ);
    ledger.setBookingDate(D2);
    ledger.markBooked(BZ);
    ledger.setBookingDate(D1);
    ledger.resolveHeld(BZ, true);
    expect(ledger.bookedCount).toBe(2);
  });

  it('releases a move once the reservation is gone', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ, 'modify');
    ledger.resolveHeld(BZ, true);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
    expect(dropped(removals)).toContain(`${D1}:modify:${BZ}`);
  });

  it('releases a swap on the same evidence', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ, 'swap');
    ledger.resolveHeld(BZ, true);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ, 'swap')).toBe(false);
    expect(dropped(removals)).toContain(`${D1}:swap:${BZ}`);
  });

  // The gained attraction was not held when a swap lock was taken, so absence
  // cannot tell a failed swap from a lost response. Same reasoning as `book`,
  // and the same answer.
  it('holds a swap lock it has never seen held', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'swap');
    for (let i = 0; i < CONFIRM_ABSENT_POLLS + 1; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ, 'swap')).toBe(true);
  });

  // Stating a key this instance never held would put it in `released`, after
  // which `adoptAttempted` refuses a later legitimate lock another instance
  // takes on that action -- and both engines act on the attraction.
  it('states only the keys it actually held', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.markAttempted(BZ, 'modify');
    ledger.resolveHeld(BZ, true);
    removals.length = 0;
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(dropped(removals).sort()).toEqual([
      `${D1}:book:${BZ}`,
      `${D1}:modify:${BZ}`,
    ]);
    ledger.adoptAttempted([`${D1}:swap:${BZ}`]);
    expect(ledger.hasAttempted(BZ, 'swap')).toBe(true);
  });

  // A release on one date must not refuse a lock another instance took for a
  // different one; `released` holds the whole key for exactly that reason.
  it('does not let a release on one date refuse adoption on another', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ);
    ledger.releaseAttempt(BZ, 'book');
    ledger.adoptAttempted([`${D2}:book:${BZ}`]);
    ledger.setBookingDate(D2);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('withdraws locks for every date it holds on reset', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ);
    ledger.setBookingDate(D2);
    ledger.markAttempted(HM, 'modify');
    removals.length = 0;
    ledger.reset();
    expect(dropped(removals).sort()).toEqual([
      `${D1}:book:${BZ}`,
      `${D2}:modify:${HM}`,
    ]);
    expect(ledger.ownedKeys()).toEqual([]);
  });

  // Loud rather than clever: an empty date would build `:book:80010114` and
  // collide across dates in exactly the way the key shape exists to prevent,
  // while passing every test that only ever supplies a real one.
  it('refuses a date that is not a park date', () => {
    expect(() => new AutoBookLedger('')).toThrow(/Not a booking date/);
    const ledger = new AutoBookLedger(D1);
    expect(() => ledger.setBookingDate('tomorrow')).toThrow(
      /Not a booking date/
    );
  });

  // The same refusal at the other door. `lockKey` is exported and the provider
  // calls it directly, to mint the retry token paired with a lock -- so it is
  // reachable without going through a ledger at all. Given no date it would
  // build `:book:80010114`, and the token would then expire and release a lock
  // on a date it was never minted for.
  it('refuses to build a key without a date', () => {
    expect(() => lockKey('', 'book', BZ)).toThrow(/Not a booking date/);
    expect(() => lockKey('tomorrow', 'modify', BZ)).toThrow(
      /Not a booking date/
    );
    expect(lockKey(D1, 'book', BZ)).toBe(`${D1}:book:${BZ}`);
  });
});

/**
 * Keys written by a build that had never heard of booking dates.
 *
 * The store is day-scoped and the owner has the deployed build installed, so a
 * key written this morning by that build is read this afternoon by this one.
 * There is no honest date to give it: the build that wrote it blocks every date
 * with it, so this one does too, and clears it on the same evidence.
 */
describe('AutoBookLedger locks from an older build', () => {
  const D1 = '2031-02-17';
  const D2 = '2031-02-18';

  const dropped = (removals: (readonly string[] | undefined)[]) =>
    removals.flatMap(r => [...(r ?? [])]);

  function watched(date = D1) {
    const removals: (readonly string[] | undefined)[] = [];
    const ledger = new AutoBookLedger(date, released =>
      removals.push(released)
    );
    return { ledger, removals };
  }

  it('blocks on every date, since it cannot say which one it meant', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(true);
    ledger.setBookingDate(D2);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('says which kind of block it is', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`book:${BZ}`, `${D1}:modify:${BZ}`]);
    expect(ledger.hasUndatedLock(BZ)).toBe(true);
    expect(ledger.hasUndatedLock(BZ, 'modify')).toBe(false);
  });

  // Never owned, for the reason storage.ts gives LEGACY_OWNER: a key we cannot
  // interpret is nobody's to publish or to withdraw on anyone else's behalf.
  it('never claims one as its own', () => {
    const { ledger, removals } = watched();
    ledger.adoptAttempted([`book:${BZ}`]);
    expect(ledger.owns(BZ)).toBe(false);
    expect(ledger.publishableKeys()).toEqual([]);
    ledger.reset();
    expect(dropped(removals)).toEqual([]);
  });

  // Exactly what an adopted lock does today, and it must keep doing it: block,
  // then clear in CONFIRM_ABSENT_POLLS polls, and not come back on the next
  // tick's re-read of the shared copy.
  it('clears on the same evidence as any other adopted lock', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`book:${BZ}`]);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(false);
    ledger.adoptAttempted([`book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(false);
  });

  /**
   * ...and only `book:` does, because only `book:` does in the build that
   * wrote it.
   *
   * That build sweeps `book:` alone, so its `modify:`/`swap:` keys block for
   * the rest of its park day with nothing able to clear them. Settling one here
   * would release, on this build's evidence, a lock the build still holding it
   * considers live -- under-blocking during the one window where two builds
   * share a store, which is the direction that costs an entitlement.
   */
  it('leaves a date-less move lock alone, as the build that wrote it does', () => {
    const { ledger, removals } = watched();
    ledger.adoptAttempted([`modify:${BZ}`, `swap:${BZ}`]);
    expect(ledger.settleableIds).toEqual([]);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS * 3; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
    expect(ledger.hasAttempted(BZ, 'swap')).toBe(true);
    expect(dropped(removals)).toEqual([]);
  });

  // The `book:` half of the same key set is still swept, so an attraction
  // carrying both is reported once and for the right reason.
  it('still settles the date-less booking lock beside them', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`book:${BZ}`, `modify:${BZ}`]);
    expect(ledger.settleableIds).toEqual([BZ]);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ, 'book')).toBe(false);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
  });

  // NextLL's escape. Before the key carried a date, an adopted lock and the one
  // released here were the same string, so a release cleared both at once.
  it('is cleared by a deliberate release', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`book:${BZ}`]);
    ledger.releaseAttempt(BZ, 'book');
    expect(ledger.hasAttempted(BZ)).toBe(false);
  });

  // The shared copy is a place another build writes to. Treating an unreadable
  // string as a lock would block an attraction for a reason nothing could
  // explain, so it is dropped and said out loud -- once, not once per tick.
  it('drops a key of no known shape and says so once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ledger = new AutoBookLedger(D1);
      ledger.adoptAttempted(['nonsense']);
      ledger.adoptAttempted(['nonsense']);
      expect(ledger.attemptedKeys()).toEqual([]);
      expect(ledger.hasAttempted('nonsense')).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * Which evidence belongs to which lock.
 *
 * One plans lookup answers "is this reservation held on this date" for every
 * lock on that attraction, so the *observation* is per reservation per date.
 * What a lock accumulates in order to be given back is not: a release hands
 * one action back, and only evidence gathered after that action's request went
 * out can justify it. Sharing the two across kinds is how a booking whose
 * response was lost gets released on a move's evidence and the attraction is
 * booked twice.
 */
/**
 * The 4am park-day rollover, for an instance that did not remount.
 *
 * Everything day-scoped goes, and the two collections that are easiest to miss
 * are the two nothing else can empty. A date-less `modify:`/`swap:` key is
 * never settled by this build (that is deliberate -- the build that wrote it
 * still holds it), so the rollover is its only exit; and a release decided
 * yesterday says nothing about today.
 */
describe('AutoBookLedger.startNewDay()', () => {
  const D1 = '2031-02-17';

  // Without this the key survives in memory into the new park day, while the
  // new day's shared copy no longer holds it -- so nothing can re-read it,
  // nothing can settle it, and that attraction's move is blocked all day with
  // no log line that explains it.
  it('drops a date-less lock an older build left', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`modify:${BZ}`]);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
    ledger.startNewDay();
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
  });

  // The booking date need not turn with the park day: a tab left open
  // overnight can still be working a future date, and yesterday's decision to
  // give a lock back must not go on refusing a lock another instance takes
  // for that date today.
  it('forgets a release decided yesterday', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'book');
    ledger.releaseAttempt(BZ, 'book');
    ledger.startNewDay();
    ledger.adoptAttempted([`${D1}:book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });
});

describe('AutoBookLedger evidence per lock', () => {
  const D1 = '2031-02-17';

  /**
   * The critical case, in the order a park day produces it.
   *
   * The provider picks the kind from the same plans the settle sweep uses, and
   * sweeps before it acts, so a tick that sees the reservation gone settles on
   * that observation and then books on it -- within one tick. Sharing
   * `confirmed` across kinds let the move's 10:00 confirmation stand in for
   * "this booking has been seen to exist", and two absences then threw away the
   * doubt-hold protecting a request whose response was never seen.
   */
  it('does not let a move-era confirmation settle a later booking', () => {
    const ledger = new AutoBookLedger(D1);
    // Held by hand, so the provider chooses `modify`.
    ledger.markAttempted(BZ, 'modify');
    // A poll sees it held: evidence about the move's lock, and only that one.
    ledger.resolveHeld(BZ, true);
    // Cancelled by hand. The move lock starts counting absences.
    ledger.resolveHeld(BZ, false);
    // Nothing is held now, so the same tick's action loop books -- and the
    // response is lost, which is what the doubt-hold exists for.
    ledger.markAttempted(BZ, 'book');
    for (let i = 0; i < CONFIRM_ABSENT_POLLS * 3; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    // The move lock goes: there is nothing left to move, and it was seen held.
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
    // The booking stays. Nothing has confirmed it since its request went out,
    // so absence cannot tell a failed booking from an itinerary lagging behind
    // one that succeeded -- and rebooking on that spends a second entitlement.
    expect(ledger.hasAttempted(BZ, 'book')).toBe(true);
  });

  /**
   * The same rule pointed the other way: absences, not confirmations.
   *
   * A lock taken now must not inherit a counter accumulated before its request
   * existed, or `CONFIRM_ABSENT_POLLS` collapses to a single observation for it.
   */
  it('clears the evidence when the same action is locked again', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'modify');
    ledger.resolveHeld(BZ, true);
    ledger.resolveHeld(BZ, false);
    // A second real request on the same action, with an absence already banked
    // against the first.
    ledger.markAttempted(BZ, 'modify');
    ledger.resolveHeld(BZ, false);
    // Not reset, that would be this lock's second absence and release it -- on
    // an observation made before this request was sent.
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
  });

  // Absence is still counted once per poll for each lock, so an attraction
  // carrying two locks is not released by a single observation.
  it('counts one poll once for each lock on the attraction', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'book');
    ledger.markAttempted(BZ, 'modify');
    ledger.resolveHeld(BZ, true);
    ledger.resolveHeld(BZ, false);
    expect(ledger.hasAttempted(BZ, 'book')).toBe(true);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
    ledger.resolveHeld(BZ, false);
    expect(ledger.hasAttempted(BZ, 'book')).toBe(false);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
  });

  /**
   * Each lock is judged on its own evidence, so a doubt-hold of ours does not
   * suppress the release of a lock we adopted.
   *
   * A swap's gained attraction was never held, so its lock never confirms and
   * is held for the session. Letting that silence an adopted `book` lock --
   * which this instance can say nothing about, and whose owner may be gone --
   * would block the attraction for the rest of the day.
   */
  it('releases an adopted lock beside a doubt-held lock of another kind', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`${D1}:book:${BZ}`]);
    ledger.markAttempted(BZ, 'swap');
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ, 'book')).toBe(false);
    expect(ledger.hasAttempted(BZ, 'swap')).toBe(true);
  });

  /**
   * A date-less lock's evidence is filed under a prefix no dated key can take.
   *
   * Spell it `${date}:${undated}` instead and it collides *exactly* with the
   * dated lock for the same kind and attraction on the same date -- which is
   * the one pairing a deploy straddle produces, an un-reloaded tab's
   * `book:80010114` beside this build's `2031-02-17:book:80010114`. Both locks
   * then advance one counter, twice per poll, and `CONFIRM_ABSENT_POLLS`
   * collapses to a single observation for the pair.
   */
  it('keeps a date-less lock’s evidence off the dated key for the same action', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`book:${BZ}`, `${D1}:book:${BZ}`]);
    ledger.resolveHeld(BZ, false);
    // One poll is one absence for each of them, and neither releases on one.
    expect(ledger.hasUndatedLock(BZ)).toBe(true);
    expect(ledger.hasDatedLock(BZ)).toBe(true);
    ledger.resolveHeld(BZ, false);
    expect(ledger.hasUndatedLock(BZ)).toBe(false);
    expect(ledger.hasDatedLock(BZ)).toBe(false);
  });

  /**
   * The rollback that runs when the dispatch marker refuses the send.
   *
   * `markAttempted` clears this lock's evidence because a new request is a new
   * question. When the request never leaves the device there is no new
   * question, and the lock still standing is the previous one -- which must get
   * its own `confirmed` and `absences` back, or it either never passes the
   * release gate again or restarts its count from nothing.
   */
  it('gives the standing lock its evidence back when the send is refused', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'modify');
    // Seen held, then seen gone once: one absence short of a release.
    ledger.resolveHeld(BZ, true);
    ledger.resolveHeld(BZ, false);
    const rollback = ledger.markAttempted(BZ, 'modify');
    rollback();
    // The first lock is still the live one, and the next absence is its second.
    ledger.resolveHeld(BZ, false);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
  });

  /**
   * Releasing a move gives back the move, and nothing else.
   *
   * The doubt-hold is the record that a booking request whose response was
   * never seen may have succeeded, and it is what the class doc calls the one
   * thing that stops a second entitlement being spent. A release reaches for
   * `unresolved` on its way out -- correctly for a `book` lock, which *is* the
   * doubt-hold -- and reaching for the booking's key while releasing a move
   * throws that record away on evidence about something else entirely. The
   * booking then lands and the ledger never accounts for it.
   */
  it('leaves a booking’s doubt-hold alone when a move on it is released', () => {
    const ledger = new AutoBookLedger(D1);
    // Held by hand, so the move lock is taken and a poll confirms it.
    ledger.markAttempted(BZ, 'modify');
    ledger.resolveHeld(BZ, true);
    // Cancelled by hand, and rebooked by us -- with the response lost.
    ledger.markAttempted(BZ, 'book');
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    // There is nothing left to move, so that lock goes.
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
    // The booking turns up after all, and the doubt-hold is what counts it.
    ledger.resolveHeld(BZ, true);
    expect(ledger.bookedCount).toBe(1);
  });

  /**
   * A lock given back by hand takes its evidence with it.
   *
   * Reachable because a release is remembered only while the shared copy still
   * names the key: once this instance's withdrawal has landed, another tab can
   * take the same action and this instance adopts it. Left behind, that fresh
   * lock inherits the absence this one banked and releases on a single poll.
   */
  it('does not hand a re-adopted lock the absences of the one it replaced', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'modify');
    ledger.resolveHeld(BZ, true);
    ledger.resolveHeld(BZ, false);
    ledger.releaseAttempt(BZ, 'modify');
    // The next tick reads a copy this instance's own withdrawal has left.
    ledger.adoptAttempted([]);
    // Another tab takes the move and publishes it.
    ledger.adoptAttempted([`${D1}:modify:${BZ}`]);
    ledger.resolveHeld(BZ, false);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
  });

  // A date-less lock blocks every date, so its evidence has to be counted per
  // date too -- one absence seen on the first day and one on the second are not two
  // consecutive absences for either.
  it('does not add a legacy absence on one date to the count on another', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.adoptAttempted([`book:${BZ}`]);
    ledger.resolveHeld(BZ, false);
    ledger.setBookingDate('2031-02-18');
    ledger.resolveHeld(BZ, false);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });
});

/**
 * Rehearsals, now that the settle sweep covers every kind.
 *
 * A dry run issues no request, so it must neither count as an action nor take
 * part in settling -- otherwise the dry-run entry re-logs every time a lock
 * releases. Recording them by bare id and for `book` alone was safe only while
 * the sweep was `book`-only.
 */
describe('AutoBookLedger rehearsals across kinds', () => {
  const D1 = '2031-02-17';

  it('keeps a rehearsed move out of the settle sweep', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'modify', true);
    expect(ledger.settleableIds).toEqual([]);
  });

  // The dry-run setting is read live, so a rehearsal of one kind and a real
  // attempt of another can coexist. A rehearsal keyed by bare id would suppress
  // settling of the real one, and its lock could never be released.
  it('lets a real attempt settle beside a rehearsal of another kind', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'modify', true);
    ledger.markAttempted(BZ, 'book');
    expect(ledger.settleableIds).toEqual([BZ]);
    ledger.resolveHeld(BZ, true);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveHeld(BZ, false);
    }
    expect(ledger.hasAttempted(BZ, 'book')).toBe(false);
    // The rehearsal is not a lock and is not released with it.
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
  });

  it('settles a real attempt made after rehearsing the same action', () => {
    const ledger = new AutoBookLedger(D1);
    ledger.markAttempted(BZ, 'book', true);
    ledger.markAttempted(BZ, 'book');
    expect(ledger.settleableIds).toEqual([BZ]);
  });
});

describe('outcomeIsUnknown', () => {
  const answered = (status: number) =>
    new RequestError({ ok: false, status, data: {} });

  // No answer, or a server failing mid-request: the change may have landed.
  it.each([0, 500, 503])('calls status %s unknown', status => {
    expect(outcomeIsUnknown(answered(status))).toBe(true);
  });

  // An answer that refused it: nothing changed.
  it.each([400, 403, 409, 410, 429])('calls status %s known', status => {
    expect(outcomeIsUnknown(answered(status))).toBe(false);
  });

  it('knows a request that never left changed nothing', () => {
    expect(outcomeIsUnknown(new RequestNotSent('refused at dispatch'))).toBe(
      false
    );
    expect(outcomeIsUnknown(new RateLimitExceeded())).toBe(false);
  });

  it("reports this app's own errors as the errors they are", () => {
    expect(outcomeIsUnknown(new Error('oops'))).toBe(false);
  });
});
