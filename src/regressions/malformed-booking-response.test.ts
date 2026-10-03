import { respond, response, testMutationControl } from '@/__fixtures__/client';
import {
  booking,
  mickey,
  minnie,
  modOffer,
  offer,
  wdw,
} from '@/__fixtures__/ll';
import { RequestNotSent, UnknownMutationOutcome } from '@/api/client';
import { LLClientWDW } from '@/api/ll/wdw';
import { getSensorData } from '@/api/sensor-data';
import { outcomeIsUnknown } from '@/autopilot/autobook';
import { fetchJson } from '@/fetch';
import { setTime } from '@/testing';

let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  setTime('10:00:00');
  jest.mocked(getSensorData).mockReturnValue('');
  jest.mocked(fetchJson).mockClear();
  // The reader logs what it refused, and what it read but found odd. The
  // tests that care about the second assert on it.
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  error = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

const valid = () => ({
  booking: {
    experienceId: booking.facilityId,
    startDateTime: String(booking.start),
    endDateTime: String(booking.end),
    guests: booking.guests.map(g => ({
      guestId: g.id,
      entitlementId: g.entitlementId,
    })),
  },
  party: {
    guests: booking.guests.map(g => ({ id: g.id, firstName: g.name })),
    ineligibleGuests: [],
  },
});

/** A new booking's body: its entries, and the same party as `valid`. */
const newBooking = (...entries: unknown[]) => ({
  entitlementExperiences: entries,
  party: valid().party,
});

async function bookingError(book: Promise<unknown>) {
  try {
    await book;
  } catch (caught) {
    return caught;
  }
  throw new Error('The booking was read');
}

// Each of these is a 2xx body the app cannot build a booking from: no
// booking, no party, no guest it could act on, or no return window. The
// request went out, so each must leave the outcome unknown -- never an
// ordinary failure a second tap could repeat.
test.each([
  ['an empty body, which is how a non-JSON success reads', {}],
  ['no booking', { party: valid().party }],
  ['a booking that is not an object', { ...valid(), booking: 'booked' }],
  ['no party', { booking: valid().booking }],
  [
    'a party with no guest list',
    { ...valid(), party: { ineligibleGuests: [] } },
  ],
  [
    'no booked guests',
    { ...valid(), booking: { ...valid().booking, guests: [] } },
  ],
  [
    'no booked guest with both an id and an entitlement',
    {
      ...valid(),
      booking: {
        ...valid().booking,
        guests: [
          { guestId: 'mickey' },
          { entitlementId: 'ent' },
          { guestId: 7, entitlementId: 8 },
        ],
      },
    },
  ],
  [
    'an unreadable start',
    {
      ...valid(),
      booking: { ...valid().booking, startDateTime: 'not-a-date' },
    },
  ],
  [
    'a start on a day that does not exist',
    {
      ...valid(),
      booking: { ...valid().booking, startDateTime: '2021-02-31T11:00:00' },
    },
  ],
  [
    'no end',
    { ...valid(), booking: { ...valid().booking, endDateTime: undefined } },
  ],
  [
    'an end before the start',
    {
      ...valid(),
      booking: { ...valid().booking, endDateTime: '2021-10-01T01:00:00' },
    },
  ],
])('an unreadable success after dispatch is unknown: %s', async (_, body) => {
  const client = new LLClientWDW(wdw, {
    experienced: () => false,
    update: jest.fn(),
  });
  respond(response(body));
  const caught = await bookingError(
    client.book(modOffer, undefined, testMutationControl())
  );
  expect(caught).toBeInstanceOf(UnknownMutationOutcome);
  expect(fetchJson).toHaveBeenCalledTimes(1);
  expect(outcomeIsUnknown(caught)).toBe(true);
});

test.each([
  ['no entries', newBooking()],
  [
    'two entries, neither of them this attraction',
    newBooking(
      { ...valid().booking, experienceId: 'elsewhere' },
      { ...valid().booking, experienceId: 'elsewhere-too' }
    ),
  ],
])('a new booking with %s is unknown', async (_, body) => {
  const client = new LLClientWDW(wdw);
  respond(response(body));
  const caught = await bookingError(
    client.book(offer, undefined, testMutationControl())
  );
  expect(caught).toBeInstanceOf(UnknownMutationOutcome);
  expect(outcomeIsUnknown(caught)).toBe(true);
});

// The checks above are only the ones the app needs; anything else that goes
// wrong while reading has to land in the same place.
test('whatever else goes wrong reading the answer is unknown too', async () => {
  const client = new LLClientWDW(wdw);
  const body = valid();
  Object.defineProperty(body.booking, 'startDateTime', {
    get() {
      throw new TypeError('surprise');
    },
  });
  respond(response(body));
  const caught = await bookingError(
    client.book(modOffer, undefined, testMutationControl())
  );
  expect(caught).toBeInstanceOf(UnknownMutationOutcome);
  expect(outcomeIsUnknown(caught)).toBe(true);
});

test('a valid success still parses', async () => {
  const client = new LLClientWDW(wdw);
  respond(response(valid()));
  await expect(
    client.book(modOffer, undefined, testMutationControl())
  ).resolves.toMatchObject({ id: booking.id });
  expect(warn).not.toHaveBeenCalled();
});

// Readable responses the 1.8.3 reader refused. Each refusal would have turned
// a booking that happened into an unresolved change, and frozen the ride.

