import { use } from 'react';

import {
  booking,
  createBooking,
  offer as fixtureOffer,
  hm,
  jc,
  mickey,
  minnie,
  mk,
  sm,
} from '@/__fixtures__/ll';
import type { RequestControl } from '@/api/client';
import type { Booking } from '@/api/itinerary';
import type { Guest } from '@/api/ll';
import {
  chooseSwapVictim,
  shouldSwap,
  slotOccupancy,
} from '@/autopilot/autoswap';
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
import { PARTY_IDS_KEY, saveSavedPartyIds } from '@/savedParty';
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
      <span>{pilot.lastSkip?.reason}</span>
    </>
  );
}

function setup({
  plans = [] as Booking[],
  preDispatch = Promise.resolve(),
  offeredHour = 11,
  eligibleGuests = [mickey] as Guest[],
} = {}) {
  const experience = {
    ...hm,
    id: '80010114',
    name: 'Buzz',
    flex: { available: true as const, nextAvailableTime: new ParkTime(11) },
  };
  const offered = {
    ...fixtureOffer,
    experience,
    start: new DateTime(TODAY, new ParkTime(offeredHour)),
    end: new DateTime(TODAY, new ParkTime(offeredHour + 1)),
    itinerary: [],
    guests: { eligible: [mickey], ineligible: [] },
  };
  const guests = jest.fn(async () => ({
    eligible: eligibleGuests,
    ineligible: [],
  }));
  const offer = jest.fn(async (_experience: unknown, requested: Guest[]) => ({
    ...offered,
    guests: { eligible: requested, ineligible: [] },
  }));
  const sent = jest.fn();
  const setPartyIds = jest.fn();
  const book = jest.fn(
    async (_o: unknown, _g: unknown, control?: RequestControl) => {
      await preDispatch;
      const send = async () => {
        control?.onDispatch?.();
        sent();
        return { ...booking, facilityId: experience.id, experience };
      };
      return control?.start ? control.start(send) : send();
    }
  );
  saveWatchList([
    {
      experienceId: experience.id,
      parkId: mk.id,
      date: TODAY,
      autoBook: true,
      before: new ParkTime(12),
    },
  ]);
  render(
    <ClientsContext
      value={
        {
          ll: {
            guests,
            offer,
            book,
            setPartyIds,
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
  return { guests, offer, book, sent, setPartyIds };
}

beforeEach(() => {
  localStorage.clear();
  setTime('09:00:00');
  saveSavedPartyIds([mickey.id]);
});

test.each([false, true])(
  'all-guests mode respects mixed capacity with whole-party=%s',
  async whole => {
    saveSavedPartyIds([]);
    saveSettings({ ...loadSettings(), requireWholeParty: whole });
    const plans = [hm, jc, sm].map(e => createBooking(e, { guests: [minnie] }));
    const { book } = setup({ plans, eligibleGuests: [mickey, minnie] });
    await act(async () => {
      click('Start');
    });
    expect(book).toHaveBeenCalledTimes(whole ? 0 : 1);
  }
);

test('three records split across people do not fill either person', () => {
  const held = [
    createBooking(hm, { guests: [mickey] }),
    createBooking(jc, { guests: [mickey] }),
    createBooking(sm, { guests: [minnie] }),
  ];
  expect(slotOccupancy(held)).toEqual(
    new Map([
      [mickey.id, 2],
      [minnie.id, 1],
    ])
  );
  expect(
    shouldSwap(
      { experienceId: 'new', autoSwap: true },
      { ...hm, id: 'new' },
      held,
      { hasAttempted: () => false }
    )
  ).toEqual({ ok: false, reason: 'not-full' });
});

test('pending commits occupy only their own guests and do not double-count Plans', () => {
  const held = [createBooking(hm, { guests: [mickey] })];
  expect(
    slotOccupancy(held, [
      {
        facilityId: hm.id,
        time: '11:00:00',
        kind: 'book',
        guestIds: [mickey.id],
      },
      {
        facilityId: jc.id,
        time: '11:00:00',
        kind: 'book',
        guestIds: [minnie.id],
      },
    ])
  ).toEqual(
    new Map([
      [mickey.id, 1],
      [minnie.id, 1],
    ])
  );
});

test('a swap victim must cover every affected guest', () => {
  const held = [createBooking(hm, { guests: [minnie] })];
  expect(
    chooseSwapVictim(held, { ...jc, priority: 0 }, [mickey.id])
  ).toBeUndefined();
});

test('whole-party policy rejects eligibility that silently omits a selected guest', async () => {
  saveSavedPartyIds([mickey.id, minnie.id]);
  saveSettings({ ...loadSettings(), requireWholeParty: true });
  const { book } = setup();
  await act(async () => {
    click('Start');
  });
  expect(book).not.toHaveBeenCalled();
});

test('cross-tab party changes invalidate prepared transport work', async () => {
  let release!: () => void;
  const preDispatch = new Promise<void>(resolve => {
    release = resolve;
  });
  const { book, sent, setPartyIds } = setup({ preDispatch });
  await act(async () => {
    click('Start');
  });
  expect(book).toHaveBeenCalledTimes(1);
  await act(async () => {
    localStorage.setItem(PARTY_IDS_KEY, JSON.stringify([minnie.id]));
    window.dispatchEvent(new StorageEvent('storage', { key: PARTY_IDS_KEY }));
    release();
  });
  expect(setPartyIds).toHaveBeenLastCalledWith([minnie.id]);
  expect(sent).not.toHaveBeenCalled();
});

test('another guest holding three passes must not make the selected guest full', async () => {
  const plans = [hm, jc, sm].map(e => createBooking(e, { guests: [minnie] }));
  const { book } = setup({ plans });
  await act(async () => {
    click('Start');
  });
  expect(book.mock.calls.length).toBe(1);
});

test('changing the selected party before dispatch must invalidate the in-flight action', async () => {
  let release!: () => void;
  const preDispatch = new Promise<void>(resolve => {
    release = resolve;
  });
  const { book, sent, setPartyIds } = setup({ preDispatch });
  await act(async () => {
    click('Start');
  });
  expect(book.mock.calls.length).toBe(1);
  await act(async () => {
    setPartyIds([minnie.id]);
    saveSavedPartyIds([minnie.id]);
    release();
  });
  expect(sent.mock.calls.length).toBe(0);
});

test('changing the selected party must invalidate cached eligibility', async () => {
  const { guests, offer, setPartyIds } = setup({ offeredHour: 15 });
  await act(async () => {
    click('Start');
  });
  expect(offer.mock.calls.length).toBe(1);
  guests.mockResolvedValue({ eligible: [mickey, minnie], ineligible: [] });
  await act(async () => {
    setPartyIds([mickey.id, minnie.id]);
    saveSavedPartyIds([mickey.id, minnie.id]);
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(offer.mock.calls.length).toBeGreaterThan(1);
  expect(guests.mock.calls.length).toBeGreaterThan(1);
});
