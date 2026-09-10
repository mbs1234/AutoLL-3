import { act, render, screen, waitFor } from '@testing-library/react';
import { use } from 'react';

import { mk, wdw } from '@/__fixtures__/resort';
import { RequestError } from '@/api/client';
import { Booking } from '@/api/itinerary';
import { Experience, FlexExperience } from '@/api/ll';
import { fireAlert, primeAudio } from '@/autopilot/alert';
import {
  CONFIRM_ABSENT_POLLS,
  DEFAULT_ACTIONS_PER_DAY,
  MAX_ACTIONS_PER_DAY,
  REFILL_ACTIONS,
} from '@/autopilot/autobook';
import {
  appendDropEvents,
  loadCoverage,
  loadDropEvents,
} from '@/autopilot/observe';
import { NO_REFUSALS, refusedCalls } from '@/autopilot/refusal';
import {
  BURST_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  syncedParkTime,
} from '@/autopilot/schedule';
import {
  DEFAULT_SETTINGS,
  loadBookingLog,
  loadBudget,
  saveBudget,
  saveSettings,
} from '@/autopilot/storage';
import { releaseScreenAwake, wakeLockHeld } from '@/autopilot/wakelock';
import { loadWatchList, saveWatchList } from '@/autopilot/watchlist';
import AutopilotContext from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import { DateTime, ParkTime } from '@/datetime';
import { TODAY, TOMORROW, setTime } from '@/testing';

import AutopilotProvider, {
  PLANS_EVERY_N_TICKS,
  RETRY_AFTER_MS,
} from './AutopilotProvider';

// An explicit factory rather than an auto-mock: auto-mocking makes
// requestAlertPermission return undefined, and the provider calls .then() on
// it, which throws inside the toggle handler.
jest.mock('@/autopilot/alert', () => ({
  alertPermission: jest.fn(() => 'granted'),
  requestAlertPermission: jest.fn(async () => 'granted'),
  primeAudio: jest.fn(),
  fireAlert: jest.fn(),
}));
jest.mock('@/timesync');
// Pins the clock to the repo's canonical TODAY (see @/testing). The earlier
// version of this file hardcoded a real calendar date and passed only because
// the suite happened to run on that day.
setTime('09:00');

const BZ = '80010114';
const DB = '80010129';

function available(
  id: string,
  time: ParkTime,
  overrides: Partial<FlexExperience> = {}
): FlexExperience {
  return {
    ...wdw.experience(id),
    park: mk,
    standby: { available: true, waitTime: 30 },
    flex: { available: true, nextAvailableTime: time },
    ...overrides,
  } as FlexExperience;
}

/** Exposes the context so tests can drive the toggle and read status. */
function Probe() {
  const {
    enabled,
    setEnabled,
    status,
    targets,
    bookingsRemaining,
    actionBudget,
    refillBudget,
    setMaxActionsPerDay,
    refusals,
    passkeyStatus,
    togglePaused,
    toggleAutoBook,
    setTargetWindow,
    setDryRun,
    setRequireWholeParty,
    lastSkip,
    sessionLog,
  } = use(AutopilotContext);
  return (
    <div>
      <button onClick={() => setEnabled(!enabled)}>toggle</button>
      <button onClick={refillBudget}>refill</button>
      <button onClick={() => togglePaused(BZ)}>pause BZ</button>
      <button onClick={() => toggleAutoBook(BZ)}>unarm BZ</button>
      <button onClick={() => setTargetWindow(BZ, 'before', '11:30')}>
        narrow BZ
      </button>
      <button onClick={() => setMaxActionsPerDay(20)}>raise budget</button>
      <button onClick={() => setDryRun(true)}>dry run on</button>
      <button onClick={() => setRequireWholeParty(true)}>whole party on</button>
      <span data-testid="mode">{status.mode}</span>
      <span data-testid="targets">{targets.length}</span>
      <span data-testid="remaining">{bookingsRemaining}</span>
      <span data-testid="budget">{actionBudget}</span>
      <span data-testid="passkey">{passkeyStatus}</span>
      <span data-testid="lastSkip">
        {lastSkip ? `${lastSkip.name}: ${lastSkip.reason}` : ''}
      </span>
      <span data-testid="sessionLog">{sessionLog.length}</span>
      <span data-testid="refused">
        {refusedCalls(refusals ?? NO_REFUSALS, syncedParkTime()).join(',')}
      </span>
    </div>
  );
}

function setup(
  experiences: Experience[],
  { bookingDate = TODAY }: { bookingDate?: string } = {}
) {
  const pollExperiences = jest.fn(async () => experiences);
  const pollPlans = jest.fn(async () => []);
  render(
    <BookingDateContext value={{ bookingDate, setBookingDate: () => {} }}>
      <ClientsContext
        value={{ ll: { nextBookTimes: [] as ParkTime[] } } as Clients}
      >
        <ParkContext value={{ park: mk, setPark: () => {} }}>
          <ExperiencesContext
            value={{
              experiences: [],
              refreshExperiences: () => {},
              pollExperiences,
              loaderElem: null,
            }}
          >
            <PlansContext
              value={{
                plans: [],
                refreshPlans: () => {},
                pollPlans,
                loaderElem: null,
              }}
            >
              <AutopilotProvider>
                <Probe />
              </AutopilotProvider>
            </PlansContext>
          </ExperiencesContext>
        </ParkContext>
      </ClientsContext>
    </BookingDateContext>
  );
  return { pollExperiences, pollPlans };
}

async function enable() {
  await act(async () => {
    screen.getByText('toggle').click();
  });
}

/**
 * Advance one interval at a time: each tick awaits a chain of polls, an offer
 * and a booking, and a single large jump outruns it.
 */
async function runTicks(count: number, intervalMs = IDLE_INTERVAL_MS) {
  await act(async () => {
    for (let i = 0; i < count; ++i) {
      await jest.advanceTimersByTimeAsync(intervalMs);
    }
  });
}

/**
 * Ticks needed for a booking lock to release, with margin.
 *
 * Any test asserting that something happens *at most once* has to outlast this
 * to mean anything: shorter than it, the assertion holds for the trivial reason
 * that no release window elapsed.
 */
const RELEASE_TICKS = PLANS_EVERY_N_TICKS * (CONFIRM_ABSENT_POLLS + 2);

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

const party = { eligible: [{ id: 'g1', name: 'A' }], ineligible: [] };

function offerAt(hour: number) {
  return {
    id: 'offer-1',
    offerSetId: 'set-1',
    start: new DateTime(TODAY, new ParkTime(hour)),
    end: new DateTime(TODAY, new ParkTime(hour + 1)),
    guests: party,
    itinerary: [],
    booking: undefined,
  };
}

/** A Multi Pass for BZ, as the itinerary would report it. */
function heldBZAt(hour: number, date = TODAY): Booking {
  return {
    type: 'LL',
    subtype: 'MP',
    id: 'ent-1',
    facilityId: BZ,
    name: 'Held',
    start: new DateTime(date, new ParkTime(hour)),
    end: new DateTime(date, new ParkTime(hour + 1)),
    cancellable: true,
    modifiable: true,
    guests: [{ id: 'g1', name: 'A' }],
  } as unknown as Booking;
}

function diningAt(hour: number): Booking {
  return {
    type: 'RES',
    subtype: 'DINING',
    id: 'res-1',
    facilityId: 'rest-1',
    name: 'Dinner',
    start: new DateTime(TODAY, new ParkTime(hour)),
  } as unknown as Booking;
}

