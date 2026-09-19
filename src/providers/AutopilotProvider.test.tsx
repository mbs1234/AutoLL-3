import { act, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { use, useState } from 'react';

import { mk, wdw } from '@/__fixtures__/resort';
import { RequestError } from '@/api/client';
import type { RequestControl } from '@/api/client';
import { Booking } from '@/api/itinerary';
import { Experience, FlexExperience } from '@/api/ll';
import { fireAlert, primeAudio } from '@/autopilot/alert';
import { AutoBookLedger, CONFIRM_ABSENT_POLLS } from '@/autopilot/autobook';
import {
  LEASE_TTL_MS,
  QUARANTINE_KEY,
  RENEW_INTERVAL_MS,
  acquire as acquireLease,
  holder as leaseHolder,
  leaseKey,
  quarantine,
  quarantinedAt,
  quarantinedMutations,
  reconcile,
  release as releaseLease,
  resolveDoubt,
} from '@/autopilot/lease';
import { MAX_MUTATION_MS } from '@/autopilot/mutation';
import {
  appendDropEvents,
  coverageBucket,
  coverageKey,
  loadCoverage,
  loadDropEvents,
  saveCoverage,
  saveWatchedDays,
} from '@/autopilot/observe';
import { NO_REFUSALS, refusedCalls } from '@/autopilot/refusal';
import {
  BACKOFF_BASE_MS,
  BURST_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  MAX_CONSECUTIVE_FAILURES,
  TICK_DEADLINE_MS,
  syncedParkTime,
} from '@/autopilot/schedule';
import {
  COMMITS_KEY,
  COMMIT_TTL_MS,
  CommittedReturn,
  DEFAULT_SETTINGS,
  loadBookingLog,
  loadCommits,
  loadLocks,
  saveCommit,
  saveLocks,
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
import kvdb from '@/kvdb';
import {
  NEXTLL_WATCHLIST_KEY,
  NOTIFICATION_TAG_NAMESPACE,
} from '@/storageNamespace';
import { TODAY, TOMORROW, setTime } from '@/testing';

import AutopilotProvider, {
  PARK_DAY_CHECK_MS,
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
/** Haunted Mansion: the fixture gives it drop times at 13:30 and 15:30. */
const HM = '80010208';
/** A lock owner that is not this tab, for simulating another instance. */
const OTHER_TAB = 'another-tab';
/** Stands for a foreground search, which owns its lease separately. */
const PROBE_OWNER = 'a-foreground-search';

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
    refusals,
    passkeyStatus,
    togglePaused,
    toggleAutoBook,
    setTargetWindow,
    setDryRun,
    setRequireWholeParty,
    lastSkip,
    sessionLog,
    dropSummaries,
    bookedCount,
  } = use(AutopilotContext);
  const [claimed, setClaimed] = useState<string>('');
  return (
    <div>
      <button onClick={() => setEnabled(!enabled)}>toggle</button>
      <button onClick={() => togglePaused(BZ)}>pause BZ</button>
      <button onClick={() => toggleAutoBook(BZ)}>unarm BZ</button>
      <button onClick={() => setTargetWindow(BZ, 'before', '11:30')}>
        narrow BZ
      </button>
      <button onClick={() => setDryRun(true)}>dry run on</button>
      <button onClick={() => setRequireWholeParty(true)}>whole party on</button>
      <span data-testid="mode">{status.mode}</span>
      <span data-testid="lastError">{status.lastError ?? ''}</span>
      <span data-testid="bookedCount">{bookedCount}</span>
      <span data-testid="targets">{targets.length}</span>
      <span data-testid="passkey">{passkeyStatus}</span>
      <span data-testid="lastSkip">
        {lastSkip ? `${lastSkip.name}: ${lastSkip.reason}` : ''}
      </span>
      <button
        onClick={() => {
          void acquireLease(leaseKey(BZ, TODAY), PROBE_OWNER).then(ok =>
            setClaimed(String(ok))
          );
        }}
      >
        claim BZ modify
      </button>
      <button
        onClick={() => void releaseLease(leaseKey(BZ, TODAY), PROBE_OWNER)}
      >
        release BZ modify
      </button>
      <span data-testid="claimed">{claimed}</span>
      <span data-testid="sessionLog">{sessionLog.length}</span>
      <span data-testid="coveredDays">
        {dropSummaries.reduce(
          (n, d) => n + d.scheduled.reduce((m, c) => m + c.coveredDays, 0),
          0
        )}
      </span>
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

function offerAt(hour: number, minute = 0, itinerary: unknown[] = []) {
  return {
    id: 'offer-1',
    offerSetId: 'set-1',
    start: new DateTime(TODAY, new ParkTime(hour, minute)),
    end: new DateTime(TODAY, new ParkTime(hour + 1, minute)),
    guests: party,
    itinerary,
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
  // Minutes for the offered return time. The clash spans are 40 minutes
  // before and 60 after a start, so whole hours alone cannot tell a parsed
  // plan's narrower span from a bare commit's wider one.
  offerMinute = 0,
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
  // The same for `book`, which is the other side of the commit boundary: a
  // request held open here has already left the device.
  bookDelay = undefined as Promise<void> | undefined,
  // Per-call, for holding one `book` open while a later one runs to completion
  // -- which is what a tick abandoned at its deadline looks like from here.
  // Indexed like `bookErrors`; falls back to `bookDelay`.
  bookDelays = [] as (Promise<void> | undefined)[],
  // Holds the client's pre-dispatch work open, as first-use sensor generation
  // can. The operation signal must reach this side of RequestControl.
  preDispatchDelay = undefined as Promise<void> | undefined,
  // Holds the availability request open, for scope/cancellation tests before
  // any alerting or booking decision has been made.
  experiencesDelay = undefined as Promise<void> | undefined,
  // The same for the plans poll, per call. A tick stalled here is abandoned by
  // the poller and resumes at the settle sweep -- the one stretch of a tick
  // with no `stale()` check in it, and the one that can release every lock on
  // the ledger.
  plansDelays = [] as (Promise<void> | undefined)[],
  // Disney's own view of what the party holds, as of the offer. Fresher than
  // the plans snapshot the tick started from, and the two can differ by a move.
  offerItinerary = [] as unknown[],
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
      return offerAt(offerHour, offerMinute, offerItinerary);
    }
  );
  let bookCalls = 0;
  const book = jest.fn(
    async (_offer: unknown, _guests: unknown, control?: RequestControl) => {
      if (preDispatchDelay) await preDispatchDelay;
      const send = async () => {
        control?.onDispatch?.();
        // Taken before the wait, so overlapping calls keep the order they were
        // dispatched in rather than the order they happen to finish in.
        const call = bookCalls++;
        const delay = bookDelays[call] ?? bookDelay;
        if (delay) await delay;
        const failure = bookErrors[call];
        if (failure === 'no-response') {
          throw new Error('Network request failed');
        }
        if (failure !== undefined) {
          throw new RequestError({ ok: false, status: failure, data: {} });
        }
        return {
          id: 'ent-1',
          guests: [{ id: 'g1', name: 'A', entitlementId: 'ent-1' }],
        };
      };
      return control?.start ? control.start(send) : send();
    }
  );
  // Mutable so a test can make a booking appear in the itinerary and later
  // vanish, which is what a real booking followed by a manual cancellation
  // looks like from here. Defaults to the same list the context renders.
  let polled = plans;
  const setPolledPlans = (next: Booking[]) => {
    polled = next;
  };
  let plansCalls = 0;
  const pollPlans = jest.fn(async () => {
    // What plans said when this poll was *asked*, not when it finally answers.
    // A held response that came back stale is the whole point of the delay.
    const answered = polled;
    const delay = plansDelays[plansCalls++];
    if (delay) await delay;
    return answered;
  });
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
      expect.objectContaining({
        tag: `${NOTIFICATION_TAG_NAMESPACE}autopilot-${TODAY}-${BZ}`,
      })
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
        tag: `${NOTIFICATION_TAG_NAMESPACE}autopilot-${TOMORROW}-${BZ}`,
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
    // What paces the rebooking is the attempt lock, not a day's allowance: a
    // release costs CONFIRM_ABSENT_POLLS consecutive absences, and plans are
    // polled once every PLANS_EVERY_N_TICKS ticks. Over this many ticks that is
    // at most two releases, so at most three bookings -- far below the ~40
    // ticks run. Without this bound the loop would be free to rebook on every
    // plans poll.
    const plansPolls = RELEASE_TICKS / PLANS_EVERY_N_TICKS;
    expect(book.mock.calls.length).toBeLessThanOrEqual(
      1 + Math.floor(plansPolls / CONFIRM_ABSENT_POLLS)
    );
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

  it('does not book past the third slot when the confirmation read lags', async () => {
    saveSettings({ ...DEFAULT_SETTINGS, avoidOverlaps: false });
    saveWatchList([
      { experienceId: BZ, autoBook: true },
      { experienceId: DB, autoBook: true },
    ]);
    const { book } = setupBooking({
      experiences: [
        available(BZ, new ParkTime(11)),
        available(DB, new ParkTime(19)),
      ],
      // Two slots are occupied. The first successful booking fills the third,
      // but the immediate Plans read still returns this pre-booking snapshot.
      plans: fullOfWorse().slice(0, 2),
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalled());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(book).toHaveBeenCalledTimes(1);
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

  it('does not book or swap when the flag is off and all slots are full', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { offerOptions, book } = setupBooking({
      offerHour: 11,
      experiences: [available(BZ, new ParkTime(11), { priority: 1.0 })],
      plans: fullOfWorse(),
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(book).not.toHaveBeenCalled();
    expect(offerOptions).toEqual([]);
    expect(screen.getByTestId('lastSkip')).toHaveTextContent('slots-full');
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

/*
 * The drop record as it reads before today's first poll.
 *
 * The summary built at mount omitted the watched-days argument the poll-time
 * one passes, and `coveredDays` is gated on it -- so every scheduled drop time
 * came back with no coverage and the Activity screen said "(not watched yet)"
 * about times it had been watching for days, until something new arrived to
 * force a re-summary. That screen is the only place a built-in drop time's
 * record is visible, and the same numbers are the evidence the demotion switch
 * would act on.
 */
describe('AutopilotProvider drop coverage at mount', () => {
  const EARLIER = ['2021-09-27', '2021-09-28'];

  beforeEach(() => {
    saveWatchList([{ experienceId: HM }]);
    const key = (date: string) => coverageKey(mk.id, date);
    // The poller was running across Haunted Mansion's 13:30 drop on both days,
    // and Haunted Mansion was armed on both.
    saveCoverage(
      Object.fromEntries(
        EARLIER.map(date => [key(date), [coverageBucket(new ParkTime(13, 30))]])
      )
    );
    saveWatchedDays(Object.fromEntries(EARLIER.map(date => [key(date), [HM]])));
  });

  it('reports what earlier days covered, before any poll', () => {
    setupBooking({ experiences: [available(HM, new ParkTime(11))] });
    expect(
      Number(screen.getByTestId('coveredDays').textContent)
    ).toBeGreaterThan(0);
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

  // The banner is the one signal for deciding whether booking still works, so
  // it lying in the reassuring direction is the expensive way for it to be
  // wrong. `observeAction` clears a run on any non-403, but only for a call it
  // is told about, and eligibility was reported solely from the failure path --
  // so the panel latched on for the session and sat over the top of every
  // booking the run went on to make.
  it('stops reporting eligibility once it succeeds again', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    setTime('09:00');
    const { guests } = setupBooking({ guestsStatus: 403 });
    await enable();
    await runTicks(4);
    expect(screen.getByTestId('refused')).toHaveTextContent('eligibility');
    // Disney's filter lifts.
    guests.mockImplementation(async () => party as unknown);
    await runTicks(2);
    expect(screen.getByTestId('refused')).not.toHaveTextContent('eligibility');
  });

  // The offer and booking calls are never made when eligibility is what failed,
  // so recording their status put a refusal against `book` on the strength of a
  // request that never went out, and the banner named the wrong call.
  it('does not blame booking for a refused eligibility call', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    setTime('09:00');
    setupBooking({ guestsStatus: 403 });
    await enable();
    await runTicks(4);
    expect(screen.getByTestId('refused')).toHaveTextContent('eligibility');
    expect(screen.getByTestId('refused')).not.toHaveTextContent('book');
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
                        watchListKey={NEXTLL_WATCHLIST_KEY}
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

  // The probe was the one bare `await` left in the tick, so a `guests` endpoint
  // refusing persistently rejected `onTick` every time: eight consecutive
  // failures and the poller stopped and scheduled nothing, taking watching,
  // alerting and drop learning down with it. Those are the parts a refusal is
  // supposed to leave working.
  it('keeps polling when the eligibility endpoint refuses the probe', async () => {
    armed();
    const { pollExperiences } = setupBooking({
      experiences: withTierOne(),
      plans: [heldPasskey()],
      experiencedIds: [PASSKEY],
      guestsStatus: 403,
    });
    await enable();
    const before = pollExperiences.mock.calls.length;
    // Comfortably past MAX_CONSECUTIVE_FAILURES. Shielded, every tick succeeds
    // and lands on the idle cadence; unshielded, the growing backoff means the
    // later advances do not reach a tick at all, which is what the poll count
    // below detects.
    await runTicks(MAX_CONSECUTIVE_FAILURES + 6);
    expect(screen.getByTestId('mode')).not.toHaveTextContent('stopped');
    // Still actually polling, not merely reporting a mode.
    expect(pollExperiences.mock.calls.length).toBeGreaterThan(before);
  });

  // Failing closed: lifting the hold needs Disney's agreement, and a refused
  // request is not agreement.
  it('leaves the Tier 1 hold on when the probe cannot be read', async () => {
    armed();
    setupBooking({
      experiences: withTierOne(),
      plans: [heldPasskey()],
      experiencedIds: [PASSKEY],
      guestsStatus: 403,
    });
    await enable();
    await runTicks(3);
    expect(screen.getByTestId('passkey')).toHaveTextContent('waiting');
  });

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

/**
 * The day's shared action locks, across instances.
 *
 * They exist so a second tab or the provider NextLL nests inside the app's own
 * cannot act on the same attraction twice. The hazard is the other direction:
 * the write used to be add-only, so a lock could never be let go, and a fresh
 * mount adopted a released one straight back -- which disabled that attraction
 * for the rest of the park day while the screen named no reason.
 */
/*
 * The operation lease.
 *
 * Exclusion between a foreground search and the engine polling underneath it.
 * The ledger's attempt locks are deliberately not involved: those answer
 * "already done today", which made a search defer to work finished hours
 * earlier, and -- once narrowed -- let one provider take over another's live
 * operation because identity was per tab and two providers share a tab.
 */
describe('AutopilotProvider operation lease', () => {
  const claim = async () => {
    await act(async () => {
      screen.getByText('claim BZ modify').click();
    });
    return screen.getByTestId('claimed').textContent;
  };

  it('grants a claim on a reservation nothing is acting on', async () => {
    setupBooking();
    expect(await claim()).toBe('true');
  });

  // The refusal that matters: a request is out for this reservation right now.
  it('refuses while the engine has a request in the air', async () => {
    let releaseOffer = () => {};
    const offerDelay = new Promise<void>(resolve => {
      releaseOffer = resolve;
    });
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      offerDelay,
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(IDLE_INTERVAL_MS);
    });
    expect(await claim()).toBe('false');
    await act(async () => releaseOffer());
  });

  // And the engine gives it back once a definite result has returned. An
  // unknown result is transferred to quarantine; retaining the live-work lease
  // for historical doubt is what used to lock a ride until the 4am rollover.
  it('is free again once the engine has finished', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(await claim()).toBe('true');
  });

  it('refuses a lease another instance holds', async () => {
    setupBooking();
    await acquireLease(leaseKey(BZ, TODAY), 'another-instance');
    expect(await claim()).toBe('false');
  });

  it('lets the engine have it back once the search releases', async () => {
    setupBooking();
    expect(await claim()).toBe('true');
    await act(async () => {
      screen.getByText('release BZ modify').click();
    });
    expect(leaseHolder(leaseKey(BZ, TODAY))).toBeUndefined();
  });

  // A tab closed mid-move leaves its lease behind and nothing comes back for
  // it. Expiry is the only safe way to reclaim a dead instance's work: a reload
  // cannot inherit it, because the script is gone but its last request may have
  // reached Disney and merely lost the response.
  it('lets a stale lease be taken over', async () => {
    setupBooking();
    await acquireLease(leaseKey(BZ, TODAY), 'a-dead-tab', Date.now());
    jest.setSystemTime(Date.now() + LEASE_TTL_MS + 1000);
    expect(await claim()).toBe('true');
  });

  // Two providers live in one tab -- NextLL nests one inside the app's own --
  // so a provider's identity is per instance, and a foreground search owns its
  // lease separately again. A shared id let one take over another's live work,
  // which is the thing ownership exists to stop: the lease is re-entrant for
  // its holder, so sharing an id turns a refusal into a grant.
  it('does not let the engine and a search share an identity', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    let releaseOffer = () => {};
    const offerDelay = new Promise<void>(resolve => {
      releaseOffer = resolve;
    });
    setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      offerDelay,
    });
    await enable();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(IDLE_INTERVAL_MS);
    });
    // The engine holds it; the search is a different owner and is refused.
    expect(leaseHolder(leaseKey(BZ, TODAY))).not.toBe(PROBE_OWNER);
    expect(await claim()).toBe('false');
    await act(async () => releaseOffer());
  });
});

/*
 * Doubt at the reservation level.
 *
 * A status-0 may have moved the reservation. Releasing the lease and trusting
 * the ledger's attempt lock left it unprotected: that lock is keyed by action
 * and attraction, a foreground search does not consult it, and a swap for a
 * different incoming attraction can target the very pass in doubt.
 */
describe('AutopilotProvider unresolved reservations', () => {
  const claim = async () => {
    await act(async () => {
      screen.getByText('claim BZ modify').click();
    });
    return screen.getByTestId('claimed').textContent;
  };

  it('quarantines a reservation whose move never came back', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      bookErrors: ['no-response'],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    // The lease is given back -- nothing is in flight any more -- but the
    // reservation is not free, and will not be until plans say what happened.
    expect(leaseHolder(leaseKey(BZ, TODAY))).toBeUndefined();
    expect(await claim()).toBe('false');
  });

  it('uses visible page-local quarantine when durable storage fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const realSet = kvdb.set.bind(kvdb);
    const set = jest.spyOn(kvdb, 'set').mockImplementation((key, value) => {
      if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
      realSet(key, value);
    });
    try {
      saveWatchList([{ experienceId: BZ, autoModify: true }]);
      const { book } = setupBooking({
        plans: [heldBZAt(19)],
        experiences: [available(BZ, new ParkTime(11))],
        bookErrors: ['no-response'],
      });
      await enable();
      await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
      const key = leaseKey(BZ, TODAY);
      const owner = leaseHolder(key);
      expect(owner).toBeDefined();
      expect(quarantinedAt(key)).toBeDefined();

      // The block is a doubt, not a timer. It remains after a lease TTL without
      // leaving a hidden interval renewing after the operation is over.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(LEASE_TTL_MS + RENEW_INTERVAL_MS);
      });
      expect(leaseHolder(key)).toBeUndefined();
      expect(quarantinedAt(key)).toBeDefined();
      expect(await claim()).toBe('false');
    } finally {
      set.mockRestore();
      for (const doubt of quarantinedMutations()) {
        await resolveDoubt(doubt.key, doubt.id);
      }
      jest.clearAllTimers();
    }
  });

  // A rejection is proof nothing happened, so there is no doubt to record.
  it('does not quarantine a move Disney refused outright', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      bookErrors: [410],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(await claim()).toBe('true');
  });

  // And keeps it while plans go on showing the reservation exactly as it was.
  // Lifting it is the plans pipeline's job, and its rule -- see
  // `PlansProvider reconciles unresolved reservations` and the lease's own
  // tests -- is deliberately stricter than "one read went by".
  it('keeps the doubt while nothing has visibly changed', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      bookErrors: ['no-response'],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(await claim()).toBe('false');
    await runTicks(PLANS_EVERY_N_TICKS + 2);
    expect(await claim()).toBe('false');
  });

  // A failure before the commit request went out cannot have changed anything:
  // all three helpers take their ledger lock immediately before `book()`, so a
  // status-0 on the *offer* call leaves the reservation untouched.
  it('does not quarantine a failure that never reached the commit', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { offer } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      offerErrors: ['no-response'],
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalled());
    expect(await claim()).toBe('true');
  });

  /*
   * The warning records what the offer itself said, not a stale Plans snapshot.
   * Exact destination evidence now controls automatic clearing, but showing a
   * person "from 7pm" when Disney's offer said 1pm would still make the manual
   * resolution screen describe the wrong operation.
   */
  it('records the reservation as the offer found it, not as plans did', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      // Disney's view at the offer: already moved since the snapshot.
      offerItinerary: [
        { facilityId: BZ, startTime: new ParkTime(13), overlap: 'NONE' },
      ],
      bookErrors: ['no-response'],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    const raised = quarantinedAt(leaseKey(BZ, TODAY));
    expect(raised).toBeDefined();
    expect(quarantinedMutations()).toEqual([
      expect.objectContaining({
        key: leaseKey(BZ, TODAY),
        kind: 'modify',
        from: '13:00:00',
        to: '11:00:00',
        reservationIds: ['ent-1'],
      }),
    ]);
    // A plans read finding it where it truly was all along is not the exact
    // destination the request asked for, so it cannot settle the operation.
    await reconcile(
      () => ({ time: '13:00:00', reservationIds: ['ent-1'] }),
      raised! + 1
    );
    expect(await claim()).toBe('false');
  });

  /*
   * A swap records what should *appear*, not only what was.
   *
   * The victim is meant to vanish, so its absence is consistent with the swap
   * having landed -- and equally consistent with the swap never happening and
   * one plans response omitting a reservation that is still there. The only
   * positive proof is the attraction the swap was for turning up.
   */
  describe('after a swap', () => {
    const ranked = (id: string, priority: number): Booking =>
      ({
        type: 'LL',
        subtype: 'MP',
        id: `ent-${id}`,
        facilityId: id,
        name: `Ride ${id}`,
        experience: { id, name: `Ride ${id}`, priority },
        start: new DateTime(TODAY, new ParkTime(15)),
        end: new DateTime(TODAY, new ParkTime(16)),
        cancellable: true,
        modifiable: true,
        guests: [{ id: 'g1', name: 'A' }],
      }) as unknown as Booking;
    const victim = leaseKey('w1', TODAY);

    const unknownSwap = async () => {
      saveWatchList([{ experienceId: BZ, autoSwap: true }]);
      const { book } = setupBooking({
        offerHour: 11,
        experiences: [available(BZ, new ParkTime(11), { priority: 1.0 })],
        plans: [ranked('w1', 4.1), ranked('w2', 3.0), ranked('w3', 2.0)],
        bookErrors: ['no-response'],
      });
      await enable();
      await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
      const raised = quarantinedAt(victim);
      expect(raised).toBeDefined();
      expect(quarantinedMutations()).toEqual([
        expect.objectContaining({
          key: victim,
          reservationIds: ['ent-w1'],
        }),
      ]);
      return raised!;
    };

    it('does not settle on the victim simply being gone', async () => {
      const raised = await unknownSwap();
      await reconcile(() => undefined, raised + 1);
      expect(quarantinedAt(victim)).toBe(raised);
    });

    it('settles once the attraction it was for appears', async () => {
      const raised = await unknownSwap();
      await reconcile(
        key =>
          key === leaseKey(BZ, TODAY)
            ? { time: '11:00:00', reservationIds: ['ent-w1'] }
            : undefined,
        raised + 1
      );
      expect(quarantinedAt(victim)).toBeUndefined();
    });
  });
});

