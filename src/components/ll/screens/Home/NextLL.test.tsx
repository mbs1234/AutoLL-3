import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { mk, wdw } from '@/__fixtures__/resort';
import { Booking } from '@/api/itinerary';
import { Experience } from '@/api/ll';
import { MIN_TARGETED_IMPROVEMENT_MINUTES } from '@/autopilot/automodify';
import { NEXTLL_PENDING_KEY, PendingSearch } from '@/autopilot/nextll';
import { PollerStatus } from '@/autopilot/usePoller';
import {
  WatchTarget,
  loadWatchList,
  saveWatchList,
} from '@/autopilot/watchlist';
import AutopilotContext, { AutopilotState } from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import TabsContext from '@/contexts/TabContext';
import { DateTime, ParkTime } from '@/datetime';
import kvdb from '@/kvdb';
import { TODAY, TOMORROW } from '@/testing';

import { NEXTLL, NEXTLL_WATCHLIST_KEY, NextLL, NextLLChooser } from './NextLL';

const BZ = '80010114';
const OFF: PollerStatus = { mode: 'off', consecutiveFailures: 0, polls: 0 };
const RUNNING: PollerStatus = {
  mode: 'idle',
  consecutiveFailures: 0,
  polls: 7,
};
/** What usePoller leaves behind after MAX_CONSECUTIVE_FAILURES. */
const STOPPED: PollerStatus = {
  mode: 'stopped',
  consecutiveFailures: 8,
  polls: 40,
  lastError: 'Unauthorized',
};

function llExperience(id: string): Experience {
  return {
    ...wdw.experience(id),
    park: mk,
    standby: { available: true, waitTime: 30 },
    flex: { available: true, nextAvailableTime: new ParkTime(11) },
  } as Experience;
}

