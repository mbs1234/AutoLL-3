import { fireEvent, screen, within } from '@testing-library/react';
import { createRef } from 'react';

import { createBooking, hm, wdw } from '@/__fixtures__/ll';
import { savePendingSearch } from '@/autopilot/nextll';
import TabsContext from '@/contexts/TabContext';
import { ParkTime } from '@/datetime';
import { nav, setTime } from '@/testing';

import Activity from './Activity';
import Configure from './Configure';
import PlanCheck from './PlanCheck';
import Timeline from './Timeline';
import Today from './Today';
import { BZ, DB, OFF, renderScreen } from './screenTestSetup';

// Pins the clock to the repo's canonical TODAY (see @/testing), so "today"
// means the date the fixtures are built for.
setTime('09:00');

const today = () => <Today ref={createRef<HTMLDivElement>()} />;
const setup = (options = {}) => renderScreen(today(), options);

beforeEach(() => {
  localStorage.clear();
  nav.goTo.mockClear();
});

describe('Today', () => {
  it('offers to turn on when off', () => {
    const { setEnabled } = setup();
    screen.getByText('Turn on autopilot').click();
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it('offers to turn off when on', () => {
    const { setEnabled } = setup({
      enabled: true,
      status: { ...OFF, mode: 'idle', polls: 3 },
    });
    screen.getByText('Turn off autopilot').click();
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it('reports the current mode', () => {
    setup({ enabled: true, status: { ...OFF, mode: 'burst', polls: 12 } });
    expect(screen.getByText(/Checking rapidly/)).toBeInTheDocument();
    expect(screen.getByText(/12 checks/)).toBeInTheDocument();
  });

  it('explains why it stopped', () => {
    setup({
      enabled: true,
      status: {
        mode: 'stopped',
        consecutiveFailures: 8,
        polls: 20,
        lastError: 'Request failed',
      },
    });
    expect(screen.getByText(/Stopped after 8 failed checks/)).toBeVisible();
    expect(screen.getByText(/Request failed/)).toBeVisible();
  });

  it('warns when notifications are blocked', () => {
    setup({ notifications: 'denied' });
    expect(screen.getByText(/Notifications are blocked/)).toBeVisible();
  });

  it('explains the iOS limitation when unsupported', () => {
    setup({ notifications: 'unsupported' });
    expect(screen.getByText(/Home Screen/)).toBeVisible();
  });

  it('requests notifications from the pre-trip checklist', () => {
    const { requestNotifications } = setup({
      bookingDate: '2021-10-02',
      notifications: 'default',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(requestNotifications).toHaveBeenCalledTimes(1);
  });

  it('marks Plan Check reviewed after opening it from the checklist', () => {
    setup({ bookingDate: '2021-10-02' });
    const item = screen
      .getAllByRole('listitem')
      .find(element => element.textContent?.includes('Run Plan Check'));
    fireEvent.click(within(item!).getByRole('button', { name: 'Open' }));
    expect(
      screen
        .getAllByRole('listitem')
        .find(element => element.textContent?.includes('Plan Check reviewed'))
    ).toHaveTextContent('Plan Check reviewed');
  });

  it('offers a top-up once the day budget is gone, and only while running', () => {
    const { refillBudget } = setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoBook: true }],
      bookingsRemaining: 0,
      status: { mode: 'idle', consecutiveFailures: 0, polls: 3 },
    });
    expect(screen.getByText(/actions are used up/)).toBeVisible();
    screen.getByText('Add more for today').click();
    expect(refillBudget).toHaveBeenCalled();
  });

  // Off, an exhausted budget is a fact about earlier today rather than the
  // reason nothing is happening now.
  it('says nothing about the budget while switched off', () => {
    setup({
      watched: [BZ],
      targets: [{ experienceId: BZ, autoBook: true }],
      bookingsRemaining: 0,
    });
    expect(screen.queryByText(/actions are used up/)).not.toBeInTheDocument();
  });

  it('shows the most recent find', () => {
    setup({
      lastHit: {
        experienceId: BZ,
        name: 'Big Thunder',
        returnTime: new ParkTime(13, 45),
      },
    });
    expect(screen.getByText(/Found Big Thunder at 1:45 PM/)).toBeVisible();
  });

  it('headlines the latest action above the status', () => {
    setup({
      enabled: true,
      status: { ...OFF, mode: 'idle', polls: 12 },
      bookingLog: [
        {
          name: 'Big Thunder',
          at: new ParkTime(9, 47),
          status: 'booked',
          returnTime: new ParkTime(11, 5),
        },
      ],
    });
    expect(screen.getByText(/Booked Big Thunder for 11:05 AM/)).toBeVisible();
  });

  it('headlines the last skip by name', () => {
    setup({
      enabled: true,
      status: { ...OFF, mode: 'idle', polls: 12 },
      lastSkip: {
        name: 'Tower of Terror',
        reason: 'offer-outside-window',
        at: new ParkTime(11, 43),
      },
    });
    expect(
      screen.getByText(
        /Skipped Tower of Terror: the offered time was outside the window/
      )
    ).toBeVisible();
  });

  // A forgotten dry run would look like a broken booker, so it is loud.
  it('shows a prominent banner while a dry run is on', () => {
    setup({ dryRun: true });
    expect(screen.getByText(/Dry run is on/)).toBeVisible();
  });

  it('shows the next Lightning Lane and the next drop', () => {
    setup({ ll: { nextBookTime: new ParkTime(11) } });
    expect(screen.getByText('Next Lightning Lane:')).toBeVisible();
    expect(document.querySelector('time[datetime="11:00:00"]')).not.toBeNull();
    expect(screen.getByText('Next drop:')).toBeVisible();
    expect(document.querySelector('time[datetime="11:30:00"]')).not.toBeNull();
  });

  it('shows the age of the older plan or LL-list refresh', () => {
    const now = Date.now();
    setup({
      experiencesUpdated: now - 3 * 60_000,
      plansUpdated: now,
    });
    expect(screen.getByText(/updated 3 min ago/)).toBeVisible();
  });

  it('lists what is held on the date, with the grace scan', () => {
    setup({ plans: [createBooking(hm)] });
    expect(
      screen.getByRole('heading', { name: 'Held (1)' })
    ).toBeInTheDocument();
    expect(screen.getByText(hm.name)).toBeVisible();
    expect(screen.getByText(/grace scan until/)).toBeVisible();
    // 12:00 plus 119 minutes.
    expect(document.querySelector('time[datetime="13:59:00"]')).not.toBeNull();
  });

  it('says when nothing is held', () => {
    setup();
    expect(
      screen.getByText(/No Multi Pass reservations yet today/)
    ).toBeVisible();
  });

  it('summarises the plan in rank order, with what each target will do', () => {
    setup({
      watched: [BZ, DB],
      targets: [
        { experienceId: BZ, autoBook: true, rank: 2, after: new ParkTime(10) },
        { experienceId: DB, autoModify: true, paused: true, rank: 1 },
      ],
      bookingsRemaining: 3,
    });
    expect(screen.getByText(/1 armed, 1 paused/)).toBeVisible();
    expect(screen.getByText(/3 of 10 actions left/)).toBeVisible();
    const items = screen
      .getByRole('heading', { name: 'Plan (2)' })
      .parentElement!.querySelectorAll('li');
    expect(items[0]).toHaveTextContent(wdw.experience(DB).name);
    expect(items[0]).toHaveTextContent(/Paused · Auto-move · Rank 1/);
    expect(items[1]).toHaveTextContent(wdw.experience(BZ).name);
    expect(items[1]).toHaveTextContent(/Auto-book · from/);
    expect(items[1]).toHaveTextContent(/Rank 2/);
  });

  it('says when nothing is watched', () => {
    setup();
    expect(screen.getByText(/Nothing watched at Magic Kingdom/)).toBeVisible();
  });

  it('opens Configure, Plan check, Timeline and Activity', () => {
    setup();
    for (const label of ['Configure', 'Plan check', 'Timeline', 'Activity']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    expect(nav.goTo.mock.calls.map(call => call[0].type)).toEqual([
      Configure,
      PlanCheck,
      Timeline,
      Activity,
    ]);
  });

  it('offers the way back to an interrupted NextLL search', () => {
    savePendingSearch({ experienceId: BZ });
    const changeTab = jest.fn();
    renderScreen(
      <TabsContext
        value={{
          tabs: [],
          active: { name: 'Today', icon: null, component: () => null },
          changeTab,
          scrollPos: { get: () => 0, set: () => {} },
        }}
      >
        {today()}
      </TabsContext>
    );
    expect(screen.getByText(/Still looking for/)).toHaveTextContent(
      wdw.experience(BZ).name
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open NextLL' }));
    expect(changeTab).toHaveBeenCalledWith('NextLL');
  });

  it('says nothing about NextLL when no search was interrupted', () => {
    setup();
    expect(screen.queryByText(/Still looking for/)).not.toBeInTheDocument();
  });
});

describe('Today refusal warning', () => {
  const refusing = {
    eligibility: { count: 5, since: new ParkTime(8, 55) },
  };

  // A refusal lands on eligibility, one step before an offer exists, so
  // autopilot keeps polling, alerting and learning drops while never acting.
  // Without this the screen reads as perfectly healthy.
  it('says so when Disney is refusing requests', () => {
    setup({
      status: { mode: 'idle', consecutiveFailures: 0, polls: 40 },
      refusals: refusing,
    });
    expect(screen.getByText(/Disney is refusing these requests/)).toBeVisible();
    expect(screen.getByText(/checking who is eligible/)).toBeVisible();
  });

  // Off, this describes earlier today rather than why nothing is happening.
  it('says nothing while switched off', () => {
    setup({ refusals: refusing });
    expect(
      screen.queryByText(/Disney is refusing these requests/)
    ).not.toBeInTheDocument();
  });

  it('says nothing when requests are going through', () => {
    setup({ status: { mode: 'idle', consecutiveFailures: 0, polls: 40 } });
    expect(
      screen.queryByText(/Disney is refusing these requests/)
    ).not.toBeInTheDocument();
  });
});

// `mode` reports the cadence the policy asked for, not the exponential
// backoff the poller is actually waiting out, so a failing Autopilot looked
// exactly like an idle one -- just slower.
describe('Today backoff', () => {
  const failing = (consecutiveFailures: number) => ({
    status: {
      mode: 'idle' as const,
      consecutiveFailures,
      polls: 12,
      lastError: 'Request failed',
    },
    enabled: true,
  });

  it('says it is backing off before it has given up', () => {
    setup(failing(3));
    expect(screen.getByText(/3 failed checks in a row/)).toBeVisible();
    expect(screen.getByText(/Request failed/)).toBeVisible();
  });

  it('says nothing while checks are succeeding', () => {
    setup({ ...failing(0), status: { ...failing(0).status } });
    expect(screen.queryByText(/failed check/)).not.toBeInTheDocument();
  });

  it('counts one failure in the singular', () => {
    setup(failing(1));
    expect(screen.getByText(/1 failed check in a row/)).toBeVisible();
  });

  // Once it has stopped, the red notice says so and this would be noise.
  it('defers to the stopped notice', () => {
    setup({
      enabled: true,
      status: {
        mode: 'stopped',
        consecutiveFailures: 8,
        polls: 20,
        lastError: 'Request failed',
      },
    });
    expect(screen.getByText(/Stopped after 8 failed checks/)).toBeVisible();
    expect(screen.queryByText(/in a row/)).not.toBeInTheDocument();
  });
});

describe('Today context strip', () => {
  it('names the park, the day and the party under the title', () => {
    localStorage.setItem('autoll3.genie.partyIds', JSON.stringify(['a', 'b']));
    setup();
    const strip = screen.getByText('Party of 2').parentElement!;
    expect(within(strip).getByText('Magic Kingdom')).toBeInTheDocument();
    expect(within(strip).getByText('Today')).toBeInTheDocument();
  });
});