/*
 * Two ticks of one provider overlapping.
 *
 * The poller's deadline *abandons* an overtime tick without cancelling it --
 * `onTick` keeps running, and only a `stale()` predicate tells it to stop
 * committing. So the next tick starts while the first is still in flight. With
 * one owner for the whole provider the lease is re-entrant between them, so
 * both could hold the same reservation, and whichever finished first would
 * withdraw the other's lease on its way out.
 */
describe('AutopilotProvider overlapping ticks', () => {
  it('does not lease the same reservation to two of its own ticks', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    let releaseOffer = () => {};
    const offerDelay = new Promise<void>(resolve => {
      releaseOffer = resolve;
    });
    const { offer } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      offerDelay,
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalledTimes(1));
    // Past the deadline, so the poller abandons that tick and runs another
    // while the first is still holding its offer open.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(
        TICK_DEADLINE_MS + BACKOFF_BASE_MS * 4
      );
    });
    // The second tick found the reservation leased and skipped it, so it never
    // reached the offer call.
    expect(offer).toHaveBeenCalledTimes(1);
    await act(async () => releaseOffer());
  });
});

/*
 * What happens to a request that never comes back at all.
 *
 * Renewing a lease for as long as its operation is outstanding closed one hole
 * and opened another. `TICK_DEADLINE_MS` abandons a tick without cancelling it,
 * sensor generation is awaited outside any request timeout, and a promise that
 * never settles never reaches the `finally` that stops the timer -- so one
 * wedged request held a reservation until the 4am rollover, with nothing on any
 * screen saying why nothing was acting on it.
 *
 * `MAX_MUTATION_MS` is where the engine stops believing in it. What it does then
 * depends on which side of the commit boundary the request was on, because that
 * is the difference between a reservation nothing has touched and one whose
 * state nobody will ever learn.
 */
