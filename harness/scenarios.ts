import { Booking } from '@/api/itinerary';
import { DEFAULT_SETTINGS, saveSettings } from '@/autopilot/storage';
import { PollerStatus } from '@/autopilot/usePoller';
import { WatchTarget, saveWatchList } from '@/autopilot/watchlist';
import { AutopilotState, BookingLogEntry } from '@/contexts/AutopilotContext';
import { modifyDate, parkDate } from '@/datetime';
import { PARTY_IDS_KEY } from '@/hooks/useSavedParty';
import kvdb from '@/kvdb';
import { BOOKING_DATE_KEY, HOME_TAB_KEY, PARK_KEY } from '@/storageNamespace';

import {
  DEFAULT_SCRIPT,
  IDS,
  Script,
  hs,
  inMinutes,
  llmp,
  mickey,
  minnie,
  mk,
  parkPass,
  sortPlans,
  wdw,
} from './fakes/world';
import { ScreenName } from './screens';

export interface Scenario {
  id: string;
  title: string;
  /** What to look at, and what to do. */
  blurb: string;
  script: Script;
  /** Storage to seed after the reset, before the app mounts. */
  seed?: () => void;
  /**
   * A fixed Autopilot state laid over the real provider's, for the states a
   * fake tipboard cannot produce on cue: bursting at a drop, stopped, spent.
   * The controls on such a screen act on the real provider underneath, so
   * they will not visibly change what is shown.
   */
  autopilot?: Partial<AutopilotState>;
  /** A screen to open once plans have loaded. */
  screen?: ScreenName;
  /** The Home tab to land on; Today unless a scenario is about another. */
  tab?: 'Today' | 'LL' | 'Times' | 'Plans' | 'NextLL';
  /** What the party holds, when it is not the usual two passes and lunch. */
  plans?: () => Booking[];
}

const nameOf = (id: string) => wdw.experience(id).name;

function target(
  id: string,
  extra: Partial<WatchTarget> = {},
  date = parkDate()
): WatchTarget {
  return { experienceId: id, name: nameOf(id), parkId: mk.id, date, ...extra };
}

/** A day's plan: one to book, one to move, one held back, one for another park. */
function dayPlan(date = parkDate()): WatchTarget[] {
  return [
    target(
      IDS.spaceMountain,
      {
        autoBook: true,
        rank: 1,
        after: inMinutes(-30),
        before: inMinutes(240),
      },
      date
    ),
    target(IDS.hauntedMansion, { autoModify: true, rank: 2 }, date),
    target(IDS.jungleCruise, { autoBook: true, paused: true }, date),
    { ...target(IDS.slinkyDog, { autoBook: true }, date), parkId: hs.id },
  ];
}

/** Magic Kingdom, the LL tab, and a party of three, for every scenario. */
function seedCommon() {
  kvdb.setDaily(PARK_KEY, mk.id);
  kvdb.set(HOME_TAB_KEY, 'Today');
  kvdb.set(PARTY_IDS_KEY, ['mickey', 'minnie', 'pluto']);
}

const armed = dayPlan();

const bursting: PollerStatus = {
  mode: 'burst',
  consecutiveFailures: 0,
  polls: 57,
  target: inMinutes(2),
  secondsToTarget: 95,
  lastCycleMs: 412,
  averageCycleMs: 498,
};

const log: BookingLogEntry[] = [
  {
    name: nameOf(IDS.hauntedMansion),
    at: inMinutes(-12),
    status: 'modified',
    fromTime: inMinutes(60),
    returnTime: inMinutes(20),
    reason: 'forty minutes sooner, inside the window',
  },
  {
    name: nameOf(IDS.spaceMountain),
    at: inMinutes(-40),
    status: 'failed',
    detail: 'Network request failed (403 offer)',
  },
];

