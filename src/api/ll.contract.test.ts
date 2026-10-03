import { LLClientWDW } from '@/api/ll/wdw';
import { DateTime, ParkTime } from '@/datetime';

import { wdw } from '../__fixtures__/resort';
import { Guest, Offer, OfferExperience } from './ll';

const DATE = '2026-09-08';
const experience = {
  ...wdw.experience('80010190'),
  flex: { available: true, nextAvailableTime: new ParkTime(10) },
  standby: { available: true },
} as OfferExperience;

const guest: Guest = {
  id: 'guest-1',
  name: 'Guest One',
  primary: true,
  orderDetails: {
    externalIdentifier: { id: 'external-1', idType: 'externalId' },
    orderId: 'order-1',
    orderItemId: 'item-1',
  },
};

function apiGuest(overrides: Record<string, unknown> = {}) {
  return { id: guest.id, firstName: 'Guest', lastName: 'One', ...overrides };
}

function makeClient() {
  const client = new LLClientWDW(wdw);
  const request = jest.fn();
  // The public methods are what this suite exercises. Replacing the protected
  // transport keeps these contract tests independent of credentials, sensors,
  // and the browser fetch implementation.
  (client as unknown as { request: jest.Mock }).request = request;
  return { client, request };
}

/** A held Multi Pass on another attraction, for the modify path. */
function held() {
  return {
    type: 'LL',
    subtype: 'MP',
    id: 'held-1',
    facilityId: '80010208',
    name: 'Haunted Mansion',
    experience: wdw.experience('80010208'),
    start: new DateTime(DATE, new ParkTime(15)),
    end: new DateTime(DATE, new ParkTime(16)),
    cancellable: true,
    modifiable: true,
    guests: [{ ...guest, entitlementId: 'ent-1' }],
  } as unknown as NonNullable<Offer['booking']>;
}

function offer(): Offer {
  return {
    id: 'offer-1',
    offerSetId: 'set-1',
    start: new DateTime(DATE, new ParkTime(10)),
    end: new DateTime(DATE, new ParkTime(11)),
    experience,
    guests: { eligible: [guest], ineligible: [] },
    itinerary: [],
    booking: undefined,
  };
}

