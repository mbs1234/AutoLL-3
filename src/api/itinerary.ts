import { DEFAULT_THEME } from '@/contexts/ThemeContext';
import { DateTime, ParkTime, parkDate } from '@/datetime';

import { authStore } from './auth';
import { avatarUrl } from './avatar';
import { ApiClient } from './client';
import { Experience, InvalidId, Land, Park } from './resort';

const RES_EXPIRATION_MINUTES = 60;

const RESORT_TO_ITINERARY_API_NAME = {
  WDW: 'wdw-itinerary-api',
} as const;

export interface Guest {
  id: string;
  name: string;
  avatarImageUrl?: string;
  transactional?: boolean;
}

export interface EntitledGuest extends Guest {
  entitlementId: string;
  bookingId?: string;
  redemptions?: number;
}

interface BaseBooking {
  type: string;
  subtype?: string;
  id: string;
  facilityId: string;
  name: string;
  park: Park;
  land?: Land;
  start: DateTime | { date: string; time?: ParkTime };
  end?: DateTime | { date: string; time?: ParkTime };
  cancellable?: boolean;
  modifiable?: boolean;
  guests: Guest[];
  choices?: Pick<Experience, 'id' | 'name' | 'park'>[];
}

export interface ParkPass extends BaseBooking {
  type: 'APR';
  subtype?: undefined;
  start: { date: string; time?: undefined };
  end?: undefined;
  cancellable?: undefined;
  modifiable?: undefined;
}

export interface LightningLane extends BaseBooking {
  type: 'LL';
  subtype: 'MP' | 'SP' | 'OTHER';
  experience: Experience;
  land: Land;
  guests: EntitledGuest[];
  showTimeInfo?: { showStartTime: ParkTime; showEndTime: ParkTime };
}

export interface LLMP extends LightningLane {
  type: 'LL';
  subtype: 'MP';
  start: DateTime;
  end: DateTime;
}

export interface DasBooking extends BaseBooking {
  type: 'DAS';
  subtype: 'IN_PARK' | 'ADVANCE';
  experience: Experience;
  land: Land;
  start: DateTime;
  modifiable?: undefined;
  guests: EntitledGuest[];
}

export interface Reservation extends BaseBooking {
  type: 'RES';
  subtype: 'DINING' | 'ACTIVITY';
  land: Land;
  start: DateTime;
  end?: undefined;
  cancellable?: undefined;
  modifiable?: undefined;
}

export interface BoardingGroup extends BaseBooking {
  type: 'BG';
  subtype?: undefined;
  experience: Experience;
  land: Land;
  boardingGroup: number;
  status: BoardingGroupItem['status'];
  start: { date: string; time?: undefined };
  cancellable?: undefined;
  modifiable?: undefined;
}

export type Booking =
  | LightningLane
  | DasBooking
  | Reservation
  | BoardingGroup
  | ParkPass;

interface Asset {
  id: string;
  type: string;
  name: string;
  media: {
    small: {
      transcodeTemplate: string;
      url: string;
    };
  };
  facility: string;
  land?: string;
  location?: string;
}

interface FastPassItem {
  id: string;
  type: 'FASTPASS';
  kind: string;
  facility: string;
  assets: { content: string; excluded: boolean; original: boolean }[];
  displayStartDate?: string;
  displayStartTime?: string;
  displayEndDate?: string;
  displayEndTime?: string;
  cancellable: boolean;
  modifiable: boolean;
  multipleExperiences: boolean;
  guests: {
    id: string;
    bookingId: string;
    entitlementId: string;
    redemptionsRemaining?: number;
    redemptionsAllowed?: number;
  }[];
  showStartDateTime?: string;
  showEndDateTime?: string;
}

interface ReservationItem {
  id: string;
  type: 'DINING' | 'ACTIVITY';
  startDateTime: string;
  guests: { id: string }[];
  asset: string;
}

export interface BoardingGroupItem {
  id: string;
  type: 'VIRTUAL_QUEUE_POSITION';
  status: 'IN_PROGRESS' | 'SUMMONED' | 'EXPIRED' | 'RELEASED' | 'OTHER';
  startDateTime: string;
  boardingGroup: { id: number };
  guests: { id: string }[];
  asset: string;
}

interface Profile {
  id: string;
  name: { firstName: string; lastName: string };
  avatarId: string;
  type: 'registered' | 'transactional';
}

interface ItineraryResponse {
  loggedInGuestId: string;
  assets: { [id: string]: Asset | undefined };
  items: (
    | FastPassItem
    | ReservationItem
    | BoardingGroupItem
    | { type: undefined }
  )[];
  profiles: { [id: string]: Profile };
}

export function isLLMP(booking: Booking): booking is LLMP {
  return booking.type === 'LL' && booking.subtype === 'MP';
}

/**
 * A Multiple Experiences Pass: the anytime, pick-one-of-several pass Disney
 * issues when an attraction you hold goes down.
 *
 * Recognised by `choices`, which only the multipleExperiences branch of the
 * itinerary parser sets. Worth telling apart from an ordinary reservation: it
 * carries no return window to improve, and giving one up for a timed pass is
 * a downgrade however the two rank.
 */