/** A held Multi Pass for BZ at the given hour. */
function heldAt(hour: number, date = TODAY): Booking {
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

function setup({
  status = OFF,
  enabled: initialEnabled = false,
  targets: initialTargets = [] as WatchTarget[],
  plans = [] as Booking[],
  chooser = false,
  ...rest
}: Partial<AutopilotState> & { plans?: Booking[]; chooser?: boolean } = {}) {
  const setEnabled = jest.fn();
  const addTarget = jest.fn();
  const removeTarget = jest.fn();
  const setPartyIds = jest.fn();
  const replaceTargets = jest.fn();
  const changeTab = jest.fn();
  const tab = (name: string) => ({ name, icon: null, component: () => null });
  const tabs = [tab('LL'), tab('Plans'), tab(NEXTLL)];

  // Stateful rather than a frozen object, so that pressing Stop actually
  // leaves the component in the stopped state. The spies still record every
  // call; they just also let the change take effect, which is what makes the
  // unmount tests below mean anything -- "stop, then leave" is a different
  // situation from "leave", and a fixed `enabled` cannot tell them apart.
  function Autopilot({ children }: { children: React.ReactNode }) {
    const [enabled, setEnabledState] = useState(initialEnabled);
    const [targets, setTargetsState] = useState(initialTargets);
    return (
      <AutopilotContext
        value={
          {
            enabled,
            setEnabled: (on: boolean) => {
              setEnabled(on);
              setEnabledState(on);
            },
            status,
            targets,
            isWatched: () => false,
            addTarget,
            removeTarget,
            replaceTargets: (next: WatchTarget[]) => {
              replaceTargets(next);
              setTargetsState(next);
            },
            bookingLog: [],
            sessionLog: [],
            skipCounts: {},
            bookedCount: 0,
            bookingsRemaining: 10,
            ...rest,
          } as unknown as AutopilotState
        }
      >
        {children}
      </AutopilotContext>
    );
  }
  const view = render(
    <ClientsContext value={{ ll: { setPartyIds } } as unknown as Clients}>
      <TabsContext
        value={{
          tabs,
          active: tabs[2]!,
          changeTab,
          scrollPos: { get: () => 0, set: () => {} },
        }}
      >
        <ParkContext value={{ park: mk, setPark: () => {} }}>
          <BookingDateContext
            value={{ bookingDate: TODAY, setBookingDate: () => {} }}
          >
            <PlansContext
              value={{
                plans,
                plansLoaded: true,
                refreshPlans: () => {},
                pollPlans: async () => plans,
                loaderElem: null,
              }}
            >
              <ExperiencesContext
                value={{
                  experiences: [llExperience(BZ)],
                  refreshExperiences: () => {},
                  pollExperiences: async () => [],
                  loaderElem: null,
                }}
              >
                <Autopilot>
                  {chooser ? <NextLLChooser /> : <NextLL />}
                </Autopilot>
              </ExperiencesContext>
            </PlansContext>
          </BookingDateContext>
        </ParkContext>
      </TabsContext>
    </ClientsContext>
  );
  return {
    ...view,
    setEnabled,
    addTarget,
    removeTarget,
    replaceTargets,
    setPartyIds,
    changeTab,
  };
}

const name = wdw.experience(BZ).name;

beforeEach(() => {
  kvdb.clear();
});

describe('NextLL', () => {
  it('starts by distinguishing a new booking from a held-LL modification', () => {
    setup({ chooser: true });
    expect(
      screen.getByRole('button', { name: 'Book a new Lightning Lane' })
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Modify a held Lightning Lane' })
    ).toBeVisible();
  });

  it('keeps the existing new-slot workflow behind its new choice', () => {
    setup({ chooser: true });
    fireEvent.click(
      screen.getByRole('button', { name: 'Book a new Lightning Lane' })
    );
    expect(screen.getByText('Find it')).toBeVisible();
  });

  it('lists an after-midnight reservation under its park day', () => {
    setup({ chooser: true, plans: [heldAt(2, TOMORROW)] });
    fireEvent.click(
      screen.getByRole('button', { name: 'Modify a held Lightning Lane' })
    );
    expect(
      screen.getByRole('button', { name: 'Modify this Lightning Lane' })
    ).toBeVisible();
  });

  // The only way back to the rest of the app. Rendering a bare div instead of
  // a Tab drops the whole footer, which is easy to do and invisible until the
  // screen is open on a phone with nothing to press.
  it('keeps the tab bar, so there is a way back to the LL tab', () => {
    const { changeTab } = setup();
    fireEvent.click(screen.getByText('LL'));
    expect(changeTab).toHaveBeenLastCalledWith('LL');
    fireEvent.click(screen.getByText('Plans'));
    expect(changeTab).toHaveBeenLastCalledWith('Plans');
  });

  // The whole point of the screen: one attraction, one goal, one button. If
  // this grows a second decision it has stopped being NextLL.
  it('asks for an attraction and nothing else that is required', () => {
    setup();
    expect(screen.getByText('Find it')).toBeVisible();
    expect(screen.getByLabelText('Latest acceptable return time')).toHaveValue(
      ''
    );
  });

  it('does nothing without an attraction chosen', () => {
    const { setEnabled, replaceTargets } = setup();
    fireEvent.click(screen.getByText('Find it'));
    expect(replaceTargets).not.toHaveBeenCalled();
    expect(setEnabled).not.toHaveBeenCalled();
  });

  // `bookThenMove` is this problem already solved: take any time so something
  // is held, then treat the window as the goal to move toward.
  it('arms a single book-then-move target with no bound by default', () => {
    const { setEnabled, replaceTargets } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: BZ } });
    fireEvent.click(screen.getByText('Find it'));
    // Replaced, not appended: `addTarget` merges by id, so a target left over
    // from an earlier search would stay armed while the screen named only the
    // new one, and Stop would clear just one of the two.
    expect(replaceTargets).toHaveBeenCalledWith([
      { experienceId: BZ, bookThenMove: true },
    ]);
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it('passes a return-by time through as the upper bound', () => {
    const { replaceTargets } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: BZ } });
    fireEvent.change(screen.getByLabelText('Latest acceptable return time'), {
      target: { value: '13:00' },
    });
    fireEvent.click(screen.getByText('Find it'));
    expect(replaceTargets).toHaveBeenCalledWith([
      {
        experienceId: BZ,
        bookThenMove: true,
        before: new ParkTime(13),
        minImprovementMinutes: MIN_TARGETED_IMPROVEMENT_MINUTES,
      },
    ]);
  });

  it('reports that nothing is held yet while it searches', () => {
    setup({ enabled: true, status: RUNNING, targets: [{ experienceId: BZ }] });
    expect(screen.getByText(/Nothing held yet/)).toBeVisible();
    expect(screen.getByText(name)).toBeVisible();
  });

  // The poller stops itself after eight consecutive failures and returns
  // without scheduling another tick, but leaves `enabled` true -- so every
  // other line on this screen goes on describing a live search. An expired
  // session is the usual cause, and it is the one case where the user has to
  // act, so a screen still saying "Checking..." is the worst possible answer.
  it('says so when the search has given up', () => {
    setup({ enabled: true, status: STOPPED, targets: [{ experienceId: BZ }] });
    expect(screen.getByText(/Stopped after 8 failed checks/)).toBeVisible();
    expect(screen.getByText(/Unauthorized/)).toBeVisible();
  });

  // The state that made this worth a message: something is held, so the
  // reassuring "still looking for something earlier" line renders, and the
  // loop behind it is dead.
  it('says so even while it is holding something', () => {
    setup({
      enabled: true,
      status: STOPPED,
      plans: [heldAt(15)],
      targets: [{ experienceId: BZ, before: new ParkTime(13) }],
    });
    expect(
      screen.getByText(/still looking for something earlier/)
    ).toBeVisible();
    expect(screen.getByText(/Stopped after 8 failed checks/)).toBeVisible();
  });

  it('shows what it is holding, and that it is still improving on it', () => {
    setup({
      enabled: true,
      status: RUNNING,
      plans: [heldAt(15)],
      targets: [{ experienceId: BZ, before: new ParkTime(13) }],
    });
    expect(
      screen.getByText(/still looking for something earlier/)
    ).toBeVisible();
  });

  it('shows activity from this NextLL search without mixing in Autopilot', () => {
    setup({
      enabled: true,
      status: RUNNING,
      bookingLog: [
        {
          name: 'Autopilot-only entry',
          at: new ParkTime(8),
          status: 'booked',
        },
      ],
      sessionLog: [
        {
          name,
          at: new ParkTime(9, 5),
          status: 'booked',
          returnTime: new ParkTime(11),
        },
      ],
      skipCounts: { 'offer-outside-window': 3 },
      lastSkip: {
        name,
        reason: 'offer-outside-window',
        at: new ParkTime(9, 4),
      },
      targets: [{ experienceId: BZ }],
    });
    fireEvent.click(screen.getByText('Activity'));
    expect(screen.getByText(/7 checks in this search/)).toBeVisible();
    expect(screen.getByText(/booked/)).toBeVisible();
    expect(screen.getByText(/Latest check:/)).toHaveTextContent(name);
    expect(screen.getAllByText(/outside the window/)).toHaveLength(2);
    expect(screen.queryByText('Autopilot-only entry')).not.toBeInTheDocument();
  });

  // The goal being met is the one moment the screen should feel finished.
  it('says the goal is met once the held time is inside the bound', () => {
    setup({
      enabled: true,
      status: RUNNING,
      plans: [heldAt(11)],
      targets: [{ experienceId: BZ, before: new ParkTime(13) }],
    });
    expect(screen.getByText(/that will do/)).toBeVisible();
    expect(screen.getByText('Done')).toBeVisible();
  });

  it('stops and clears its target', () => {
    const { setEnabled, replaceTargets } = setup({
      enabled: true,
      status: RUNNING,
      targets: [{ experienceId: BZ }],
    });
    fireEvent.click(screen.getByText('Stop looking'));
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(replaceTargets).toHaveBeenCalledWith([]);
  });
});

