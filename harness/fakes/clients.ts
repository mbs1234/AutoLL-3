import { RequestControl, RequestError } from '@/api/client';
import { DasClient, DasParty } from '@/api/das';
import { Booking, ItineraryClient, LLMP } from '@/api/itinerary';
import { LiveDataClient } from '@/api/livedata';
import {
  Experience,
  Guest,
  Guests,
  HourlyTimes,
  LLClient,
  Offer,
  OfferExperience,
} from '@/api/ll';
import { Park, Resort } from '@/api/resort';
import { Clients } from '@/contexts/ClientsContext';
import { DateTime, ParkTime, parkDate } from '@/datetime';
import { sleep } from '@/sleep';

import {
  IDS,
  World,
  donald,
  inMinutes,
  llmp,
  party,
  sortPlans,
  wdw,
} from './world';

/** Enough delay to see spinners; not enough to slow a poll noticeably. */
const LATENCY_MS = 150;
const BOOK_PATH = '/ea-vas/api/v2/products/flex/bookings';

/** Quarter hours from `from` to `to` minutes around a time, inclusive. */
function offsets(from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += 15) out.push(m);
  return out;
}

/** The API's shape: one row per hour. */
function byHour(times: ParkTime[]): HourlyTimes {
  const rows = new Map<number, ParkTime[]>();
  for (const time of times) {
    const row = rows.get(time.hour) ?? [];
    row.push(time);
    rows.set(time.hour, row);
  }
  return [...rows.values()];
}

/**
 * Walt Disney World's Lightning Lane client with the network taken out.
 *
 * Everything that would be a request reads or writes the shared `World`
 * instead, with a little latency so loading states are visible. Everything
 * else -- the tracker, party ids, the last-offer bookkeeping -- is the real
 * base class.
 */
export class FakeLLClient extends LLClient {
  readonly rules = {
    book: true,
    maxPartySize: 20,
    parkModify: true,
    prebook: true,
    timeSelect: true,
  };

  constructor(
    resort: Resort,
    readonly world: World
  ) {
    super(resort);
  }

  override async experiences(park: Park, date: string): Promise<Experience[]> {
    await sleep(LATENCY_MS);
    this.world.polls += 1;
    this.nextBookTimes = [inMinutes(90)];
    this.unknownExperienceIds = this.world.script.unknownId
      ? [IDS.unknown]
      : [];
    const today = date === parkDate();
    return this.world.tipboard(park).map(exp => ({
      ...exp,
      experienced: today ? this.tracker.experienced(exp) : undefined,
    }));
  }

  async guests(
    experience?: { id: string },
    date?: string,
    park?: { id: string }
  ): Promise<Guests> {
    void experience;
    void date;
    void park;
    await sleep(LATENCY_MS);
    const inParty = (g: Guest) =>
      this.partyIds.size === 0 || this.partyIds.has(g.id);
    return {
      eligible: party.filter(inParty),
      ineligible: [
        ...party
          .filter(g => !inParty(g))
          .map(g => ({ ...g, ineligibleReason: 'NOT_IN_PARTY' as const })),
        donald,
      ],
    };
  }

  async offer<B extends Offer['booking']>(
    experience: OfferExperience,
    guests: Guest[],
    options?: { date: string } | { booking?: B }
  ): Promise<Offer<B>> {
    await sleep(LATENCY_MS);
    const booking =
      options && 'booking' in options ? options.booking : undefined;
    const date =
      options && 'date' in options
        ? options.date
        : (booking?.start.date ?? parkDate());
    const listed = this.world
      .tipboard(experience.park)
      .find(exp => exp.id === experience.id);
    // Modifying starts from what is held; a new booking starts from what the
    // tipboard advertises, which is what the real offer comes back with.
    const advertised = listed?.flex.available
      ? listed.flex.nextAvailableTime
      : undefined;
    const start = booking?.start.time ?? advertised ?? inMinutes(30);
    const offer = this.makeOffer(experience, guests, date, start, booking as B);
    return this.updateLastOffer(offer, start);
  }

