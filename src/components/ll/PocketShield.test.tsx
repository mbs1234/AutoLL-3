import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import { AutopilotState } from '@/contexts/AutopilotContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';

import PocketShield from './PocketShield';
import { MIN_TAP_GAP_MS, TAPS_REQUIRED } from './pocketGuard';

const state: AutopilotState = {
  enabled: true,
  setEnabled: () => {},
  status: { mode: 'approach', consecutiveFailures: 0, polls: 8 },
  targets: [],
  targetsHere: [{ experienceId: 'ride', autoBook: true }],
  isWatched: () => false,
  addTarget: () => {},
  removeTarget: () => {},
  replaceTargets: () => {},
  toggleAutoBook: () => {},
  toggleAutoModify: () => {},
  toggleBookThenMove: () => {},
  togglePaused: () => {},
  toggleAutoSwap: () => {},
  setTargetWindow: () => {},
  setTargetRank: () => {},
  togglePasskey: () => {},
  passkeyStatus: 'off',
  notifications: 'granted',
  requestNotifications: () => {},
  bookingLog: [],
  sessionLog: [],
  bookedCount: 2,
  requireWholeParty: false,
  setRequireWholeParty: () => {},
  dryRun: false,
  setDryRun: () => {},
  avoidOverlaps: false,
  setAvoidOverlaps: () => {},
  skipCounts: {},
  dropSummaries: [],
};

function setup(overrides: Partial<AutopilotState> = {}) {
  const onExit = jest.fn();
  render(
    <TopAutopilotContext value={{ ...state, ...overrides }}>
      <PocketShield onExit={onExit} />
    </TopAutopilotContext>
  );
  return onExit;
}

const box = () => screen.getByRole('button', { name: /unlock the screen/i });
const backdrop = () => screen.getByTestId('pocket-shield');

/**
 * Taps have to be separated in time or the guard refuses them.
 *
 * `fireEvent` fires everything inside one millisecond, which the gap floor
 * reads -- correctly -- as one contact smearing across the glass rather than
 * three deliberate taps. Every tap here therefore moves the clock first, and a
 * test that forgets to is a test that proves the floor exists.
 */
let clock = 0;
beforeEach(() => {
  clock = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => jest.restoreAllMocks());

function tap(element: HTMLElement) {
  clock += MIN_TAP_GAP_MS;
  fireEvent.click(element);
}

describe('the pocket shield', () => {
  // A blank screen would answer nothing. The question being asked while the
  // phone is out of a pocket is almost always "is it still working", and this
  // is meant to answer it without being unlocked at all.
  it('says what the engine is doing, in the words the rest of the app uses', () => {
    setup();
    expect(screen.getByText('Checking often')).toBeInTheDocument();
    expect(screen.getByText(/1 armed/)).toBeInTheDocument();
    expect(screen.getByText(/2 booked today/)).toBeInTheDocument();
  });

  it('lifts after three taps on the target', () => {
    const onExit = setup();
    for (let i = 0; i < TAPS_REQUIRED - 1; ++i) {
      tap(box());
      expect(onExit).not.toHaveBeenCalled();
    }
    tap(box());
    expect(onExit).toHaveBeenCalled();
  });

  // Found by writing this suite: the first draft tapped three times without
  // moving the clock and did not unlock, which is the floor doing its job. One
  // contact dragging across the glass emits a burst like that.
  it('refuses three taps that arrive in the same instant', () => {
    const onExit = setup();
    fireEvent.click(box());
    fireEvent.click(box());
    fireEvent.click(box());
    expect(onExit).not.toHaveBeenCalled();
  });

  it('counts down so the remaining taps are never a guess', () => {
    setup();
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    tap(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);
  });

  // The rule that does the real work. Three lucky hits over a long walk are
  // conceivable; three with no miss between them are not.
  it('resets progress when a touch lands anywhere else', () => {
    const onExit = setup();
    tap(box());
    tap(box());
    tap(backdrop());
    tap(box());
    expect(onExit).not.toHaveBeenCalled();
    expect(box()).toHaveAccessibleName(/2 more taps/i);
  });

  // Asserted on the position index rather than the rendered `left`. Two of the
  // eight positions share an x -- the target moves diagonally between them --
  // so reading one coordinate made this pass or fail on where the random pick
  // landed. It failed in CI on an unrelated pull request, which is the only
  // reason it was caught.
  it('moves the target after a tap, so it cannot be found by feel', () => {
    setup();
    const before = box().dataset.position;
    tap(box());
    expect(box().dataset.position).not.toBe(before);
  });

  // The property the flake was reaching for: wherever it goes, it is somewhere
  // else. Run enough times that a random pick cannot hide a broken one.
  it('never stays where it was, whichever position it starts from', () => {
    setup();
    for (let i = 0; i < 40; ++i) {
      const before = box().dataset.position;
      tap(box());
      expect(box().dataset.position).not.toBe(before);
      tap(backdrop());
    }
  });

  // Being shielded over a dead engine is the one state where the shield is
  // actively harmful, so it is the one state it shouts about.
  it('says so loudly when autopilot has stopped', () => {
    setup({ status: { mode: 'stopped', consecutiveFailures: 8, polls: 40 } });
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText(/no longer checking/i)).toBeInTheDocument();
  });
});