function setupBooking({
  offerHour = 11,
  experiences = [available(BZ, new ParkTime(11))],
  plans = [] as Booking[],
  guestsResult = party as unknown,
  // The status `ll.guests` should reject with, for the refusal tests.
  guestsStatus = undefined as number | undefined,
  // Set one of these within BURST_LEAD_S of the pinned 09:00 clock to drive
  // the poller into burst cadence, where plans polls are ~12s apart instead of
  // ~7.5min.
  nextBookTimes = [] as ParkTime[],
  // NextLL's settings: no budget, and a reservation may be moved more than
  // once. Off by default, which is Autopilot.
  repeatMoves = false,
  // Lets a test make `book` fail, and say how. `undefined` succeeds.
  bookErrors = [] as (number | 'no-response' | undefined)[],
  // The same for `offer`. The stage is the point: `offer` runs before the
  // ledger lock is taken and `book` after it, so a failure here is one that
  // provably changed nothing and holds nothing.
  offerErrors = [] as (number | 'no-response' | undefined)[],
  // Ids LLTracker would mark redeemed. The passkey turns on the strategy only
  // after a tap-in, so this is the difference between held and redeemed.
  experiencedIds = [] as string[],
  bookingDate = TODAY,
  // Holds the offer request open, for the gate between offer and book.
  offerDelay = undefined as Promise<void> | undefined,
  // Holds the availability request open, for scope/cancellation tests before
  // any alerting or booking decision has been made.
  experiencesDelay = undefined as Promise<void> | undefined,
} = {}) {
  const guests = jest.fn(async () => {
    if (guestsStatus !== undefined) {
      throw new RequestError({ ok: false, status: guestsStatus, data: {} });
    }
    return guestsResult;
  });
  // Records which attraction was offered, in order -- clearer than indexing
  // into mock.calls, and it keeps the parameter typed and used.
  const offeredIds: string[] = [];
  // Also records the options argument, which is what distinguishes the two
  // paths: a fresh booking passes { date }, a modification passes { booking }.
  const offerOptions: Record<string, unknown>[] = [];
  let offerCalls = 0;
  const offer = jest.fn(
    async (
      experience: { id: string },
      guests: unknown,
      options: Record<string, unknown>
    ) => {
      offeredIds.push(experience.id);
      offerOptions.push(options);
      if (offerDelay) await offerDelay;
      void guests;
      const failure = offerErrors[offerCalls++];
      if (failure === 'no-response') throw new Error('Network request failed');
      if (failure !== undefined) {
        throw new RequestError({ ok: false, status: failure, data: {} });
      }
      return offerAt(offerHour);
    }
  );
  let bookCalls = 0;
  const book = jest.fn(async () => {
    const failure = bookErrors[bookCalls++];
    if (failure === 'no-response') throw new Error('Network request failed');
    if (failure !== undefined) {
      throw new RequestError({ ok: false, status: failure, data: {} });
    }
    return { id: 'ent-1' };
  });
  // Mutable so a test can make a booking appear in the itinerary and later
  // vanish, which is what a real booking followed by a manual cancellation
  // looks like from here. Defaults to the same list the context renders.
  let polled = plans;
  const setPolledPlans = (next: Booking[]) => {
    polled = next;
  };
  const pollPlans = jest.fn(async () => polled);
  const pollExperiences = jest.fn(async () => {
    if (experiencesDelay) await experiencesDelay;
    return experiences;
  });
  function Tree({ date }: { date: string }) {
    return (
      <BookingDateContext
        value={{ bookingDate: date, setBookingDate: () => {} }}
      >
        <ClientsContext
          // Two-step cast: with the jest.Mock members present this no longer
          // merely omits properties from Clients, it conflicts with them.
          value={
            {
              ll: {
                nextBookTimes,
                guests,
                offer,
                book,
                experienced: ({ id }: { id: string }) =>
                  experiencedIds.includes(id),
              },
            } as unknown as Clients
          }
        >
          <ParkContext value={{ park: mk, setPark: () => {} }}>
            <ExperiencesContext
              value={{
                experiences: [],
                refreshExperiences: () => {},
                pollExperiences,
                loaderElem: null,
              }}
            >
              <PlansContext
                value={{
                  plans,
                  refreshPlans: () => {},
                  pollPlans,
                  loaderElem: null,
                }}
              >
                <AutopilotProvider repeatMoves={repeatMoves}>
                  <Probe />
                </AutopilotProvider>
              </PlansContext>
            </ExperiencesContext>
          </ParkContext>
        </ClientsContext>
      </BookingDateContext>
    );
  }
  const view = render(<Tree date={bookingDate} />);

  return {
    guests,
    offer,
    book,
    pollPlans,
    offeredIds,
    offerOptions,
    pollExperiences,
    setPolledPlans,
    /** Move the app onto another booking date, as the LL tab's picker does. */
    setBookingDate: (date: string) => view.rerender(<Tree date={date} />),
  };
}

describe('AutopilotProvider', () => {
  it('polls nothing until enabled', async () => {
    const { pollExperiences } = setup([available(BZ, new ParkTime(11))]);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(pollExperiences).not.toHaveBeenCalled();
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
  });

  // Unlocking audio has to happen inside the gesture that turned it on;
  // doing it later, when a drop lands, produces silence on mobile.
  it('primes audio when switched on', async () => {
    setup([]);
    await enable();
    expect(primeAudio).toHaveBeenCalled();
  });

  it('alerts for a watched experience that is available', async () => {
    saveWatchList([{ experienceId: BZ }]);
    setup([available(BZ, new ParkTime(11, 5))]);
    await enable();
    await waitFor(() => expect(fireAlert).toHaveBeenCalledTimes(1));
    expect(fireAlert).toHaveBeenCalledWith(
      expect.objectContaining({ tag: `autoll3-autopilot-${TODAY}-${BZ}` })
    );
  });

  // Alerting deliberately spans dates, and the tag is what stops a repeat
  // replacing rather than stacking -- so without the date in it, a find for
  // today would silently destroy the notification for a future date's find on
  // the same attraction.
  it('names the date, and keys the alert by it, on a future date', async () => {
    saveWatchList([{ experienceId: BZ }]);
    setup([available(BZ, new ParkTime(11, 5))], { bookingDate: TOMORROW });
    await enable();
    await waitFor(() => expect(fireAlert).toHaveBeenCalledTimes(1));
    expect(fireAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: `autoll3-autopilot-${TOMORROW}-${BZ}`,
        body: expect.stringContaining('on '),
      })
    );
  });

  it('stays silent for an experience that is not watched', async () => {
    saveWatchList([{ experienceId: DB }]);
    setup([available(BZ, new ParkTime(11, 5))]);
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(fireAlert).not.toHaveBeenCalled();
  });

  it('alerts only once while the same offer persists', async () => {
    saveWatchList([{ experienceId: BZ }]);
    setup([available(BZ, new ParkTime(11, 5))]);
    await enable();
    await waitFor(() => expect(fireAlert).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000 * 3);
    });
    expect(fireAlert).toHaveBeenCalledTimes(1);
  });

  // The window governs what autopilot will take, not what it tells you about.
  // Silencing the alert too would hide the one fact worth knowing -- that the
  // ride came back at all -- and leave a screen that says nothing happened.
  it('alerts outside the window but will not book there', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true, after: new ParkTime(15) },
    ]);
    const { offer, book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11, 5))],
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(fireAlert).toHaveBeenCalled();
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  // Plans cost a request and change rarely, so they refresh on a slower
  // cadence than availability.
  it('polls plans less often than experiences', async () => {
    const { pollExperiences, pollPlans } = setup([]);
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000 * (PLANS_EVERY_N_TICKS + 2));
    });
    expect(pollExperiences.mock.calls.length).toBeGreaterThan(
      pollPlans.mock.calls.length
    );
    expect(pollPlans).toHaveBeenCalled();
  });

  // A plans failure must not count against the poller's failure budget or
  // stall availability polling.
  it('keeps polling when plans fail', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const experiences: Experience[] = [];
    const pollExperiences = jest.fn(async () => experiences);
    render(
      <BookingDateContext
        value={{ bookingDate: TODAY, setBookingDate: () => {} }}
      >
        <ClientsContext
          value={
            {
              ll: { nextBookTimes: [] as ParkTime[], experienced: () => false },
            } as unknown as Clients
          }
        >
          <ParkContext value={{ park: mk, setPark: () => {} }}>
            <ExperiencesContext
              value={{
                experiences: [],
                refreshExperiences: () => {},
                pollExperiences,
                loaderElem: null,
              }}
            >
              <PlansContext
                value={{
                  plans: [],
                  refreshPlans: () => {},
                  pollPlans: async () => {
                    throw new Error('plans down');
                  },
                  loaderElem: null,
                }}
              >
                <AutopilotProvider>
                  <Probe />
                </AutopilotProvider>
              </PlansContext>
            </ExperiencesContext>
          </ParkContext>
        </ClientsContext>
      </BookingDateContext>
    );
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000 * 3);
    });
    expect(pollExperiences.mock.calls.length).toBeGreaterThan(1);
    expect(screen.getByTestId('mode')).not.toHaveTextContent('stopped');
  });

  it('loads a saved watch list on mount', async () => {
    saveWatchList([{ experienceId: BZ }, { experienceId: DB }]);
    setup([]);
    expect(screen.getByTestId('targets')).toHaveTextContent('2');
  });
});

