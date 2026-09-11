import { DateTime, ParkTime, parkDate } from '@/datetime';

import {
  ApiGuest,
  Experience,
  Guest,
  Guests,
  HourlyTimes,
  IneligibleReason,
  LLClient,
  LLMP,
  Offer,
  OfferError,
  OfferExperience,
  OfferItineraryItem,
  OrderDetails,
  replaceTimeStrings,
  throwOnNotModifiable,
} from '../ll';
import { InvalidId, Park } from '../resort';

interface GuestsResponse {
  guests: ApiGuest[];
  ineligibleGuests: (ApiGuest & {
    ineligibleReason: {
      ineligibleReason: IneligibleReason;
      isSoftConflict?: boolean;
      metadata?: { facilityIds: string[] };
    };
  })[];
}

interface OfferSetItineraryItem {
  type: 'OFFER_ITEM' | 'EXISTING_ITEM' | 'EVENT_ITEM';
  facilityId: string;
  startDateTime: string;
  startTime: string;
  endDateTime?: string;
  endTime?: string;
  showTimeInfo?: {
    showStartTime: string;
    showEndTime: string;
  };
}

export interface OfferItem extends OfferSetItineraryItem {
  type: 'OFFER_ITEM';
  offerSetId: string;
  offerId: string;
  offerType: 'FLEX';
  endDateTime: string;
  endTime: string;
}

interface ExistingItem extends OfferSetItineraryItem {
  type: 'EXISTING_ITEM';
  id: string;
}

interface EventItem extends OfferSetItineraryItem {
  type: 'EVENT_ITEM';
  eventType: 'PARK_OPEN' | 'PARK_CLOSE';
}

interface OfferSetResponse {
  itinerary?: {
    items: (OfferItem | ExistingItem | EventItem)[];
  };
  offerSetGroup?: {
    expirySeconds: number;
    offerSets: {
      offerSetId: string;
      offers: {
        experienceId: string;
        offerId: string;
        offerType: 'FLEX';
      };
      expiryDateTime: string;
    }[];
  };
  party: GuestsResponse;
}

export interface NewBookingResponse {
  entitlementExperiences: {
    experienceId: string;
    startDateTime: string;
    endDateTime: string;
    guests: { entitlementId: string; guestId: string }[];
  }[];
  party: GuestsResponse;
}

export interface ModBookingResponse {
  booking: {
    experienceId: string;
    startDateTime: string;
    endDateTime: string;
    guests: { entitlementId: string; guestId: string }[];
  };
  party: GuestsResponse;
}

export class Overlap {
  protected startTime;
  protected endTime;

  constructor(
    item: Pick<OfferItineraryItem, 'startTime' | 'endTime' | 'showTimeInfo'>
  ) {
    const startTime = ParkTime.from(item.startTime);
    this.startTime = startTime.add({ minutes: -40 });
    this.endTime = item.showTimeInfo
      ? ParkTime.from(item.showTimeInfo.showEndTime).add({ minutes: -20 })
      : startTime.add({ minutes: item.endTime ? 40 : 60 });
  }

  contains(time: ParkTime) {
    return time > this.startTime && time < this.endTime;
  }
}

/**
 * How long a failed availability-bundle fetch is left uncached before the
 * next poll is allowed to retry it.
 *
 * The request is best-effort supplementary data, and the poller may run every
 * second or two mid-drop -- retrying every tick would defeat the point of
 * caching at all. Long enough that a transient failure is not retried into
 * the ground, short enough that it is not effectively permanent for the
 * life of the client, which one bad response used to make it.
 */
export const AVAILABILITY_BUNDLE_RETRY_MS = 5 * 60_000;

