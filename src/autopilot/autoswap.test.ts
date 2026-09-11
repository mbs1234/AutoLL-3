import { Booking, LLMP } from '@/api/itinerary';
import { Guest, Guests, Offer, OfferError } from '@/api/ll';
import { DateTime, ParkTime } from '@/datetime';

import { AutoBookLedger } from './autobook';
import {
  MAX_HELD_MP,
  attemptAutoSwap,
  chooseSwapVictim,
  heldMPToday,
  shouldSwap,
} from './autoswap';
import { WatchTarget } from './watchlist';

const DATE = '2026-09-04';
const at = (h: number, m = 0) => new ParkTime(h, m);
const guest = (id: string) => ({ id, name: id }) as Guest;
const party = (eligible: Guest[] = [guest('a')]) =>
  ({ eligible, ineligible: [] }) as Guests;

/** A held Multi Pass reservation with a ranked experience. */
function held(
  id: string,
  priority: number | undefined,
  rest: {
    tier?: number;
    modifiable?: boolean;
    time?: ParkTime;
    cancellable?: boolean;
    guests?: Guest[];
    choices?: { id: string }[];
  } = {}
): LLMP {
  const time = rest.time ?? at(15);
  return {
    type: 'LL',
    subtype: 'MP',
    id: `ent-${id}`,
    facilityId: id,
    name: `Ride ${id}`,
    experience: { id, name: `Ride ${id}`, priority, tier: rest.tier },
    start: new DateTime(DATE, time),
    end: new DateTime(DATE, time.add({ hours: 1 })),
    modifiable: rest.modifiable ?? true,
    // A reservation only occupies a slot while it is cancellable and still has
    // a guest with a redemption left, so the fixture has to carry both.
    cancellable: rest.cancellable ?? true,
    guests: rest.guests ?? [guest('a')],
    ...(rest.choices ? { choices: rest.choices } : {}),
  } as unknown as LLMP;
}

const incoming = (id: string, priority?: number, tier?: number) =>
  ({ id, name: `Ride ${id}`, priority, tier, park: { id: 'p' } }) as never;

const target = (rest: Partial<WatchTarget> = {}): WatchTarget => ({
  experienceId: 'new',
  autoSwap: true,
  ...rest,
});

const full = () => [held('a', 4.1), held('b', 3.0), held('c', 2.0)];

function offerAt(time: ParkTime, guests = party()) {
  return {
    id: 'offer-1',
    offerSetId: 'set-1',
    start: new DateTime(DATE, time),
    end: new DateTime(DATE, time.add({ hours: 1 })),
    guests,
    itinerary: [],
  } as unknown as Offer<LLMP>;
}

function deps(overrides: Partial<Parameters<typeof attemptAutoSwap>[3]> = {}) {
  return {
    createSwapOffer: jest.fn(async () => offerAt(at(11))),
    book: jest.fn(async () => held('new', 1.0)),
    guests: party(),
    ledger: new AutoBookLedger(),
    ...overrides,
  } as Parameters<typeof attemptAutoSwap>[3];
}

describe('heldMPToday()', () => {
  it('returns Multi Pass reservations on the given day', () => {
    const plans = [held('a', 1), held('b', 2)] as Booking[];
    expect(heldMPToday(plans, DATE)).toHaveLength(2);
  });

  // After the first tap-in of the day the itinerary keeps the booking but
  // drops its guests, and counting that would make autopilot believe the party
  // is full -- so it would swap a reservation away rather than book into the
  // slot that just came free.
  it('excludes reservations that no longer occupy a slot', () => {
    const redeemed = held('a', 1, { guests: [] });
    const gone = held('b', 2, { cancellable: false });
    const mep = held('c', 3, { choices: [{ id: 'x' }] });
    expect(heldMPToday([redeemed, gone, mep] as Booking[], DATE)).toEqual([]);
  });

  it('excludes other days and non-Multi-Pass bookings', () => {
    const tomorrow = {
      ...held('a', 1),
      start: new DateTime('2026-09-05', at(15)),
    };
    const sp = { ...held('b', 2), subtype: 'SP' };
    expect(heldMPToday([tomorrow, sp] as unknown as Booking[], DATE)).toEqual(
      []
    );
  });
});