describe('AutopilotProvider abandoned operations', () => {
  const hang = () => new Promise<void>(() => {});

  it('passes the operation signal into work waiting before dispatch', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    let releasePreDispatch: () => void = () => undefined;
    const preDispatchDelay = new Promise<void>(resolve => {
      releasePreDispatch = resolve;
    });
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      preDispatchDelay,
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    const control = book.mock.calls[0]![2];

    await act(async () => {
      await jest.advanceTimersByTimeAsync(MAX_MUTATION_MS + 1);
    });
    const wasAborted = control?.signal.aborted;
    await act(async () => releasePreDispatch());

    expect(wasAborted).toBe(true);
  });

  it('keeps a dispatched request alive long enough to clear its own doubt', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    let releaseBook: () => void = () => undefined;
    const bookDelay = new Promise<void>(resolve => {
      releaseBook = resolve;
    });
    const key = leaseKey(BZ, TODAY);
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      bookDelay,
      bookErrors: [410],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    const control = book.mock.calls[0]![2];
    await quarantine(
      key,
      { id: 'other-operation', kind: 'modify', to: '12:00:00' },
      Date.now()
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(RENEW_INTERVAL_MS);
    });
    await waitFor(() => expect(quarantinedMutations()).toHaveLength(2));
    expect(control?.signal.aborted).toBe(false);

    await act(async () => releaseBook());
    await waitFor(() =>
      expect(quarantinedMutations().map(doubt => doubt.id)).toEqual([
        'other-operation',
      ])
    );
    await resolveDoubt(key, 'other-operation');
  });

  it('measures abandonment from the tick that authorised the action', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    let releaseExperiences: () => void = () => undefined;
    const experiencesDelay = new Promise<void>(resolve => {
      releaseExperiences = resolve;
    });
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      experiencesDelay,
      bookDelay: hang(),
    });
    await enable();

    // Most of the authorising tick is spent before the mutation object exists.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
      releaseExperiences();
    });
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(MAX_MUTATION_MS - 60_000 + 1);
    });
    expect(quarantinedAt(leaseKey(BZ, TODAY))).toBeDefined();
  });

  it('gives the reservation back when nothing was ever committed', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { offer } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      offerDelay: hang(),
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalledTimes(1));
    const wedged = leaseHolder(leaseKey(BZ, TODAY));
    expect(wedged).toBeDefined();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(MAX_MUTATION_MS + 1);
    });
    // Not this operation's any more. A later tick may well have taken it, which
    // is the point: the reservation is workable again.
    expect(leaseHolder(leaseKey(BZ, TODAY))).not.toBe(wedged);
    // And nothing is in doubt, because nothing was sent.
    expect(quarantinedAt(leaseKey(BZ, TODAY))).toBeUndefined();
  });

  it('puts the reservation in doubt when a commit never returns', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      bookDelay: hang(),
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(quarantinedAt(leaseKey(BZ, TODAY))).toBeUndefined();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(MAX_MUTATION_MS + 1);
    });
    // The request left the device and its outcome is now unknowable, so the
    // reservation is protected rather than quietly handed to the next tick.
    expect(quarantinedAt(leaseKey(BZ, TODAY))).toBeDefined();
    expect(await claim()).toBe('false');
  });

  const claim = async () => {
    await act(async () => {
      screen.getByText('claim BZ modify').click();
    });
    return screen.getByTestId('claimed').textContent;
  };
});