export function isMultipleExperiences(booking: Booking): boolean {
  return !!booking.choices?.length;
}

export function isDAS(booking: Booking): booking is DasBooking {
  return booking.type === 'DAS' && booking.subtype === 'IN_PARK';
}

export const FALLBACK_EXPS = {
  WDW: { id: '80010110', park: { id: '80007944' } },
} as const;

const RES_TYPES = new Set(['ACTIVITY', 'DINING']);

const typelessId = (id: string) => id.split(';')[0]!;

export class ItineraryClient extends ApiClient {
  onRefresh: (bookings: Booking[]) => void = () => {};
  onUnauthorized = () => {};

  async plans(): Promise<Booking[]> {
    const { swid } = authStore.getData();
    const today = DateTime.now().date;
    const parkDay = parkDate();
    const itineraryApiName = RESORT_TO_ITINERARY_API_NAME[this.resort.id];
    const {
      data: { loggedInGuestId = '', items = [], assets = {}, profiles = {} },
    } = await this.request<ItineraryResponse>({
      path: `/plan/${itineraryApiName}/api/v1/itinerary-items/${swid}?item-types=FASTPASS&item-types=DINING&item-types=ACTIVITY&item-types=VIRTUAL_QUEUE_POSITION`,
      params: {
        destination: this.resort.id,
        fields: 'items,profiles,assets,loggedInGuestId',
        'guest-locators': swid + ';type=swid',
        'guest-locator-groups': 'MY_FAMILY',
        'start-date': today,
        'show-friends': 'false',
      },
      ignoreUnauth: 'itinerary-refresh',
    });
    const primaryGuestId = typelessId(loggedInGuestId);

    const getGuest = (g: ReservationItem['guests'][0]) => {
      const { name, avatarId, type } = profiles[g.id]!;
      const id = typelessId(g.id);
      return {
        id,
        name: `${name.firstName ?? ''} ${name.lastName ?? ''}`.trim(),
        avatarImageUrl: avatarUrl(avatarId),
        primary: id === primaryGuestId,
        ...(type === 'transactional' && { transactional: true }),
      };
    };

    const earliestRes = new Date();
    earliestRes.setMinutes(earliestRes.getMinutes() - RES_EXPIRATION_MINUTES);

    const getReservation = (item: ReservationItem) => {
      const activityAsset = assets[item.asset];
      if (!activityAsset) return;
      const facilityAsset = assets[activityAsset.facility];
      if (!facilityAsset) return;
      const parkIdStr = facilityAsset.location ?? '';
      const park = this.park(parkIdStr);
      const land = {
        name: (assets[facilityAsset.land ?? ''] ?? {}).name ?? '',
        park,
        sort: 0,
        color: '',
        theme: { bg: '', text: '', color: '' },
      };
      const parkAsset = assets[parkIdStr];
      if (park.name === '' && parkIdStr && parkAsset) {
        park.name = parkAsset.name;
      }
      const start = new Date(item.startDateTime);
      if (start < earliestRes) return;
      const res: Reservation = {
        type: 'RES',
        subtype: item.type,
        facilityId: typelessId(activityAsset.facility),
        land,
        park,
        name: activityAsset.name,
        start: DateTime.from(start),
        guests: item.guests
          .map(getGuest)
          .sort(
            (a, b) =>
              +b.primary - +a.primary ||
              +!b.transactional - +!a.transactional ||
              a.name.localeCompare(b.name)
          ),
        id: typelessId(item.id),
      };
      return res;
    };

    const getFastPass = (item: FastPassItem) => {
      const expAsset = assets[item.facility];
      const guestIds = new Set();
      return {
        ...this.experienceData(
          item.facility,
          expAsset?.location,
          expAsset?.name
        ),
        start:
          (item.displayStartDate ?? today) < parkDay
            ? { date: parkDay }
            : item.displayStartTime
              ? DateTime.from(
                  `${item.displayStartDate ?? today}T${item.displayStartTime}`
                )
              : { date: item.displayStartDate ?? today },
        end: item.displayEndTime
          ? DateTime.from(`${item.displayEndDate}T${item.displayEndTime}`)
          : item.displayEndDate
            ? { date: item.displayEndDate }
            : undefined,
        guests: item.guests
          .filter(g => {
            if (guestIds.has(g.id)) return false;
            if (g.redemptionsRemaining === 0) return false;
            guestIds.add(g.id);
            return true;
          })
          .map(g => ({
            ...getGuest(g),
            entitlementId: g.entitlementId,
            bookingId: g.bookingId,
            ...(g.redemptionsRemaining !== undefined && {
              redemptions: Math.min(
                g.redemptionsRemaining,
                g.redemptionsAllowed ?? 1
              ),
            }),
          })),
        id: typelessId(item.id),
      };
    };

    const getLightningLane = (item: FastPassItem) => {
      const subtype =
        ({ FLEX: 'MP', STANDARD: 'SP', OTHER: 'OTHER' } as const)[item.kind] ??
        'OTHER';
      const isMP = subtype === 'MP';
      let booking: LightningLane = {
        type: 'LL',
        subtype,
        ...getFastPass(item),
        cancellable: item.cancellable && isMP,
        modifiable: item.modifiable && isMP,
      };
      if (item.showStartDateTime && item.showEndDateTime) {
        booking.showTimeInfo = {
          showStartTime: DateTime.from(item.showStartDateTime).time,
          showEndTime: DateTime.from(item.showEndDateTime).time,
        };
      }
      if (item.multipleExperiences) {
        const origAsset = item.assets.find(a => a.original);
        booking = {
          ...booking,
          ...(origAsset
            ? this.experienceData(
                origAsset.content,
                assets[origAsset.content]?.location
              )
            : { facilityId: '', name: '' }),
        };
        booking.choices = item.assets
          .filter(a => !a.excluded && !a.original)
          .map(({ content }) => {
            const { name, location } = assets[content] ?? {};
            const { experience } = this.experienceData(content, location, name);
            return experience;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
      }
      return booking;
    };

    const getDasSelection = (item: FastPassItem): DasBooking => {
      const kindToSubtype = { DAS: 'IN_PARK', FDS: 'ADVANCE' } as const;
      const subtype = kindToSubtype[item.kind as 'DAS' | 'FDS'];
      const inPark = subtype === 'IN_PARK';
      return {
        type: 'DAS',
        subtype,
        cancellable: item.cancellable && inPark,
        ...(getFastPass(item) as ReturnType<typeof getFastPass> & {
          start: DasBooking['start'];
        }),
      };
    };

    const getBoardingGroup = (
      item: BoardingGroupItem
    ): BoardingGroup | undefined => {
      const vqAsset = assets[item.asset];
      if (!vqAsset) return;
      const facilityAsset = assets[vqAsset.facility];
      if (!facilityAsset) return;
      const exp = this.experienceData(
        vqAsset.facility,
        facilityAsset.location,
        vqAsset.name
      );
      if (exp.park.name === '') exp.park.name = facilityAsset.name;
      return {
        ...exp,
        type: 'BG',
        boardingGroup: item.boardingGroup.id,
        status: item.status,
        start: { date: DateTime.from(item.startDateTime).date },
        guests: item.guests.map(getGuest),
        id: typelessId(item.id),
      };
    };

    const getParkPass = (item: FastPassItem): ParkPass | undefined => {
      const park = this.park(assets[item.facility]?.location ?? item.facility);
      if (!park) return;
      return {
        type: 'APR',
        facilityId: park.id,
        name: park.name,
        park,
        start: { date: item.displayStartDate! },
        guests: item.guests.map(getGuest),
        id: typelessId(item.id),
      };
    };

    const kindToFunc: {
      [key: string]:
        | ((item: FastPassItem) => ParkPass | undefined)
        | ((item: FastPassItem) => DasBooking)
        | undefined;
    } = {
      PARK_PASS: getParkPass,
      DAS: getDasSelection,
      FDS: getDasSelection,
    };
    const typeOrder = { APR: 0, BG: 1, DAS: 2, RES: 3, LL: 4 };
    const bookings = items
      .map(item => {
        try {
          if (item.type === 'FASTPASS') {
            return (kindToFunc[item.kind] ?? getLightningLane)(item);
          } else if (item.type === 'VIRTUAL_QUEUE_POSITION') {
            return getBoardingGroup(item);
          } else if (item.type && RES_TYPES.has(item.type)) {
            return getReservation(item);
          }
        } catch (error) {
          console.error(error);
        }
      })
      .filter((booking): booking is Booking => !!booking)
      .sort((a, b) => {
        const ast = a.start;
        const bst = b.start;
        return (
          (ast.date < bst.date ? -1 : ast.date > bst.date ? 1 : 0) ||
          +(ast.time ?? -1) - +(bst.time ?? -1) ||
          (a.type !== b.type && typeOrder[a.type] - typeOrder[b.type]) ||
          a.name.localeCompare(b.name) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        );
      });
    this.onRefresh(bookings);
    return bookings;
  }

  protected experienceData(
    id: string,
    parkId?: string,
    name: string = 'Experience'
  ) {
    id = typelessId(id);
    let exp: Experience;
    try {
      exp = this.resort.experience(id);
    } catch (error) {
      if (!(error instanceof InvalidId && parkId)) throw error;
      const park = this.park(parkId);
      const land = {
        name: '',
        sort: 0,
        color: '',
        theme: { bg: '', text: '', color: '' },
        park,
      };
      exp = { id, name, park, land, type: 'A', unlisted: true };
    }
    return {
      facilityId: id,
      name: exp.name,
      land: exp.land,
      park: exp.park,
      experience: exp,
    };
  }

  protected park(id: string): Park {
    id = typelessId(id);
    try {
      return this.resort.park(id);
    } catch (error) {
      if (error instanceof InvalidId) {
        return {
          id,
          name: '',
          icon: '',
          geo: { n: 0, s: 0, e: 0, w: 0 },
          color: '',
          theme: DEFAULT_THEME,
          dropTimes: [],
          dropSchedule: new Map(),
        };
      }
      throw error;
    }
  }
}