describe('chooseSwapVictim()', () => {
  it('gives up the worst-ranked reservation', () => {
    expect(chooseSwapVictim(full(), incoming('new', 1.0))?.facilityId).toBe(
      'a'
    );
  });

  // Swapping sideways or downward spends a request to make the day no better.
  it('only considers reservations ranked strictly worse', () => {
    const heldList = [held('a', 1.0), held('b', 2.0)];
    expect(chooseSwapVictim(heldList, incoming('new', 2.0))?.facilityId).toBe(
      undefined
    );
    expect(chooseSwapVictim(heldList, incoming('new', 1.5))?.facilityId).toBe(
      'b'
    );
  });

  it('returns nothing when everything held is better', () => {
    expect(chooseSwapVictim(full(), incoming('new', 4.5))).toBeUndefined();
  });

  it('skips unmodifiable reservations', () => {
    const heldList = [held('a', 4.1, { modifiable: false }), held('b', 3.0)];
    expect(chooseSwapVictim(heldList, incoming('new', 1.0))?.facilityId).toBe(
      'b'
    );
  });

  // Wait Magic: give up "particularly a Tier 2 attraction, that isn't very
  // hard to claim again later" ahead of a Tier 1.
  it('prefers giving up a non-Tier-1 over a worse-ranked Tier 1', () => {
    const heldList = [held('t1', 4.1, { tier: 1 }), held('t2', 3.0)];
    expect(chooseSwapVictim(heldList, incoming('new', 1.0))?.facilityId).toBe(
      't2'
    );
  });

  // Reversed deliberately. `comparePriority` sorts a missing priority last,
  // which is right for attempt order and wrong here: an unranked reservation
  // read as the worst thing held, and `Itinerary` synthesises an experience for
  // an unknown facility id with neither `priority` nor `tier` -- so it also
  // passed the non-Tier-1 preference above and became the ideal victim on both
  // keys. A renamed id after a refurbishment, a new ride, or a seasonal overlay
  // was enough. Refusing to rank it costs one swap; guessing costs a real
  // reservation, and that is the trade this whole function is about.
  it('never gives up a reservation the resort data does not rank', () => {
    const heldList = [held('ranked', 4.0), held('none', undefined)];
    expect(chooseSwapVictim(heldList, incoming('new', 1.0))?.facilityId).toBe(
      'ranked'
    );
  });

  it('gives up nothing when the only worse reservation is unranked', () => {
    const heldList = [held('better', 1.0), held('none', undefined)];
    expect(chooseSwapVictim(heldList, incoming('new', 2.0))).toBeUndefined();
  });

  // The same rule from the other side, and already the behaviour: an incoming
  // attraction with no rank cannot be shown to be an improvement, so it never
  // costs anything held.
  it('gives up nothing for an unranked incoming attraction', () => {
    expect(chooseSwapVictim(full(), incoming('new'))).toBeUndefined();
  });

  it('handles an empty list', () => {
    expect(chooseSwapVictim([], incoming('new', 1.0))).toBeUndefined();
  });
});

describe('shouldSwap()', () => {
  const ledger = () => new AutoBookLedger();

  it('allows a swap when full and a worse reservation exists', () => {
    const result = shouldSwap(target(), incoming('new', 1.0), full(), ledger());
    expect(result).toMatchObject({
      ok: true,
      victim: expect.objectContaining({ facilityId: 'a' }),
    });
  });

  it('refuses when not enabled', () => {
    expect(
      shouldSwap(
        target({ autoSwap: false }),
        incoming('new', 1.0),
        full(),
        ledger()
      )
    ).toEqual({ ok: false, reason: 'not-enabled' });
  });

  // With a slot free, a fresh booking keeps both attractions.
  it('refuses when the party is not full', () => {
    expect(
      shouldSwap(
        target(),
        incoming('new', 1.0),
        full().slice(0, MAX_HELD_MP - 1),
        ledger()
      )
    ).toEqual({ ok: false, reason: 'not-full' });
  });

  it('refuses when the attraction is already held', () => {
    expect(
      shouldSwap(
        target({ experienceId: 'a' }),
        incoming('a', 1.0),
        full(),
        ledger()
      )
    ).toEqual({ ok: false, reason: 'already-held' });
  });

  it('refuses when nothing held is worse', () => {
    expect(
      shouldSwap(target(), incoming('new', 4.5), full(), ledger())
    ).toEqual({ ok: false, reason: 'no-worse-reservation' });
  });

  it('refuses a second swap attempt for the same attraction', () => {
    const l = ledger();
    l.markAttempted('new', 'swap');
    expect(shouldSwap(target(), incoming('new', 1.0), full(), l)).toEqual({
      ok: false,
      reason: 'already-attempted',
    });
  });

  it('is not blocked by a prior booking or move of the same attraction', () => {
    const l = ledger();
    l.markAttempted('new', 'book');
    l.markAttempted('new', 'modify');
    expect(shouldSwap(target(), incoming('new', 1.0), full(), l).ok).toBe(true);
  });

  it('refuses at the session cap', () => {
    const l = new AutoBookLedger(1);
    l.markBooked();
    expect(shouldSwap(target(), incoming('new', 1.0), full(), l)).toEqual({
      ok: false,
      reason: 'budget-exhausted',
    });
  });
});

