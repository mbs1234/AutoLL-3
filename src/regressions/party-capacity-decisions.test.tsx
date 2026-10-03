/*
 * Capacity decisions after 1.8.3's per-guest counting: one fullness rule for
 * the choice between booking and swapping and for the swap itself, counted
 * over the guests who would actually be booked. Each case is one a review of
 * 1.8.3 reproduced: a swap a full party needed and never got, or a booking for
 * people the rules should have left alone.
 */
import { use } from 'react';

import {
  createBooking,
  offer as fixtureOffer,
  hm,
  jc,
  mickey,
  minnie,
  mk,
  pluto,
  sm,
} from '@/__fixtures__/ll';
import type { RequestControl } from '@/api/client';
import type { Booking, LLMP } from '@/api/itinerary';
import type { Guest } from '@/api/ll';
import { loadSettings, saveSettings } from '@/autopilot/storage';
import { saveWatchList } from '@/autopilot/watchlist';
import AutopilotContext from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import { DateTime, ParkTime } from '@/datetime';
import AutopilotProvider from '@/providers/AutopilotProvider';
import { saveSavedPartyIds } from '@/savedParty';
import { TODAY, act, click, render, setTime } from '@/testing';

jest.mock('@/timesync');
jest.mock('@/autopilot/alert', () => ({
  alertPermission: () => 'granted',
  requestAlertPermission: async () => 'granted',
  primeAudio: jest.fn(),
  rearmAudio: jest.fn(),
  fireAlert: jest.fn(),
}));

function Start() {
  const pilot = use(AutopilotContext);
  return (
    <>
      <button onClick={() => pilot.setEnabled(true)}>Start</button>
      <span data-testid="skip">{pilot.lastSkip?.reason}</span>
    </>
  );
}

const donald: Guest = {
  id: 'donald',
  name: 'Donald Duck',
  ineligibleReason: 'INVALID_PARK_ADMISSION',
};

function setup({
  plans = [] as Booking[],
  eligibleGuests = [mickey] as Guest[],
  ineligibleGuests = [] as Guest[],
  autoSwap = false,
}) {
  const experience = {
    ...hm,
    id: '80010114',
    name: 'Buzz',
    priority: 0.5,
    tier: undefined,
    flex: { available: true as const, nextAvailableTime: new ParkTime(11) },
  };
  const offered = {
    ...fixtureOffer,
    experience,
    start: new DateTime(TODAY, new ParkTime(11)),
    end: new DateTime(TODAY, new ParkTime(12)),
    itinerary: [],
  };
  const guests = jest.fn(async () => ({
    eligible: eligibleGuests,
    ineligible: ineligibleGuests,
  }));
  const offerCalls: { guests: string[]; booking?: string }[] = [];
  const offer = jest.fn(
    async (
      _experience: unknown,
      requested: Guest[],
      options: { booking?: LLMP }
    ) => {
      offerCalls.push({
        guests: requested.map(g => g.id),
        booking: options?.booking?.facilityId,
      });
      return {
        ...offered,
        booking: options?.booking,
        guests: { eligible: requested, ineligible: [] },
      };
    }
  );
  const book = jest.fn(
    async (o: any, _g: unknown, control?: RequestControl) => {
      const send = async () => {
        control?.onDispatch?.();
        return createBooking(experience as any, {
          guests: o.guests.eligible,
        });
      };
      return control?.start ? control.start(send) : send();
    }
  );
  saveWatchList([
    {
      experienceId: experience.id,
      parkId: mk.id,
      date: TODAY,
      autoBook: !autoSwap,
      autoSwap,
      before: new ParkTime(12),
    },
  ]);
  const view = render(
    <ClientsContext
      value={
        {
          ll: {
            guests,
            offer,
            book,
            setPartyIds: jest.fn(),
            nextBookTimes: [],
            experienced: () => false,
          },
        } as unknown as Clients
      }
    >
      <BookingDateContext
        value={{ bookingDate: TODAY, setBookingDate: () => {} }}
      >
        <ParkContext value={{ park: mk, setPark: () => {} }}>
          <ExperiencesContext
            value={{
              experiences: [experience],
              pollExperiences: async () => [experience],
              refreshExperiences: () => {},
              loaderElem: null,
            }}
          >
            <PlansContext
              value={{
                plans,
                pollPlans: async () => plans,
                refreshPlans: () => {},
                loaderElem: null,
              }}
            >
              <AutopilotProvider rapid>
                <Start />
              </AutopilotProvider>
            </PlansContext>
          </ExperiencesContext>
        </ParkContext>
      </BookingDateContext>
    </ClientsContext>
  );
  return { guests, offer, book, offerCalls, view };
}