describe('AutopilotProvider auto-booking', () => {
  it('books a watched attraction that is armed', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });

  // Alerting and booking are deliberately separate decisions.
  it('does not book a watched attraction that is not armed', async () => {
    saveWatchList([{ experienceId: BZ }]);
    const { book, offer } = setupBooking();
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  // The load-bearing guard: matching runs on the tipboard time, but the offer
  // can come back with a later one.
  it('refuses to book an offer outside the window', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true, before: new ParkTime(12) },
    ]);
    const { offer, book } = setupBooking({ offerHour: 20 });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalled());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(book).not.toHaveBeenCalled();
  });

  // December means dining packages, and the manual booking screen only warns
  // about a clash. Autopilot has nobody to warn, so it declines -- and it does
  // so before the offer, which keeps a doomed round trip out of a drop.
  it('will not book on top of an existing reservation', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { offer, book } = setupBooking({ plans: [diningAt(11)] });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  // The advertised time can clear the clash while the offer that comes back
  // does not, so the real time is checked again before anything is committed.
  it('declines an offer that comes back on top of a reservation', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { offer, book } = setupBooking({
      experiences: [available(BZ, new ParkTime(9))],
      offerHour: 11,
      plans: [diningAt(11)],
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalled());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(book).not.toHaveBeenCalled();
  });

  it('books over a reservation when clash avoidance is off', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveSettings({ ...DEFAULT_SETTINGS, avoidOverlaps: false });
    const { book } = setupBooking({ plans: [diningAt(11)] });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });

  it('books at most once per attraction', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000 * 3);
    });
    expect(book).toHaveBeenCalledTimes(1);
  });

  // The lock covers doubt about whether a request landed, not the session.
  // Three minutes is well inside it: releasing takes CONFIRM_ABSENT_POLLS
  // plans polls, and plans are polled every PLANS_EVERY_N_TICKS ticks of a
  // 45-second idle cadence -- fifteen minutes of the reservation being
  // consistently absent.
  it('holds the booking lock until absence is confirmed', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(
        IDLE_INTERVAL_MS * PLANS_EVERY_N_TICKS * CONFIRM_ABSENT_POLLS * 0.5
      );
    });
    expect(book).toHaveBeenCalledTimes(1);
  });

  // Disney allows booking, cancelling and rebooking the same attraction, so a
  // reservation that appears and then disappears should free the attraction.
  it('rebooks once an observed reservation disappears', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, setPolledPlans } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    // The booking lands in the itinerary...
    setPolledPlans([heldBZAt(11)]);
    await runTicks(PLANS_EVERY_N_TICKS + 2);
    // ...and is then cancelled by hand.
    setPolledPlans([]);
    await runTicks(RELEASE_TICKS);
    expect(book.mock.calls.length).toBeGreaterThan(1);
    expect(book.mock.calls.length).toBeLessThanOrEqual(DEFAULT_ACTIONS_PER_DAY);
  });

  // The regression this guards: plans polls are ~24s apart in a drop burst,
  // not the ~15 minutes the idle cadence gives. Releasing on absence alone
  // would rebook a Lightning Lane the itinerary simply had not caught up on
  // yet -- and burn the session cap on one attraction while doing it.
  it('never rebooks a reservation it has not seen in plans', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await runTicks(RELEASE_TICKS * 2);
    expect(book).toHaveBeenCalledTimes(1);
  });

  // The cadence that actually mattered. At BURST_INTERVAL_MS the two plans
  // polls needed to release a lock are ~24 seconds apart, not the ~15 minutes
  // idle gives -- and a drop is exactly when a duplicate booking would cost
  // the most. The clock is pinned to 09:00, so a 09:00:20 target sits inside
  // BURST_LEAD_S and the whole run stays within the 150s burst window.
  it('never rebooks an unseen reservation at burst cadence', async () => {
    // The fake clock is pinned once at module scope, and earlier tests in this
    // file advance it by an hour. Re-pin before rendering so the target below
    // is genuinely 20 seconds out rather than long past.
    setTime('09:00');
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, pollPlans } = setupBooking({
      nextBookTimes: [new ParkTime(9, 0, 20)],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    const pollsAfterBooking = pollPlans.mock.calls.length;
    await runTicks(
      PLANS_EVERY_N_TICKS * CONFIRM_ABSENT_POLLS * 2,
      BURST_INTERVAL_MS
    );
    // Guards the guard. The bug needed CONFIRM_ABSENT_POLLS plans polls to
    // elapse after the booking; asserting they did is what proves this run
    // actually reached the dangerous state rather than merely idling past it.
    expect(
      pollPlans.mock.calls.length - pollsAfterBooking
    ).toBeGreaterThanOrEqual(CONFIRM_ABSENT_POLLS);
    expect(book).toHaveBeenCalledTimes(1);
  });

  it('refreshes plans after booking so the new reservation shows', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, pollPlans } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalled());
    expect(pollPlans.mock.calls.length).toBeGreaterThan(1);
  });

  // Eligibility is the one request in the booking path that does not change
  // second to second, so it is fetched ahead of the moment that matters.
  it('prewarms eligibility for armed targets', async () => {
    saveWatchList([{ experienceId: DB, autoBook: true }]);
    const { guests } = setupBooking({ experiences: [] });
    await enable();
    await waitFor(() => expect(guests).toHaveBeenCalled());
  });

  it('does not prewarm when nothing is armed', async () => {
    saveWatchList([{ experienceId: DB }]);
    const { guests } = setupBooking({ experiences: [] });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(guests).not.toHaveBeenCalled();
  });

  // The first booking constrains what the next can be, so when two armed
  // attractions drop in the same tick the order must not come down to
  // whatever the tipboard happened to list first.
  it('books the higher-priority attraction first', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true },
      { experienceId: DB, autoBook: true },
    ]);
    const { offer, offeredIds } = setupBooking({
      experiences: [
        // Listed worse-first on purpose.
        available(BZ, new ParkTime(11), { priority: 3.1 }),
        available(DB, new ParkTime(11), { priority: 1.0 }),
      ],
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalled());
    expect(offeredIds[0]).toBe(DB);
  });

  // Booking the lesser Tier 1 can consume the party's only Tier 1 selection.
  it('holds the Tier 1 slot for a better armed attraction', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true },
      { experienceId: DB, autoBook: true },
    ]);
    const { offer } = setupBooking({
      experiences: [
        // Available now, but the lesser of the two.
        available(BZ, new ParkTime(11), { tier: 1, priority: 2.3 }),
        // Better, Tier 1, still has a drop ahead -- and not yet available.
        {
          ...available(DB, new ParkTime(11)),
          tier: 1,
          priority: 1.0,
          flex: { available: false },
          dropTimes: [new ParkTime(10)],
        } as FlexExperience,
      ],
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
  });

  // The horizon the hold is bounded by. Tiana's drop list runs to 21:47, so
  // "any drop still ahead today" meant an armed Space Mountain was declined
  // from park open until the first tap-in -- a whole morning holding the
  // Tier 1 slot for a drop eight hours away.
  it('does not hold the Tier 1 slot for a drop hours away', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true },
      { experienceId: DB, autoBook: true },
    ]);
    const { offer, offeredIds } = setupBooking({
      experiences: [
        available(BZ, new ParkTime(11), { tier: 1, priority: 2.3 }),
        {
          ...available(DB, new ParkTime(11)),
          tier: 1,
          priority: 1.0,
          flex: { available: false },
          dropTimes: [new ParkTime(21, 47)],
        } as FlexExperience,
      ],
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalled());
    expect(offeredIds[0]).toBe(BZ);
  });

  // Wait Magic's FAQ: after the party's first redemption of the day the
  // single-Tier-1 limit no longer applies, so there is nothing to hold for.
  it('drops the Tier 1 hold once the party has redeemed today', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true },
      { experienceId: DB, autoBook: true },
    ]);
    const { offer, offeredIds } = setupBooking({
      experiences: [
        available(BZ, new ParkTime(11), { tier: 1, priority: 2.3 }),
        {
          ...available(DB, new ParkTime(11)),
          tier: 1,
          priority: 1.0,
          flex: { available: false },
          dropTimes: [new ParkTime(10)],
        } as FlexExperience,
        // A redeemed attraction: LLTracker marks it experienced.
        // Spread from a real fixture (unknown ids throw InvalidId), then
        // re-id so it does not collide with DB above.
        {
          ...available(DB, new ParkTime(11)),
          id: 'redeemed',
          experienced: true,
        },
      ],
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalled());
    expect(offeredIds[0]).toBe(BZ);
  });

  // Self-releasing, so a held slot cannot deadlock for the rest of the day.
  it('releases the Tier 1 hold once the better drop has passed', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true },
      { experienceId: DB, autoBook: true },
    ]);
    const { offer, offeredIds } = setupBooking({
      experiences: [
        available(BZ, new ParkTime(11), { tier: 1, priority: 2.3 }),
        {
          ...available(DB, new ParkTime(11)),
          tier: 1,
          priority: 1.0,
          flex: { available: false },
          // Already behind us, so there is no longer a reason to wait.
          dropTimes: [new ParkTime(4, 1)],
        } as FlexExperience,
      ],
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalled());
    expect(offeredIds[0]).toBe(BZ);
  });
});

describe('AutopilotProvider auto-move', () => {
  /** An existing Multi Pass reservation for BZ at `hour` on `date`. */
  function heldAt(hour: number, date = TODAY): Booking {
    return {
      type: 'LL',
      subtype: 'MP',
      id: 'ent-1',
      facilityId: BZ,
      name: 'Held',
      start: new DateTime(date, new ParkTime(hour)),
      end: new DateTime(date, new ParkTime(hour + 1)),
      modifiable: true,
      guests: [],
    } as unknown as Booking;
  }

  it('moves an existing reservation to a much better time', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book, offerOptions } = setupBooking({
      offerHour: 11,
      plans: [heldAt(19)],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    // Proves the modify endpoint was used, not a fresh booking: offer() gets
    // the existing reservation rather than a date.
    expect(offerOptions[0]).toHaveProperty('booking');
    expect(offerOptions[0]).not.toHaveProperty('date');
  });

  it('leaves a reservation alone when auto-move is off', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, offer } = setupBooking({ plans: [heldAt(19)] });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  // The failure mode plain booking does not have.
  it('never moves a reservation to a later time', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({ offerHour: 22, plans: [heldAt(19)] });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(book).not.toHaveBeenCalled();
  });

  it('ignores a gain below the threshold', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    // Holding 11:00, offered 10:45 -- only 15 minutes better.
    const { book } = setupBooking({
      offerHour: 10,
      experiences: [available(BZ, new ParkTime(10, 45))],
      plans: [heldAt(11)],
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(book).not.toHaveBeenCalled();
  });

  // Holding a reservation makes a second booking pointless, so the modify
  // path takes precedence even when both toggles are on.
  it('modifies rather than books when a reservation is held', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true, autoModify: true }]);
    const { book } = setupBooking({ offerHour: 11, plans: [heldAt(19)] });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });

  // The itinerary returns future pre-booked selections too. Watching today
  // must not treat tomorrow's reservation as something to improve.
  it('ignores a reservation for a different day', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true, autoModify: true }]);
    const { book, offerOptions } = setupBooking({
      offerHour: 11,
      plans: [heldAt(19, TOMORROW)],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    // Nothing held *today*, so this is a fresh booking, not a modification.
    expect(offerOptions[0]).toHaveProperty('date');
    expect(offerOptions[0]).not.toHaveProperty('booking');
  });

  it('books normally when nothing is held', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true, autoModify: true }]);
    const { book, offerOptions } = setupBooking({ offerHour: 11, plans: [] });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(offerOptions[0]).toHaveProperty('date');
    expect(offerOptions[0]).not.toHaveProperty('booking');
  });
});