// Leaving the tab unmounts the provider, so the search stops whatever this
// screen does about it. These cover the part it can control: not leaving an
// armed target behind, and leaving enough to offer the search back.
describe('NextLL when its tab goes away', () => {
  it('clears the target so it cannot re-arm behind the next search', () => {
    // Seeded, because this harness renders NextLL under a hand-built context
    // rather than the real provider -- so nothing else writes the key, and an
    // unseeded assertion would hold whether or not the cleanup ran.
    saveWatchList(
      [{ experienceId: BZ, bookThenMove: true }],
      NEXTLL_WATCHLIST_KEY
    );
    const { unmount } = setup({
      enabled: true,
      status: RUNNING,
      targets: [{ experienceId: BZ }],
    });
    expect(loadWatchList(NEXTLL_WATCHLIST_KEY)).toHaveLength(1);
    unmount();
    expect(loadWatchList(NEXTLL_WATCHLIST_KEY)).toEqual([]);
  });

  it('remembers what it was looking for, bound and all', () => {
    const { unmount } = setup({
      enabled: true,
      status: RUNNING,
      targets: [{ experienceId: BZ, before: new ParkTime(13) }],
    });
    unmount();
    expect(kvdb.getDaily<PendingSearch>(NEXTLL_PENDING_KEY)).toEqual({
      experienceId: BZ,
      before: '13:00:00',
    });
  });

  // Nothing was running, so there is nothing to offer back. Prompting anyway
  // would make the prompt meaningless.
  it('remembers nothing when no search was running', () => {
    const { unmount } = setup();
    unmount();
    expect(kvdb.getDaily(NEXTLL_PENDING_KEY)).toBeUndefined();
  });

  it('forgets it once the search is stopped by hand', () => {
    const { unmount } = setup({
      enabled: true,
      status: RUNNING,
      targets: [{ experienceId: BZ }],
    });
    fireEvent.click(screen.getByText('Stop looking'));
    unmount();
    expect(kvdb.getDaily(NEXTLL_PENDING_KEY)).toBeUndefined();
  });
});

