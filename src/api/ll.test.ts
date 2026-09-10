import { expectFetch, respond, response } from '@/__fixtures__/client';
import {
  booking,
  bookings,
  donald,
  expiredLL,
  hm,
  hs,
  ll,
  mickey,
  minnie,
  mk,
  modOffer,
  offer,
  pluto,
  sdd,
  sm,
  times,
  wdw,
} from '@/__fixtures__/ll';
import { DateTime, ParkTime, modifyDate } from '@/datetime';
import kvdb from '@/kvdb';
import { TODAY, TOMORROW, setTime } from '@/testing';

import { RequestError } from './client';
import {
  Experience,
  Guest,
  LLTracker,
  ModifyNotAllowed,
  Offer,
  OfferError,
} from './ll';
import { LLClientWDW } from './ll/wdw';

jest.mock('@/ratelimit');
const onUnauthorized = jest.fn();

function apiGuest<T extends { name: string }>({
  name,
  ...rest
}: T): Omit<T, 'name'> {
  const [firstName, lastName = ''] = name.split(' ');
  return { ...rest, firstName, lastName };
}

const guests = [mickey, minnie, pluto];
const ineligibleGuests = [donald];

const tracker = {
  experienced: (exp: { id: string }) => exp.id === booking.facilityId,
  update: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  setTime('10:00');
});