describe('AutopilotProvider book-then-move', () => {
  function heldAt(hour: number): Booking {
    return {
      type: 'LL',
      subtype: 'MP',
      id: 'ent-1',
      facilityId: BZ,
      name: 'Held',
      start: new DateTime(TODAY, new ParkTime(hour)),
      end: new DateTime(TODAY, new ParkTime(hour + 1)),
      modifiable: true,
      guests: [],
    } as unknown as Booking;
  }

  // Wait Magic's "start wide, then narrow in": with nothing held, any offered
  // time is taken so the party holds *something*. Plain auto-book with the
  // same window would refuse this offer (covered elsewhere).
  it('books outside the window when nothing is held', async () => {
    saveWatchList([
      { experienceId: BZ, bookThenMove: true, before: new ParkTime(12) },
    ]);
    const { book, offerOptions } = setupBooking({
      offerHour: 19,
      experiences: [available(BZ, new ParkTime(19))],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(offerOptions[0]).toHaveProperty('date');
  });

  // Once something is held, the window becomes the goal for the move.
  it('moves the held reservation into the window', async () => {
    saveWatchList([
      { experienceId: BZ, bookThenMove: true, before: new ParkTime(12) },
    ]);
    const { book, offerOptions } = setupBooking({
      offerHour: 11,
      experiences: [available(BZ, new ParkTime(11))],
      plans: [heldAt(19)],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(offerOptions[0]).toHaveProperty('booking');
  });

  it('does not move a held reservation to a time outside the window', async () => {
    saveWatchList([
      { experienceId: BZ, bookThenMove: true, before: new ParkTime(12) },
    ]);
    const { book, offer } = setupBooking({
      offerHour: 15,
      experiences: [available(BZ, new ParkTime(15))],
      plans: [heldAt(19)],
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });
});

describe('AutopilotProvider pause', () => {
  it('still alerts but takes no action while paused', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true, paused: true }]);
    const { book, offer } = setupBooking({
      experiences: [available(BZ, new ParkTime(11))],
    });
    await enable();
    await waitFor(() => expect(fireAlert).toHaveBeenCalled());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  // Pausing an attraction says "not now", so it must not make others wait for
  // it either.
  it('does not hold the Tier 1 slot for a paused attraction', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true },
      { experienceId: DB, autoBook: true, paused: true },
    ]);
    const { offer, offeredIds } = setupBooking({
      experiences: [
        available(BZ, new ParkTime(11), { tier: 1, priority: 2.3 }),
        {
          ...available(DB, new ParkTime(11)),
          tier: 1,
          priority: 1.0,
          flex: { available: false },
          dropTimes: [new ParkTime(10)],
        } as FlexExperience,
      ],
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalled());
    expect(offeredIds[0]).toBe(BZ);
  });
});

describe('AutopilotProvider swap', () => {
  /** A held, ranked Multi Pass reservation on TODAY for some other ride. */
  function heldRanked(id: string, priority: number, tier?: number): Booking {
    return {
      type: 'LL',
      subtype: 'MP',
      id: `ent-${id}`,
      facilityId: id,
      name: `Ride ${id}`,
      experience: { id, name: `Ride ${id}`, priority, tier },
      start: new DateTime(TODAY, new ParkTime(15)),
      end: new DateTime(TODAY, new ParkTime(16)),
      cancellable: true,
      modifiable: true,
      guests: [{ id: 'g1', name: 'A' }],
    } as unknown as Booking;
  }
  const fullOfWorse = () => [
    heldRanked('w1', 4.1),
    heldRanked('w2', 3.0),
    heldRanked('w3', 2.0),
  ];

  // Wait Magic's Attraction Swap: when every slot is taken, the worst held
  // reservation is given up for the incoming one -- in a single request, so
  // the old one is released only if the new one is secured.
  it('swaps out the worst reservation when the party is full', async () => {
    saveWatchList([{ experienceId: BZ, autoSwap: true }]);
    const { book, offerOptions } = setupBooking({
      offerHour: 11,
      experiences: [available(BZ, new ParkTime(11), { priority: 1.0 })],
      plans: fullOfWorse(),
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(offerOptions[0]).toHaveProperty('booking');
    expect(
      (offerOptions[0]!.booking as { facilityId: string }).facilityId
    ).toBe('w1');
  });

  // The tick that polls plans reads them through `currentPlans`, not through
  // the ref the last render captured -- so a reservation that has just been
  // cancelled, redeemed or converted is seen as gone straight away. Reading
  // the stale ref made autopilot believe all three slots were still taken and
  // give one up for an attraction it could simply have booked.
  it("does not swap when this tick's poll shows a slot has come free", async () => {
    saveWatchList([{ experienceId: BZ, autoSwap: true }]);
    const { book, offerOptions, setPolledPlans } = setupBooking({
      offerHour: 11,
      experiences: [available(BZ, new ParkTime(11), { priority: 1.0 })],
      plans: fullOfWorse(),
    });
    setPolledPlans(fullOfWorse().slice(0, 2));
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(offerOptions[0]).toHaveProperty('date');
    expect(offerOptions[0]).not.toHaveProperty('booking');
  });

  // With a slot free, a fresh booking keeps both attractions.
  it('books normally instead of swapping when a slot is free', async () => {
    saveWatchList([{ experienceId: BZ, autoSwap: true }]);
    const { book, offerOptions } = setupBooking({
      offerHour: 11,
      experiences: [available(BZ, new ParkTime(11), { priority: 1.0 })],
      plans: fullOfWorse().slice(0, 2),
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(offerOptions[0]).toHaveProperty('date');
    expect(offerOptions[0]).not.toHaveProperty('booking');
  });

  it('does not swap when nothing held is worse', async () => {
    saveWatchList([{ experienceId: BZ, autoSwap: true }]);
    const { book, offer } = setupBooking({
      offerHour: 11,
      experiences: [available(BZ, new ParkTime(11), { priority: 3.5 })],
      plans: [
        heldRanked('b1', 1.0),
        heldRanked('b2', 1.5),
        heldRanked('b3', 2.0),
      ],
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  it('does not swap when the flag is off, even when full', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { offerOptions, book } = setupBooking({
      offerHour: 11,
      experiences: [available(BZ, new ParkTime(11), { priority: 1.0 })],
      plans: fullOfWorse(),
    });
    await enable();
    // Plain auto-book still tries a fresh booking (Disney would reject it);
    // the point is that it never reaches for someone else's reservation.
    await waitFor(() => expect(book).toHaveBeenCalled());
    expect(offerOptions[0]).not.toHaveProperty('booking');
  });
});

describe('AutopilotProvider whole-party guard', () => {
  const partyMemberLeftOut = {
    eligible: [{ id: 'g1', name: 'A' }],
    ineligible: [{ id: 'g2', name: 'B', ineligibleReason: 'TOO_EARLY' }],
  };
  const onlyOutsiders = {
    eligible: [{ id: 'g1', name: 'A' }],
    ineligible: [{ id: 'x', name: 'X', ineligibleReason: 'NOT_IN_PARTY' }],
  };

  it('books for whoever is eligible by default', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({ guestsResult: partyMemberLeftOut });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });

  // A Lightning Lane for part of the group splits the party and spends the
  // slot; when asked to, autopilot refuses rather than booking a subset.
  it('refuses to book when a party member is ineligible and the guard is on', async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      requireWholeParty: true,
      dryRun: false,
    });
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, offer } = setupBooking({ guestsResult: partyMemberLeftOut });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  // Guests outside the saved party are not "the party".
  it('still books when only outsiders are ineligible', async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      requireWholeParty: true,
      dryRun: false,
    });
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({ guestsResult: onlyOutsiders });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });
});

describe('AutopilotProvider persistence and diagnostics', () => {
  it("keeps the day's activity log across a reload", async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    // What the next mount will read back.
    await waitFor(() => expect(loadBookingLog()).toHaveLength(1));
    expect(loadBookingLog()[0]).toMatchObject({ status: 'booked' });
    expect(screen.getByTestId('sessionLog')).toHaveTextContent('1');
  });

  it('exposes why nothing was booked', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true, before: new ParkTime(12) },
    ]);
    // Offer comes back outside the window every time.
    setupBooking({ offerHour: 20 });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    // The Probe does not render skipCounts; check the effect on the log
    // instead -- skips must never reach it.
    expect(loadBookingLog()).toEqual([]);
    // What it does render is the newest skip, named, which is what the screen
    // headlines while the counts stay in the diagnostics.
    expect(screen.getByTestId('lastSkip')).toHaveTextContent(
      new RegExp(`^${wdw.experience(BZ).name}: .*outside-window$`)
    );
  });

  it('forgets the last skip when switched on again', async () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true, before: new ParkTime(12) },
    ]);
    setupBooking({ offerHour: 20 });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('lastSkip')).not.toHaveTextContent(/^$/);
    await enable();
    // Disarmed, so the next run has nothing to skip and what it cleared on
    // the way in stays clear.
    await act(async () => {
      screen.getByText('unarm BZ').click();
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('lastSkip')).toHaveTextContent(/^$/);
  });
});