test('a Modify for part of the party keeps only the guests it moved', async () => {
  const client = new LLClientWDW(wdw);
  // Disney's party may name everyone on the offer, Pluto included, though
  // only two guests were sent.
  respond(
    response({
      ...valid(),
      booking: {
        ...valid().booking,
        guests: [
          { guestId: mickey.id, entitlementId: 'moved-mickey' },
          { guestId: minnie.id, entitlementId: 'moved-minnie' },
        ],
      },
    })
  );
  const moved = await client.book(
    modOffer,
    [mickey, minnie],
    testMutationControl()
  );
  // Only the guests booked: these are what a commit record, a cancellation
  // and the post-booking cleanup act on.
  expect(moved.id).toBe('moved-mickey');
  expect(moved.guests).toEqual([
    expect.objectContaining({
      id: mickey.id,
      name: mickey.name,
      entitlementId: 'moved-mickey',
    }),
    expect.objectContaining({
      id: minnie.id,
      name: minnie.name,
      entitlementId: 'moved-minnie',
    }),
  ]);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('1 party guest(s) not booked')
  );
});

test('reads the entry for the attraction booked when there are two', async () => {
  const client = new LLClientWDW(wdw);
  respond(
    response(
      newBooking(
        {
          experienceId: 'elsewhere',
          startDateTime: '2021-10-01T15:00:00',
          endDateTime: '2021-10-01T16:00:00',
          guests: [{ guestId: mickey.id, entitlementId: 'elsewhere-mickey' }],
        },
        valid().booking
      )
    )
  );
  const booked = await client.book(offer, undefined, testMutationControl());
  expect(booked.id).toBe(booking.id);
  expect(`${booked.start.time}`).toBe(`${booking.start.time}`);
  expect(booked.guests.map(g => g.entitlementId)).toEqual(
    booking.guests.map(g => g.entitlementId)
  );
});

test('reads a lone entry Disney files under another id', async () => {
  const client = new LLClientWDW(wdw);
  respond(
    response({
      ...valid(),
      booking: { ...valid().booking, experienceId: 'renamed' },
    })
  );
  const booked = await client.book(modOffer, undefined, testMutationControl());
  expect(booked.facilityId).toBe(booking.facilityId);
  expect(booked.id).toBe(booking.id);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('renamed'));
});

test('names a guest the party leaves unnamed, or leaves out', async () => {
  const client = new LLClientWDW(wdw);
  respond(
    response({
      booking: {
        ...valid().booking,
        guests: [
          ...valid().booking.guests.slice(0, 2),
          { guestId: 'goofy', entitlementId: 'goofy-ent' },
        ],
      },
      party: {
        // Minnie is there without a name, and Goofy, whom nothing else
        // knows either, not at all.
        guests: [{ id: mickey.id, firstName: mickey.name }, { id: minnie.id }],
        ineligibleGuests: [],
      },
    })
  );
  const booked = await client.book(modOffer, undefined, testMutationControl());
  expect(booked.guests.map(g => [g.id, g.name])).toEqual([
    [mickey.id, mickey.name],
    [minnie.id, minnie.name],
    ['goofy', 'goofy'],
  ]);
});

test('reads a party that names none of the guests booked', async () => {
  const client = new LLClientWDW(wdw);
  respond(response({ ...valid(), party: { guests: [{ id: 'wrong' }] } }));
  const booked = await client.book(modOffer, undefined, testMutationControl());
  expect(booked.guests.map(g => g.name)).toEqual(
    booking.guests.map(g => g.name)
  );
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('3 booked guest(s) missing from its party')
  );
});

test('an odd field on a party entry costs only that name', async () => {
  const client = new LLClientWDW(wdw);
  const [first, ...rest] = valid().party.guests;
  respond(
    response({
      ...valid(),
      party: {
        guests: [{ ...first, eligibleAfter: 'later' }, ...rest],
        ineligibleGuests: [],
      },
    })
  );
  const booked = await client.book(modOffer, undefined, testMutationControl());
  expect(booked.guests.map(g => g.name)).toEqual(
    booking.guests.map(g => g.name)
  );
});

test('a new booking with a non-JSON success is unknown too', async () => {
  const client = new LLClientWDW(wdw);
  respond(response({}));
  await expect(
    client.book(offer, undefined, testMutationControl())
  ).rejects.toBeInstanceOf(UnknownMutationOutcome);
});

test('a body-read rejection preserves dispatched metadata', async () => {
  const client = new LLClientWDW(wdw);
  jest.mocked(fetchJson).mockRejectedValueOnce(new SyntaxError('JSON body'));
  await expect(
    client.book(modOffer, undefined, testMutationControl())
  ).rejects.toBeInstanceOf(UnknownMutationOutcome);
});

test('a local preparation failure remains safe to retry', async () => {
  const client = new LLClientWDW(wdw);
  const local = new Error('module unavailable');
  jest.mocked(getSensorData).mockRejectedValueOnce(local);
  await expect(
    client.book(modOffer, undefined, testMutationControl())
  ).rejects.toBe(local);
  expect(outcomeIsUnknown(local)).toBe(false);
  expect(fetchJson).not.toHaveBeenCalled();
});

test('uncontrolled production booking and cancellation never dispatch', async () => {
  const client = new LLClientWDW(wdw);
  await expect(client.book(offer)).rejects.toBeInstanceOf(RequestNotSent);
  await expect(client.cancelBooking(booking.guests)).rejects.toBeInstanceOf(
    RequestNotSent
  );
  expect(fetchJson).not.toHaveBeenCalled();
});