/*
 * A lease lost while the offer was still being put together.
 *
 * Renewal answers "is this still mine", and throwing the answer away was the
 * whole bug: another actor can quarantine the reservation, or take the lease
 * over after it lapsed, while this attempt is mid-round-trip. Committing on top
 * of that is exactly what the lease exists to prevent, so the answer belongs in
 * the last gate before the request leaves the device.
 */
describe('AutopilotProvider losing a lease mid-attempt', () => {
  it('does not commit after a renewal was refused', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    let releaseOffer = () => {};
    const offerDelay = new Promise<void>(resolve => {
      releaseOffer = resolve;
    });
    const { book, offer } = setupBooking({
      plans: [heldBZAt(19)],
      experiences: [available(BZ, new ParkTime(11))],
      offerDelay,
    });
    await enable();
    await waitFor(() => expect(offer).toHaveBeenCalledTimes(1));
    // Somebody else puts the reservation in doubt while the offer is out.
    await quarantine(leaseKey(BZ, TODAY), { kind: 'modify' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(RENEW_INTERVAL_MS);
    });
    await act(async () => releaseOffer());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(book).not.toHaveBeenCalled();
  });
});

describe('AutopilotProvider shared action locks', () => {
  it('publishes a lock it takes', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(loadLocks()).toEqual([`${TODAY}:book:${BZ}`]);
  });

  // A lock left in the day's copy by an earlier instance still blocks acting:
  // that is the whole point of sharing them.
  it('adopts a lock another instance left behind', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveLocks(OTHER_TAB, [`${TODAY}:book:${BZ}`]);
    const { book } = setupBooking();
    await enable();
    await runTicks(3);
    expect(book).not.toHaveBeenCalled();
  });

  /**
   * ...and gives it back on plans evidence, which is the half with the teeth.
   *
   * This is the only thing in the product that ever releases a lock left by a
   * tab that has since been closed: nothing adopted is ever owned here, so no
   * `releaseAttempt` of ours can reach it, and the shared copy keeps it under
   * its original owner's name until the 4am rollover. Two tabs open on a
   * booking morning and one of them closed after taking a lock is an ordinary
   * morning, and without this the attraction reads `already-attempted` for the
   * rest of the day.
   */
  it('releases a lock another instance left behind once plans settle it', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveLocks(OTHER_TAB, [`${TODAY}:book:${BZ}`]);
    const { book } = setupBooking();
    await enable();
    await runTicks(3);
    expect(book).not.toHaveBeenCalled();
    // Plans never show the reservation, so the absences add up, the lock goes,
    // and this instance books it itself.
    await runTicks(RELEASE_TICKS);
    expect(book).toHaveBeenCalledTimes(1);
  });

  // ...but it must say so. This used to `continue` in silence, which is
  // indistinguishable on screen from nothing being available.
  it('names the adopted lock as the reason it did nothing', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveLocks(OTHER_TAB, [`${TODAY}:book:${BZ}`]);
    setupBooking();
    await enable();
    await runTicks(3);
    expect(screen.getByTestId('lastSkip')).toHaveTextContent(
      new RegExp(`^${wdw.experience(BZ).name}: already-attempted$`)
    );
  });

  // The shape an older build published, which the owner's installed copy is
  // still writing until every tab is reloaded. It blocks, because a key with
  // no date in it cannot say which date it meant and the safe reading is all
  // of them -- which is exactly what the build that wrote it does.
  it('honours a lock left by an older build', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveLocks(OTHER_TAB, [`book:${BZ}`]);
    const { book } = setupBooking();
    await enable();
    await runTicks(3);
    expect(book).not.toHaveBeenCalled();
  });

  // ...and says which of the two it is. This is the one case where the date
  // fix still costs a booking, so it must not be reported in the words that
  // mean somebody else is mid-request on it.
  it('names an older build as the reason, not a live action', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveLocks(OTHER_TAB, [`book:${BZ}`]);
    setupBooking();
    await enable();
    await runTicks(3);
    expect(screen.getByTestId('lastSkip')).toHaveTextContent(
      new RegExp(`^${wdw.experience(BZ).name}: stale-lock$`)
    );
  });

  // The regression, end to end: switching autopilot off and on is how a person
  // says "try again". It has to clear the day's copy of this instance's own
  // locks, or the first tick of the new run reads them back and the run is
  // dead before it starts.
  it('clears its own locks from the day copy when switched on again', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(loadLocks()).toEqual([`${TODAY}:book:${BZ}`]);
    // Off, then disarmed so the new run has nothing to re-book, then on:
    // `reset()` runs on the way in. Disarming is what makes the withdrawal
    // observable on its own -- left armed, the new run books again and takes a
    // fresh lock, which is correct but hides what is being tested.
    await enable();
    await act(async () => {
      screen.getByText('unarm BZ').click();
    });
    await enable();
    expect(loadLocks()).toEqual([]);
  });
});

/**
 * Crossing 4am under a mounted provider.
 *
 * Everything day-scoped here was read once at mount, and this provider does not
 * remount: a phone tab that backgrounds overnight was still holding yesterday
 * at 7am. The log write refuses to write in that state, which kept the
 * staleness out of storage but left the tab acting on it -- yesterday's locks,
 * yesterday's activity log.
 */