describe('WDW Lightning Lane request contracts', () => {
  it('requests party eligibility for the exact attraction and park day', async () => {
    const { client, request } = makeClient();
    request.mockResolvedValue({
      data: { guests: [apiGuest()], ineligibleGuests: [] },
    });

    await expect(client.guests(experience, DATE)).resolves.toEqual({
      eligible: [expect.objectContaining({ id: guest.id, name: guest.name })],
      ineligible: [],
    });
    expect(request).toHaveBeenCalledWith({
      path: '/ea-vas/planning/api/v1/experiences/guest/guests',
      data: {
        date: DATE,
        facilityId: '80010190',
        // Literal, because the production value comes from a *re-lookup* --
        // `this.resort.experience(id).park.id` -- not from the argument. The
        // provider calls this with `{ id }` alone, so the re-lookup is what
        // supplies the park at all, and asserting `experience.park.id` here
        // compared the same object to itself.
        parkId: '80007944',
      },
      sensorData: true,
    });
  });

  // The branch the Plan Check screen takes, and the one nothing asserted: no
  // attraction, so no park to look up. It used to fall back to the resort's
  // first park regardless of what the caller was asking about.
  it('asks about the given park when no attraction is named', async () => {
    const { client, request } = makeClient();
    request.mockResolvedValue({
      data: { guests: [apiGuest()], ineligibleGuests: [] },
    });

    await client.guests(undefined, DATE, { id: '80007838' });
    expect(request).toHaveBeenCalledWith({
      path: '/ea-vas/planning/api/v1/experiences/guest/guests',
      data: { date: DATE, facilityId: null, parkId: '80007838' },
      sensorData: true,
    });
  });

  it('falls back to the resort default park with neither', async () => {
    const { client, request } = makeClient();
    request.mockResolvedValue({
      data: { guests: [apiGuest()], ineligibleGuests: [] },
    });

    await client.guests(undefined, DATE);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ facilityId: null, parkId: '80007944' }),
      })
    );
  });

  it('generates a booking offer with the selected party and return target', async () => {
    const { client, request } = makeClient();
    request.mockResolvedValue({
      data: {
        itinerary: {
          items: [
            {
              type: 'OFFER_ITEM',
              facilityId: experience.id,
              offerSetId: 'set-1',
              offerId: 'offer-1',
              offerType: 'FLEX',
              startDateTime: `${DATE}T10:00:00`,
              endDateTime: `${DATE}T11:00:00`,
              startTime: '10:00:00',
              endTime: '11:00:00',
            },
          ],
        },
        party: { guests: [apiGuest()], ineligibleGuests: [] },
      },
    });

    const result = await client.offer(experience, [guest], { date: DATE });
    // The parsed times, not only the ids: asserting ids alone let start and
    // end be swapped in the parser with every test still green.
    expect(result.id).toBe('offer-1');
    expect(result.offerSetId).toBe('set-1');
    expect(`${result.start.time}`).toBe('10:00:00');
    expect(`${result.end.time}`).toBe('11:00:00');
    expect(result.start.date).toBe(DATE);
    // Exactly one request: the client re-times an offer that came back more
    // than ten minutes later than asked for, and nothing pinned that it does
    // not fire when the offer matches.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      path: '/ea-vas/planning/api/v1/experiences/offerset/generate',
      data: {
        date: DATE,
        parkId: '80007944',
        guestIds: [guest.id],
        targetedTime: new ParkTime(10),
        ignoredBookedExperienceIds: null,
        experienceIds: [experience.id],
      },
      sensorData: true,
    });
  });

  // The fallback the Change-return-time flow actually sends, which the
  // always-populated fixture hid.
  it('targets 08:00 when the attraction advertises no next time', async () => {
    const { client, request } = makeClient();
    request.mockResolvedValue({
      data: {
        itinerary: { items: [] },
        party: { guests: [], ineligibleGuests: [] },
      },
    });

    await expect(
      client.offer({ ...experience, flex: { available: false } }, [guest], {
        date: DATE,
      })
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetedTime: '08:00:00' }),
      })
    );
  });

  // Three of the six LL request builders were covered and the three harder
  // ones were not -- including the `/mod` shape every Auto-move and swap uses,
  // where the two experience ids are easy to transpose.
  it('generates a modify offer against the booking being moved', async () => {
    const { client, request } = makeClient();
    request.mockResolvedValue({
      data: {
        itinerary: {
          items: [
            {
              type: 'OFFER_ITEM',
              facilityId: experience.id,
              offerSetId: 'set-2',
              offerId: 'offer-2',
              offerType: 'FLEX',
              startDateTime: `${DATE}T10:00:00`,
              endDateTime: `${DATE}T11:00:00`,
              startTime: '10:00:00',
              endTime: '11:00:00',
            },
          ],
        },
        party: { guests: [apiGuest()], ineligibleGuests: [] },
      },
    });

    await client.offer(experience, [guest], { booking: held() });
    expect(request).toHaveBeenCalledWith({
      path: '/ea-vas/planning/api/v1/experiences/mod/offerset/generate',
      data: {
        date: DATE,
        parkId: '80007944',
        guestIds: [guest.id],
        experienceId: experience.id,
        originalExperienceId: '80010208',
        originalEntitlementIds: ['ent-1'],
        targetedTime: new ParkTime(10),
        ignoredBookedExperienceIds: null,
      },
      sensorData: true,
    });
  });

  it('commits a confirmed offer with only its eligible guests', async () => {
    const { client, request } = makeClient();
    // Two guests the client must drop for two different reasons: one is
    // ineligible, and one has no order details. With a single clean guest
    // both filters could be deleted and the test stayed green.
    const ineligible: Guest = { ...guest, id: 'guest-2', name: 'Guest Two' };
    const noOrder = {
      id: 'guest-3',
      name: 'Guest Three',
    } as unknown as Guest;
    request.mockResolvedValue({
      data: {
        entitlementExperiences: [
          {
            experienceId: experience.id,
            startDateTime: `${DATE}T10:00:00`,
            endDateTime: `${DATE}T11:00:00`,
            guests: [{ guestId: guest.id, entitlementId: 'entitlement-1' }],
          },
        ],
        party: { guests: [apiGuest()], ineligibleGuests: [] },
      },
    });

    const control = {
      signal: new AbortController().signal,
      start: async <T>(send: () => Promise<T>) => send(),
      onDispatch: jest.fn(),
    };
    const booked = await client.book(
      {
        ...offer(),
        guests: { eligible: [guest, noOrder], ineligible: [ineligible] },
      },
      undefined,
      control
    );
    expect(booked.facilityId).toBe(experience.id);
    expect(booked.id).toBe('entitlement-1');
    expect(`${booked.start.time}`).toBe('10:00:00');
    expect(`${booked.end.time}`).toBe('11:00:00');
    expect(request).toHaveBeenCalledWith({
      path: '/ea-vas/planning/api/v1/experiences/entitlements/book',
      data: {
        offerSetId: 'set-1',
        orderGuestDetails: [
          {
            orderId: 'order-1',
            orderItemId: 'item-1',
            guestDetails: [
              {
                guestId: guest.id,
                externalIdentifier: guest.orderDetails!.externalIdentifier,
              },
            ],
          },
        ],
      },
      sensorData: true,
      control,
    });
  });
});