beforeEach(() => {
  localStorage.clear();
  setTime('09:00:00');
});

async function run() {
  await act(async () => {
    click('Start');
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5_000);
  });
}

const skip = () => document.querySelector('[data-testid="skip"]')?.textContent;

// Parent/child shape: the child (minnie) lacks one pass the adults hold.
const mixed = () => [
  createBooking(hm, { guests: [mickey, minnie] }),
  createBooking(jc, { guests: [mickey, minnie], startTime: new ParkTime(13) }),
  createBooking(sm, { guests: [mickey], startTime: new ParkTime(15) }),
];

const full = (guests: Guest[]) => [
  createBooking(hm, { guests }),
  createBooking(jc, { guests, startTime: new ParkTime(13) }),
  createBooking(sm, { guests, startTime: new ParkTime(15) }),
];

/** One swap, for the whole group, giving up a pass every one of them holds. */
function expectSwapForAll(
  offerCalls: { guests: string[]; booking?: string }[],
  book: jest.Mock,
  ids: string[]
) {
  expect(offerCalls).toHaveLength(1);
  expect(offerCalls[0]!.booking).toBeDefined();
  expect(offerCalls[0]!.guests.sort()).toEqual([...ids].sort());
  expect(book).toHaveBeenCalledTimes(1);
}

describe('the swap a full group needs', () => {
  it('swaps for a parent and child holding uneven passes, whole party on', async () => {
    saveSavedPartyIds([mickey.id, minnie.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: true });
    const { offerCalls, book } = setup({
      plans: mixed(),
      eligibleGuests: [mickey, minnie],
      autoSwap: true,
    });
    await run();
    expectSwapForAll(offerCalls, book, [mickey.id, minnie.id]);
    // A pass both hold, so both move onto the new ride together.
    expect([hm.id, jc.id]).toContain(offerCalls[0]!.booking);
  });

  it('swaps for both with whole party off too, rather than booking the child alone', async () => {
    saveSavedPartyIds([mickey.id, minnie.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: false });
    const { offerCalls, book } = setup({
      plans: mixed(),
      eligibleGuests: [mickey, minnie],
      autoSwap: true,
    });
    await run();
    expectSwapForAll(offerCalls, book, [mickey.id, minnie.id]);
  });

  it('swaps when a linked guest with no ticket today holds nothing', async () => {
    saveSavedPartyIds([]);
    saveSettings({ ...loadSettings(), requireWholeParty: false });
    const { offerCalls, book } = setup({
      plans: full([mickey, minnie]),
      eligibleGuests: [mickey, minnie],
      ineligibleGuests: [donald],
      autoSwap: true,
    });
    await run();
    expectSwapForAll(offerCalls, book, [mickey.id, minnie.id]);
  });

  it('rehearses that swap in dry run, not a booking', async () => {
    saveSavedPartyIds([]);
    saveSettings({
      ...loadSettings(),
      requireWholeParty: false,
      dryRun: true,
    });
    const { offerCalls, book } = setup({
      plans: full([mickey, minnie]),
      eligibleGuests: [mickey, minnie],
      ineligibleGuests: [donald],
      autoSwap: true,
    });
    await run();
    expect(offerCalls).toHaveLength(0);
    expect(book).not.toHaveBeenCalled();
    const { loadBookingLog } = await import('@/autopilot/storage');
    expect(loadBookingLog()).toEqual([
      expect.objectContaining({ status: 'dry-run', detail: 'swap' }),
    ]);
  });

  it('swaps when a saved member without a Multi Pass holds nothing', async () => {
    saveSavedPartyIds([mickey.id, minnie.id, pluto.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: false });
    const { offerCalls, book } = setup({
      plans: full([mickey, minnie]),
      eligibleGuests: [mickey, minnie],
      ineligibleGuests: [{ ...pluto, ineligibleReason: 'MULTI_PASS_NEEDED' }],
      autoSwap: true,
    });
    await run();
    expectSwapForAll(offerCalls, book, [mickey.id, minnie.id]);
  });

  it('swaps a uniformly full party of three', async () => {
    saveSavedPartyIds([mickey.id, minnie.id, pluto.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: true });
    const { offerCalls, book } = setup({
      plans: full([mickey, minnie, pluto]),
      eligibleGuests: [mickey, minnie, pluto],
      autoSwap: true,
    });
    await run();
    expectSwapForAll(offerCalls, book, [mickey.id, minnie.id, pluto.id]);
  });

  it('swaps when the victim also carries a guest outside the party', async () => {
    saveSavedPartyIds([mickey.id, minnie.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: true });
    const { offerCalls, book } = setup({
      plans: full([mickey, minnie, pluto]),
      eligibleGuests: [mickey, minnie],
      ineligibleGuests: [{ ...pluto, ineligibleReason: 'NOT_IN_PARTY' }],
      autoSwap: true,
    });
    await run();
    expectSwapForAll(offerCalls, book, [mickey.id, minnie.id]);
  });
});

