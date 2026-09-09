import { DateTime, ParkTime, parkDate } from '@/datetime';
import kvdb from '@/kvdb';

import { authStore } from './auth';
import { avatarUrl } from './avatar';
import { ApiClient } from './client';
import { Booking, LLMP, isLLMP } from './itinerary';
import { Experience as ExpData, InvalidId, Park, Resort } from './resort';

export type { LLMP };

interface Standby {
  available?: boolean;
  unavailableReason?:
    | 'TEMPORARILY_DOWN'
    | 'NOT_STANDBY_ENABLED'
    | 'NO_MORE_SHOWS'
    | 'CLOSED';
  waitTime?: number;
}

interface ApiExperience {
  id: string;
  type: 'ATTRACTION' | 'ENTERTAINMENT';
  standby: Standby & { nextShowTime?: string };
  additionalShowTimes?: string[];
  flex?: {
    available?: boolean;
    nextAvailableTime?: string;
    enrollmentStartTime?: string;
  };
  individual?: {
    available: boolean;
    displayPrice: string;
    nextAvailableTime?: string;
  };
  virtualQueue?: {
    available: boolean;
    nextAvailableTime?: string;
  };
}

type WithParkTimes<T> = T extends object
  ? {
      [K in keyof T]: K extends `${string}Time`
        ? T[K] extends string | undefined
          ? ParkTime
          : WithParkTimes<T[K]>
        : K extends `${string}Times`
          ? ParkTime[]
          : WithParkTimes<T[K]>;
    }
  : T;

export function replaceTimeStrings<T extends { [k: string]: any }>(
  obj: T
): WithParkTimes<T> {
  // `typeof null` is `'object'`, so null has to be named: without it the
  // recursion below walks into one and `Object.entries(null)` throws. Disney
  // sends explicit nulls elsewhere in its own API -- `nextScheduledOpenTime`
  // in the virtual queue payload is declared `string | null` -- and a throw
  // here escapes `experiences()`, which the poller reads as a failed tick.
  if (obj === null || typeof obj !== 'object') return obj;

  for (const [k, v] of Object.entries(obj)) {
    switch (typeof v) {
      case 'string':
        if (k.endsWith('Time') && v.match(/^\d{2}:\d{2}:\d{2}$/)) {
          (obj as any)[k] = ParkTime.from(v);
        }
        break;
      case 'object':
        (obj as any)[k] = replaceTimeStrings(v);
        break;
    }
  }

  return obj as WithParkTimes<T>;
}

export type Experience = ExpData &
  Omit<
    WithParkTimes<ApiExperience>,
    'type' | 'standby' | 'additionalShowTimes'
  > & {
    standby: Standby;
    experienced?: boolean;
    showTimes?: ParkTime[];
  };
export type FlexExperience = Experience & Required<Pick<Experience, 'flex'>>;

export interface ExperiencesResponse {
  availableExperiences: ApiExperience[];
  eligibility?: {
    geniePlusEligibility?: {
      [date: string]: {
        flexEligibilityWindows?: {
          time: {
            time: string;
            timeDisplayString: string;
            timeStatus: 'NOW' | 'LATER';
          };
          guestIds: string[];
        }[];
      };
    };
    guestIds: string[];
  };
}

export type IneligibleReason =
  | 'INVALID_PARK_ADMISSION'
  | 'PARK_RESERVATION_NEEDED'
  | 'GENIE_PLUS_NEEDED'
  | 'EXPERIENCE_LIMIT_REACHED'
  | 'TOO_EARLY'
  | 'TOO_EARLY_FOR_PARK_HOPPING'
  | 'NOT_IN_PARTY'
  | 'MULTI_PASS_NEEDED'
  | 'REDEMPTION_NEEDED'
  | 'TIER_LIMIT_REACHED'
  | 'TOO_EARLY_FOR_NEXT_PARK';

interface GuestEligibility {
  ineligibleReason?: IneligibleReason;
  eligibleAfter?: ParkTime;
}

export interface OrderDetails {
  externalIdentifier: {
    id: string;
    idType: string;
  };
  orderId: string;
  orderItemId: string;
}

export interface Guest extends GuestEligibility {
  id: string;
  name: string;
  primary?: boolean;
  avatarImageUrl?: string;
  transactional?: boolean;
  orderDetails?: OrderDetails;
}

export interface Guests {
  eligible: Guest[];
  ineligible: Guest[];
}