describe('AutopilotProvider drop learning', () => {
  // The learner only records what is being watched, so these have to arm
  // something to have anything to learn from.
  beforeEach(() => saveWatchList([{ experienceId: BZ }]));

  function setupSequence(polls: Experience[][]) {
    // Explicit return type: an inferred `async () => []` is Promise<never[]>,
    // which rejects the real experiences queued below.
    const pollExperiences = jest.fn(async (): Promise<Experience[]> => []);
    for (const exps of polls) pollExperiences.mockResolvedValueOnce(exps);
    // After the scripted polls, keep returning the last one.
    pollExperiences.mockResolvedValue(polls[polls.length - 1] ?? []);
    const pollPlans = jest.fn(async () => []);
    render(
      <BookingDateContext
        value={{ bookingDate: TODAY, setBookingDate: () => {} }}
      >
        <ClientsContext
          value={{ ll: { nextBookTimes: [] as ParkTime[] } } as Clients}
        >
          <ParkContext value={{ park: mk, setPark: () => {} }}>
            <ExperiencesContext
              value={{
                experiences: [],
                refreshExperiences: () => {},
                pollExperiences,
                loaderElem: null,
              }}
            >
              <PlansContext
                value={{
                  plans: [],
                  refreshPlans: () => {},
                  pollPlans,
                  loaderElem: null,
                }}
              >
                <AutopilotProvider>
                  <Probe />
                </AutopilotProvider>
              </PlansContext>
            </ExperiencesContext>
          </ParkContext>
        </ClientsContext>
      </BookingDateContext>
    );
    return { pollExperiences };
  }

  const unavailable = (id: string): Experience =>
    ({
      ...wdw.experience(id),
      park: mk,
      standby: { available: true, waitTime: 30 },
      flex: { available: false },
    }) as Experience;

  it('records an attraction becoming available between polls', async () => {
    const { pollExperiences } = setupSequence([
      [unavailable(BZ)],
      [available(BZ, new ParkTime(11))],
    ]);
    await enable();
    await waitFor(() => expect(pollExperiences).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() =>
      expect(loadDropEvents().some(e => e.experienceId === BZ)).toBe(true)
    );
    expect(loadDropEvents()[0]).toMatchObject({
      kind: 'appeared',
      date: TODAY,
    });
  });

  // The bound that keeps learning useful. Away from a scheduled drop an
  // availability flip is somebody cancelling, and with refill-window polling
  // sampling every six seconds for hours, recording the whole tipboard
  // promotes that noise into burst bands within two park days.
  it('ignores an attraction that is not being watched', async () => {
    saveWatchList([{ experienceId: DB }]);
    const { pollExperiences } = setupSequence([
      [unavailable(BZ)],
      [available(BZ, new ParkTime(11))],
    ]);
    await enable();
    await waitFor(() => expect(pollExperiences).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(loadDropEvents().some(e => e.experienceId === BZ)).toBe(false);
  });

  // The first poll of a run is a baseline; seeing something available on it
  // is not a drop.
  it('does not treat the first poll as a drop', async () => {
    const { pollExperiences } = setupSequence([
      [available(BZ, new ParkTime(11))],
    ]);
    await enable();
    await waitFor(() => expect(pollExperiences).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(loadDropEvents()).toEqual([]);
  });

  it('records that the poller was watching', async () => {
    const { pollExperiences } = setupSequence([[unavailable(BZ)]]);
    await enable();
    await waitFor(() => expect(pollExperiences).toHaveBeenCalled());
    await waitFor(() =>
      expect(Object.keys(loadCoverage())).toContain(`${mk.id}:${TODAY}`)
    );
  });
});

describe('AutopilotProvider learned timing', () => {
  // Every earlier test in this file advances fake time, so by now the clock is
  // well past the 09:00 pinned at module load -- outside any burst window.
  // Re-pin so "a drop at 09:00" is genuinely happening now.
  beforeEach(() => setTime('09:00'));

  // A drop seen on two earlier days at this minute should put the poller into
  // burst mode now, even though the built-in schedule has nothing here.
  it('bursts for a drop learned on enough prior days', async () => {
    // The clock is pinned to 09:00 TODAY; teach a 09:00 drop from two days.
    appendDropEvents([
      { experienceId: BZ, date: '2021-09-28', time: '09:00', kind: 'appeared' },
      { experienceId: BZ, date: '2021-09-29', time: '09:00', kind: 'appeared' },
    ]);
    const bz = available(BZ, new ParkTime(11));
    const pollExperiences = jest.fn(async (): Promise<Experience[]> => [bz]);
    render(
      <BookingDateContext
        value={{ bookingDate: TODAY, setBookingDate: () => {} }}
      >
        <ClientsContext
          value={{ ll: { nextBookTimes: [] as ParkTime[] } } as Clients}
        >
          <ParkContext
            value={{ park: { ...mk, dropTimes: [] }, setPark: () => {} }}
          >
            <ExperiencesContext
              value={{
                // The park filter reads the current tipboard.
                experiences: [bz],
                refreshExperiences: () => {},
                pollExperiences,
                loaderElem: null,
              }}
            >
              <PlansContext
                value={{
                  plans: [],
                  refreshPlans: () => {},
                  pollPlans: async () => [],
                  loaderElem: null,
                }}
              >
                <AutopilotProvider>
                  <Probe />
                </AutopilotProvider>
              </PlansContext>
            </ExperiencesContext>
          </ParkContext>
        </ClientsContext>
      </BookingDateContext>
    );
    await enable();
    await waitFor(() =>
      expect(screen.getByTestId('mode')).toHaveTextContent('burst')
    );
  });

  it('does not burst for a drop seen on only one day', async () => {
    appendDropEvents([
      { experienceId: BZ, date: '2021-09-28', time: '09:00', kind: 'appeared' },
    ]);
    const bz = available(BZ, new ParkTime(11));
    render(
      <BookingDateContext
        value={{ bookingDate: TODAY, setBookingDate: () => {} }}
      >
        <ClientsContext
          value={{ ll: { nextBookTimes: [] as ParkTime[] } } as Clients}
        >
          <ParkContext
            value={{ park: { ...mk, dropTimes: [] }, setPark: () => {} }}
          >
            <ExperiencesContext
              value={{
                experiences: [bz],
                refreshExperiences: () => {},
                pollExperiences: async () => [bz],
                loaderElem: null,
              }}
            >
              <PlansContext
                value={{
                  plans: [],
                  refreshPlans: () => {},
                  pollPlans: async () => [],
                  loaderElem: null,
                }}
              >
                <AutopilotProvider>
                  <Probe />
                </AutopilotProvider>
              </PlansContext>
            </ExperiencesContext>
          </ParkContext>
        </ClientsContext>
      </BookingDateContext>
    );
    await enable();
    await waitFor(() =>
      expect(screen.getByTestId('mode')).toHaveTextContent('idle')
    );
  });
});

describe('AutopilotProvider dry run', () => {
  it('runs the guards and logs, but never offers or books', async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      requireWholeParty: false,
      dryRun: true,
    });
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { offer, book, guests } = setupBooking();
    await enable();
    // Eligibility is still checked -- a faithful rehearsal.
    await waitFor(() => expect(guests).toHaveBeenCalled());
    await waitFor(() =>
      expect(loadBookingLog().some(e => e.status === 'dry-run')).toBe(true)
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000 * 3);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
    expect(loadBookingLog()[0]).toMatchObject({
      status: 'dry-run',
      detail: 'book',
    });
  });

  // Once per attraction per action, not once per tick.
  it('logs a rehearsed action only once', async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      requireWholeParty: false,
      dryRun: true,
    });
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    setupBooking();
    await enable();
    await waitFor(() =>
      expect(loadBookingLog().some(e => e.status === 'dry-run')).toBe(true)
    );
    // Past a full release window on purpose. A rehearsal marks the attraction
    // only so this logs once; were that mark to take part in settling, the
    // lock would release and the same rehearsal would log again. Five minutes
    // -- the previous span -- is shorter than the window, so the assertion
    // used to hold for no reason at all.
    await runTicks(RELEASE_TICKS);
    expect(loadBookingLog().filter(e => e.status === 'dry-run')).toHaveLength(
      1
    );
  });

  // A rehearsal that logged "would have moved" for a 15-minute gain, when the
  // live run refuses anything under 30, would teach the user the wrong thing.
  it('applies the improvement threshold while rehearsing a move', async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      requireWholeParty: false,
      dryRun: true,
    });
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    setupBooking({
      // Holding 11:00, offered 10:45 -- only 15 minutes better.
      experiences: [available(BZ, new ParkTime(10, 45))],
      plans: [
        {
          type: 'LL',
          subtype: 'MP',
          id: 'ent-1',
          facilityId: BZ,
          name: 'Held',
          start: new DateTime(TODAY, new ParkTime(11)),
          end: new DateTime(TODAY, new ParkTime(12)),
          modifiable: true,
          guests: [],
        } as unknown as Booking,
      ],
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(loadBookingLog()).toEqual([]);
  });

  it('does rehearse a move that clears the threshold', async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      requireWholeParty: false,
      dryRun: true,
    });
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    setupBooking({
      experiences: [available(BZ, new ParkTime(11))],
      plans: [
        {
          type: 'LL',
          subtype: 'MP',
          id: 'ent-1',
          facilityId: BZ,
          name: 'Held',
          start: new DateTime(TODAY, new ParkTime(19)),
          end: new DateTime(TODAY, new ParkTime(20)),
          modifiable: true,
          guests: [],
        } as unknown as Booking,
      ],
    });
    await enable();
    await waitFor(() =>
      expect(loadBookingLog()[0]).toMatchObject({
        status: 'dry-run',
        detail: 'modify',
      })
    );
  });

  // The whole point: the guards still gate what gets logged.
  it('still honors the whole-party guard while rehearsing', async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      requireWholeParty: true,
      dryRun: true,
    });
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    setupBooking({
      guestsResult: {
        eligible: [{ id: 'g1', name: 'A' }],
        ineligible: [{ id: 'g2', name: 'B', ineligibleReason: 'TOO_EARLY' }],
      },
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(loadBookingLog()).toEqual([]);
  });
});