/** The static picture of a busy morning. */
const running: Partial<AutopilotState> = {
  enabled: true,
  status: bursting,
  targets: armed,
  targetsHere: armed.filter(t => t.parkId === mk.id),
  isWatched: id => armed.some(t => t.experienceId === id),
  bookingLog: log,
  bookedCount: 1,
  notifications: 'granted',
  lastHit: {
    experienceId: IDS.spaceMountain,
    name: nameOf(IDS.spaceMountain),
    returnTime: inMinutes(35),
  },
  skipCounts: { 'offer-outside-window': 3, 'tier-hold': 1, 'partial-party': 2 },
};

const idle: PollerStatus = {
  ...bursting,
  mode: 'idle',
  target: undefined,
  secondsToTarget: undefined,
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'off',
    title: 'Off, nothing watched',
    blurb:
      'Today with two held Lightning Lanes, lunch and an empty plan; the LL tab has the tipboard. The real engine runs against the fakes.',
    script: DEFAULT_SCRIPT,
    seed: seedCommon,
  },
  {
    id: 'tipboard',
    title: 'The LL tab',
    blurb: 'The tipboard as the LL tab shows it, with two passes booked.',
    script: DEFAULT_SCRIPT,
    seed: seedCommon,
    tab: 'LL',
  },
  {
    id: 'configure',
    title: 'Configure, three targets',
    blurb:
      'The setup screen: safeguards, a card per watched attraction, and the list to add from.',
    script: DEFAULT_SCRIPT,
    seed: () => {
      seedCommon();
      saveWatchList(dayPlan());
    },
    screen: 'configure',
  },
  {
    id: 'live',
    title: 'Live engine',
    blurb:
      'Three targets saved. Turn Autopilot on: Space Mountain comes back into stock after three checks and gets booked, and Haunted Mansion, held an hour out, has a time forty minutes sooner on offer, so it moves. The idle cadence is 45 s, so give it a minute.',
    script: { ...DEFAULT_SCRIPT, restockAfterPolls: 3 },
    seed: () => {
      seedCommon();
      saveWatchList(dayPlan());
    },
  },
  {
    id: 'running',
    title: 'Bursting at a drop (static)',
    blurb:
      'A fixed state: checking rapidly, one move made, one failure, skips counted, a find. Toggles act on the hidden real provider, not on what is shown.',
    script: DEFAULT_SCRIPT,
    seed: seedCommon,
    autopilot: running,
  },
  {
    id: 'stopped',
    title: 'Stopped after errors (static)',
    blurb: 'The poller gave up after five failed checks.',
    script: DEFAULT_SCRIPT,
    seed: seedCommon,
    autopilot: {
      ...running,
      status: {
        mode: 'stopped',
        consecutiveFailures: 5,
        polls: 12,
        lastError: 'Network request failed (no response experiences)',
      },
    },
  },
  {
    id: 'refused',
    title: 'Disney refusing requests (static)',
    blurb:
      'Eligibility and offer calls refused for minutes; watching continues.',
    script: DEFAULT_SCRIPT,
    seed: seedCommon,
    autopilot: {
      ...running,
      status: idle,
      refusals: {
        eligibility: { count: 6, since: inMinutes(-3) },
        offer: { count: 4, since: inMinutes(-2) },
      },
    },
  },
  {
    id: 'dry-run',
    title: 'Dry run',
    blurb:
      'Rehearsal on with three targets saved; the real engine. Turn it on and the log says what it would have done.',
    script: { ...DEFAULT_SCRIPT, restockAfterPolls: 2 },
    seed: () => {
      seedCommon();
      saveWatchList(dayPlan());
      saveSettings({ ...DEFAULT_SETTINGS, dryRun: true });
    },
  },
  {
    id: 'unknown-id',
    title: 'An attraction the build does not know',
    blurb: 'The tipboard lists an id the data file has never heard of.',
    script: { ...DEFAULT_SCRIPT, unknownId: true },
    seed: seedCommon,
  },
  {
    id: 'pretrip',
    title: 'A future date',
    blurb:
      "The booking date is five days out, with a plan saved for it. What Today's pre-trip mode will grow from.",
    script: DEFAULT_SCRIPT,
    seed: () => {
      seedCommon();
      const date = modifyDate(parkDate(), 5);
      kvdb.setDaily(BOOKING_DATE_KEY, date);
      saveWatchList(dayPlan(date));
    },
  },
  {
    id: 'split-party',
    title: 'Two people hold one ride',
    blurb:
      'Mickey holds Haunted Mansion soon and Minnie holds it later. On NextLL, pick Haunted Mansion: with no party saved it says whose is whose and how to choose. Save Minnie alone in Party Selection and it works on hers.',
    script: DEFAULT_SCRIPT,
    plans: () =>
      sortPlans([
        parkPass(mk, parkDate()),
        llmp(IDS.hauntedMansion, inMinutes(20), parkDate(), [mickey]),
        llmp(IDS.hauntedMansion, inMinutes(100), parkDate(), [minnie]),
      ]),
    seed: seedCommon,
    tab: 'NextLL',
  },
  {
    id: 'plancheck',
    title: 'Plan check with blockers',
    blurb:
      "An impossible window, a target that is not on the tipboard, and a window swallowed by lunch's protected time.",
    script: DEFAULT_SCRIPT,
    seed: () => {
      seedCommon();
      saveWatchList([
        target(IDS.spaceMountain, {
          autoBook: true,
          after: inMinutes(120),
          before: inMinutes(60),
        }),
        {
          experienceId: IDS.unknown,
          name: 'Retired Ride',
          parkId: mk.id,
          date: parkDate(),
          autoBook: true,
        },
        target(IDS.hauntedMansion, {
          autoBook: true,
          after: inMinutes(50),
          before: inMinutes(120),
        }),
      ]);
    },
    screen: 'plancheck',
  },
  {
    id: 'timeline',
    title: 'Timeline',
    blurb:
      'Two held passes and lunch beside three windows, one crossing lunch.',
    script: DEFAULT_SCRIPT,
    seed: () => {
      seedCommon();
      saveWatchList(dayPlan());
    },
    screen: 'timeline',
  },
  {
    id: 'activity',
    title: 'Activity (static)',
    blurb: 'The log, the skip counts and a learned drop, on their own screen.',
    script: DEFAULT_SCRIPT,
    seed: seedCommon,
    autopilot: running,
    screen: 'activity',
  },
  {
    id: 'search-earlier',
    title: 'Time Search: an earlier time exists',
    blurb:
      'Find the earliest: the grid has a slot ninety minutes sooner than the held Haunted Mansion, so the search moves there on its own and Plans follows.',
    script: { ...DEFAULT_SCRIPT, grid: 'earlier' },
    seed: seedCommon,
    screen: 'timesearch',
  },
  {
    id: 'search-later',
    title: 'Time Search: only later times',
    blurb:
      'Nothing earlier is on offer. Aim for a time an hour after what is held: the move is offered, not taken, until you take it.',
    script: { ...DEFAULT_SCRIPT, grid: 'later' },
    seed: seedCommon,
    screen: 'timesearch',
  },
  {
    id: 'search-unresolved',
    title: 'Time Search: a move that did not come back',
    blurb:
      'The commit gets no response. The search must stop and send you to Plans rather than ask again.',
    script: { ...DEFAULT_SCRIPT, grid: 'earlier', book: 'timeout' },
    seed: seedCommon,
    screen: 'timesearch',
  },
  {
    id: 'search-unconfirmed',
    title: 'Time Search: Plans never catches up',
    blurb:
      'The move succeeds but Plans keeps the old time. After ten settle cycles, about a minute, the search gives up and says so.',
    script: { ...DEFAULT_SCRIPT, grid: 'earlier', plansFollow: false },
    seed: seedCommon,
    screen: 'timesearch',
  },
];

export function findScenario(id: string | null): Scenario {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0]!;
}