describe('AutopilotProvider park-day rollover', () => {
  // Each of these leaves the clock in the next park day, so it has to be put
  // back or the following test starts on the wrong day.
  beforeEach(() => setTime('09:00'));

  /** Move the clock into the next park day and let the check fire. */
  async function crossRollover() {
    jest.setSystemTime(new Date(`${TOMORROW}T07:00-0400`));
    await act(async () => {
      jest.advanceTimersByTime(PARK_DAY_CHECK_MS + 1000);
    });
  }

  it('stops the run rather than carrying it into the new day', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    setupBooking();
    await enable();
    expect(screen.getByTestId('mode')).not.toHaveTextContent('off');
    await crossRollover();
    // `enabled` false puts the poller back to 'off'.
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
  });

  // A lock exists to stop a second action on an attraction *today*.
  it('clears the day-scoped action locks', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(loadLocks()).toEqual([`${TODAY}:book:${BZ}`]);
    await crossRollover();
    // Day-scoped storage reads empty for the new day, and the ledger agrees.
    expect(loadLocks()).toEqual([]);
  });

  it('clears the activity log rather than restamping it under the new day', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(loadBookingLog().length).toBeGreaterThan(0);
    await crossRollover();
    expect(loadBookingLog()).toEqual([]);
  });
});

/**
 * A booking another instance made moments ago.
 *
 * `avoidOverlaps` is checked against the plans this instance last polled plus the
 * offer's own itinerary, and neither sees a commit from elsewhere: plans are
 * refetched every tenth tick, and there are routinely two instances because
 * NextLL nests an AutopilotProvider inside the app's own. So both could pass the
 * overlap check against their own snapshot and commit clashing return times --
 * the outcome the setting exists to prevent.
 */