export interface ApiGuest extends GuestEligibility {
  id: string;
  firstName: string;
  lastName: string;
  primary?: boolean;
  characterId?: string;
  orderDetails?: OrderDetails;
}

export interface GuestsResponse {
  guests: ApiGuest[];
  ineligibleGuests: ApiGuest[];
}

export type OfferExperience = Omit<Experience, 'standby'>;

interface Overlap {
  contains: (time: ParkTime) => boolean;
}

export interface OfferItineraryItem {
  overlap: Overlap;
  facilityId: string;
  startTime: ParkTime;
  endTime?: ParkTime;
  showTimeInfo?: {
    showStartTime: ParkTime;
    showEndTime: ParkTime;
  };
}

export interface Offer<B = LLMP | undefined> {
  id: string;
  start: DateTime;
  end: DateTime;
  changed?: boolean;
  guests: {
    eligible: Guest[];
    ineligible: Guest[];
  };
  experience: OfferExperience;
  itinerary: OfferItineraryItem[];
  parkHours?: { openTime: ParkTime; closeTime: ParkTime };
  offerSetId?: string;
  booking: B;
}

export type HourlyTimes = ParkTime[][];

export class ModifyNotAllowed extends Error {
  name = 'ModifyNotAllowed';
}

export function throwOnNotModifiable(booking?: Booking) {
  if (booking && !booking.modifiable) {
    throw new ModifyNotAllowed();
  }
}

export class OfferError extends Error {
  readonly name = 'OfferError';
  constructor(readonly guests: Guests) {
    super('Offer request failed');
  }
}

function compareByReason(a: Guest, b: Guest, reason: IneligibleReason) {
  return +(b.ineligibleReason === reason) - +(a.ineligibleReason === reason);
}

/**
 * Every moment Disney says a booking window opens on `date`, soonest first.
 *
 * Read for the date actually requested rather than today. The two coincide for
 * every current caller, but reading `parkDate()` here while the rest of
 * `experiences()` answers for `date` would report today next booking time as
 * though it applied to a future park day.
 *
 * Plural because a party's slots free at different times, and each entry is a
 * moment Disney has said inventory opens. Keeping only the earliest threw the
 * rest away, so the poller idled at 45 seconds through every later one.
 *
 * Ordered by `ParkTime`, which measures from a 4am day start, rather than by
 * the raw `HH:MM:SS` string: a window at 00:15 on a late Magic Kingdom night
 * belongs after 23:00, not at the head of the list where a string sort puts
 * it. That is a live bug in the single-window code this replaces.
 *
 * A window whose time will not parse is dropped rather than thrown on.
 * `ParkTime.from` throws a RangeError on anything that is not HH:MM:SS, and
 * this now reads every window instead of one, so a single malformed entry
 * would fail the whole poll -- and MAX_CONSECUTIVE_FAILURES of those stop
 * autopilot for the day.
 */
