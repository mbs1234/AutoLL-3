import '@testing-library/jest-dom';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';

import { AutopilotState } from '@/contexts/AutopilotContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';

import PocketShield from './PocketShield';
import {
  MAX_FINGER_RADIUS_PX,
  MIN_TAP_GAP_MS,
  TAPS_REQUIRED,
} from './pocketGuard';

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

function setup(
  overrides: Partial<AutopilotState> = {},
  options: {
    wideTouchLearned?: boolean;
    onLearnWideTouch?: () => void;
  } = {}
) {
  const onExit = jest.fn();
  render(
    <TopAutopilotContext value={{ ...state, ...overrides }}>
      <PocketShield onExit={onExit} {...options} />
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

const finger = (
  identifier: number,
  radius = 12,
  clientX = 10,
  clientY = 10
) => ({
  identifier,
  radiusX: radius,
  radiusY: radius,
  clientX,
  clientY,
});

const ovalFinger = (
  identifier: number,
  radiusX: number,
  radiusY: number,
  clientX = 10,
  clientY = 10
) => ({ identifier, radiusX, radiusY, clientX, clientY });

function touchStart(
  element: HTMLElement,
  touches: ReturnType<typeof finger>[],
  changedTouches = touches
) {
  fireEvent.touchStart(element, { touches, changedTouches });
}

function touchMove(
  element: HTMLElement,
  touches: ReturnType<typeof finger>[],
  changedTouches = touches
) {
  fireEvent.touchMove(element, { touches, changedTouches });
}

function touchEnd(
  element: HTMLElement,
  changedTouches: ReturnType<typeof finger>[],
  touches: ReturnType<typeof finger>[] = []
) {
  fireEvent.touchEnd(element, { touches, changedTouches });
}

function deliberateTouch(element: HTMLElement) {
  clock += MIN_TAP_GAP_MS;
  const contact = finger(1);
  touchStart(element, [contact]);
  touchEnd(element, [contact]);
  // Browsers follow a touch with this compatibility click. It is part of the
  // sequence under test, not a second action by the user.
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

  it('counts a deliberate touch once, not again for its synthetic click', () => {
    setup();
    deliberateTouch(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);
  });

  it('does not credit a touchend whose touchstart preceded the shield', () => {
    setup();
    const contact = finger(40);
    touchEnd(box(), [contact]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/3 more taps/i);
  });

  it.each([
    [20, 60],
    [60, 20],
  ])(
    'accepts an elongated fingertip reported as %d by %d',
    (radiusX, radiusY) => {
      setup();
      clock += MIN_TAP_GAP_MS;
      const contact = ovalFinger(9, radiusX, radiusY);
      touchStart(box(), [contact]);
      touchEnd(box(), [contact]);
      fireEvent.click(box());
      expect(box()).toHaveAccessibleName(/2 more taps/i);
      expect(
        screen.queryByText(/keep using one fingertip/i)
      ).not.toBeInTheDocument();
    }
  );

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

  /**
   * The regression sequence, kept whole. In v1.1.2 the click after the broad
   * miss happened to reset progress. Suppressing that click without making the
   * touch itself reset would silently remove the only reset the sequence had.
   */
  it('resets on a broad miss and ignores every later event in its click sequence', () => {
    setup();
    deliberateTouch(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);

    const broad = finger(2, MAX_FINGER_RADIUS_PX + 1);
    touchStart(backdrop(), [broad]);
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    touchEnd(backdrop(), [broad]);
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    fireEvent.click(backdrop());
    expect(box()).toHaveAccessibleName(/3 more taps/i);
  });

  it('turns one broad target sequence into one moving-target escape attempt', () => {
    const onLearnWideTouch = jest.fn();
    setup({}, { onLearnWideTouch });
    deliberateTouch(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);

    const broad = finger(2, MAX_FINGER_RADIUS_PX + 1);
    const before = box().dataset.position;
    touchStart(box(), [broad]);
    expect(box().dataset.position).not.toBe(before);
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    touchEnd(box(), [broad]);
    expect(box()).toHaveAccessibleName(/2 more taps/i);
    expect(screen.getByText(/keep using one fingertip/i)).toBeVisible();
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);
    expect(onLearnWideTouch).not.toHaveBeenCalled();
  });

  it('unlocks through three broad moving-target touches with centroid drift', () => {
    const onLearnWideTouch = jest.fn();
    const onExit = setup({}, { onLearnWideTouch });
    const labels: (string | null)[] = [];
    const exitCounts: number[] = [];

    for (let attempt = 0; attempt < TAPS_REQUIRED; ++attempt) {
      clock += MIN_TAP_GAP_MS;
      const start = finger(20 + attempt, MAX_FINGER_RADIUS_PX + 1, 10, 10);
      const moved = finger(20 + attempt, MAX_FINGER_RADIUS_PX + 1, 60, 10);
      const before = box().dataset.position;

      touchStart(box(), [start]);
      expect(box().dataset.position).not.toBe(before);
      expect(onExit).not.toHaveBeenCalled();

      touchMove(box(), [moved]);
      expect(onExit).not.toHaveBeenCalled();

      touchEnd(box(), [moved]);
      fireEvent.click(box());
      labels.push(box().getAttribute('aria-label'));
      exitCounts.push(onExit.mock.calls.length);
    }

    expect(labels.slice(0, 2)).toEqual([
      'Unlock the screen: 2 more taps needed',
      'Unlock the screen: 1 more tap needed',
    ]);
    expect(exitCounts).toEqual([0, 0, 1]);
    expect(onLearnWideTouch).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('resets the escape when the next press stays at the old target', () => {
    setup();
    clock += MIN_TAP_GAP_MS;
    const broad = finger(30, MAX_FINGER_RADIUS_PX + 1);
    touchStart(box(), [broad]);
    touchEnd(box(), [broad]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);

    clock += MIN_TAP_GAP_MS;
    touchStart(backdrop(), [broad]);
    touchEnd(backdrop(), [broad]);
    fireEvent.click(backdrop());
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    expect(
      screen.queryByText(/keep using one fingertip/i)
    ).not.toBeInTheDocument();
  });

  it('uses the ordinary path for a learned broad fingertip', () => {
    setup({}, { wideTouchLearned: true });
    clock += MIN_TAP_GAP_MS;
    const broad = finger(31, MAX_FINGER_RADIUS_PX + 1);
    const before = box().dataset.position;
    touchStart(box(), [broad]);
    expect(box().dataset.position).toBe(before);
    touchEnd(box(), [broad]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);
    expect(box().dataset.position).not.toBe(before);
  });

  it('keeps a staggered multi-touch invalid through both releases', () => {
    setup();
    const broad = finger(32, MAX_FINGER_RADIUS_PX + 1);
    touchStart(box(), [broad]);
    touchEnd(box(), [broad]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);

    const first = finger(3);
    const second = finger(4);
    touchStart(box(), [first]);
    touchStart(backdrop(), [first, second], [second]);
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    touchEnd(box(), [first], [second]);
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    touchEnd(backdrop(), [second]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    expect(
      screen.queryByText(/keep using one fingertip/i)
    ).not.toBeInTheDocument();
  });

  it('uses the escape when a contact broadens during movement', () => {
    setup();
    deliberateTouch(box());
    const contact = finger(5);
    touchStart(box(), [contact]);
    const broad = finger(5, MAX_FINGER_RADIUS_PX + 1);
    touchMove(box(), [broad]);
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    touchEnd(box(), [broad]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);
  });

  it('resets escape progress when the next gesture is cancelled', () => {
    setup();
    const broad = finger(33, MAX_FINGER_RADIUS_PX + 1);
    touchStart(box(), [broad]);
    touchEnd(box(), [broad]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);

    touchStart(box(), [finger(6)]);
    fireEvent.touchCancel(box(), {
      touches: [],
      changedTouches: [finger(6)],
    });
    expect(box()).toHaveAccessibleName(/3 more taps/i);
  });

  it('resets escape progress when a large contact travels too far', () => {
    setup();
    const broad = finger(34, MAX_FINGER_RADIUS_PX + 1);
    touchStart(box(), [broad]);
    touchEnd(box(), [broad]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/2 more taps/i);

    clock += MIN_TAP_GAP_MS;
    touchStart(box(), [broad]);
    const dragged = finger(34, MAX_FINGER_RADIUS_PX + 1, 100, 10);
    touchMove(box(), [dragged]);
    touchEnd(box(), [dragged]);
    fireEvent.click(box());
    expect(box()).toHaveAccessibleName(/3 more taps/i);
    expect(
      screen.queryByText(/keep using one fingertip/i)
    ).not.toBeInTheDocument();
  });

  it('resets when a contact drags instead of tapping', () => {
    setup();
    deliberateTouch(box());
    touchStart(box(), [finger(8)]);
    touchMove(box(), [finger(8, 12, 100, 10)]);
    expect(box()).toHaveAccessibleName(/3 more taps/i);
  });

  it('prevents the touch gestures that can scroll or reload the page', () => {
    setup();
    expect(backdrop()).toHaveClass('touch-none', 'overscroll-none');
    const event = createEvent.touchMove(backdrop(), {
      cancelable: true,
      touches: [finger(7)],
      changedTouches: [finger(7)],
    });
    fireEvent(backdrop(), event);
    expect(event.defaultPrevented).toBe(true);
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

  it('uses the same alarm state when autopilot is off', () => {
    setup({
      enabled: false,
      status: { mode: 'off', consecutiveFailures: 0, polls: 0 },
    });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/is off and is no longer checking/i)).toBeVisible();
    expect(backdrop()).toHaveClass('bg-red-950');
  });

  it('counts only unpaused targets with an automatic action', () => {
    setup({
      targetsHere: [
        { experienceId: 'alert-only' },
        { experienceId: 'book', autoBook: true },
        { experienceId: 'paused', autoSwap: true, paused: true },
      ],
    });
    expect(screen.getByText(/1 armed/)).toBeInTheDocument();
  });
});