describe('AutopilotProvider cross-instance overlaps', () => {
  beforeEach(() => setTime('09:00'));

  it('publishes the return time it commits', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11))],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(loadCommits()).toEqual([
      // Carries the reservation's own park day, so a future-date move is filed
      // under the day it is on rather than under today.
      {
        facilityId: BZ,
        time: '11:00:00',
        at: expect.any(Number),
        date: TODAY,
        kind: 'book',
        reservationIds: ['ent-1'],
      },
    ]);
  });

  it('keeps a committed time through a lagging Plans read', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11))],
      plans: [],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(loadCommits()).toHaveLength(1);

    // The next scheduled read still lacks the booking. That is exactly the
    // lag this record bridges, so absence cannot remove it before its TTL.
    await runTicks(PLANS_EVERY_N_TICKS + 2);
    expect(loadCommits()).toHaveLength(1);
  });

  it('keeps a committed move while Plans still shows its old time', async () => {
    saveCommit({
      facilityId: BZ,
      time: '11:00:00',
      kind: 'modify',
      reservationIds: ['ent-1'],
    });
    saveWatchList([{ experienceId: DB, autoBook: true }]);
    setupBooking({
      experiences: [available(DB, new ParkTime(19))],
      plans: [heldBZAt(19)],
      offerHour: 19,
    });
    await enable();
    await runTicks(PLANS_EVERY_N_TICKS + 2);
    expect(loadCommits().some(commit => commit.facilityId === BZ)).toBe(true);
  });

  it('enforces a committed move while Plans still shows its old time', async () => {
    saveCommit({
      facilityId: BZ,
      time: '11:00:00',
      kind: 'modify',
      reservationIds: ['ent-1'],
    });
    saveWatchList([{ experienceId: DB, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(DB, new ParkTime(11, 20))],
      plans: [heldBZAt(19)],
      offerHour: 11,
      offerMinute: 20,
    });
    await enable();
    await runTicks(3);
    expect(book).not.toHaveBeenCalled();
  });

  it('does not settle a commit from another same-ride reservation', async () => {
    saveCommit({
      facilityId: BZ,
      time: '11:00:00',
      kind: 'modify',
      reservationIds: ['ent-target'],
    });
    saveWatchList([{ experienceId: DB, autoBook: true }]);
    const otherReservation = {
      ...heldBZAt(11),
      id: 'ent-other',
      guests: [{ id: 'g1', name: 'A', entitlementId: 'ent-other' }],
    } as Booking;
    setupBooking({
      experiences: [available(DB, new ParkTime(19))],
      plans: [otherReservation],
      offerHour: 19,
    });
    await enable();
    await runTicks(PLANS_EVERY_N_TICKS + 2);
    expect(loadCommits().some(commit => commit.facilityId === BZ)).toBe(true);
  });

  it('does not ignore a split-party commit when moving the same ride', async () => {
    saveCommit({
      facilityId: BZ,
      time: '11:00:00',
      kind: 'modify',
      reservationIds: ['ent-other-half'],
    });
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11, 20))],
      plans: [heldBZAt(19)],
      offerHour: 11,
      offerMinute: 20,
    });
    await enable();
    await runTicks(3);
    expect(book).not.toHaveBeenCalled();
  });

  // The regression: another instance holds 11:00, and this one is asked to book
  // a different attraction at a time inside that reservation's protected span.
  it("refuses a time that clashes with another instance's booking", async () => {
    saveCommit({ facilityId: DB, time: '11:00:00' });
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11, 20))],
      offerHour: 11,
    });
    await enable();
    await runTicks(3);
    expect(book).not.toHaveBeenCalled();
  });

  it('books a time clear of it', async () => {
    saveCommit({ facilityId: DB, time: '11:00:00' });
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(19))],
      offerHour: 19,
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });

  it('ignores the record when clash avoidance is off', async () => {
    saveCommit({ facilityId: DB, time: '11:00:00' });
    saveSettings({ ...DEFAULT_SETTINGS, avoidOverlaps: false });
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11, 20))],
      offerHour: 11,
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });

  // A parsed plan carries an end time and gives the narrower, more accurate
  // span, so it wins over a commit for the same attraction. 11:50 is the test:
  // inside the commit's bare 10:20-12:00 span, outside the held plan's
  // 10:20-11:40 one. The earlier version of this test offered 7pm, eight hours
  // clear of both, so it passed whether or not plans won anything.
  it('defers to plans once they have caught up', async () => {
    saveCommit({ facilityId: BZ, time: '11:00:00' });
    saveWatchList([{ experienceId: DB, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(DB, new ParkTime(11, 50))],
      plans: [heldBZAt(11)],
      offerHour: 11,
      offerMinute: 50,
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });

  // The same time, with the commit alone: refused. Without this the test above
  // proves only that 11:50 is bookable.
  it('refuses that time when only the commit knows about it', async () => {
    saveCommit({ facilityId: BZ, time: '11:00:00' });
    saveWatchList([{ experienceId: DB, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(DB, new ParkTime(11, 50))],
      plans: [],
      offerHour: 11,
      offerMinute: 50,
    });
    await enable();
    await runTicks(3);
    expect(book).not.toHaveBeenCalled();
  });

  // A commit is written for a move and a swap as well as a booking, and the
  // settle loop only ever swept `book:` locks -- so one of those records sat
  // here for the rest of the park day, protecting a return time the party had
  // ridden or cancelled. Two things end it: plans carrying the reservation,
  // and the record outliving the window it exists to cover.
  it('forgets a commit once plans carry the reservation', async () => {
    saveCommit({ facilityId: BZ, time: '11:00:00' });
    saveWatchList([{ experienceId: DB, autoBook: true }]);
    setupBooking({
      experiences: [available(DB, new ParkTime(19))],
      plans: [heldBZAt(11)],
      offerHour: 19,
    });
    await enable();
    await runTicks(PLANS_EVERY_N_TICKS + 2);
    expect(loadCommits().some(commit => commit.facilityId === BZ)).toBe(false);
  });

  it('forgets one that has outlived its window', async () => {
    kvdb.setDaily<CommittedReturn[]>(COMMITS_KEY, [
      { facilityId: BZ, time: '11:00:00', at: Date.now() - COMMIT_TTL_MS },
    ]);
    saveWatchList([{ experienceId: DB, autoBook: true }]);
    setupBooking({
      experiences: [available(DB, new ParkTime(19))],
      offerHour: 19,
    });
    await enable();
    await runTicks(PLANS_EVERY_N_TICKS + 2);
    expect(loadCommits().some(commit => commit.facilityId === BZ)).toBe(false);
  });

  // The park failure: an expired record must stop refusing return times as
  // well as stop being stored.
  it('books a time an expired commit used to block', async () => {
    kvdb.setDaily<CommittedReturn[]>(COMMITS_KEY, [
      { facilityId: DB, time: '11:00:00', at: Date.now() - COMMIT_TTL_MS },
    ]);
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({
      experiences: [available(BZ, new ParkTime(11, 20))],
      offerHour: 11,
      offerMinute: 20,
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
  });
});

/**
 * Roadmap item 10, end to end: the booking date moving under a lock.
 *
 * This is the morning of 2026-10-11 in miniature. The party is on-site, so all
 * three October park days are booked in one sitting from one date picker: three
 * dates, many searches, the picker moved between them. An action lock that did
 * not name a date retired an attraction on dates nothing had been attempted for.
 */
describe('AutopilotProvider across booking dates', () => {
  beforeEach(() => setTime('09:00'));

  /** A Multi Pass for BZ on a given date, with its own entitlement id. */
  function heldOn(date: string, hour: number, id: string): Booking {
    return {
      type: 'LL',
      subtype: 'MP',
      id,
      facilityId: BZ,
      name: 'Held',
      start: new DateTime(date, new ParkTime(hour)),
      end: new DateTime(date, new ParkTime(hour + 1)),
      cancellable: true,
      modifiable: true,
      guests: [{ id: 'g1', name: 'A' }],
    } as unknown as Booking;
  }

  // The user-visible bug. Book for one date, move the picker, and the
  // attraction was skipped as already-attempted on a date holding nothing.
  it('books again for the date the picker moved to', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, offerOptions, setBookingDate } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    await act(async () => setBookingDate(TOMORROW));
    await runTicks(2);
    expect(book).toHaveBeenCalledTimes(2);
    // And for the new date, not a second attempt at the old one.
    expect(offerOptions[0]).toEqual({ date: TODAY });
    expect(offerOptions[1]).toEqual({ date: TOMORROW });
  });

  // The case that never healed. A booking whose response was lost leaves a lock
  // this instance owns and has never seen held, and the doubt-hold returns
  // before the absence counter -- correctly, for its own date. Undated, that
  // hold covered every other date too, for the rest of the session, which is
  // precisely the shape a 7am rush produces.
  it('books for a new date although the old one is still in doubt', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, offerOptions, setBookingDate } = setupBooking({
      bookErrors: ['no-response'],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    await act(async () => setBookingDate(TOMORROW));
    await runTicks(RELEASE_TICKS);
    expect(book).toHaveBeenCalledTimes(2);
    expect(offerOptions[1]).toEqual({ date: TOMORROW });
  });

  // The half with no release path at all. `modify` locks were never swept, so
  // no evidence could clear one: a move made for one date blocked moving that
  // attraction on every other date for the rest of the session.
  it('moves a reservation on a new date after moving one on the old', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book, offerOptions, setBookingDate } = setupBooking({
      offerHour: 11,
      plans: [heldOn(TODAY, 19, 'ent-1'), heldOn(TOMORROW, 19, 'ent-2')],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(offerOptions[0]).toEqual({
      booking: expect.objectContaining({ id: 'ent-1' }),
    });

    await act(async () => setBookingDate(TOMORROW));
    await runTicks(2);
    expect(book).toHaveBeenCalledTimes(2);
    expect(offerOptions[1]).toEqual({
      booking: expect.objectContaining({ id: 'ent-2' }),
    });
  });

  // The release path itself, on one date. The settle loop swept `book` locks
  // only, so nothing could ever clear a move's lock: cancel the reservation by
  // hand and the attraction stayed unmovable for the rest of the session, with
  // the lock sitting in the day's shared copy for every other instance to adopt.
  it('releases a move lock once the reservation is gone', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    const { book, setPolledPlans } = setupBooking({
      offerHour: 11,
      plans: [heldOn(TODAY, 19, 'ent-1')],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await runTicks(PLANS_EVERY_N_TICKS + 1);
    expect(loadLocks()).toEqual([`${TODAY}:modify:${BZ}`]);

    // Paused, so the only thing that can touch the lock from here is the
    // settle loop -- which is what this is about.
    await act(async () => {
      screen.getByText('pause BZ').click();
    });
    // Cancelled by hand. Two consecutive plans polls without it are what the
    // release needs, and the first one of those also has to have seen it held.
    setPolledPlans([]);
    await runTicks(RELEASE_TICKS);
    expect(loadLocks()).toEqual([]);
  });

  /**
   * The retry token is paired one to one with a ledger lock, so it has to carry
   * the same date the lock does.
   *
   * Keyed by action alone, a token minted for a rejection on one date expires
   * and releases a *different* date's doubt-hold -- re-sending a booking whose
   * outcome was never learned. That inverts the rule the ledger is built on,
   * and it is the same inversion the comment above `RETRY_AFTER_MS`'s consumer
   * already warns about, reached by a different route.
   */
  it('does not let a retry token from one date unlock another', async () => {
    saveWatchList([{ experienceId: BZ, bookThenMove: true }]);
    const { book, setBookingDate } = setupBooking({
      repeatMoves: true,
      // Today's attempt is refused outright, which mints a token. Tomorrow's
      // takes a real lock and then never hears back.
      bookErrors: [410, 'no-response'],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    await act(async () => setBookingDate(TOMORROW));
    await runTicks(2);
    // The second attempt happened -- otherwise this would pass for the trivial
    // reason that nothing ever took a lock on the new date.
    expect(book).toHaveBeenCalledTimes(2);
    // Long enough for today's token to have expired several times over.
    await runTicks(Math.ceil(RETRY_AFTER_MS / IDLE_INTERVAL_MS) + 4);
    expect(book).toHaveBeenCalledTimes(2);
  });

  // Publication is symmetric with adoption: a key for the date the picker moved
  // off must keep being republished, since the per-tick write is what heals a
  // lost one. Left out, moving the picker silently abandons a live lock.
  it('keeps publishing the old date’s lock after the picker moves', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, setBookingDate } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    await act(async () => setBookingDate(TOMORROW));
    await runTicks(2);
    expect(loadLocks().sort()).toEqual([
      `${TODAY}:book:${BZ}`,
      `${TOMORROW}:book:${BZ}`,
    ]);
  });
});

/**
 * The settle loop, driven end to end rather than at the ledger.
 *
 * The provider is where the two halves meet: it picks the action from the same
 * plans the sweep reads, and it sweeps before it acts, so a tick that settles a
 * lock can book on that same observation a few lines later. Every case below
 * was reachable only through that ordering.
 */
describe('AutopilotProvider settling action locks', () => {
  beforeEach(() => setTime('09:00'));
  // The poll interval carries +/-20%% jitter, and every case below turns on
  // which *poll* a thing lands on. Pinned to the midpoint, where `withJitter`
  // returns the interval unchanged, so a tick is a tick.
  beforeEach(() => jest.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => jest.restoreAllMocks());

  /**
   * The double booking. An attraction held, moved, cancelled by hand, rebooked,
   * and the rebooking's response lost.
   *
   * Sharing "seen held" across kinds let the move-era observation stand in for
   * evidence about the booking, so two absent polls threw away the doubt-hold
   * protecting a request whose outcome was never learned -- and the next pass
   * of the action loop spent a second entitlement on the same attraction.
   */
  it('does not rebook a lost booking on a move’s evidence', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true, autoModify: true }]);
    const { book, offerOptions, pollPlans, setPolledPlans } = setupBooking({
      offerHour: 11,
      plans: [heldBZAt(19)],
      // The move lands. The booking that follows the manual cancellation never
      // hears back, which is exactly what the doubt-hold is for.
      bookErrors: [undefined, 'no-response'],
    });
    // A fresh booking offers against a date; a move offers against the
    // reservation it is moving. Only the first kind spends an entitlement, and
    // only the first kind is what must not happen twice.
    const bookings = () => offerOptions.filter(o => 'date' in o).length;
    // Plans are polled every tenth tick, and the whole of this failure is which
    // *poll* each thing lands on -- so step by poll rather than by tick, or the
    // test is measuring where the arithmetic happened to land.
    const untilNextPlansPoll = async () => {
      const polls = pollPlans.mock.calls.length;
      // Generously: the poll interval carries jitter, so a fixed number of
      // 45-second advances does not map one to one onto ticks.
      for (let i = 0; i < PLANS_EVERY_N_TICKS * 3; ++i) {
        if (pollPlans.mock.calls.length > polls) {
          // Let the rest of that tick finish: the sweep runs on the poll, and
          // the action loop it feeds is a dozen awaits further on. Advancing by
          // zero drains those without reaching the next tick, which is ~45s
          // away.
          await act(async () => {
            for (let drain = 0; drain < 20; ++drain) {
              await jest.advanceTimersByTimeAsync(0);
            }
          });
          return;
        }
        await runTicks(1);
      }
      throw new Error('no plans poll happened');
    };
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    // A poll that sees the reservation: what confirms the move's lock.
    await untilNextPlansPoll();

    // Cancelled by hand. The next poll is the first that shows it gone, and
    // that same tick's action loop goes on to book -- sweep first, act second.
    setPolledPlans([]);
    await untilNextPlansPoll();
    // The booking really was made and really is in doubt. Without this the rest
    // would pass for the trivial reason that nothing ever took the lock this is
    // about.
    expect(bookings()).toBe(1);
    expect(loadLocks()).toContain(`${TODAY}:book:${BZ}`);

    // The second absent poll. This is the one: the move's lock has now been
    // seen absent twice and goes, and sharing "seen held" across kinds hands
    // the booking that same second observation.
    await untilNextPlansPoll();
    expect(bookings()).toBe(1);
    expect(loadLocks()).toContain(`${TODAY}:book:${BZ}`);

    // And it stays held, however long nothing is there.
    await runTicks(RELEASE_TICKS * 2);
    expect(bookings()).toBe(1);
    expect(loadLocks()).toContain(`${TODAY}:book:${BZ}`);
  });

  // The legacy branch of `settleableIds` is the only thing that feeds an old
  // build's lock into this loop, and it is the whole of the back-compat claim:
  // a date-less key clears on the same evidence, in the same two polls, as the
  // build that wrote it clears it.
  it('clears an older build’s booking lock on plans evidence', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveLocks(OTHER_TAB, [`book:${BZ}`]);
    const { book } = setupBooking();
    await enable();
    await runTicks(2);
    expect(book).not.toHaveBeenCalled();
    await runTicks(RELEASE_TICKS);
    expect(book).toHaveBeenCalledTimes(1);
  });

  // ...but only `book:`, because only `book:` clears in the build that wrote
  // it. Releasing its move lock on our evidence would free an action that build
  // still considers taken.
  it('leaves an older build’s move lock blocking', async () => {
    saveWatchList([{ experienceId: BZ, autoModify: true }]);
    saveLocks(OTHER_TAB, [`modify:${BZ}`]);
    const { book, setPolledPlans } = setupBooking({
      offerHour: 11,
      plans: [heldBZAt(19)],
    });
    await enable();
    await runTicks(PLANS_EVERY_N_TICKS + 1);
    // The very evidence that clears a date-less `book:` key, applied for far
    // longer than a release needs. The reservation the *context* reports is
    // still there, so a cleared lock would be acted on immediately.
    setPolledPlans([]);
    await runTicks(RELEASE_TICKS * 2);
    expect(book).not.toHaveBeenCalled();
    // And it is still the older build's key doing the blocking, not some other
    // guard that would make this pass for the wrong reason.
    expect(screen.getByTestId('lastSkip')).toHaveTextContent(
      new RegExp(`^${wdw.experience(BZ).name}: stale-lock$`)
    );
  });

  // Two locks on one attraction, one absent poll. The dedup in `settleableIds`
  // is what keeps that from counting as two observations and releasing both
  // after a single one.
  it('does not release two locks on one attraction after one absent poll', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true, autoModify: true }]);
    saveLocks(OTHER_TAB, [`${TODAY}:book:${BZ}`, `${TODAY}:modify:${BZ}`]);
    const { book, setPolledPlans } = setupBooking({ plans: [heldBZAt(19)] });
    await enable();
    // One poll showing it held, then exactly one showing it gone.
    await runTicks(PLANS_EVERY_N_TICKS + 1);
    setPolledPlans([]);
    await runTicks(PLANS_EVERY_N_TICKS);
    expect(book).not.toHaveBeenCalled();
  });

  // A swap's lock is published in the dated shape and released by the same
  // evidence, at the provider boundary rather than only in the ledger.
  it('publishes and releases a swap lock', async () => {
    saveWatchList([{ experienceId: BZ, autoSwap: true }]);
    const heldRanked = (id: string, priority: number): Booking =>
      ({
        type: 'LL',
        subtype: 'MP',
        id: `ent-${id}`,
        facilityId: id,
        name: `Ride ${id}`,
        experience: { id, name: `Ride ${id}`, priority },
        start: new DateTime(TODAY, new ParkTime(15)),
        end: new DateTime(TODAY, new ParkTime(16)),
        cancellable: true,
        modifiable: true,
        guests: [{ id: 'g1', name: 'A' }],
      }) as unknown as Booking;
    const { book, setPolledPlans } = setupBooking({
      offerHour: 11,
      experiences: [available(BZ, new ParkTime(11), { priority: 1.0 })],
      plans: [
        heldRanked('w1', 4.1),
        heldRanked('w2', 3.0),
        heldRanked('w3', 2),
      ],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    expect(loadLocks()).toContain(`${TODAY}:swap:${BZ}`);

    // The gained reservation appears, then is cancelled by hand: seen held, and
    // then absent twice, which is what a release needs.
    await act(async () => {
      screen.getByText('pause BZ').click();
    });
    setPolledPlans([heldBZAt(11)]);
    await runTicks(PLANS_EVERY_N_TICKS + 1);
    setPolledPlans([]);
    await runTicks(RELEASE_TICKS);
    expect(loadLocks()).not.toContain(`${TODAY}:swap:${BZ}`);
  });
});