describe('NextLL on returning to the tab', () => {
  const pending = (before?: string) =>
    kvdb.setDaily<PendingSearch>(NEXTLL_PENDING_KEY, {
      experienceId: BZ,
      ...(before ? { before } : {}),
    });

  it('offers the interrupted search back by name', () => {
    pending();
    setup();
    const offer = screen.getByText(/Still looking for/);
    expect(offer).toBeVisible();
    // Scoped to the offer: the attraction is also one of the options in the
    // picker below it.
    expect(offer).toHaveTextContent(name);
  });

  it('re-arms the same goal in one tap, bound and all', () => {
    pending('13:00:00');
    const { replaceTargets, setEnabled } = setup();
    fireEvent.click(screen.getByText('Resume'));
    expect(replaceTargets).toHaveBeenCalledWith([
      {
        experienceId: BZ,
        bookThenMove: true,
        before: new ParkTime(13),
        minImprovementMinutes: MIN_TARGETED_IMPROVEMENT_MINUTES,
      },
    ]);
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(kvdb.getDaily(NEXTLL_PENDING_KEY)).toBeUndefined();
  });

  // Resume applies the goal and hides the form, so the refill is observable
  // only once the search is stopped again -- which is exactly when it
  // matters: the picker has to come back holding what was resumed rather than
  // empty, or pressing Find it again silently arms an unbounded search.
  it('refills the form, so stopping does not lose the goal', () => {
    pending('13:00:00');
    setup();
    fireEvent.click(screen.getByText('Resume'));
    fireEvent.click(screen.getByText('Stop looking'));
    expect(screen.getByRole('combobox')).toHaveValue(BZ);
    expect(screen.getByLabelText('Latest acceptable return time')).toHaveValue(
      '13:00'
    );
  });

  it('drops the offer without arming anything', () => {
    pending();
    const { replaceTargets, setEnabled } = setup();
    fireEvent.click(screen.getByText('Start something else'));
    expect(screen.queryByText(/Still looking for/)).not.toBeInTheDocument();
    expect(replaceTargets).not.toHaveBeenCalled();
    expect(setEnabled).not.toHaveBeenCalled();
    expect(kvdb.getDaily(NEXTLL_PENDING_KEY)).toBeUndefined();
  });

  // The park selector sits in this screen's own header. A search for a Magic
  // Kingdom ride cannot run while Epcot is loaded, so offering it there would
  // be an offer the button could not keep -- but it is kept, not discarded,
  // so switching the park back brings it into reach again.
  it('stays quiet about an attraction the loaded park does not have', () => {
    kvdb.setDaily<PendingSearch>(NEXTLL_PENDING_KEY, {
      experienceId: 'not_in_this_park',
    });
    setup();
    expect(screen.queryByText(/Still looking for/)).not.toBeInTheDocument();
    expect(kvdb.getDaily(NEXTLL_PENDING_KEY)).toBeDefined();
  });
});

/**
 * The lower bound, which is what lets a search aim at a time rather than
 * just "as early as possible".
 */
describe('NextLL aiming at a particular time', () => {
  it('passes both bounds through, with the relaxed bar', () => {
    const { replaceTargets } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: BZ } });
    fireEvent.change(screen.getByLabelText('Earliest acceptable return time'), {
      target: { value: '10:45' },
    });
    fireEvent.change(screen.getByLabelText('Latest acceptable return time'), {
      target: { value: '11:15' },
    });
    fireEvent.click(screen.getByText('Find it'));
    expect(replaceTargets).toHaveBeenCalledWith([
      {
        experienceId: BZ,
        bookThenMove: true,
        after: new ParkTime(10, 45),
        before: new ParkTime(11, 15),
        minImprovementMinutes: MIN_TARGETED_IMPROVEMENT_MINUTES,
      },
    ]);
  });

  // No bound named means no time named, so the unattended rule stands: this
  // is the "as early as possible" search, and it should not quietly become
  // willing to move a reservation for two minutes.
  it('leaves the bar alone when no time is named', () => {
    const { replaceTargets } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: BZ } });
    fireEvent.click(screen.getByText('Find it'));
    expect(replaceTargets).toHaveBeenCalledWith([
      { experienceId: BZ, bookThenMove: true },
    ]);
  });
});
