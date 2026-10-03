/*
 * Autopilot after an answer it never got, or a refusal it did.
 *
 * 1.8.3 held every booking whose answer was lost as an unresolved change,
 * which nothing but a person could clear, and counted Disney's 403 and 429 as
 * unknown. Either froze the attraction for the day: a booking that had landed
 * could not be moved, and a refused one could not be tried again by hand.
 */
import { use } from 'react';

import {
  createBooking,
  offer as fixtureOffer,
  hm,
  mickey,
  mk,
} from '@/__fixtures__/ll';
import { RequestError } from '@/api/client';
import type { RequestControl } from '@/api/client';
import type { Booking, LLMP } from '@/api/itinerary';
import type { Guest } from '@/api/ll';
import { quarantinedMutations } from '@/autopilot/lease';
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

beforeEach(() => {
  localStorage.clear();
  setTime('09:00:00');
  saveSavedPartyIds([mickey.id]);
});

const experience = {
  ...hm,
  id: '80010114',
  name: 'Buzz',
  priority: 0.5,
  tier: undefined,
  flex: { available: true as const, nextAvailableTime: new ParkTime(11) },
};

/**
 * Autopilot with book-then-move on one attraction. `respond` decides what the
 * n-th `/book` request does; the tip board shows `tip.time`.
 */
function setup(
  respond: (n: number, send: () => LLMP) => LLMP,
  plans: { current: Booking[] } = { current: [] }
) {
  const tip = { time: new ParkTime(11) };
  const offerCalls: { booking?: string; time: string }[] = [];
  const offer = jest.fn(
    async (e: any, requested: Guest[], options: { booking?: LLMP }) => {
      offerCalls.push({
        booking: options?.booking?.facilityId,
        time: String(tip.time),
      });
      return {
        ...fixtureOffer,
        experience: e,
        start: new DateTime(TODAY, tip.time),
        end: new DateTime(TODAY, tip.time.add({ hours: 1 })),
        itinerary: [],
        booking: options?.booking,
        guests: { eligible: requested, ineligible: [] },
      };
    }
  );
  let calls = 0;
  const book = jest.fn(
    async (o: any, _g: unknown, control?: RequestControl) => {
      const send = async () => {
        control?.onDispatch?.();
        return respond(calls++, () =>
          createBooking(experience as any, {
            guests: o.guests.eligible,
            startTime: o.start.time,
          })
        );
      };
      return control?.start ? control.start(send) : send();
    }
  );
  saveWatchList([
    {
      experienceId: experience.id,
      parkId: mk.id,
      date: TODAY,
      bookThenMove: true,
      after: new ParkTime(9),
      before: new ParkTime(10, 30),
    },
  ]);
  render(
    <ClientsContext
      value={
        {
          ll: {
            guests: jest.fn(async () => ({
              eligible: [mickey],
              ineligible: [],
            })),
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
              pollExperiences: async () => [
                {
                  ...experience,
                  flex: {
                    available: true as const,
                    nextAvailableTime: tip.time,
                  },
                },
              ],
              refreshExperiences: () => {},
              loaderElem: null,
            }}
          >
            <PlansContext
              value={{
                plans: [],
                pollPlans: async () => plans.current,
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
  return { tip, offerCalls, book };
}

async function start() {
  await act(async () => {
    click('Start');
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5_000);
  });
}

const lost = () =>
  new RequestError(
    { ok: false, status: 0, data: undefined } as any,
    'Request failed',
    '/book'
  );

it('moves a booking whose answer was lost once Plans show it landed', async () => {
  const plans = { current: [] as Booking[] };
  const { tip, offerCalls, book } = setup((n, send) => {
    if (n > 0) return send();
    // Disney applied it, but the response was lost.
    plans.current = [
      createBooking(experience as any, {
        guests: [mickey],
        startTime: new ParkTime(11),
      }),
    ];
    throw lost();
  }, plans);
  await start();
  // Not held as an unresolved change: the ledger's doubt-hold covers it.
  expect(quarantinedMutations()).toEqual([]);
  // A much better time inside the window appears later.
  tip.time = new ParkTime(9, 30);
  for (let i = 0; i < 40 && book.mock.calls.length < 2; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
  }
  expect(book).toHaveBeenCalledTimes(2);
  expect(offerCalls.at(-1)).toEqual({
    booking: experience.id,
    time: '09:30:00',
  });
});

it.each([403, 429])(
  'leaves no unresolved change after a %d on the booking',
  async status => {
    setup(() => {
      throw new RequestError(
        { ok: false, status, data: undefined } as any,
        'Refused',
        '/book'
      );
    });
    await start();
    expect(quarantinedMutations()).toEqual([]);
  }
);

it('still protects a move whose answer was lost', async () => {
  const held = createBooking(experience as any, {
    guests: [mickey],
    startTime: new ParkTime(11),
  });
  const { tip } = setup(
    () => {
      throw lost();
    },
    { current: [held] }
  );
  tip.time = new ParkTime(9, 30);
  await start();
  expect(quarantinedMutations()).toEqual([
    expect.objectContaining({ kind: 'modify', facilityId: experience.id }),
  ]);
});