/**
 * Which of the two things blocking an attraction the screen names.
 *
 * `stale-lock` tells the owner to reload their other tabs. That is the right
 * answer only when an un-interpretable key is the *only* thing in the way; said
 * over the top of a live request from a current-build tab it sends them to do
 * something that cannot help.
 */
describe('AutopilotProvider naming what blocks an attraction', () => {
  beforeEach(() => setTime('09:00'));

  it('names the live action when a dated lock blocks alongside a stale one', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    saveLocks(OTHER_TAB, [`book:${BZ}`, `${TODAY}:book:${BZ}`]);
    setupBooking();
    await enable();
    await runTicks(2);
    expect(screen.getByTestId('lastSkip')).toHaveTextContent(
      new RegExp(`^${wdw.experience(BZ).name}: already-attempted$`)
    );
  });
});

/**
 * Ticks overlap, and the ledger holds one booking date at a time.
 *
 * `usePoller` stops waiting on a tick at `TICK_DEADLINE_MS` and starts the next
 * one while the abandoned tick runs on to completion. That next tick moves the
 * ledger onto whatever date the picker is on now -- so the tail of the
 * abandoned tick, which carries no date of its own, would act on a different
 * date's records than the one it fetched plans for and took its lock on.
 */
describe('AutopilotProvider with ticks overlapping a date change', () => {
  beforeEach(() => setTime('09:00'));
  // The poll interval carries +/-20%% jitter, and every case below turns on
  // which *poll* a thing lands on. Pinned to the midpoint, where `withJitter`
  // returns the interval unchanged, so a tick is a tick.
  beforeEach(() => jest.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => jest.restoreAllMocks());

  it('settles a rejection against the date its own tick was working', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let releaseFirst: () => void = () => undefined;
    const firstBook = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const { book, setBookingDate } = setupBooking({
      // The first request stalls past the tick deadline and comes back a 410 --
      // proof it changed nothing. The second takes a real lock for the new date
      // and never hears back, which is the doubt the 410 must not settle.
      bookDelays: [firstBook],
      bookErrors: [410, 'no-response'],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    // Past the deadline: the poller gives up on that tick and schedules the
    // next, while the request is still out.
    await runTicks(Math.ceil(TICK_DEADLINE_MS / IDLE_INTERVAL_MS) + 1);
    await act(async () => setBookingDate(TOMORROW));
    await runTicks(2);
    // The new date really did take a lock -- otherwise this would pass for the
    // trivial reason that there was nothing there to withdraw.
    expect(book).toHaveBeenCalledTimes(2);
    expect(loadLocks()).toContain(`${TOMORROW}:book:${BZ}`);

    // And now the stalled request answers, for the date it was sent on.
    await act(async () => releaseFirst());
    await runTicks(2);
    // Its rejection withdraws its own date's lock and leaves the other date's
    // doubt-hold alone. Withdrawn the wrong way round, nothing is protecting
    // tomorrow's booking and NextLL's provider books it a second time.
    expect(loadLocks()).toEqual([`${TOMORROW}:book:${BZ}`]);
  });

  /**
   * The same inversion at the sweep, which is the site that can release every
   * lock the ledger holds.
   *
   * There is no `stale()` check anywhere between `await pollPlans()` and the
   * settle sweep, so a tick abandoned at its deadline resumes *there* — with
   * its own date and its own plans, against a ledger a newer tick has since
   * moved. Unwrapped, it reads the newer date's locks and judges them on the
   * older date's plans: today's reservation stands in for tomorrow's, which
   * confirms a lock nothing has ever seen held, and confirmation is the one
   * condition standing between a booking whose response was lost and a second
   * entitlement.
   */
  it('sweeps the locks of the date its own tick fetched plans for', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let releasePlans: () => void = () => undefined;
    const stalledPlans = new Promise<void>(resolve => {
      releasePlans = resolve;
    });
    const { book, setBookingDate } = setupBooking({
      // Today holds BZ, so today's tick never books and today has no lock...
      plans: [heldBZAt(11, TODAY)],
      // ...and today's plans poll stalls past the tick deadline.
      plansDelays: [stalledPlans],
      // Tomorrow's booking is the one that never hears back.
      bookErrors: ['no-response'],
    });
    await enable();
    await runTicks(Math.ceil(TICK_DEADLINE_MS / IDLE_INTERVAL_MS) + 1);
    await act(async () => setBookingDate(TOMORROW));
    await runTicks(2);
    // Tomorrow really did take a lock and lose the response -- otherwise this
    // would pass for the trivial reason that there was nothing to protect.
    expect(book).toHaveBeenCalledTimes(1);
    expect(loadLocks()).toEqual([`${TOMORROW}:book:${BZ}`]);

    // And now today's plans answer, long after the picker moved.
    await act(async () => releasePlans());
    await runTicks(RELEASE_TICKS);

    // Swept on its own date there is nothing there to settle. Swept on
    // tomorrow's, today's held reservation confirms tomorrow's in-doubt lock,
    // two absent polls then release it, and BZ is booked a second time for a
    // date that may already hold it.
    expect(book).toHaveBeenCalledTimes(1);
  });

  /**
   * The same inversion, from inside the booking helper rather than after it.
   *
   * `markBooked` runs when the booking round trip returns, which for an
   * abandoned tick is long after a newer one moved the ledger. It clears the
   * doubt-hold for a request whose response was lost, so on the wrong date it
   * discards the only thing standing between that date and a second
   * entitlement. The helpers take a `BookLedger` rather than the instance so
   * the provider can hand them one pinned to the tick's own date.
   */
  it('counts a stalled booking against the date it was made for', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    let releaseFirst: () => void = () => undefined;
    const firstBook = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const { book, setBookingDate, setPolledPlans } = setupBooking({
      // Today's booking stalls past the tick deadline and then succeeds.
      // Tomorrow's takes a lock and never hears back.
      bookDelays: [firstBook],
      bookErrors: [undefined, 'no-response'],
    });
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    await runTicks(Math.ceil(TICK_DEADLINE_MS / IDLE_INTERVAL_MS) + 1);
    await act(async () => setBookingDate(TOMORROW));
    await runTicks(2);
    expect(book).toHaveBeenCalledTimes(2);

    // Today's booking finally lands.
    await act(async () => releaseFirst());
    await runTicks(2);
    expect(screen.getByTestId('bookedCount')).toHaveTextContent('1');

    // Tomorrow's turns up in plans, which is what settles the doubt it left.
    // Cleared against the wrong date above, there is no doubt left to settle
    // and this booking is never counted -- nor protected.
    setPolledPlans([heldBZAt(11, TOMORROW)]);
    await runTicks(PLANS_EVERY_N_TICKS + 1);
    expect(screen.getByTestId('bookedCount')).toHaveTextContent('2');
  });
});