export function bookWindows(
  eligibility: ExperiencesResponse['eligibility'],
  date: string
): ParkTime[] {
  const windows =
    eligibility?.geniePlusEligibility?.[date]?.flexEligibilityWindows ?? [];
  return windows
    .flatMap(w => {
      try {
        return w.time?.time ? [ParkTime.from(w.time.time)] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => +a - +b);
}

export abstract class LLClient extends ApiClient {
  readonly rules = {
    book: true,
    maxPartySize: 12,
    parkModify: false,
    prebook: false,
    timeSelect: false,
  };
  /**
   * Every moment Disney says a booking window opens, soonest first.
   *
   * Reassigned wholesale on every `experiences()` call rather than mutated,
   * so a park or date change cannot leave a stale window behind and the
   * poller's ref cannot observe a half-written list mid-tick.
   */
  nextBookTimes: ParkTime[] = [];
  /**
   * Tipboard ids the resort data file does not know, from the last fetch.
   *
   * Disney issues a new facility id when an attraction is re-themed, and
   * `experiences()` drops an unknown id silently -- no row, no watch target,
   * no alert, no booking, and nothing on screen saying why. Three attractions
   * went stale this way in 2026, two of them headliners. Recorded here so the
   * next one is visible the day it happens instead of on the trip.
   */
  unknownExperienceIds: string[] = [];
  onUnauthorized = () => undefined;

  protected partyIds = new Set<Guest['id']>();
  protected tracker: Public<LLTracker>;
  #lastOffer: Offer | null = null;
  #primaryGuestId = '';

  constructor(resort: Resort, tracker?: Public<LLTracker>) {
    super(resort);
    this.tracker = tracker ?? new LLTracker();
  }

  get lastOffer() {
    return this.#lastOffer;
  }

  /**
   * The soonest booking window, which is the one the screens name.
   *
   * Derived rather than stored alongside the array: two homes for the same
   * fact drift apart, and both readers want a single time rather than a `[0]`
   * in their JSX.
   */
  get nextBookTime(): ParkTime | undefined {
    return this.nextBookTimes[0];
  }

  setPartyIds(partyIds: string[]) {
    this.partyIds = new Set(partyIds);
  }

  async experiences(park: Park, date: string): Promise<Experience[]> {
    const { data } = await this.request<ExperiencesResponse>({
      path: `/tipboard-vas/planning/v1/parks/${encodeURIComponent(
        park.id
      )}/experiences/`,
      params: { date },
      userId: true,
    });
    // Unconditional: a response with no eligibility block must clear the
    // previous park's windows rather than leave them to be burst for.
    this.nextBookTimes = bookWindows(data.eligibility, date);

    const unknown: string[] = [];
    const mapped = data.availableExperiences.flatMap(exp => {
      try {
        return {
          ...replaceTimeStrings(exp),
          ...this.resort.experience(exp.id),
          park,
          showTimes: exp.standby?.nextShowTime
            ? [
                exp.standby.nextShowTime,
                ...(exp.additionalShowTimes ?? []),
              ].map(t => ParkTime.from(t))
            : undefined,
          // Only for the current park day. `LLTracker` is day-scoped -- it
          // loads through `getDaily` and keeps only bookings whose start is
          // today -- so its answer is always about today, whatever date this
          // tipboard was fetched for. Stamping it onto a future date said "you
          // have already ridden this" about a day the party has not been to,
          // which lifts the one-Tier-1-at-a-time hold for a redemption that
          // has not happened yet.
          experienced:
            date === parkDate() ? this.tracker.experienced(exp) : undefined,
        };
      } catch (error) {
        if (!(error instanceof InvalidId)) throw error;
        // Ids deliberately listed as null are a decision, not staleness.
        if (!this.resort.knows(exp.id)) unknown.push(exp.id);
        return [];
      }
    });
    this.unknownExperienceIds = unknown;
    return mapped;
  }

  track(bookings: Booking[]) {
    this.tracker.update(bookings, this);
  }

  /**
   * Whether the party has already used up this attraction today.
   *
   * True once a reservation has been redeemed, and also once one has expired
   * unredeemed -- Disney counts a lapsed pass as ridden, so both leave the
   * itinerary looking identical to a cancellation while being nothing of the
   * kind. Read from the tracker rather than the tipboard because a spent
   * attraction can disappear from the tipboard altogether.
   */
  experienced(experience: Pick<Experience, 'id'>): boolean {
    return this.tracker.experienced(experience);
  }

  abstract guests(
    experience?: { id: string },
    date?: string,
    /**
     * Which park to ask about when no attraction is given.
     *
     * Only reachable that way: with an attraction the park is looked up from
     * it. Without one the WDW client used to fall back to the resort's first
     * park, so a general eligibility check for Animal Kingdom silently asked
     * about Magic Kingdom.
     */
    park?: { id: string }
  ): Promise<Guests>;

  abstract offer<B extends Offer['booking']>(
    experience: OfferExperience,
    guests: Guest[],
    options?: { date: string } | { booking?: B }
  ): Promise<Offer<B>>;

  abstract times(offer: Offer): Promise<HourlyTimes>;

  abstract changeOfferTime<B extends Offer['booking']>(
    offer: Offer<B>,
    time: ParkTime
  ): Promise<Offer<B>>;

  abstract book<B extends Offer['booking']>(
    offer: Offer<B>,
    guestsToModify?: Pick<Guest, 'id'>[]
  ): Promise<LLMP>;

  async cancelBooking(guests: LLMP['guests']) {
    const ids = guests.map(g => g.entitlementId);
    const idParam = ids.map(encodeURIComponent).join(',');
    await this.request({
      path: `/ea-vas/api/v1/entitlements/${idParam}`,
      method: 'DELETE',
    });
  }

  protected convertGuest = <T extends ApiGuest>(
    guest: T
  ): Omit<
    T,
    'id' | 'firstName' | 'lastName' | 'characterId' | 'eligibleAfter'
  > & {
    id: string;
    name: string;
    avatarImageUrl?: string;
    eligibleAfter?: ParkTime;
  } => {
    const {
      id,
      firstName,
      lastName,
      characterId,
      eligibleAfter: eligibleAfterString,
      ...rest
    } = guest;
    let eligibleAfter = eligibleAfterString
      ? ParkTime.from(eligibleAfterString)
      : undefined;
    const name = `${firstName ?? ''} ${lastName ?? ''}`.trim();
    const avatarImageUrl = avatarUrl(characterId);
    if (this.partyIds.size > 0 && !this.partyIds.has(id)) {
      rest.ineligibleReason = 'NOT_IN_PARTY';
      eligibleAfter = undefined;
    }
    return { ...rest, id, name, eligibleAfter, avatarImageUrl };
  };

  protected async primaryGuestId() {
    if (!this.#primaryGuestId) {
      const { eligible, ineligible } = await this.guests();
      this.#primaryGuestId =
        [...eligible, ...ineligible].find(g => g.primary)?.id ?? '';
    }
    return this.#primaryGuestId;
  }

  protected async request<T>(
    request: Parameters<ApiClient['request']>[0] & { userId?: boolean }
  ) {
    if (request.userId) {
      const { swid } = authStore.getData();
      request = { ...request };
      request.params = { ...request.params, userId: swid };
    }
    return super.request<T>(request);
  }

  protected parseGuestData(data: GuestsResponse): Guests {
    const { guests, ineligibleGuests } = data;
    const ineligible = ineligibleGuests.map(this.convertGuest);
    const eligible = guests
      .map(this.convertGuest)
      .filter(g => !g.ineligibleReason || (ineligible.push(g) && false));
    ineligible.sort((a, b) => {
      const cmp = +!a.primary - +!b.primary || a.name.localeCompare(b.name);
      if (a.eligibleAfter || b.eligibleAfter) {
        return +(a.eligibleAfter ?? 86400) - +(b.eligibleAfter ?? 86400) || cmp;
      }
      if (a.ineligibleReason === b.ineligibleReason) return cmp;
      return (
        compareByReason(b, a, 'NOT_IN_PARTY') ||
        compareByReason(b, a, 'MULTI_PASS_NEEDED') ||
        compareByReason(a, b, 'EXPERIENCE_LIMIT_REACHED') ||
        cmp
      );
    });
    return { eligible, ineligible };
  }

  protected updateLastOffer<O extends Offer>(
    offer: O,
    expectedTime: ParkTime | undefined
  ): O {
    offer.changed = +offer.start.time !== +(expectedTime ?? offer.start.time);
    this.#lastOffer = offer;
    return offer;
  }
}

export const BOOKINGS_KEY = 'autoll3.ll.bookings';

interface LLTrackerData {
  booked: Experience['id'][];
  experienced: Experience['id'][];
}

export class LLTracker {
  protected bookedIds = new Set<Experience['id']>();
  protected experiencedIds = new Set<Experience['id']>();

  constructor() {
    this.load();
  }

  experienced(experience: Pick<Experience, 'id'>) {
    return this.experiencedIds.has(experience.id);
  }

  async update(bookings: Booking[], client: LLClient) {
    this.load();
    const parkDay = parkDate();
    const cancellableLLs = bookings
      .filter(isLLMP)
      .filter(b => !!b.cancellable && parkDate(b.start) === parkDay);
    for (const b of cancellableLLs) {
      this.experiencedIds[b.modifiable ? 'delete' : 'add'](b.experience.id);
    }
    const prevBookedIds = this.bookedIds;
    this.bookedIds = new Set(cancellableLLs.map(b => b.experience.id));
    for (const id of prevBookedIds) {
      if (this.bookedIds.has(id)) continue;
      const { ineligible } = await client.guests({ id });
      const limitReached = ineligible.some(
        g => g.ineligibleReason === 'EXPERIENCE_LIMIT_REACHED'
      );
      this.experiencedIds[limitReached ? 'add' : 'delete'](id);
    }
    this.save();
  }

  protected load() {
    const { booked = [], experienced = [] } =
      kvdb.getDaily<LLTrackerData>(BOOKINGS_KEY) ?? {};
    this.bookedIds = new Set(booked);
    this.experiencedIds = new Set(experienced);
  }

  protected save() {
    kvdb.setDaily<LLTrackerData>(BOOKINGS_KEY, {
      booked: [...this.bookedIds],
      experienced: [...this.experiencedIds],
    });
  }
}