describe('attemptAutoSwap()', () => {
  it('swaps the worst reservation for the incoming attraction', async () => {
    const d = deps();
    const result = await attemptAutoSwap(
      target(),
      incoming('new', 1.0),
      full(),
      d
    );
    expect(result).toMatchObject({
      status: 'swapped',
      replaced: { name: 'Ride a', time: at(15) },
      to: at(11),
    });
    expect(d.ledger.bookedCount).toBe(1);
  });

  // The victim rides along in the offer request; that is what makes the swap
  // one atomic call rather than a cancel followed by a book.
  it('passes the victim to the swap offer', async () => {
    const d = deps();
    await attemptAutoSwap(target(), incoming('new', 1.0), full(), d);
    const [, , victim] = (d.createSwapOffer as jest.Mock).mock.calls[0]!;
    expect(victim.facilityId).toBe('a');
  });

  it('spends no request when the guards refuse', async () => {
    const d = deps();
    await attemptAutoSwap(
      target(),
      incoming('new', 1.0),
      full().slice(0, 2),
      d
    );
    expect(d.createSwapOffer).not.toHaveBeenCalled();
  });

  // Same re-check as booking and moving: the offer's real time can differ.
  it('refuses an offer outside the window', async () => {
    const d = deps({ createSwapOffer: jest.fn(async () => offerAt(at(20))) });
    const result = await attemptAutoSwap(
      target({ before: at(12) }),
      incoming('new', 1.0),
      full(),
      d
    );
    expect(result).toEqual({
      status: 'skipped',
      reason: 'offer-outside-window',
    });
    expect(d.book).not.toHaveBeenCalled();
    expect(d.ledger.hasAttempted('new', 'swap')).toBe(false);
  });

  it('marks the attempt before committing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = deps({
      book: jest.fn(async () => {
        throw new Error('boom');
      }),
    });
    const result = await attemptAutoSwap(
      target(),
      incoming('new', 1.0),
      full(),
      d
    );
    expect(result).toEqual({
      status: 'failed',
      error: 'boom',
      // No response, so it may have applied after all: the lock must stand.
      rejected: false,
    });
    expect(d.ledger.hasAttempted('new', 'swap')).toBe(true);
    expect(d.ledger.bookedCount).toBe(0);
  });

  it('treats OfferError as a skip', async () => {
    const d = deps({
      createSwapOffer: jest.fn(async () => {
        throw new OfferError(party([]));
      }),
    });
    const result = await attemptAutoSwap(
      target(),
      incoming('new', 1.0),
      full(),
      d
    );
    expect(result).toEqual({
      status: 'skipped',
      reason: 'no-eligible-guests',
    });
  });
});

describe('attemptAutoSwap() clash guard', () => {
  const clashes = jest.fn(() => true);

  beforeEach(() => clashes.mockClear());

  it('abandons an offer that lands on an existing plan', async () => {
    const outcome = await attemptAutoSwap(
      target(),
      incoming('new', 1.0),
      full(),
      deps({ clashes })
    );
    expect(outcome).toEqual({ status: 'skipped', reason: 'overlaps-plans' });
  });

  // The reservation being traded away is released by this very request, so
  // the slot it occupies cannot conflict with what replaces it. Counting it
  // would refuse every swap into a time near the victim's own.
  it('excludes the reservation being given up from the check', async () => {
    const seen: unknown[] = [];
    await attemptAutoSwap(target(), incoming('new', 1.0), full(), {
      ...deps(),
      clashes: (_time, _itinerary, release) => {
        seen.push(release);
        return false;
      },
    });
    expect(seen).toEqual([expect.objectContaining({ facilityId: 'a' })]);
  });
});