/**
 * Eligibility moves for reasons no clock predicts, and the cache was cleared
 * only for actions autopilot took itself.
 */
describe('AutopilotProvider eligibility cache', () => {
  /** A Multi Pass reservation held by the named guests. */
  const heldBy = (id: string, guestIds: string[]): Booking =>
    ({
      type: 'LL',
      subtype: 'MP',
      id,
      facilityId: DB,
      name: 'Held',
      start: new DateTime(TODAY, new ParkTime(15)),
      end: new DateTime(TODAY, new ParkTime(16)),
      cancellable: true,
      modifiable: true,
      guests: guestIds.map(g => ({ id: g, name: g })),
    }) as unknown as Booking;

  /**
   * Burst cadence, so plans are polled every ~12s and the run finishes well
   * inside the 3-minute cache TTL -- otherwise a refetch proves only that the
   * entry expired on its own.
   */
  function setup(plans: Booking[]) {
    setTime('09:00');
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    return setupBooking({
      // Unavailable, so nothing is booked and `guests` is called only by the
      // prewarm loop -- which is what makes the call count readable.
      experiences: [
        available(BZ, new ParkTime(11), { flex: { available: false } }),
      ],
      plans,
      nextBookTimes: [new ParkTime(9, 0, 20)],
    });
  }

  // A guest who taps in is dropped from `booking.guests` by the itinerary
  // parser, which is what makes a redemption observable at all. Before this,
  // the party sat out the rest of the drop on a cached "you cannot book".
  it('refetches eligibility once an entitlement disappears', async () => {
    const { guests, setPolledPlans } = setup([heldBy('b1', ['g1', 'g2'])]);
    await enable();
    await runTicks(PLANS_EVERY_N_TICKS + 2, BURST_INTERVAL_MS);
    const beforeTapIn = guests.mock.calls.length;
    setPolledPlans([heldBy('b1', ['g1'])]);
    await runTicks(PLANS_EVERY_N_TICKS + 2, BURST_INTERVAL_MS);
    expect(guests.mock.calls.length).toBeGreaterThan(beforeTapIn);
  });

  // The twin that makes the test above mean something: without it, the refetch
  // could just as well be the TTL expiring.
  it('leaves the cache alone while nothing the party holds moves', async () => {
    const { guests } = setup([heldBy('b1', ['g1', 'g2'])]);
    await enable();
    await runTicks(PLANS_EVERY_N_TICKS + 2, BURST_INTERVAL_MS);
    const warmed = guests.mock.calls.length;
    await runTicks(PLANS_EVERY_N_TICKS + 2, BURST_INTERVAL_MS);
    expect(guests.mock.calls.length).toBe(warmed);
  });
});

/**
 * The action budget. Session-scoped, it bounded nothing: the ledger lived in a
 * ref, so turning autopilot off and on refilled it -- and so did a plain page
 * reload, which on a phone that backgrounds a tab mid-day is the ordinary path.
 */
describe('AutopilotProvider action budget', () => {
  // Dry run stops at the budget too. It spends nothing, so exempting it looks
  // free -- but a rehearsal exists to show what the live run would have done,
  // and a live run with no budget left does nothing.
  it('rehearses nothing once the day budget is spent', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveSettings({ ...DEFAULT_SETTINGS, dryRun: true });
    saveBudget({ spent: DEFAULT_ACTIONS_PER_DAY, granted: 0 });
    const { offer } = setupBooking();
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(loadBookingLog()).toEqual([]);
  });

  it('keeps the day count across turning autopilot off and on', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    // Mutable, so availability can be taken away before the re-arm: with the
    // attraction still on offer, the second run would legitimately book it
    // again and the assertion would be measuring that instead.
    const experiences = [available(BZ, new ParkTime(11))];
    const { book } = setupBooking({ experiences });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    const afterBooking = Number(screen.getByTestId('remaining').textContent);
    expect(afterBooking).toBe(DEFAULT_ACTIONS_PER_DAY - 1);
    experiences.length = 0;
    await enable(); // off
    await enable(); // on again
    expect(Number(screen.getByTestId('remaining').textContent)).toBe(
      afterBooking
    );
  });

  // A reload is the ordinary way this used to reset, and the one nobody chose.
  it('starts from what storage says was already spent today', async () => {
    saveBudget({ spent: 4, granted: 0 });
    setupBooking();
    expect(Number(screen.getByTestId('remaining').textContent)).toBe(
      DEFAULT_ACTIONS_PER_DAY - 4
    );
  });

  it('tops the day up on request, without touching what was spent', async () => {
    saveBudget({ spent: DEFAULT_ACTIONS_PER_DAY, granted: 0 });
    setupBooking();
    expect(Number(screen.getByTestId('remaining').textContent)).toBe(0);
    await act(async () => {
      screen.getByText('refill').click();
    });
    expect(Number(screen.getByTestId('remaining').textContent)).toBe(
      REFILL_ACTIONS
    );
    expect(Number(screen.getByTestId('budget').textContent)).toBe(
      DEFAULT_ACTIONS_PER_DAY + REFILL_ACTIONS
    );
  });

  // The ceiling is enforced on the sum, not just on the setting: `granted` is
  // persisted, so an edited value must not be able to lift it.
  it('will not let refills lift the day ceiling', async () => {
    saveBudget({ spent: 0, granted: MAX_ACTIONS_PER_DAY });
    setupBooking();
    expect(Number(screen.getByTestId('budget').textContent)).toBe(
      MAX_ACTIONS_PER_DAY
    );
  });

  // The point of the whole item: without the write, a reload starts the day
  // over. Booking after a refill exercises both halves of the record at once.
  it('keeps the day spend and the refill in storage, so a reload sees both', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11))],
    });
    await act(async () => {
      screen.getByText('refill').click();
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(loadBudget()).toEqual({ spent: 1, granted: REFILL_ACTIONS });
  });

  // The allowance lives in settings but is enforced by the ledger, so a change
  // has to travel: raising it while the budget is spent must free actions up.
  it('carries a changed allowance into the ledger', async () => {
    saveBudget({ spent: 12, granted: 0 });
    setupBooking();
    expect(Number(screen.getByTestId('remaining').textContent)).toBe(0);
    await act(async () => {
      screen.getByText('raise budget').click();
    });
    expect(Number(screen.getByTestId('budget').textContent)).toBe(20);
    expect(Number(screen.getByTestId('remaining').textContent)).toBe(8);
  });

  // A tab that outlives 4am must not write yesterday's numbers under today's
  // date: a reload would then start the new day already exhausted, and the
  // user cannot undo it by reloading again.
  it('refuses to write the day record once the park day has turned', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveBudget({ spent: 6, granted: 0 });
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11))],
    });
    // 4am has passed: the same mounted tab is now on the next park day.
    jest.setSystemTime(new Date(`${TOMORROW}T07:00-0400`));
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    // Nothing stamped with tomorrow: the record still belongs to the day it
    // describes, so tomorrow's first mount reads a clean one.
    expect(loadBudget()).toEqual({ spent: 0, granted: 0 });
  });

  it('will not book once the day budget is spent', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveBudget({ spent: DEFAULT_ACTIONS_PER_DAY, granted: 0 });
    const { offer, book } = setupBooking();
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });
});

/**
 * Disney refusing the booking path outright. The failure lands on eligibility,
 * one step before an offer exists, so without this autopilot polls, alerts and
 * learns drops looking entirely healthy while never acting.
 */
describe('AutopilotProvider refusals', () => {
  it('reports eligibility being refused, once it has lasted', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    setTime('09:00');
    setupBooking({ guestsStatus: 403 });
    await enable();
    // Three refusals arrive within seconds; the warning waits for the run to
    // span a minute, so that an ordinary hiccup mid-drop does not trip it.
    await runTicks(4);
    expect(screen.getByTestId('refused')).toHaveTextContent('eligibility');
  });

  // 410 is a ride selling out from under you -- the common case at a drop.
  it('does not report an ordinary failure as a refusal', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    setTime('09:00');
    setupBooking({ guestsStatus: 410 });
    await enable();
    await runTicks(4);
    expect(screen.getByTestId('refused')).toHaveTextContent('');
  });
});