describe('LLClientWDW', () => {
  const guestsUrl = '/ea-vas/planning/api/v1/experiences/guest/guests';
  const guestsRes = response({
    guests: guests.map(apiGuest),
    ineligibleGuests: ineligibleGuests.map(g =>
      apiGuest({
        ...g,
        ineligibleReason: { ineligibleReason: g.ineligibleReason },
      })
    ),
  });
  let client: LLClientWDW;

  beforeEach(() => {
    client = new LLClientWDW(wdw, tracker);
    client.onUnauthorized = onUnauthorized;
  });

  describe('experiences()', () => {
    const closed = {
      standby: { available: false, unavailableReason: 'CLOSED' },
      flex: { available: false },
    };

    it('returns experiences', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const res = response({
        availableExperiences: [hm, sm, { id: 'not_a_real_id' }],
      });
      const exps = [
        { ...hm, experienced: true },
        { ...sm, experienced: false },
      ];
      respond(res);
      expect(await client.experiences(mk, TODAY)).toEqual(exps);
      expectFetch(
        `/tipboard-vas/planning/v1/parks/${encodeURIComponent(mk.id)}/experiences`,
        { params: { date: TODAY } },
        true,
        1
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenLastCalledWith(
        'Missing experience: not_a_real_id'
      );

      respond(res);
      expect(await client.experiences(mk, TODAY)).toEqual(exps);

      warn.mockRestore();
    });

    it('uses fallback when no experiences reported by tipboard', async () => {
      const noExpsRes = response({ availableExperiences: [] });
      const availabilityRes = response({
        tiers: [
          { experiences: [{ facilityId: sm.id }] },
          { experiences: [{ facilityId: hm.id }] },
        ],
      });
      respond(noExpsRes, guestsRes, availabilityRes);
      const exps = [sm, hm].map(exp => ({ ...exp, ...closed }));
      expect(await client.experiences(mk, TODAY)).toEqual(exps);
      expectFetch(
        '/ea-vas/planning/api/v1/experiences/availability/bundles/experiences',
        {
          data: {
            parkId: mk.id,
            date: TODAY,
            guestIds: [mickey.id],
            existingOfferIds: [],
            orderId: null,
          },
        },
        false,
        3
      );

      respond(noExpsRes);
      expect(await client.experiences(mk, TODAY)).toEqual(exps);
    });

    it('checks for new/re-opening experiences on future dates', async () => {
      const noExpsRes = response({ availableExperiences: [hm] });
      const availabilityRes = response({
        tiers: [{ experiences: [{ facilityId: sm.id }] }],
      });
      respond(noExpsRes, guestsRes, availabilityRes);
      const exps = [
        { ...hm, experienced: undefined, showTimes: undefined },
        { ...sm, ...closed },
      ];
      expect(await client.experiences(mk, TOMORROW)).toEqual(exps);

      respond(noExpsRes, availabilityRes);
      const dayAfterTomorrow = modifyDate(TOMORROW, 1);
      expect(await client.experiences(mk, dayAfterTomorrow)).toEqual(exps);

      respond(
        response({ availableExperiences: [] }),
        response({
          tiers: [{ experiences: [{ facilityId: sdd.id }] }],
        })
      );
      expect(await client.experiences(hs, TOMORROW)).toEqual([
        { ...sdd, ...closed },
      ]);
    });
  });

  describe('setPartyIds()', () => {
    it('sets booking party', async () => {
      client.setPartyIds([mickey.id, pluto.id]);
      respond(guestsRes);
      const { eligible, ineligible } = await client.guests();
      expect(eligible.map(g => g.id)).toEqual([mickey.id, pluto.id]);
      expect(ineligible.map(g => g.id)).toEqual([donald.id, minnie.id]);
      ineligible.forEach(g => expect(g.ineligibleReason).toBe('NOT_IN_PARTY'));
      client.setPartyIds([]);
    });
  });

  describe('guests()', () => {
    it('returns eligible & ineligible guests for experience', async () => {
      respond(guestsRes);
      expect(await client.guests(hm)).toEqual({
        eligible: [mickey, minnie, pluto],
        ineligible: ineligibleGuests,
      });
      expectFetch(guestsUrl, {
        data: {
          date: TODAY,
          facilityId: hm.id,
          parkId: mk.id,
        },
      });
    });

    it('includes avatarImageUrls when characterId exists', async () => {
      respond(
        response({
          guests: [
            { ...mickey, characterId: '19633995' },
            { ...minnie, characterId: '18405224' },
            { ...pluto, characterId: '90004625' },
          ].map(apiGuest),
          ineligibleGuests: [],
        })
      );
      const result = await client.guests(hm);
      expect(result.ineligible).toEqual([]);
      expect(result.eligible.map(guest => guest.avatarImageUrl)).toEqual([
        'https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/90/90/75/dam/disney-world/50th-anniversary/avatars/RetAvatar_180x180_50th_Mickey.png',
        'https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/90/90/75/dam/wdpro-assets/avatars/180x180/RetAvatar-180x180-Moana.png',
        'https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/90/90/75/dam/wdpro-assets/avatars/180x180/RetAvatar_180x180_Pluto.png',
      ]);
    });

    it('treats any guests with ineligibleReason as ineligible', async () => {
      respond(
        response({
          guests: [donald].map(apiGuest),
          ineligibleGuests: [],
        })
      );
      expect(await client.guests(hm)).toEqual({
        eligible: [],
        ineligible: [donald],
      });
    });

    it('sorts ineligible guests', async () => {
      const fifi = {
        id: 'fifi',
        name: 'Fifi',
        ineligibleReason: 'TOO_EARLY',
        eligibleAfter: ParkTime.from('10:30'),
      };
      const goofy = {
        id: 'goofy',
        name: 'Goofy',
        ineligibleReason: 'EXPERIENCE_LIMIT_REACHED',
      };
      respond(
        response({
          guests: [],
          ineligibleGuests: [
            {
              ...minnie,
              ineligibleReason: 'TOO_EARLY',
              eligibleAfter: ParkTime.from('10:30'),
            },
            {
              ...pluto,
              ineligibleReason: 'TOO_EARLY',
              eligibleAfter: ParkTime.from('10:00'),
            },
            donald,
            fifi,
            goofy,
            {
              ...mickey,
              ineligibleReason: 'TOO_EARLY',
              eligibleAfter: ParkTime.from('10:30'),
              primary: true,
            },
          ].map(apiGuest),
        })
      );
      const { ineligible } = await client.guests(hm);
      expect(ineligible.map(g => g.id)).toEqual(
        [pluto, mickey, fifi, minnie, donald, goofy].map(g => g.id)
      );
    });
  });

  describe('offer()', () => {
    function offerResponse(offer: Offer) {
      const offerItem = {
        facilityId: offer.experience.id,
        type: 'OFFER_ITEM',
        offerId: offer.id,
        offerSetId: offer.offerSetId as string,
        offerType: 'FLEX',
        startDateTime: `${offer.start}`,
        endDateTime: `${offer.end}`,
      };
      const offerSet = {
        itinerary: {
          items: [
            {
              type: 'EVENT_ITEM',
              eventType: 'PARK_OPEN',
              facilityId: '80007944',
              startTime: ParkTime.from('09:00'),
            },
            offerItem,
            {
              type: 'EVENT_ITEM',
              eventType: 'PARK_CLOSE',
              facilityId: '80007944',
              startTime: ParkTime.from('21:00'),
            },
          ],
        },
        party: {
          guests: offer.guests.eligible.map(apiGuest),
          ineligibleGuests: [],
        },
      };
      return response(offerSet);
    }

    const respondOffer = (offer: Offer) => respond(offerResponse(offer));

    async function expectOffer(
      experience: Experience,
      guests: Guest[],
      options: any,
      expectedOffer: Offer
    ) {
      respondOffer(expectedOffer);
      const offer = await client.offer(experience, guests, options);
      expect(offer).toEqual(expectedOffer);
      expect(client.lastOffer).toBe(offer);
      return offer;
    }

    let changeOfferTime: jest.SpyInstance;

    beforeEach(() => {
      changeOfferTime = jest.spyOn(client, 'changeOfferTime');
      changeOfferTime.mockResolvedValueOnce(offer);
    });

    afterAll(() => {
      changeOfferTime.mockRestore();
    });

    it('obtains Lightning Lane offer', async () => {
      await expectOffer(hm, guests, { date: TOMORROW }, offer);
      expectFetch('/ea-vas/planning/api/v1/experiences/offerset/generate', {
        data: {
          date: TOMORROW,
          guestIds: guests.map(g => g.id),
          parkId: mk.id,
          experienceIds: [hm.id],
          targetedTime: hm.flex.nextAvailableTime,
          ignoredBookedExperienceIds: null,
        },
      });
    });

    it('obtains offer to modify existing booking', async () => {
      await expectOffer(
        sm,
        guests,
        { booking },
        {
          ...offer,
          experience: sm,
          start: new DateTime(TODAY, ParkTime.from('10:40')),
          end: new DateTime(TODAY, ParkTime.from('11:40')),
          booking,
        }
      );
      expectFetch('/ea-vas/planning/api/v1/experiences/mod/offerset/generate', {
        data: {
          date: booking.start.date,
          guestIds: guests.map(g => g.id),
          parkId: mk.id,
          experienceId: sm.id,
          originalExperienceId: hm.id,
          originalEntitlementIds: booking.guests.map(g => g.entitlementId),
          targetedTime: sm.flex.nextAvailableTime,
          ignoredBookedExperienceIds: null,
        },
      });
    });

    it('throws OfferError if no offer in response', async () => {
      const response = offerResponse(offer);
      response.data.itinerary.items = [];
      response.data.party = {
        guests: [],
        ineligibleGuests: booking.guests.map(g =>
          apiGuest({
            ...g,
            ineligibleReason: {
              ineligibleReason: 'EXPERIENCE_LIMIT_REACHED',
            },
          })
        ),
      };
      respond(response);
      await expect(client.offer(hm, booking.guests)).rejects.toThrow(
        new OfferError({
          eligible: [],
          ineligible: booking.guests.map(g => ({
            ...g,
            ineligibleReason: 'EXPERIENCE_LIMIT_REACHED',
          })),
        })
      );
    });

    it('reports changed return time', async () => {
      await expectOffer(
        hm,
        offer.guests.eligible,
        { date: TODAY },
        {
          ...offer,
          start: new DateTime(TODAY, ParkTime.from('11:20')),
          end: new DateTime(TODAY, ParkTime.from('12:20')),
          changed: true,
        }
      );
      expect(client.changeOfferTime).toHaveBeenCalledTimes(0);
    });

    it('checks for earlier time if later than expected', async () => {
      respondOffer({
        ...offer,
        start: new DateTime(TODAY, ParkTime.from('11:25')),
        end: new DateTime(TODAY, ParkTime.from('12:25')),
      });
      expect(
        await client.offer(hm, offer.guests.eligible, { date: TODAY })
      ).toEqual(offer);
      expect(client.changeOfferTime).toHaveBeenCalledTimes(1);
    });

    it('returns original offer if changeOfferTime() fails', async () => {
      jest.spyOn(console, 'error').mockImplementationOnce(() => {});
      changeOfferTime.mockReset().mockRejectedValueOnce('oops');
      await expectOffer(
        hm,
        offer.guests.eligible,
        { date: TODAY },
        {
          ...offer,
          start: new DateTime(TODAY, ParkTime.from('11:25')),
          end: new DateTime(TODAY, ParkTime.from('12:25')),
          changed: true,
        }
      );
      expect(client.changeOfferTime).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('oops');
    });

    it('throws ModifyNotAllowed when not allowed to modify', async () => {
      await expect(
        client.offer(hm, guests, {
          booking: { ...booking, modifiable: false },
        })
      ).rejects.toThrow(ModifyNotAllowed);
    });
  });

  describe('times()', () => {
    const timesRes = response({
      hourSegmentGroups: times.map(times => ({
        inventorySlotsAvailability: times.map(t => ({ startTime: t })),
      })),
    });
    const timesReq = {
      data: {
        date: TODAY,
        experienceId: hm.id,
        parkId: mk.id,
        offerId: offer.id,
        offerSetIds: [offer.offerSetId],
        offerType: 'FLEX',
        guestIds: offer.guests.eligible.map(g => g.id),
        experienceIdsToIgnore: [],
        originalOrderItemId: null,
      },
    };

    it('uses mod endpoint when modifying', async () => {
      respond(timesRes);
      expect(await client.times(modOffer)).toEqual(times);
      expectFetch(
        '/ea-vas/planning/api/v1/experiences/mod/offerset/times',
        timesReq
      );
    });
  });

  describe('changeOfferTime()', () => {
    const time = ParkTime.from('15:00');
    const newOffer = {
      ...offer,
      id: 'changedOfferId',
      offerSetId: 'changedOfferSetId',
      start: new DateTime(TODAY, time),
      end: new DateTime(TODAY, ParkTime.from('16:00')),
    };
    const changeRes = response({
      updatedPlanningOfferDisplayItem: {
        offerId: newOffer.id,
        offerSetId: newOffer.offerSetId,
        startDateTime: `${newOffer.start}`,
        endDateTime: `${newOffer.end}`,
      },
    });
    const changeReq = {
      data: {
        date: TODAY,
        guestIds: offer.guests.eligible.map(g => g.id),
        offerId: offer.id,
        offerSetIds: [offer.offerSetId],
        offerType: 'FLEX',
        parkId: mk.id,
        targetSlot: { startTime: time, endTime: time },
        experienceIdsToIgnore: [],
      },
    };

    it('changes offer time', async () => {
      respond(changeRes);
      expect(await client.changeOfferTime(offer, time)).toEqual(newOffer);
      expectFetch(
        '/ea-vas/planning/api/v1/experiences/offerset/times/fulfill',
        changeReq
      );
    });

    it('specifies if time was changed', async () => {
      const { updatedPlanningOfferDisplayItem: item } = changeRes.data;
      const start = new DateTime(TODAY, ParkTime.from('15:25'));
      const end = new DateTime(TODAY, ParkTime.from('16:25'));
      respond({
        ...changeRes,
        data: {
          updatedPlanningOfferDisplayItem: {
            ...item,
            startDateTime: `${start}`,
            endDateTime: `${end}`,
          },
        },
      });
      expect(await client.changeOfferTime(offer, time)).toEqual({
        ...newOffer,
        start,
        end,
        changed: true,
      });
    });

    it('uses mod endpoint when modifying', async () => {
      respond(changeRes);
      expect(await client.changeOfferTime(modOffer, time)).toEqual({
        ...newOffer,
        booking,
      });
      expectFetch(
        '/ea-vas/planning/api/v1/experiences/mod/offerset/times/fulfill',
        {
          data: {
            date: TODAY,
            guestIds: offer.guests.eligible.map(g => g.id),
            offerId: offer.id,
            offerSetId: offer.offerSetId,
            offerType: 'FLEX',
            parkId: mk.id,
            targetSlot: { startTime: time, endTime: time },
            experienceIdsToIgnore: [],
          },
        }
      );
    });
  });

  describe('book()', () => {
    it('books Lightning Lanes', async () => {
      respond(
        response({
          entitlementExperiences: [
            {
              experienceId: booking.facilityId,
              startDateTime: `${booking.start.date}T${booking.start.time}`,
              endDateTime: `${booking.end.date}T${booking.end.time}`,
              guests: booking.guests.map(g => ({
                entitlementId: g.entitlementId,
                guestId: g.id,
              })),
            },
          ],
          party: {
            guests: booking.guests.map(apiGuest),
            ineligibleGuests: [],
          },
        })
      );
      expect(await client.book(offer)).toEqual({
        ...booking,
        experience: offer.experience,
      });
      expectFetch('/ea-vas/planning/api/v1/experiences/entitlements/book', {
        data: {
          offerSetId: offer.offerSetId,
          orderGuestDetails: guests.map(g => ({
            orderId: g.orderDetails.orderId,
            orderItemId: g.orderDetails.orderItemId,
            guestDetails: [
              {
                guestId: g.id,
                externalIdentifier: g.orderDetails.externalIdentifier,
              },
            ],
          })),
        },
      });
    });

    it('modifies an existing LL', async () => {
      const orderDetailsById = new Map(guests.map(g => [g.id, g.orderDetails]));
      const modGuests = booking.guests.slice(0, 2);
      respond(
        response({
          booking: {
            experienceId: booking.facilityId,
            startDateTime: `${booking.start.date}T${booking.start.time}`,
            endDateTime: `${booking.end.date}T${booking.end.time}`,
            guests: modGuests.map(g => ({
              guestId: g.id,
              entitlementId: g.entitlementId,
            })),
          },
          party: {
            guests: modGuests.map(apiGuest),
            ineligibleGuests: [],
          },
        })
      );
      expect(await client.book(modOffer, modGuests)).toEqual({
        ...booking,
        experience: modOffer.experience,
        guests: modGuests,
      });
      expectFetch('/ea-vas/planning/api/v1/experiences/mod/entitlements/book', {
        data: {
          offerSetId: modOffer.offerSetId,
          eligibleGuestsEntitlements: modGuests.map(g => ({
            guestId: g.id,
            entitlementId: g.entitlementId,
            ...orderDetailsById.get(g.id),
          })),
        },
      });
    });

    it('throws RequestError on failure', async () => {
      respond(response({}, 410));
      await expect(client.book(offer)).rejects.toThrow(RequestError);
    });
  });

  describe('cancelBooking()', () => {
    it('cancels booking', async () => {
      respond(response({}));
      await client.cancelBooking(booking.guests);
      expectFetch(
        `/ea-vas/api/v1/entitlements/${booking.guests
          .map(g => g.entitlementId)
          .join(',')}`,
        { method: 'DELETE' }
      );
    });
  });

  describe('track()', () => {
    it('updates LL tracker', async () => {
      client.track(bookings);
      expect(tracker.update).toHaveBeenCalledTimes(1);
    });
  });
});

describe('LLTracker', () => {
  kvdb.clear();
  const tracker = new LLTracker();

  describe('update()', () => {
    it('updates tracking data', async () => {
      await tracker.update([expiredLL], ll);
      await tracker.update(bookings, ll);
      expect(tracker.experienced(booking.experience)).toBe(false);
      expect(tracker.experienced(expiredLL.experience)).toBe(true);
      ll.guests.mockResolvedValueOnce({
        eligible: [],
        ineligible: [
          { ...mickey, ineligibleReason: 'EXPERIENCE_LIMIT_REACHED' },
        ],
      });
      await tracker.update([expiredLL], ll);
      expect(tracker.experienced(booking.experience)).toBe(true);
      expect(tracker.experienced(expiredLL.experience)).toBe(true);
    });
  });
});
