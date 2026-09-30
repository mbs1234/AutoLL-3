import { act, fireEvent, screen, within } from '@testing-library/react';
import { type ReactElement, createRef } from 'react';

import { createBooking, hm, wdw } from '@/__fixtures__/ll';
import { mk } from '@/__fixtures__/resort';
import { primeAudio, resetAudioForTests } from '@/autopilot/alert';
import { leaseKey, quarantine } from '@/autopilot/lease';
import { savePendingSearch } from '@/autopilot/nextll';
import { planReview } from '@/autopilot/plancheck';
import { noteRefusal, noteThrottle, resetPushback } from '@/autopilot/pushback';
import { holdScreenAwake, releaseScreenAwake } from '@/autopilot/wakelock';
import TabsContext from '@/contexts/TabContext';
import { ParkTime, parkDate } from '@/datetime';
import { PARTY_IDS_KEY } from '@/hooks/useSavedParty';
import kvdb from '@/kvdb';
import { PLAN_CHECK_REVIEW_KEY } from '@/storageNamespace';
import { TODAY, TOMORROW, nav, setTime } from '@/testing';

import Activity from './Activity';
import Configure from './Configure';
import PlanCheck from './PlanCheck';
import Timeline from './Timeline';
import Today from './Today';
import { BZ, DB, OFF, llExperience, renderScreen } from './screenTestSetup';

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

  it('does not mark Plan Check reviewed merely because its route was opened', () => {
    setup({
      bookingDate: '2021-10-02',
      targets: [{ experienceId: BZ, autoBook: true }],
    });
    const item = screen
      .getAllByRole('listitem')
      .find(element => element.textContent?.includes('Run Plan Check'));
    fireEvent.click(within(item!).getByRole('button', { name: 'Open' }));
    expect(
      screen
        .getAllByRole('listitem')
        .find(element => element.textContent?.includes('Run Plan Check'))
    ).toHaveTextContent('Run Plan Check');
    expect(nav.goTo.mock.calls[0]?.[0].type).toBe(PlanCheck);
  });

  it('marks the rendered clean result reviewed and keeps it reopenable', () => {
    const date = '2021-10-02';
    const targets = [{ experienceId: BZ, autoBook: true }];
    const experiences = [llExperience(BZ), llExperience(DB)];
    setup({ bookingDate: date, targets, experiences });

    const item = screen
      .getAllByRole('listitem')
      .find(element => element.textContent?.includes('Run Plan Check'));
    fireEvent.click(within(item!).getByRole('button', { name: 'Open' }));
    const routed = nav.goTo.mock.calls[0]?.[0] as ReactElement<{
      onReviewed: (review: ReturnType<typeof planReview>) => void;
    }>;
    const review = planReview({
      targets,
      parkId: mk.id,
      date,
      experiences,
      plans: [],
      requireWholeParty: false,
      avoidOverlaps: true,
      dryRun: false,
      tierLimitLifted: false,
    });
    act(() => routed.props.onReviewed(review));

    const reviewed = screen
      .getAllByRole('listitem')
      .find(element => element.textContent?.includes('Plan Check reviewed'));
    expect(reviewed).toHaveTextContent('✓ Plan Check reviewed');
    fireEvent.click(within(reviewed!).getByRole('button', { name: 'Review' }));
    expect(nav.goTo).toHaveBeenCalledTimes(2);
    expect(kvdb.get(PLAN_CHECK_REVIEW_KEY)).toEqual(review);
  });

  it('does not certify a reviewed plan that has a blocker', () => {
    const date = '2021-10-02';
    const targets = [
      {
        experienceId: BZ,
        autoBook: true,
        after: new ParkTime(15),
        before: new ParkTime(10),
      },
    ];
    const experiences = [llExperience(BZ), llExperience(DB)];
    const review = planReview({
      targets,
      parkId: mk.id,
      date,
      experiences,
      plans: [],
      requireWholeParty: false,
      avoidOverlaps: true,
      dryRun: false,
      tierLimitLifted: false,
    });
    kvdb.set(PLAN_CHECK_REVIEW_KEY, review);

    setup({ bookingDate: date, targets, experiences });

    const item = screen
      .getAllByRole('listitem')
      .find(element => element.textContent?.includes('Plan Check found'));
    expect(item).toHaveTextContent('○ Plan Check found 1 blocker');
  });

  it('does not carry a Plan Check acknowledgement to another date', () => {
    const targets = [{ experienceId: BZ, autoBook: true }];
    const experiences = [llExperience(BZ), llExperience(DB)];
    kvdb.set(
      PLAN_CHECK_REVIEW_KEY,
      planReview({
        targets,
        parkId: mk.id,
        date: '2021-10-02',
        experiences,
        plans: [],
        requireWholeParty: false,
        avoidOverlaps: true,
        dryRun: false,
        tierLimitLifted: false,
      })
    );

    setup({ bookingDate: '2021-10-03', targets, experiences });
    expect(screen.getByText(/Run Plan Check before enabling/)).toBeVisible();
  });

  it('shows unresolved protection on Today and routes to its details', async () => {
    await quarantine(leaseKey(BZ, parkDate()), {
      id: 'move-1',
      kind: 'modify',
      to: '11:00:00',
    });
    setup();

    expect(screen.getByRole('alert')).toHaveTextContent(
      '1 unresolved Lightning Lane change needs review.'
    );
    expect(
      screen.getByText(/stopped automatically booking, moving, or swapping/)
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review protection' }));
    expect(nav.goTo.mock.calls[0]?.[0].type).toBe(Activity);
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
    expect(screen.getByText(/current as of 3 min ago/)).toBeVisible();
  });

  /*
   * This is the line that tells you whether to trust the rest of the screen, so
   * it must not claim currency it does not have. It used to filter the
   * undefined values out and take the minimum of what was left, which read one
   * loaded context beside one that had never fetched as "both current" --
   * over-claiming in exactly the state where believing it is wrong.
   */
  it.each([
    ['the LL list has never loaded', { plansUpdated: Date.now() }],
    ['plans have never loaded', { experiencesUpdated: Date.now() }],
    ['neither has loaded', {}],
  ])('says nothing about freshness when %s', (_case, updates) => {
    setup(updates);
    expect(screen.queryByText(/current as of/)).not.toBeInTheDocument();
  });

  it('lists what is held on the date, with its return window', () => {
    setup({ plans: [createBooking(hm)] });
    expect(
      screen.getByRole('heading', { name: 'Held (1)' })
    ).toBeInTheDocument();
    expect(screen.getByText(hm.name)).toBeVisible();
    expect(document.querySelector('time[datetime="12:00:00"]')).not.toBeNull();
  });

  /*
   * It used to promise one, in the words "(grace scan until 1:59 PM)" against
   * every held pass -- 119 minutes past the end of the window, a number with no
   * constant, no comment and no origin anybody could trace. Nothing in the
   * engine scans for a lapsing pass, then or now. Telling a user on a park day
   * that something is watching a reservation when nothing is watching it is the
   * worst shape a failure takes in this project, and it was printed on the
   * screen they hold. Warning before a pass lapses is worth building; saying so
   * before it is built is not.
   */
  it('does not promise to watch a pass it is not watching', () => {
    setup({ plans: [createBooking(hm)] });
    expect(screen.queryByText(/grace scan/i)).not.toBeInTheDocument();
    expect(document.querySelector('time[datetime="13:59:00"]')).toBeNull();
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
    });
    expect(screen.getByText(/1 armed, 1 paused/)).toBeVisible();
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
    savePendingSearch({ experienceId: BZ, bookingDate: TODAY });
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

describe('Today when Disney pushes back', () => {
  beforeEach(() => resetPushback());

  // A refusal stops everything, and the two things worth knowing are that it
  // was Disney, not errors, and that starting again is allowed but risky.
  it('says a stop was Disney refusing, and how to start again', () => {
    setup({
      enabled: true,
      status: {
        mode: 'stopped',
        stopReason: 'refused',
        consecutiveFailures: 0,
        polls: 40,
      },
    });
    expect(
      screen.getByText(/Disney refused a request, so everything has stopped/)
    ).toBeVisible();
    expect(
      screen.getByText(/the next refusal stops everything again/)
    ).toBeVisible();
  });

  // A wait is not a stop: without saying when, and that it is still on, it
  // reads as the engine having died.
  it('says Autopilot is waiting, still on and armed, and until when', () => {
    setup({
      enabled: true,
      status: {
        mode: 'waiting',
        waitUntil: Date.now() + 5 * 60_000,
        consecutiveFailures: 0,
        polls: 40,
      },
    });
    expect(
      screen.getByText(/Disney asked Autopilot to slow down/)
    ).toHaveTextContent(/waiting until .*still on and still armed/);
  });

  // User beware: starting again is allowed, and the switch says what it risks.
  it('warns beside the switch after a refusal, without blocking it', () => {
    noteRefusal();
    setup();
    expect(
      screen.getByText(/next refusal stops everything again/)
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Turn on autopilot' })
    ).toBeEnabled();
  });

  it('warns beside the switch after Disney asked to slow down', () => {
    noteThrottle(10 * 60_000);
    setup();
    expect(screen.getByText(/Disney asked to slow down at/)).toHaveTextContent(
      /suggested waiting until/
    );
  });

  it('says nothing beside the switch before any pushback', () => {
    setup();
    expect(screen.queryByText(/Disney refused/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Disney asked to slow down/)
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

/**
 * The alert channel, which on iOS Safari is the only one there is.
 *
 * `Notification` is undefined outside an installed web app and vibration is
 * unimplemented, so a context that never unlocked -- or that iOS interrupted
 * -- leaves a run unable to reach anybody, silently. Found on a phone: a ride
 * came up, autopilot alerted, and nothing made a sound.
 */
describe('Today alert sound', () => {
  type AudioGlobal = Omit<typeof globalThis, 'AudioContext'> & {
    AudioContext?: unknown;
  };
  const g = globalThis as AudioGlobal;

  function fakeAudio(state: string) {
    const listeners = new Set<() => void>();
    const ctx = {
      state,
      currentTime: 0,
      resume: jest.fn(async () => {
        await Promise.resolve();
        ctx.setState('running');
      }),
      createOscillator: jest.fn(() => ({
        type: '',
        frequency: { value: 0 },
        connect: jest.fn(() => gain),
        start: jest.fn(),
        stop: jest.fn(),
      })),
      createGain: jest.fn(() => gain),
      sampleRate: 48_000,
      createBuffer: jest.fn(() => ({})),
      createBufferSource: jest.fn(() => ({
        buffer: undefined as unknown,
        connect: jest.fn(),
        start: jest.fn(),
      })),
      destination: {},
      addEventListener: jest.fn((type: string, listener: () => void) => {
        if (type === 'statechange') listeners.add(listener);
      }),
      removeEventListener: jest.fn((type: string, listener: () => void) => {
        if (type === 'statechange') listeners.delete(listener);
      }),
      setState(next: string) {
        this.state = next;
        for (const listener of listeners) listener();
      },
    };
    const gain = {
      gain: {
        setValueAtTime: jest.fn(),
        linearRampToValueAtTime: jest.fn(),
      },
      connect: jest.fn(() => ({})),
    };
    g.AudioContext = jest.fn(() => ctx);
    return ctx;
  }

  beforeEach(() => resetAudioForTests());
  afterEach(() => {
    resetAudioForTests();
    delete g.AudioContext;
  });

  // An iPhone in Safari has no notifications, so the pre-trip list asks for
  // the one alert it does have to be heard, rather than ticking it off.
  it('has the pre-trip list test the sound where there are no notifications', async () => {
    const ctx = fakeAudio('suspended');
    setup({ bookingDate: TOMORROW, notifications: 'unsupported' });
    expect(
      screen.getByText(/○ Test the alert sound: it is the only alert here/)
    ).toBeVisible();
    await act(async () => {
      screen.getByRole('button', { name: 'Test' }).click();
    });
    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(screen.getByText(/✓ Alert sound works/)).toBeVisible();
  });

  // Offering a sound test on a browser that cannot make one is a row that can
  // only ever report failure.
  it('says nothing where the browser has no audio at all', () => {
    setup({ enabled: true });
    expect(screen.queryByText('Test sound')).not.toBeInTheDocument();
  });

  it('warns while sound would be silent', () => {
    fakeAudio('suspended');
    setup({ enabled: true });
    expect(screen.getByText(/Alert sound is not armed/)).toBeVisible();
  });

  it('keeps the pre-flight sound check neutral while autopilot is off', () => {
    fakeAudio('suspended');
    setup({ enabled: false });
    const status = screen.getByText(
      'Test alert sound before starting Autopilot.'
    );
    expect(status).toBeVisible();
    expect(status).toHaveClass('text-gray-600');
    expect(status).not.toHaveClass('text-red-700');
  });

  it('warns whenever autopilot is enabled, including after it stops', () => {
    fakeAudio('suspended');
    setup({
      enabled: true,
      status: {
        mode: 'stopped',
        consecutiveFailures: 8,
        polls: 20,
        lastError: 'Request failed',
      },
    });
    expect(screen.getByText(/Alert sound is not armed/)).toHaveClass(
      'text-red-700'
    );
  });

  it('wakes the sound up on demand and says so', async () => {
    const ctx = fakeAudio('suspended');
    setup({ enabled: true });
    await act(async () => {
      screen.getByText('Test sound').click();
    });
    expect(ctx.resume).toHaveBeenCalled();
    // Actually played, not merely woken: the point of the button is hearing it.
    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(screen.getByText('Alert sound is armed.')).toBeVisible();
  });

  it('reports a context that refuses to wake, rather than claiming success', async () => {
    const ctx = fakeAudio('suspended');
    ctx.resume = jest.fn(async () => {
      throw new Error('gesture required');
    });
    setup({ enabled: true });
    await act(async () => {
      screen.getByText('Test sound').click();
    });
    expect(screen.getByText(/Alert sound is not armed/)).toBeVisible();
  });

  it('reports an interruption immediately rather than waiting for a poll', () => {
    const ctx = fakeAudio('running');
    primeAudio();
    setup({ enabled: true });
    expect(screen.getByText('Alert sound is armed.')).toBeVisible();

    act(() => ctx.setState('interrupted'));

    expect(screen.getByText(/Alert sound is not armed/)).toBeVisible();
  });
});

describe('Today screen wake status', () => {
  const OWNER = Symbol('today-wake-test');

  function installWakeLock() {
    const listeners = new Set<() => void>();
    const sentinel = {
      release: jest.fn(async () => undefined),
      addEventListener: jest.fn((type: string, listener: () => void) => {
        if (type === 'release') listeners.add(listener);
      }),
      dropFromBrowser() {
        for (const listener of listeners) listener();
      },
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: jest.fn(async () => sentinel) },
    });
    return sentinel;
  }

  afterEach(async () => {
    await releaseScreenAwake(OWNER);
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('omits the row when the browser has no wake-lock API', () => {
    setup({ enabled: true });
    expect(screen.queryByText(/Screen may sleep/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Screen is being kept awake/)
    ).not.toBeInTheDocument();
  });

  it('warns when screen wake is supported but idle', () => {
    installWakeLock();
    setup({ enabled: true });
    expect(screen.getByText(/Screen may sleep/)).toBeVisible();
  });

  it('omits an idle wake-lock warning while autopilot is off', () => {
    installWakeLock();
    setup({ enabled: false });
    expect(screen.queryByText(/Screen may sleep/)).not.toBeInTheDocument();
  });

  it('shows a held lock and reacts when the browser releases it', async () => {
    const sentinel = installWakeLock();
    await holdScreenAwake(OWNER);
    setup({ enabled: true });
    expect(screen.getByText('Screen is being kept awake.')).toBeVisible();

    act(() => sentinel.dropFromBrowser());

    expect(screen.getByText(/Screen may sleep/)).toBeVisible();
  });
});

describe('Today context strip', () => {
  it('names the park, the day and the party under the title', () => {
    localStorage.setItem(PARTY_IDS_KEY, JSON.stringify(['a', 'b']));
    setup();
    const strip = screen.getByText('Party of 2').parentElement!;
    expect(within(strip).getByText('Magic Kingdom')).toBeInTheDocument();
    expect(within(strip).getByText('Today')).toBeInTheDocument();
  });
});

// It said what was being waited for, and not where to go to end the wait.
describe('Today with a passkey', () => {
  const passkey = { experienceId: DB, autoBook: true, passkey: true };

  it('says where to tap in to lift the Tier 1 hold', () => {
    setup({ targets: [passkey], passkeyStatus: 'waiting' });
    expect(
      screen.getByText(
        new RegExp(
          `Tap in at ${wdw.experience(DB).name} with every selected guest`
        )
      )
    ).toBeVisible();
  });

  it('says it is lifted once Disney confirms it', () => {
    setup({ targets: [passkey], passkeyStatus: 'unlocked' });
    expect(screen.getByText(/Tier 1 hold is unlocked/)).toBeVisible();
    expect(screen.queryByText(/Tap in at/)).not.toBeInTheDocument();
  });
});