describe('booking with free slots', () => {
  it('books a party of three holding two passes each', async () => {
    saveSavedPartyIds([mickey.id, minnie.id, pluto.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: true });
    const { offerCalls, book } = setup({
      plans: full([mickey, minnie, pluto]).slice(0, 2),
      eligibleGuests: [mickey, minnie, pluto],
    });
    await run();
    expect(offerCalls).toEqual([
      { guests: [mickey.id, minnie.id, pluto.id], booking: undefined },
    ]);
    expect(book).toHaveBeenCalledTimes(1);
  });

  it("does not let another person's three passes fill the party's slots", async () => {
    saveSavedPartyIds([mickey.id, minnie.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: true });
    const { offerCalls, book } = setup({
      plans: full([pluto]),
      eligibleGuests: [mickey, minnie],
      ineligibleGuests: [{ ...pluto, ineligibleReason: 'NOT_IN_PARTY' }],
    });
    await run();
    expect(offerCalls).toEqual([
      { guests: [mickey.id, minnie.id], booking: undefined },
    ]);
    expect(book).toHaveBeenCalledTimes(1);
  });

  it('books only the guest with a slot when whole party is off and no swap is wanted', async () => {
    saveSavedPartyIds([mickey.id, minnie.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: false });
    const { offerCalls, book } = setup({
      plans: mixed(),
      eligibleGuests: [mickey, minnie],
    });
    await run();
    expect(offerCalls).toEqual([{ guests: [minnie.id], booking: undefined }]);
    expect(book).toHaveBeenCalledTimes(1);
  });

  it('books nobody when whole party is on, someone is full and no swap is wanted', async () => {
    saveSavedPartyIds([mickey.id, minnie.id]);
    saveSettings({ ...loadSettings(), requireWholeParty: true });
    const { offerCalls, book } = setup({
      plans: mixed(),
      eligibleGuests: [mickey, minnie],
    });
    await run();
    expect(offerCalls).toHaveLength(0);
    expect(book).not.toHaveBeenCalled();
    expect(skip()).toBe('slots-full');
  });

  // Codex's rule, kept: a saved guest Disney does not return cannot be
  // confirmed, so whole party refuses. Plan Check and Party Selection now say
  // so, and saving the party drops the guest.
  it('refuses a whole party whose saved guest Disney no longer returns', async () => {
    saveSavedPartyIds([mickey.id, minnie.id, 'stale-id']);
    saveSettings({ ...loadSettings(), requireWholeParty: true });
    const { book } = setup({ eligibleGuests: [mickey, minnie] });
    await run();
    expect(book).not.toHaveBeenCalled();
    expect(skip()).toBe('partial-party');
  });
});