export class LLClientWDW extends LLClient {
  readonly rules = {
    book: true,
    maxPartySize: 20,
    parkModify: true,
    prebook: true,
    timeSelect: true,
  };
  #availabilityBundles: {
    [dateParkId: string]:
      | {
          closedIds: Experience['id'][];
          /** Only populated when Disney explicitly labels a tier. */
          tiers: Map<Experience['id'], number | undefined>;
          /** When this came from a failed fetch, so a retry can be allowed later. */
          failedAt?: number;
        }
      | undefined;
  } = {};

  async experiences(park: Park, date: string): Promise<Experience[]> {
    const exps = await super.experiences(park, date);
    const expIds = new Set(exps.map(exp => exp.id));

    // Supplementary, and only where the tipboard leaves a gap: a future date,
    // or a park that reported nothing at all. Cached per park/date so an
    // active poller never pays for it more than once.
    //
    // Not on an ordinary day-of poll. What this appends are closed
    // attractions, and they enter `snapshotOf` with `available: false` from
    // the first poll -- so the moment one opens, the drop learner sees an
    // unavailable-to-available flip and files a ride simply starting its day
    // as a drop. A future date cannot hit that, because learning is skipped
    // for any date that is not today.
    const dateParkId = date + park.id;
    const cached = this.#availabilityBundles[dateParkId];
    // A failed fetch is retried after a cooldown rather than never again; see
    // `AVAILABILITY_BUNDLE_RETRY_MS`.
    const retryDue =
      cached?.failedAt !== undefined &&
      Date.now() - cached.failedAt >= AVAILABILITY_BUNDLE_RETRY_MS;
    if ((date > parkDate() || exps.length === 0) && (!cached || retryDue)) {
      // Best effort, and deliberately unable to fail the call it enriches.
      //
      // The tipboard has already come back by this point; everything below
      // only adds the attractions it omits because they are closed. Letting
      // this throw threw away a good result and, because the poller reads a
      // thrown tick as a failed one, drove it into exponential backoff --
      // then stopped it after MAX_CONSECUTIVE_FAILURES. This is an extra: it
      // may not be worth a request, and it is certainly not worth the poll.
      try {
        const { data } = await this.request<{
          tiers: {
            /** Disney has returned both numeric and unlabeled tiers. */
            tier?: number;
            experiences: {
              facilityId: string;
              isAvailable?: boolean;
              tier?: number;
            }[];
          }[];
        }>({
          path: '/ea-vas/planning/api/v1/experiences/availability/bundles/experiences',
          data: {
            parkId: park.id,
            date,
            guestIds: [await this.primaryGuestId()],
            existingOfferIds: [],
            orderId: null,
          },
        });
        const tiers = new Map<Experience['id'], number | undefined>();
        const closedIds: Experience['id'][] = [];
        for (const group of data.tiers) {
          for (const exp of group.experiences) {
            if (!expIds.has(exp.facilityId)) closedIds.push(exp.facilityId);
            // Never infer a tier from array position. An unlabeled response
            // must leave the shipped data in control.
            const tier = exp.tier ?? group.tier;
            if (typeof tier === 'number') tiers.set(exp.facilityId, tier);
          }
        }
        this.#availabilityBundles[dateParkId] = { closedIds, tiers };
      } catch (error) {
        // Cached as "nothing to add" so the next poll does not pay for the
        // same failure -- but only until `AVAILABILITY_BUNDLE_RETRY_MS` has
        // passed, so a transient failure does not suppress this for the rest
        // of the client's life if the endpoint recovers.
        console.error(error);
        this.#availabilityBundles[dateParkId] = {
          closedIds: [],
          tiers: new Map(),
          failedAt: Date.now(),
        };
      }
    }

    const bundle = this.#availabilityBundles[date + park.id];
    for (const id of bundle?.closedIds ?? []) {
      if (expIds.has(id)) continue;
      try {
        exps.push({
          ...this.resort.experience(id),
          flex: { available: false },
          standby: { available: false, unavailableReason: 'CLOSED' },
        });
      } catch (error) {
        if (!(error instanceof InvalidId)) throw error;
      }
    }

    // Reported, not applied.
    //
    // Assigning `exp.tier` here rewrites the tier on tipboard experiences
    // only. A booking builds its experience from `resort.experience(id)`,
    // which this never touches -- so in exactly the case worth warning about,
    // the two halves of the app disagreed about the same attraction. That
    // breaks the comparisons that span them: ExistingBookings' "this would
    // spend a tier slot you already hold", and MultiPassList's "earlier than
    // what you already booked in this tier".
    //
    // One curated table stays in control. PLAN.md 3.2 and 9.11 both argue
    // against inferring tiers from this endpoint, and a disagreement is a
    // prompt to check the data rather than something to silently act on.
    for (const exp of exps) {
      const liveTier = bundle?.tiers.get(exp.id);
      if (liveTier === undefined || liveTier === exp.tier) continue;
      console.warn(
        `Live tier differs for ${exp.name}: data=${exp.tier ?? 'none'}, live=${liveTier}`
      );
    }

    return exps;
  }

  async guests(
    experience?: { id: string },
    date?: string,
    park?: { id: string }
  ): Promise<Guests> {
    const { data } = await this.request<GuestsResponse>({
      path: '/ea-vas/planning/api/v1/experiences/guest/guests',
      data: {
        date: date ?? DateTime.now().date,
        facilityId: experience?.id ?? null,
        // An attraction names its own park. Failing that, the caller's, and
        // only then the resort's first -- which used to be the sole fallback
        // and meant Magic Kingdom for every park-less check at WDW.
        parkId: experience
          ? this.resort.experience(experience.id).park.id
          : (park?.id ?? this.resort.parks[0]!.id),
      },
      sensorData: true,
    });
    return this.parseGuestData(data);
  }

  async offer<B extends Offer['booking']>(
    experience: OfferExperience,
    guests: Guest[],
    options?: { date: string } | { booking?: B }
  ): Promise<Offer<B>> {
    const today = parkDate();
    const { date, booking } = { date: today, booking: undefined, ...options };
    throwOnNotModifiable(booking);
    const { nextAvailableTime } = experience.flex ?? {};
    const { data } = await this.request<OfferSetResponse>({
      path: `/ea-vas/planning/api/v1/experiences${booking ? '/mod' : ''}/offerset/generate`,
      data: {
        date: booking ? booking.start.date : date,
        parkId: experience.park.id,
        guestIds: guests.map(g => g.id),
        targetedTime: nextAvailableTime ?? '08:00:00',
        ignoredBookedExperienceIds: null,
        ...(booking
          ? {
              experienceId: experience.id,
              originalExperienceId: booking.experience.id,
              originalEntitlementIds: booking.guests.map(g => g.entitlementId),
            }
          : {
              experienceIds: [experience.id],
            }),
      },
      sensorData: true,
    });
    const party = this.parseGuestData(data.party);

    let offerItem: OfferItem | undefined;
    const itinerary: Offer['itinerary'] = [];
    let openTime: ParkTime | undefined;
    let closeTime: ParkTime | undefined;
    for (const item of (data.itinerary ?? {}).items ?? []) {
      switch (item.type) {
        case 'EXISTING_ITEM': {
          const newItem = replaceTimeStrings(item);
          itinerary.push({ ...newItem, overlap: new Overlap(newItem) });
          break;
        }
        case 'EVENT_ITEM':
          if (item.eventType === 'PARK_OPEN') {
            openTime = ParkTime.from(item.startTime);
          } else if (item.eventType === 'PARK_CLOSE') {
            closeTime = ParkTime.from(item.startTime);
          }
          break;
        case 'OFFER_ITEM':
          if (item.facilityId === experience.id) offerItem = item;
          break;
      }
    }

    if (!offerItem) throw new OfferError(party);
    const { offerSetId, offerId, startDateTime, endDateTime } = offerItem;
    const guestsById = Object.fromEntries(guests.map(g => [g.id, g]));
    const offer: Offer<B> = {
      offerSetId,
      id: offerId,
      start: DateTime.from(startDateTime),
      end: DateTime.from(endDateTime),
      experience,
      guests: {
        eligible: party.eligible.map(g => ({ ...guestsById[g.id], ...g })),
        ineligible: party.ineligible,
      },
      booking: booking as B,
      itinerary,
      parkHours: openTime && closeTime ? { openTime, closeTime } : undefined,
    };
    // When you already have two LLs booked, the system tries to place your
    // third LL in between them rather than offering you the earliest available
    // return time. This is probably not what most people expect or usually
    // want, so we correct for this behavior by trying to change the offer time
    // when it's significantly later than expected.
    if (
      nextAvailableTime &&
      offer.start.time !== nextAvailableTime &&
      +offer.start.time - +nextAvailableTime > 10 * 60
    ) {
      try {
        return await this.changeOfferTime(offer, nextAvailableTime);
      } catch (error) {
        // Keep original offer
        console.error(error);
      }
    }
    return this.updateLastOffer(offer, nextAvailableTime);
  }

  async times(offer: Offer): Promise<HourlyTimes> {
    const { data } = await this.request<{
      hourSegmentGroups: {
        inventorySlotsAvailability: { startTime: string }[];
      }[];
    }>({
      path: `/ea-vas/planning/api/v1/experiences${offer.booking ? '/mod' : ''}/offerset/times`,
      data: {
        experienceId: offer.experience.id,
        parkId: offer.experience.park.id,
        date: offer.start.date,
        offerId: offer.id,
        offerSetIds: [offer.offerSetId],
        guestIds: offer.guests.eligible.map(g => g.id),
        offerType: 'FLEX',
        experienceIdsToIgnore: [],
        originalOrderItemId: null,
      },
      sensorData: true,
    });
    return data.hourSegmentGroups.map(group =>
      group.inventorySlotsAvailability.map(s => ParkTime.from(s.startTime))
    );
  }

  async changeOfferTime<B extends Offer['booking']>(
    offer: Offer<B>,
    time: ParkTime
  ): Promise<Offer<B>> {
    const {
      data: { updatedPlanningOfferDisplayItem: newOffer },
    } = await this.request<{
      experienceId: string;
      offerId: string;
      offerSetId: string;
      offerType: 'FLEX';
      updatedPlanningOfferDisplayItem: OfferItem;
    }>({
      path: `/ea-vas/planning/api/v1/experiences${offer.booking ? '/mod' : ''}/offerset/times/fulfill`,
      data: {
        parkId: offer.experience.park.id,
        date: offer.start.date,
        offerId: offer.id,
        ...(offer.booking
          ? { offerSetId: offer.offerSetId }
          : { offerSetIds: [offer.offerSetId] }),
        offerType: 'FLEX',
        guestIds: offer.guests.eligible.map(g => g.id),
        targetSlot: { startTime: time, endTime: time },
        experienceIdsToIgnore: [],
      },
      sensorData: true,
    });
    return this.updateLastOffer(
      {
        ...offer,
        id: newOffer.offerId,
        offerSetId: newOffer.offerSetId,
        start: DateTime.from(newOffer.startDateTime),
        end: DateTime.from(newOffer.endDateTime),
      },
      time
    );
  }

  async book<B extends Offer['booking']>(
    offer: Offer<B>,
    guestsToModify?: Pick<Guest, 'id'>[]
  ): Promise<LLMP> {
    if (offer.booking) {
      return this.modify(offer as Offer<LLMP>, guestsToModify);
    }
    const { data } = await this.request<NewBookingResponse>({
      path: '/ea-vas/planning/api/v1/experiences/entitlements/book',
      data: {
        offerSetId: offer.offerSetId,
        orderGuestDetails: offer.guests.eligible
          .filter(
            (g): g is Guest & { orderDetails: OrderDetails } => !!g.orderDetails
          )
          .map(({ id, orderDetails: { externalIdentifier, ...ids } }) => ({
            guestDetails: [{ guestId: id, externalIdentifier }],
            ...ids,
          })),
      },
      sensorData: true,
    });
    return this.createLLFromResponse(offer.experience, data);
  }

  protected async modify(
    offer: Offer<LLMP>,
    guestsToModify?: Pick<Guest, 'id'>[]
  ): Promise<LLMP> {
    const {
      offerSetId,
      guests: { eligible },
    } = offer;
    const guestIdsToModify = new Set(
      (guestsToModify ?? offer.guests.eligible).map(g => g.id)
    );
    const entIdsByGuestId = Object.fromEntries(
      offer.booking.guests.map(g => [g.id, g.entitlementId])
    );
    const { data } = await this.request<ModBookingResponse>({
      path: '/ea-vas/planning/api/v1/experiences/mod/entitlements/book',
      data: {
        offerSetId,
        eligibleGuestsEntitlements: eligible
          .filter(g => guestIdsToModify.has(g.id))
          .map(g => ({
            guestId: g.id,
            entitlementId: entIdsByGuestId[g.id],
            ...g.orderDetails,
          })),
      },
      sensorData: true,
    });
    return this.createLLFromResponse(offer.experience, {
      entitlementExperiences: [data.booking],
      party: data.party,
    });
  }

  protected createLLFromResponse(
    experience: OfferExperience,
    response: NewBookingResponse
  ): LLMP {
    const booking = response.entitlementExperiences[0]!;
    const entIdsByGuestId = Object.fromEntries(
      booking.guests.map(g => [g.guestId, g.entitlementId])
    );
    const { id, name, land, park } = experience;
    return {
      facilityId: id,
      name,
      experience,
      land,
      park,
      type: 'LL',
      subtype: 'MP',
      id: booking.guests[0]!.entitlementId,
      start: DateTime.from(booking.startDateTime),
      end: DateTime.from(booking.endDateTime),
      cancellable: true,
      modifiable: true,
      guests: response.party.guests.map(g => ({
        ...this.convertGuest(g),
        entitlementId: entIdsByGuestId[g.id]!,
      })),
    };
  }

  protected parseGuestData({ guests, ineligibleGuests }: GuestsResponse) {
    return super.parseGuestData({
      guests,
      ineligibleGuests: ineligibleGuests.map(g =>
        g.ineligibleReason
          ? { ...g, ineligibleReason: g.ineligibleReason.ineligibleReason }
          : g
      ),
    });
  }
}