  async times(offer: Offer): Promise<HourlyTimes> {
    await sleep(LATENCY_MS);
    const held = offer.booking?.start.time ?? offer.start.time;
    const anchor = (this.world.anchor ??= held);
    const minutes = {
      earlier: offsets(-90, 120),
      later: offsets(0, 180),
      same: [0],
    }[this.world.script.grid];
    return byHour(minutes.map(m => anchor.add({ minutes: m })));
  }

  async changeOfferTime<B extends Offer['booking']>(
    offer: Offer<B>,
    time: ParkTime
  ): Promise<Offer<B>> {
    await sleep(LATENCY_MS);
    const next = this.makeOffer(
      offer.experience,
      offer.guests.eligible,
      offer.start.date,
      time,
      offer.booking
    );
    return this.updateLastOffer(next, time);
  }

  async book<B extends Offer['booking']>(
    offer: Offer<B>,
    guestsToModify?: Pick<Guest, 'id'>[],
    control?: RequestControl
  ): Promise<LLMP> {
    void guestsToModify;
    await sleep(LATENCY_MS * 2);
    const send = async () => {
      control?.onDispatch?.();
      const { book, plansFollow } = this.world.script;
      if (book === 'timeout') {
        throw new RequestError(
          { ok: false, status: 0, data: undefined },
          'Request failed',
          BOOK_PATH
        );
      }
      if (book === 'refused') {
        throw new RequestError(
          { ok: false, status: 403, data: {} },
          'Request failed',
          BOOK_PATH
        );
      }
      const held = offer.booking;
      if (held) {
        const moved: LLMP = { ...held, start: offer.start, end: offer.end };
        if (plansFollow) {
          this.world.plans = sortPlans(
            this.world.plans.map(b => (b.id === held.id ? moved : b))
          );
        }
        return moved;
      }
      const booked = llmp(
        offer.experience.id,
        offer.start.time,
        offer.start.date,
        offer.guests.eligible
      );
      this.world.plans = sortPlans([...this.world.plans, booked]);
      return booked;
    };
    return control?.start ? control.start(send) : send();
  }

  override async cancelBooking(guests: LLMP['guests']): Promise<void> {
    await sleep(LATENCY_MS);
    const ids = new Set(guests.map(g => g.entitlementId));
    this.world.plans = this.world.plans.filter(b => !ids.has(b.id));
  }

  private makeOffer<B extends Offer['booking']>(
    experience: OfferExperience,
    guests: Guest[],
    date: string,
    start: ParkTime,
    booking: B
  ): Offer<B> {
    const id = `offer-${++this.world.seq}`;
    return {
      id,
      offerSetId: `set-${id}`,
      start: new DateTime(date, start),
      end: new DateTime(date, start.add({ hours: 1 })),
      changed: false,
      guests: { eligible: guests, ineligible: [] },
      experience,
      itinerary: [],
      parkHours: { openTime: new ParkTime(9), closeTime: new ParkTime(22) },
      booking,
    };
  }
}

export class FakeItineraryClient extends ItineraryClient {
  constructor(
    resort: Resort,
    readonly world: World
  ) {
    super(resort);
  }

  override async plans(): Promise<Booking[]> {
    await sleep(LATENCY_MS);
    const plans = sortPlans(this.world.plans);
    this.onRefresh(plans);
    return plans;
  }
}

export class FakeLiveDataClient extends LiveDataClient {
  override async shows(): Promise<{ [id: string]: Experience }> {
    return {};
  }
}

export class FakeDasClient extends DasClient {
  override async parties(): Promise<DasParty[]> {
    return [];
  }

  override async experiences(): Promise<never[]> {
    return [];
  }
}

/** The same wiring as `createClients`, over the fakes. */
export function createFakeClients(world: World): Clients {
  const das = new FakeDasClient(wdw);
  const liveData = new FakeLiveDataClient(wdw);
  const ll = new FakeLLClient(wdw, world);
  const itinerary = new FakeItineraryClient(wdw, world);
  itinerary.onRefresh = bookings => ll.track(bookings);
  return { das, itinerary, liveData, ll };
}
