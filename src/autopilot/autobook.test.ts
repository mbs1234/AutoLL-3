import { RequestError } from '@/api/client';
import { LLMP } from '@/api/itinerary';
import { Guest, Guests, Offer, OfferError } from '@/api/ll';
import { DateTime, ParkTime } from '@/datetime';
import { RateLimitExceeded } from '@/ratelimit';

import {
  AutoBookLedger,
  CONFIRM_ABSENT_POLLS,
  DEFAULT_ACTIONS_PER_DAY,
  MAX_ACTIONS_PER_DAY,
  MIN_ACTIONS_PER_DAY,
  actionWasRejected,
  attemptAutoBook,
  offerIsAcceptable,
  shouldAttempt,
} from './autobook';
import { WatchTarget } from './watchlist';

const BZ = '80010114';
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
  it('starts with the full allowance', () => {
    expect(new AutoBookLedger().remaining).toBe(DEFAULT_ACTIONS_PER_DAY);
  });

  it('counts bookings against the allowance', () => {
    const ledger = new AutoBookLedger(2);
    ledger.markBooked();
    expect(ledger.remaining).toBe(1);
    ledger.markBooked();
    expect(ledger.remaining).toBe(0);
  });

  it('never reports a negative allowance', () => {
    const ledger = new AutoBookLedger(1);
    ledger.markBooked();
    ledger.markBooked();
    expect(ledger.remaining).toBe(0);
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

  it('charges the allowance for an attempt that never confirmed', () => {
    const ledger = new AutoBookLedger(1);
    ledger.markAttempted(BZ);
    // The request may have landed. Until plans say otherwise it is treated as
    // spent, so nothing else can book against the same slot.
    expect(ledger.remaining).toBe(0);
    expect(ledger.bookedCount).toBe(0);
  });

  it('does not double-charge an attempt that confirmed', () => {
    const ledger = new AutoBookLedger(2);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    expect(ledger.remaining).toBe(1);
    expect(ledger.bookedCount).toBe(1);
  });

  it('charges an unconfirmed attempt once plans show it landed', () => {
    const ledger = new AutoBookLedger(2);
    ledger.markAttempted(BZ);
    ledger.resolveBook(BZ, true);
    expect(ledger.bookedCount).toBe(1);
    expect(ledger.remaining).toBe(1);
  });

  it('leaves a confirmed booking alone when plans agree', () => {
    const ledger = new AutoBookLedger(2);
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

  it('keeps an unconfirmed attempt charged against the allowance', () => {
    const ledger = new AutoBookLedger(1);
    ledger.markAttempted(BZ);
    seeAbsent(ledger, CONFIRM_ABSENT_POLLS * 10);
    expect(ledger.remaining).toBe(0);
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

  // A rehearsal issues no request, so it must neither hold the allowance nor
  // take part in settling -- otherwise the dry-run entry re-logs every time
  // the lock releases, and the README's "none of it counts" becomes false.
  it('keeps dry-run marks out of the allowance', () => {
    const ledger = new AutoBookLedger(1);
    ledger.markAttempted(BZ, 'book', true);
    expect(ledger.remaining).toBe(1);
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
  // settle a booking's.
  it('leaves booking doubt untouched when a move confirms', () => {
    const ledger = new AutoBookLedger(2);
    ledger.markAttempted(BZ);
    ledger.markAttempted(BZ, 'modify');
    ledger.markBooked();
    expect(ledger.remaining).toBe(0);
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

  it('refuses once the session cap is reached', () => {
    const ledger = new AutoBookLedger(1);
    ledger.markBooked();
    expect(shouldAttempt(target(), ledger)).toEqual({
      ok: false,
      reason: 'budget-exhausted',
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

  it('stops at the session cap', async () => {
    const ledger = new AutoBookLedger(1);
    const d = deps({ ledger });
    await attemptAutoBook(target(), experience, d);
    const second = await attemptAutoBook(
      target({ experienceId: 'other' }),
      experience,
      d
    );
    expect(second).toEqual({ status: 'skipped', reason: 'budget-exhausted' });
  });
});

/**
 * The day's allowance. A session-scoped cap bounded nothing: the ledger lived
 * in a ref, so a plain page reload refilled it.
 */
describe('AutoBookLedger day budget', () => {
  it('counts what earlier runs today already spent', () => {
    const ledger = new AutoBookLedger(10, 4);
    expect(ledger.spent).toBe(4);
    expect(ledger.remaining).toBe(6);
  });

  // The bug this replaces: turning autopilot off and on was the refill, and it
  // came bundled with a wipe of the drop-detection baseline.
  it('carries the run forward across a reset rather than refilling', () => {
    const ledger = new AutoBookLedger(10);
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    expect(ledger.remaining).toBe(9);
    ledger.reset();
    expect(ledger.spent).toBe(1);
    expect(ledger.remaining).toBe(9);
    // The per-attraction lock is session state and does clear.
    expect(ledger.hasAttempted(BZ)).toBe(false);
  });

  it('reports every change in the charge, so the day survives a reload', () => {
    const spends: number[] = [];
    const ledger = new AutoBookLedger(10, 0, n => spends.push(n));
    ledger.markAttempted(BZ);
    ledger.markBooked(BZ);
    ledger.reset();
    expect(spends).toEqual([1, 1, 1]);
  });

  // Lowering the allowance below what has been spent leaves nothing remaining
  // rather than going negative or refunding anything.
  it('changes the ceiling without changing the spend', () => {
    const ledger = new AutoBookLedger(10, 6);
    ledger.setBudget(4);
    expect(ledger.spent).toBe(6);
    expect(ledger.remaining).toBe(0);
    ledger.setBudget(12);
    expect(ledger.remaining).toBe(6);
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

  // An unbudgeted ledger still counts; it just never runs out.
  it('does not refund the spend', () => {
    const ledger = new AutoBookLedger();
    ledger.markAttempted(BZ, 'modify');
    ledger.markBooked();
    const spent = ledger.spent;
    ledger.releaseAttempt(BZ, 'modify');
    expect(ledger.spent).toBe(spent);
  });

  // A book attempt also charges the day's allowance, on the chance that a
  // request whose outcome we never learned did succeed. Releasing is only
  // ever done for one we did learn about -- Disney refused it, or our own
  // limiter never sent it -- so the charge has to come back, or a run of lost
  // races quietly spends a day of Lightning Lanes on bookings that do not
  // exist.
  it('gives back the doubt-hold a book attempt charged', () => {
    const ledger = new AutoBookLedger(10);
    ledger.markAttempted(BZ);
    expect(ledger.remaining).toBe(9);
    ledger.releaseAttempt(BZ, 'book');
    expect(ledger.remaining).toBe(10);
    expect(ledger.hasAttempted(BZ)).toBe(false);
  });

  // A modify puts a reservation already held through a round trip. It spends
  // no entitlement and takes no doubt-hold, so there is none to give back.
  it('leaves the allowance alone for a modify', () => {
    const ledger = new AutoBookLedger(10);
    ledger.markAttempted(BZ, 'modify');
    ledger.releaseAttempt(BZ, 'modify');
    expect(ledger.remaining).toBe(10);
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

  // Thrown as the first statement of ApiClient.request, before anything is
  // sent -- so this is the most certain "nothing happened" of the lot, and it
  // is the one that used to read as unknown, because it carries no response.
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

// The two numbers are independent and easy to conflate: the ceiling bounds
// what someone who has decided otherwise may raise the allowance to, while
// the default is what everyone gets without asking. Raising one must not
// drag the other with it.
describe("the day's allowance", () => {
  it('defaults to ten', () => {
    expect(DEFAULT_ACTIONS_PER_DAY).toBe(10);
  });

  it('lets it be raised to fifty, and no further', () => {
    expect(MAX_ACTIONS_PER_DAY).toBe(50);
  });

  it('keeps the default well below the ceiling', () => {
    expect(DEFAULT_ACTIONS_PER_DAY).toBeLessThan(MAX_ACTIONS_PER_DAY);
    expect(MIN_ACTIONS_PER_DAY).toBeLessThanOrEqual(DEFAULT_ACTIONS_PER_DAY);
  });

  // A budget is only a bound if the ledger enforces it.
  it('refuses to act past the ceiling however it was reached', () => {
    const ledger = new AutoBookLedger(MAX_ACTIONS_PER_DAY + 20);
    expect(ledger.remaining).toBeLessThanOrEqual(MAX_ACTIONS_PER_DAY + 20);
    const capped = new AutoBookLedger(MAX_ACTIONS_PER_DAY);
    for (let i = 0; i < MAX_ACTIONS_PER_DAY; ++i) capped.markBooked();
    expect(capped.remaining).toBe(0);
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
  function watched(budget = DEFAULT_ACTIONS_PER_DAY) {
    const removals: (readonly string[] | undefined)[] = [];
    const ledger = new AutoBookLedger(
      budget,
      0,
      () => undefined,
      released => removals.push(released)
    );
    return { ledger, removals };
  }

  /** Every key the persister was told to drop, flattened. */
  const dropped = (removals: (readonly string[] | undefined)[]) =>
    removals.flatMap(r => [...(r ?? [])]);

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
