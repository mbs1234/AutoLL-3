import { respond, response, testMutationControl } from '@/__fixtures__/client';
import { booking, modOffer, offer, wdw } from '@/__fixtures__/ll';
import { RequestNotSent, UnknownMutationOutcome } from '@/api/client';
import { LLClientWDW } from '@/api/ll/wdw';
import { getSensorData } from '@/api/sensor-data';
import { outcomeIsUnknown } from '@/autopilot/autobook';
import { fetchJson } from '@/fetch';
import { setTime } from '@/testing';

beforeEach(() => {
  setTime('10:00:00');
  jest.mocked(getSensorData).mockReturnValue('');
  jest.mocked(fetchJson).mockClear();
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

test.each([
  {},
  { party: valid().party },
  { booking: valid().booking },
  { ...valid(), booking: { ...valid().booking, guests: [] } },
  { ...valid(), booking: { ...valid().booking, startDateTime: 'not-a-date' } },
  {
    ...valid(),
    booking: { ...valid().booking, startDateTime: '2021-02-31T11:00:00' },
  },
  {
    ...valid(),
    booking: { ...valid().booking, endDateTime: '2021-10-01T01:00:00' },
  },
  { ...valid(), booking: { ...valid().booking, experienceId: 'wrong' } },
  { ...valid(), party: { guests: [{ id: 'wrong' }] } },
])('an unreadable success after dispatch is unknown: %#', async body => {
  const client = new LLClientWDW(wdw, {
    experienced: () => false,
    update: jest.fn(),
  });
  respond(response(body));
  let caught: unknown;
  try {
    await client.book(modOffer, undefined, testMutationControl());
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(UnknownMutationOutcome);
  expect(fetchJson).toHaveBeenCalledTimes(1);
  expect(outcomeIsUnknown(caught)).toBe(true);
});

test('a valid success still parses', async () => {
  const client = new LLClientWDW(wdw);
  respond(response(valid()));
  await expect(
    client.book(modOffer, undefined, testMutationControl())
  ).resolves.toMatchObject({ id: booking.id });
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
