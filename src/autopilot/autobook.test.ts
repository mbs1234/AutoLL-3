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
  offerIsAcceptable,
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
    ledger: new AutoBookLedger(),
    ...overrides,
  } as Parameters<typeof attemptAutoBook>[2];
}

describe('AutoBookLedger', () => {
  it('counts bookings', () => {
    const ledger = new AutoBookLedger();
    ledger.markBooked();
    expect(ledger.bookedCount).toBe(1);
    ledger.markBooked();
    expect(ledger.bookedCount).toBe(2);
  });

  it('remembers attempts', () => {
    const ledger = new AutoBookLedger();
    expect(ledger.hasAttempted(BZ)).toBe(false);
    ledger.markAttempted(BZ);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // Booking and moving the same attraction are separate each-once actions.
  it('tracks booking and moving independently', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ, 'book');
    expect(ledger.hasAttempted(BZ, 'book')).toBe(true);
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
    ledger.markAttempted(BZ, 'modify');
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
  });

  it('defaults to the booking kind', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    expect(ledger.hasAttempted(BZ, 'book')).toBe(true);
  });

  it('resets', () => {
    const ledger = new AutoBookLedger();
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
    for (let i = 0; i < times; ++i) ledger.resolveBook(BZ, false);
  }

  /** Plans reporting the reservation, which is what arms a later release. */
  const seeHeld = (ledger: AutoBookLedger) => ledger.resolveBook(BZ, true);

  it('does not count an attempt that never confirmed as booked', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    // The request may have landed. Until plans say otherwise the lock stands,
    // so nothing else attempts the same attraction.
    expect(ledger.hasAttempted(BZ)).toBe(true);
    expect(ledger.bookedCount).toBe(0);
  });

  it('does not double-count an attempt that confirmed', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    expect(ledger.bookedCount).toBe(1);
  });

  it('counts an unconfirmed attempt once plans show it landed', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.resolveBook(BZ, true);
    expect(ledger.bookedCount).toBe(1);
  });

  it('leaves a confirmed booking alone when plans agree', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.resolveBook(BZ, true);
    expect(ledger.bookedCount).toBe(1);
  });

  it('keeps the lock while the reservation is held', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.resolveBook(BZ, true);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // A pass that has been redeemed -- or has simply expired unredeemed, which
  // Disney counts the same way -- leaves plans looking exactly like a
  // cancelled one. Releasing the lock there would spend the session allowance
  // rebooking something Disney will not sell again.
  it('keeps the lock when the entitlement was spent rather than cancelled', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    seeHeld(ledger);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS + 2; ++i) {
      ledger.resolveBook(BZ, false, true);
    }
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // Absences seen while the pass was still live must not carry over: the
  // release needs CONFIRM_ABSENT_POLLS *consecutive* ones.
  it('forgets earlier absences once an entitlement is spent', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    seeHeld(ledger);
    ledger.resolveBook(BZ, false);
    ledger.resolveBook(BZ, false, true);
    ledger.resolveBook(BZ, false);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // The reason any of this exists: cancel a late return time by hand and the
  // better one that drops later must still be bookable.
  it('releases the lock after an observed booking is cancelled', () => {
    const ledger = new AutoBookLedger();
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
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS * 10);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('keeps an unconfirmed attempt locked however long it is absent', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS * 10);
    expect(ledger.hasAttempted(BZ)).toBe(true);
    expect(ledger.bookedCount).toBe(0);
  });

  // Disney can omit a just-made booking from a single plans response. Acting
  // on one gap would rebook something still held.
  it('requires consecutive absences before releasing', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    seeHeld(ledger);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS - 1);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('restarts the count when the reservation reappears', () => {
    const ledger = new AutoBookLedger();
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
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ, 'book', true);
    expect(ledger.bookedCount).toBe(0);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('keeps dry-run marks out of settling', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ, 'book', true);
    expect(ledger.attemptedBookIds).toEqual([]);
    seeHeld(ledger);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS * 5);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('reports unsettled and settled book attempts alike', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.markAttempted('other', 'modify');
    expect(ledger.attemptedBookIds).toEqual([BZ]);
  });

  // Moving and swapping create no doubt-hold of their own, so neither may
  // settle a booking's: the move is counted, and the booking stays in doubt
  // until plans speak for it.
  it('leaves booking doubt untouched when a move confirms', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markAttempted(BZ, 'modify');
    ledger.markBooked();
    expect(ledger.bookedCount).toBe(1);
    ledger.resolveBook(BZ, true);
    expect(ledger.bookedCount).toBe(2);
  });

  it('clears absence counts on reset', () => {
    const ledger = new AutoBookLedger();
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
      new AutoBookLedger()
    );
    expect(result).toEqual({ ok: false, reason: 'not-enabled' });
  });

  it('refuses when autoBook is simply absent', () => {
    expect(shouldAttempt({ experienceId: BZ }, new AutoBookLedger())).toEqual({
      ok: false,
      reason: 'not-enabled',
    });
  });

  it('allows an enabled, unattempted target', () => {
    expect(shouldAttempt(target(), new AutoBookLedger())).toEqual({ ok: true });
  });

  it('is enabled by bookThenMove alone', () => {
    const t = target({ autoBook: false, bookThenMove: true });
    expect(shouldAttempt(t, new AutoBookLedger())).toEqual({ ok: true });
  });

  // A timed-out booking request may still have succeeded server-side, so a
  // retry risks double-booking.
  it('refuses a second attempt at the same attraction', () => {
    const ledger = new AutoBookLedger();
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
    const ledger = new AutoBookLedger();
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
    const ledger = new AutoBookLedger();
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
    const ledger = new AutoBookLedger(() => {
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
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ, 'modify');
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(true);
    ledger.releaseAttempt(BZ, 'modify');
    expect(ledger.hasAttempted(BZ, 'modify')).toBe(false);
  });

  it('releases only the kind named, and only that attraction', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ, 'modify');
    ledger.markAttempted(BZ, 'book');
    ledger.releaseAttempt(BZ, 'modify');
    expect(ledger.hasAttempted(BZ, 'book')).toBe(true);
  });

  // A released booking keeps whatever it already confirmed. Releasing is about
  // the lock, not about unwinding a booking that happened.
  it('keeps the booking count across a release', () => {
    const ledger = new AutoBookLedger();
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
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.releaseAttempt(BZ, 'book');
    expect(ledger.hasAttempted(BZ)).toBe(false);
    ledger.resolveBook(BZ, true);
    expect(ledger.bookedCount).toBe(0);
  });

  // A modify puts a reservation already held through a round trip. It creates
  // no entitlement and takes no doubt-hold, so there is none to clear.
  it('leaves the booking count alone for a modify', () => {
    const ledger = new AutoBookLedger();
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
    const ledger = new AutoBookLedger(released => removals.push(released));
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
    expect(dropped(removals)).toContain(`book:${BZ}`);
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
    expect(ledger.attemptedKeys()).toEqual([`book:${HM}`]);
  });

  it('shares the lock again if the same attraction is attempted again', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.resolveRejected(BZ);
    ledger.releaseAttempt(BZ, 'book');
    ledger.markAttempted(BZ, 'book');
    expect(ledger.attemptedKeys()).toContain(`book:${BZ}`);
  });

  // An adopted lock used to be permanent: nothing here confirms it, so the
  // absence branch returned early every time. Plans saying the reservation is
  // not there is the same evidence for an adopted lock as for one of ours.
  it('releases an adopted lock once plans settle it as absent', () => {
    const { ledger, removals } = watched();
    ledger.adoptAttempted([`book:${BZ}`]);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; i++) {
      ledger.resolveBook(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(false);
    expect(dropped(removals)).toContain(`book:${BZ}`);
  });

  it('holds an adopted lock until the absences add up', () => {
    const { ledger } = watched();
    ledger.adoptAttempted([`book:${BZ}`]);
    ledger.resolveBook(BZ, false);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  // This instance's own unsettled attempt is a different case: the request may
  // have succeeded where the response was lost, so absence is not proof.
  it('keeps an unsettled attempt of its own through the same absences', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    for (let i = 0; i < CONFIRM_ABSENT_POLLS + 1; i++) {
      ledger.resolveBook(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('reports a lock it took as its own', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    expect(ledger.attemptedKeys()).toEqual([`book:${BZ}`]);
    expect(ledger.ownedKeys()).toEqual([`book:${BZ}`]);
  });

  // Adoption is how another instance's lock gets here, and it is not this
  // instance's to withdraw.
  it('does not claim an adopted lock as its own', () => {
    const { ledger } = watched();
    ledger.adoptAttempted([`book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(true);
    expect(ledger.ownedKeys()).toEqual([]);
  });

  it('states the key when an attempt is released by hand', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ, 'modify');
    ledger.releaseAttempt(BZ, 'modify');
    expect(dropped(removals)).toContain(`modify:${BZ}`);
    expect(ledger.ownedKeys()).toEqual([]);
  });

  // The regression this block exists for. `resolveBook` settling a
  // cancellation used to call `notify()` alone, so the release never reached
  // storage: the lock survived, the next mount adopted it, and the rebooking
  // the release branch exists to permit never happened.
  it('states the key when a cancellation settles the lock', () => {
    const { ledger, removals } = watched();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.resolveBook(BZ, true);
    for (let i = 0; i < CONFIRM_ABSENT_POLLS; ++i) {
      ledger.resolveBook(BZ, false);
    }
    expect(ledger.hasAttempted(BZ)).toBe(false);
    expect(dropped(removals)).toContain(`book:${BZ}`);
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
    expect(dropped(removals).sort()).toEqual([`book:${BZ}`, 'swap:OTHER']);
    expect(ledger.ownedKeys()).toEqual([]);
  });

  it('leaves an adopted lock in the shared copy on reset', () => {
    const { ledger, removals } = watched();
    ledger.adoptAttempted([`book:${BZ}`]);
    removals.length = 0;
    ledger.reset();
    expect(dropped(removals)).toEqual([]);
  });

  // A release is remembered so a stale read cannot resurrect it...
  it('refuses to re-adopt a lock it released', () => {
    const { ledger } = watched();
    ledger.markAttempted(BZ, 'book');
    ledger.releaseAttempt(BZ, 'book');
    ledger.adoptAttempted([`book:${BZ}`]);
    expect(ledger.hasAttempted(BZ)).toBe(false);
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
    expect(ledger.ownedKeys()).toEqual([`book:${BZ}`]);
    ledger.reset();
    ledger.adoptAttempted([`book:${BZ}`]);
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
        ledger: new AutoBookLedger(),
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
        ledger: new AutoBookLedger(),
        partyIsAcceptable: wholePartyEligible,
      }
    );
    expect(outcome.status).toBe('booked');
  });

  // Refusing before the lock is taken matters: a skip must not retire the
  // attraction for the session or charge the allowance.
  it('takes no lock and no charge when it refuses', async () => {
    const ledger = new AutoBookLedger();
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
        ledger: new AutoBookLedger(),
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
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.resolveRejected(BZ);
    // Plans finding the attraction held now says nothing about this attempt:
    // whatever is there, this request did not put it there.
    ledger.resolveBook(BZ, true);
    expect(ledger.bookedCount).toBe(0);
  });

  // Autopilot keeps one action per attraction per session; only NextLL retries.
  it('keeps the attempt lock', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.resolveRejected(BZ);
    expect(ledger.hasAttempted(BZ)).toBe(true);
  });

  it('does nothing for an attraction with no hold', () => {
    const ledger = new AutoBookLedger();
    ledger.resolveRejected(BZ);
    expect(ledger.bookedCount).toBe(0);
  });

  // A confirmed booking is a real booking, not a doubt.
  it('does not unwind a booking that confirmed', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.resolveRejected(BZ);
    expect(ledger.bookedCount).toBe(1);
  });
});