// NextLL's settings. The improvement loop is the feature: it takes whatever
// time it can get, then keeps moving that reservation earlier for as long as
// the screen is open.
describe('AutopilotProvider repeated moves', () => {
  // Not inherited: an earlier test in this file moves the clock to the next
  // park day and leaves it there, and the retry wait is measured in real
  // milliseconds against whatever the clock says.
  beforeEach(() => setTime('09:00'));

  function heldAt(hour: number): Booking {
    return {
      type: 'LL',
      subtype: 'MP',
      id: 'ent-1',
      facilityId: BZ,
      name: 'Held',
      start: new DateTime(TODAY, new ParkTime(hour)),
      end: new DateTime(TODAY, new ParkTime(hour + 1)),
      modifiable: true,
      guests: [],
    } as unknown as Booking;
  }

  /** Ticks that span the retry wait, with margin. */
  const WAITED = Math.ceil(RETRY_AFTER_MS / IDLE_INTERVAL_MS) + 2;
  /**
   * The same wait measured in burst ticks, for the pacing test.
   *
   * At the idle cadence one tick already outlasts the wait, so nothing can be
   * observed happening inside it. Bursting is also the honest case: it is the
   * cadence closest to NextLL's own, and the one where a spin costs the most.
   */
  const BURSTING = { nextBookTimes: [new ParkTime(9, 0, 20)] };
  const BURST_TICKS_INSIDE_WAIT = Math.floor(
    RETRY_AFTER_MS / BURST_INTERVAL_MS / 2
  );
  const BURST_TICKS_PAST_WAIT =
    Math.ceil(RETRY_AFTER_MS / BURST_INTERVAL_MS) + 4;

  // The lock is taken before the request goes out, so a failed modify used to
  // hold it for the rest of the session: `repeatMoves` released it only on
  // success. Losing one race therefore ended the improvement loop while the
  // screen went on saying it was still looking.
  it('tries again after a move that the server rejected', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      offerHour: 11,
      plans: [heldAt(19)],
      repeatMoves: true,
      bookErrors: [409],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await runTicks(WAITED);
    expect(book.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // A rejection leaves every input to the decision unchanged -- the
  // reservation did not move, and plans are re-polled only after a success --
  // so retrying at once would re-run the same three requests against the same
  // evidence every 600ms, on a limiter shared with the other provider and the
  // user's own taps.
  it('waits before retrying rather than spinning on the same evidence', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book, offer } = setupBooking({
      offerHour: 11,
      plans: [heldAt(19)],
      repeatMoves: true,
      ...BURSTING,
      // Every attempt is refused, so nothing but the wait can bound this.
      bookErrors: Array(200).fill(409),
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    // Well inside the wait, across several ticks: no second attempt, and --
    // the part that matters for the rate limiter -- no second offer request
    // either. Each spin would cost both.
    await runTicks(BURST_TICKS_INSIDE_WAIT, BURST_INTERVAL_MS);
    expect(book).toHaveBeenCalledTimes(1);
    expect(offer).toHaveBeenCalledTimes(1);

    await runTicks(BURST_TICKS_PAST_WAIT, BURST_INTERVAL_MS);
    expect(book.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Paced, not spinning: an unbounded retry would attempt on every one of
    // the ticks that have now elapsed.
    expect(book.mock.calls.length).toBeLessThan(
      (BURST_TICKS_INSIDE_WAIT + BURST_TICKS_PAST_WAIT) / 3
    );
  });

  // A modify that never reached a server may still have applied, and doing it
  // again would move the same reservation twice. Unknown stays locked.
  it('does not try again when the request never got a response', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      offerHour: 11,
      plans: [heldAt(19)],
      repeatMoves: true,
      bookErrors: ['no-response'],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await runTicks(WAITED);
    expect(book).toHaveBeenCalledTimes(1);
  });

  // The booking leg of book-then-move, which is what NextLL runs while
  // nothing is held. A lost race at 7am used to retire the attraction for the
  // day under copy promising it would take the first Lightning Lane it could
  // get.
  it('tries again after a booking the server rejected', async () => {
    saveWatchList([{ experienceId: BZ, bookThenMove: true }]);
    const { book } = setupBooking({ repeatMoves: true, bookErrors: [410] });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await runTicks(WAITED);
    expect(book.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // The doubt-hold a book attempt charges must come back with the lock, or a
  // run of lost races quietly spends the day's allowance on bookings that do
  // not exist.
  it('gives the allowance back for a booking that never happened', async () => {
    saveWatchList([{ experienceId: BZ, bookThenMove: true }]);
    setupBooking({ repeatMoves: true, bookErrors: Array(50).fill(410) });
    await enable();
    await waitFor(() =>
      expect(screen.getByTestId('remaining')).toHaveTextContent('9')
    );
    await runTicks(WAITED);
    // Back to the full allowance between attempts: nothing was ever booked.
    expect(Number(screen.getByTestId('remaining').textContent)).toBeGreaterThan(
      8
    );
  });

  /**
   * The gap between "rejected" and "locked".
   *
   * All three helpers take their ledger lock *after* the offer round trip, so
   * a 4xx on the offer call is rejected with nothing held -- and a 410 there
   * is the ordinary outcome of a contested drop, not an edge case. A token
   * minted for that attempt outlives it: the consumer reads a token only once
   * `hasAttempted` is true, so it sits unread until some *later* attempt takes
   * a real lock, by which time it has long expired. That later attempt is the
   * one that matters here -- its request timed out, so whether it booked is
   * unknown, which is the exact case the doubt-hold exists for.
   *
   * Every other test in this block injects through `bookErrors`, i.e. after
   * the lock is taken, so the token is always paired with the lock it belongs
   * to and none of them can see this.
   */
  it('does not retry an unknown outcome because an earlier offer was refused', async () => {
    saveWatchList([{ experienceId: BZ, bookThenMove: true }]);
    const { book, offer } = setupBooking({
      repeatMoves: true,
      // Tick 1 is refused at the offer, before any lock exists. Tick 2 gets an
      // offer, takes the lock and the doubt-hold, and then never hears back.
      offerErrors: [410],
      bookErrors: ['no-response'],
    });
    await enable();
    // Long enough for both attempts and for a token minted on the first to
    // have expired several times over.
    await runTicks(WAITED * 2);

    // The second attempt happened -- otherwise this passes for the trivial
    // reason that nothing ever took a lock.
    expect(offer.mock.calls.length).toBeGreaterThanOrEqual(2);
    // And it is not repeated. A request that never came back may have booked,
    // so the lock and the doubt-hold have to stand: retrying is the dangerous
    // option, which is the whole reason the lock is taken before the request
    // goes out.
    expect(book).toHaveBeenCalledTimes(1);
  });

  // Autopilot's rule is one action per attraction per session, which is what
  // stops it thrashing a reservation as availability shifts. A rejection must
  // not become a way around that.
  it('leaves Autopilot at one move per attraction', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      offerHour: 11,
      plans: [heldAt(19)],
      bookErrors: [409],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await runTicks(WAITED);
    expect(book).toHaveBeenCalledTimes(1);
  });
});

// The arrangement the app actually ships: Merlock mounts one provider above
// the whole nav stack, and the NextLL tab mounts a second one inside itself.
// Opening and leaving that tab therefore mounts and unmounts a provider
// underneath a running one, and must not disturb it -- Autopilot running
// across tabs is the whole reason its provider sits where it does.
describe('AutopilotProvider with a second provider mounted inside it', () => {
  beforeEach(() => setTime('09:00'));

  /** A wake lock the browser grants, so there is something to lose. */
  function installWakeLock() {
    const sentinel = {
      released: false,
      release: jest.fn(async () => undefined),
      addEventListener: jest.fn(),
    };
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: jest.fn(async () => sentinel) },
      configurable: true,
    });
    return sentinel;
  }

  afterEach(async () => {
    await releaseScreenAwake();
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  function setupNested() {
    const pollExperiences = jest.fn(async () => []);
    const pollPlans = jest.fn(async () => []);
    function Tree({ inner }: { inner: boolean }) {
      return (
        <BookingDateContext
          value={{ bookingDate: TODAY, setBookingDate: () => {} }}
        >
          <ClientsContext
            value={{ ll: { nextBookTimes: [] as ParkTime[] } } as Clients}
          >
            <ParkContext value={{ park: mk, setPark: () => {} }}>
              <ExperiencesContext
                value={{
                  experiences: [],
                  refreshExperiences: () => {},
                  pollExperiences,
                  loaderElem: null,
                }}
              >
                <PlansContext
                  value={{
                    plans: [],
                    refreshPlans: () => {},
                    pollPlans,
                    loaderElem: null,
                  }}
                >
                  <AutopilotProvider>
                    <Probe />
                    {inner && (
                      <AutopilotProvider
                        watchListKey="autoll3.nextll.watchlist"
                        budgeted={false}
                        repeatMoves
                      >
                        <div />
                      </AutopilotProvider>
                    )}
                  </AutopilotProvider>
                </PlansContext>
              </ExperiencesContext>
            </ParkContext>
          </ClientsContext>
        </BookingDateContext>
      );
    }
    const view = render(<Tree inner={false} />);
    return {
      pollExperiences,
      openNextLL: () => view.rerender(<Tree inner />),
      leaveNextLL: () => view.rerender(<Tree inner={false} />),
    };
  }

  // The regression this replaced: the wake lock is a module singleton, and
  // the inner provider's unmount released it unconditionally. Since it is
  // only ever requested from the gesture that starts a run, nothing put it
  // back -- so opening this tab and leaving cost a running Autopilot the lock
  // for the rest of the day, and the phone would sleep through the drop.
  it('keeps the screen awake when the second provider goes away', async () => {
    const sentinel = installWakeLock();
    const { openNextLL, leaveNextLL } = setupNested();
    await enable();
    await waitFor(() => expect(wakeLockHeld()).toBe(true));

    await act(async () => openNextLL());
    await act(async () => leaveNextLL());

    expect(wakeLockHeld()).toBe(true);
    expect(sentinel.release).not.toHaveBeenCalled();
  });

  it('keeps polling across the second provider coming and going', async () => {
    const { pollExperiences, openNextLL, leaveNextLL } = setupNested();
    await enable();
    await runTicks(2);
    const before = pollExperiences.mock.calls.length;

    await act(async () => openNextLL());
    await act(async () => leaveNextLL());
    await runTicks(2);

    expect(pollExperiences.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByTestId('mode')).not.toHaveTextContent('off');
  });

  // Its own key, so a quick search cannot overwrite a list built up all
  // morning -- nor clear it on the way out.
  it('leaves the watch list alone', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { openNextLL, leaveNextLL } = setupNested();
    await enable();
    await act(async () => openNextLL());
    await act(async () => leaveNextLL());
    expect(loadWatchList()).toHaveLength(1);
    expect(screen.getByTestId('targets')).toHaveTextContent('1');
  });
});

// The passkey is the one feature that can switch the Tier 1 hold off, so the
// two ways it must NOT do that are worth pinning at the provider rather than
// only on the pure predicate. `tierLimitLifted` is trivially true for a party
// holding no Tier 1 -- Disney only reports TIER_LIMIT_REACHED to a party that
// already holds one -- so before this the probe passed the moment a passkey
// was booked.
describe('AutopilotProvider passkey', () => {
  beforeEach(() => setTime('09:00'));

  const PASSKEY = BZ;
  const TIER_ONE = DB;

  /** The passkey sitting in plans, which is not the same as tapped in. */
  function heldPasskey(): Booking {
    return {
      type: 'LL',
      subtype: 'MP',
      id: 'ent-passkey',
      facilityId: PASSKEY,
      name: 'Passkey',
      start: new DateTime(TODAY, new ParkTime(10)),
      end: new DateTime(TODAY, new ParkTime(11)),
      modifiable: true,
      guests: [],
    } as unknown as Booking;
  }

  const armed = () =>
    saveWatchList([
      { experienceId: PASSKEY, passkey: true, autoBook: true },
      { experienceId: TIER_ONE, autoBook: true },
    ]);

  const withTierOne = () => [
    available(PASSKEY, new ParkTime(11)),
    { ...available(TIER_ONE, new ParkTime(11)), tier: 1 } as FlexExperience,
  ];

  it('does not unlock for a passkey that is only booked', async () => {
    armed();
    setupBooking({ experiences: withTierOne(), plans: [heldPasskey()] });
    await enable();
    await runTicks(2);
    expect(screen.getByTestId('passkey')).toHaveTextContent('waiting');
  });

  it('unlocks once the passkey has been tapped in', async () => {
    armed();
    setupBooking({
      experiences: withTierOne(),
      plans: [heldPasskey()],
      experiencedIds: [PASSKEY],
    });
    await enable();
    await waitFor(() =>
      expect(screen.getByTestId('passkey')).toHaveTextContent('unlocked')
    );
  });

  // The unlock was a bare boolean cleared only by turning autopilot off and
  // on, so a tab left open across the 4am rollover or a change of booking date
  // carried yesterday's unlock into a day it says nothing about.
  // The tracker exists for exactly this: a redeemed pass leaves the itinerary,
  // and LLTracker.update settles it by asking Disney whether the party now
  // reports EXPERIENCE_LIMIT_REACHED. Requiring the reservation to still be in
  // plans left a genuinely redeemed passkey stuck on "waiting" all day -- and
  // redeeming early enough to disappear is the ordinary case for a strategy
  // whose whole point is redeeming early.
  it('unlocks for a redeemed passkey that has left the itinerary', async () => {
    armed();
    setupBooking({
      experiences: withTierOne(),
      plans: [],
      experiencedIds: [PASSKEY],
    });
    await enable();
    await waitFor(() =>
      expect(screen.getByTestId('passkey')).toHaveTextContent('unlocked')
    );
  });

  it('does not carry an unlock onto another day', async () => {
    armed();
    const { setBookingDate } = setupBooking({
      experiences: withTierOne(),
      plans: [heldPasskey()],
      experiencedIds: [PASSKEY],
    });
    await enable();
    // Establish the unlock for today first -- without that there is nothing to
    // carry, and the assertion below would hold for the wrong reason.
    await waitFor(() =>
      expect(screen.getByTestId('passkey')).toHaveTextContent('unlocked')
    );

    await act(async () => setBookingDate(TOMORROW));
    await runTicks(2);
    // The passkey was redeemed *today*. Nothing about tomorrow is established,
    // so the Tier 1 hold has to stand again.
    expect(screen.getByTestId('passkey')).not.toHaveTextContent('unlocked');
  });
});

// The poller's own cancellation only fires on enable/disable and unmount --
// the polling effect depends on `enabled` alone so a park or date change does
// not tear the loop down. A tick already in flight therefore keeps the park
// and date it captured, and the only thing standing between that and a
// booking against a day the user has moved off is the tick's own staleness
// test.
describe('AutopilotProvider acting on a plan that changed mid-tick', () => {
  beforeEach(() => setTime('09:00'));

  /** One guest held back, so whole-party-only has something to refuse. */
  const partyMemberLeftOut = {
    eligible: [{ id: 'g1', name: 'A' }],
    ineligible: [{ id: 'g2', name: 'B', ineligibleReason: 'TOO_EARLY' }],
  };

  it('does not alert from an availability response for the previous date', async () => {
    saveWatchList([{ experienceId: BZ }]);
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const { pollExperiences, setBookingDate } = setupBooking({
      experiencesDelay: held,
    });
    await enable();
    await waitFor(() => expect(pollExperiences).toHaveBeenCalledTimes(1));

    await act(async () => setBookingDate(TOMORROW));
    await act(async () => {
      release();
      await Promise.resolve();
    });

    expect(fireAlert).not.toHaveBeenCalled();
  });

  it('does not book after the booking date moves under it', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const { book, offer, setBookingDate } = setupBooking({
      // Eligibility is a round trip, and the decision to book is made after
      // it returns. Hold it open and change the day while it is outstanding.
      guestsResult: held.then(() => party) as unknown,
    });
    await enable();
    await act(async () => {
      setBookingDate(TOMORROW);
      release();
      await Promise.resolve();
    });
    // Deliberately no further ticks: a *new* tick booking for the new date is
    // correct, and would mask the thing under test. This asserts only that
    // the tick which started on the old date did not go on to act.
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  // Present and unpaused is not the same as still authorised. Turning
  // Auto-book off leaves the target exactly where it was.
  it('does not book after its action is switched off mid-request', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const { book, offer } = setupBooking({
      guestsResult: held.then(() => party) as unknown,
    });
    await enable();
    await act(async () => {
      screen.getByText('unarm BZ').click();
      release();
      await Promise.resolve();
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  // The last gate. Generating the offer is another round trip, so everything
  // above ran before it; this is the moment the entitlement is spent.
  it('does not commit an offer after the plan changes', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const { book } = setupBooking({
      // The offer is what is held open this time, not eligibility.
      offerDelay: held,
    });
    await enable();
    await act(async () => {
      screen.getByText('unarm BZ').click();
      release();
      await Promise.resolve();
    });
    expect(book).not.toHaveBeenCalled();
  });

  // The tipboard advertises one time and the offer can come back with a
  // later one, so the window has to be judged against what would actually be
  // booked. Validating the advertised time let a narrowed window approve an
  // offer that no longer fits it.
  it('judges a narrowed window against the offer, not the advertised time', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const { book } = setupBooking({
      // Advertised 11:00 (inside the 11:30 window set below); offered 12:00,
      // which is not.
      experiences: [available(BZ, new ParkTime(11))],
      offerHour: 12,
      offerDelay: held,
    });
    await enable();
    await act(async () => {
      screen.getByText('narrow BZ').click();
      release();
      await Promise.resolve();
    });
    expect(book).not.toHaveBeenCalled();
  });

  // The three global controls are read once, before the offer is requested,
  // and each exists to *prevent* an action. Turning one on while a request is
  // in flight and having the booking go through anyway is the wrong way round.
  it.each([
    ['dry run', 'dry run on'],
    ['whole-party only', 'whole party on'],
  ])('does not commit once %s is switched on mid-request', async (_, label) => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const { book } = setupBooking({
      // Whole-party only bites here because the fixture party has an
      // ineligible guest.
      guestsResult: partyMemberLeftOut,
      offerDelay: held,
    });
    await enable();
    await act(async () => {
      screen.getByText(label).click();
      release();
      await Promise.resolve();
    });
    expect(book).not.toHaveBeenCalled();
  });

  it('does not book an attraction paused while eligibility was in flight', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let release!: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const { book, offer } = setupBooking({
      guestsResult: held.then(() => party) as unknown,
    });
    await enable();
    await act(async () => {
      // Through the context, not storage: `saveWatchList` writes localStorage
      // and the provider's list is state, so the running tick would never see
      // it and the test would pass for the wrong reason.
      screen.getByText('pause BZ').click();
      release();
      await Promise.resolve();
    });
    expect(offer).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });
});