/*
 * The invariant the two tests above rest on, checked over the source itself.
 *
 * The ledger holds one booking date at a time and ticks overlap by design, so
 * correctness here is not a property of any one call site: it is the property
 * that *every* date-sensitive ledger call in a tick goes through
 * `onBookingDate`. A behavioural test can only reach the sites that have a
 * visible consequence today — the rejection, the stalled `markBooked`, the
 * settle sweep — and the remaining ones (the repeatMoves release, the dry-run
 * mark) are wrapped for the same reason with nothing yet able to say so. A
 * contributor adding a sixth unwrapped call gets no signal from any of them.
 *
 * Read over the source, in the shape `events.test.ts` already uses for the
 * skip-reason labels: derived from what the file actually says rather than
 * from a list kept by hand, so it cannot quietly fall behind.
 */
describe('AutopilotProvider ledger calls in a tick', () => {
  // These answer about every booking date this instance has touched, or about
  // none at all, so the date the ledger happens to be on cannot change what
  // they say. Safe outside the wrapper, and deliberately a short list.
  const DATE_AGNOSTIC = new Set([
    'adoptAttempted',
    'publishableKeys',
    'bookedCount',
    'reset',
    'startNewDay',
  ]);
  // The wrapper's own machinery, plus the once-per-tick statement of the date
  // that puts the ledger on the date this tick captured.
  const MOVES_THE_DATE = new Set(['bookingDate', 'setBookingDate']);

  const source = readFileSync(
    join(process.cwd(), 'src', 'providers', 'AutopilotProvider.tsx'),
    'utf8'
  );

  /** The character span of each `onBookingDate(...)` call, parens matched. */
  const wrappedSpans = (text: string): [number, number][] => {
    const spans: [number, number][] = [];
    const calls = /onBookingDate\(/g;
    let call: RegExpExecArray | null;
    while ((call = calls.exec(text))) {
      let depth = 0;
      let i = call.index + call[0].length - 1;
      for (; i < text.length; ++i) {
        if (text[i] === '(') ++depth;
        else if (text[i] === ')' && --depth === 0) break;
      }
      spans.push([call.index, i]);
    }
    return spans;
  };

  it('routes every date-sensitive one through onBookingDate', () => {
    const spans = wrappedSpans(source);
    // Guards the guard: a regex that matched nothing would pass silently.
    expect(spans.length).toBeGreaterThan(4);
    const unwrapped = [...source.matchAll(/ledgerRef\.current\.(\w+)/g)]
      .filter(
        use => !DATE_AGNOSTIC.has(use[1]!) && !MOVES_THE_DATE.has(use[1]!)
      )
      .filter(
        use => !spans.some(([from, to]) => use.index > from && use.index < to)
      )
      .map(use => use[1]!);
    expect(unwrapped).toEqual([]);
  });

  // And the allowlist is not a place to hide a call: every name on it has to
  // be a method the ledger actually has, and every date-sensitive method has
  // to be absent from it.
  it('keeps the allowlist honest', () => {
    const ledger = new AutoBookLedger(TODAY);
    for (const name of [...DATE_AGNOSTIC, ...MOVES_THE_DATE]) {
      expect(name in ledger || name in Object.getPrototypeOf(ledger)).toBe(
        true
      );
    }
    for (const name of ['hasAttempted', 'markAttempted', 'markBooked']) {
      expect(DATE_AGNOSTIC.has(name)).toBe(false);
    }
  });
});

/**
 * A booking date the ledger cannot read.
 *
 * `BookingDateProvider` validates, so nothing reaches here today -- but the key
 * shape now depends on the date being a real one: an empty string would build
 * `:book:80010114`, which collides across every date in exactly the way dating
 * the keys exists to prevent, while passing every test that supplies a real
 * date. So the ledger refuses it, and this is what that refusal looks like from
 * the outside: named on screen, not a quietly idle engine.
 */
describe('AutopilotProvider given an unreadable booking date', () => {
  beforeEach(() => setTime('09:00'));

  it('stops and says why, rather than acting on a date nobody chose', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book, setBookingDate } = setupBooking();
    await enable();
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));

    await act(async () => setBookingDate(''));
    // Past the backoff, which grows with each failure.
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES + 2; ++i) {
      await runTicks(1, BACKOFF_BASE_MS * 2 ** MAX_CONSECUTIVE_FAILURES);
    }
    expect(screen.getByTestId('mode')).toHaveTextContent('stopped');
    expect(screen.getByTestId('lastError')).toHaveTextContent(
      'Not a booking date'
    );
    // And nothing was booked against the unreadable date.
    expect(book).toHaveBeenCalledTimes(1);
  });

  /**
   * The same refusal arriving on the *first* render, which is the half that
   * used to take the screen down.
   *
   * `??=` stopped the ledger being constructed on every render; it still runs
   * on the first, so a provider mounted with a date it cannot read threw out
   * of `render`, with no error boundary under it. The construction now takes
   * the park day, which is a park date by construction, and the picker's date
   * reaches the ledger inside the poller -- where a refusal is a stopped run
   * with a reason on it rather than a blank screen.
   */
  it('mounts on an unreadable date and still says why', async () => {
    saveWatchList([{ experienceId: BZ, autoBook: true }]);
    const { book } = setupBooking({ bookingDate: '' });
    // Rendering got this far, which is the whole point: the Probe is on screen.
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
    await enable();
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES + 2; ++i) {
      await runTicks(1, BACKOFF_BASE_MS * 2 ** MAX_CONSECUTIVE_FAILURES);
    }
    expect(screen.getByTestId('mode')).toHaveTextContent('stopped');
    expect(screen.getByTestId('lastError')).toHaveTextContent(
      'Not a booking date'
    );
    expect(book).not.toHaveBeenCalled();
  });
});
