/**
 * The rules that decide whether a touch was a person or a pocket.
 *
 * Autopilot holds a screen wake lock, so the phone that goes in your pocket has
 * its display on and its glass live. One unconfirmed tap on Today stops the
 * engine, and a stopped engine is silent -- you would find out whenever you next
 * looked. This is the guard against that, kept out of the component so the rules
 * can be argued with in tests rather than by tapping a phone.
 *
 * The mechanic is three deliberate taps on a small target that moves after each
 * one. Moving it is what makes it work: fabric cannot look at the screen to find
 * out where the target went, and a person can.
 */

/** Taps needed to lift the shield. */
export const TAPS_REQUIRED = 3;

/**
 * The shortest gap between two taps that can both count, in ms.
 *
 * One contact dragging across the glass can produce a run of touch events in
 * quick succession. A person tapping three separate places cannot go faster
 * than this, so the floor costs nothing and removes the smear.
 */
export const MIN_TAP_GAP_MS = 150;

/**
 * Where the target can be, as fractions of the shield.
 *
 * Nine positions, well apart, and never the centre -- the centre is where a
 * pocket press is most likely to land and where the eye goes first, so the
 * target is always somewhere that had to be looked for.
 */
export const BOX_POSITIONS: readonly { x: number; y: number }[] = [
  { x: 0.2, y: 0.22 },
  { x: 0.5, y: 0.18 },
  { x: 0.8, y: 0.22 },
  { x: 0.18, y: 0.5 },
  { x: 0.82, y: 0.5 },
  { x: 0.2, y: 0.78 },
  { x: 0.5, y: 0.82 },
  { x: 0.8, y: 0.78 },
];

export interface ShieldState {
  /** Taps accepted so far, 0 to TAPS_REQUIRED - 1. */
  taps: number;
  /** Index into BOX_POSITIONS. */
  position: number;
  /** When the last accepted tap landed, for the gap floor. */
  lastTapAt: number;
}

export const INITIAL: ShieldState = { taps: 0, position: 0, lastTapAt: 0 };

/**
 * Whether a touch is one finger, deliberately placed.
 *
 * A pocket puts several contacts down at once and each one is broad. Both
 * readings are advisory: `radiusX` is unreported on some engines and reads 0 or
 * 1 on others, so a missing or zero radius is NOT treated as suspicious -- it
 * would refuse every tap on those devices. Only a radius we can read AND that
 * is implausibly wide for a fingertip is rejected.
 */
export function isDeliberateTouch(
  touchCount: number,
  radiusX?: number
): boolean {
  if (touchCount > 1) return false;
  if (radiusX === undefined || radiusX <= 0) return true;
  return radiusX <= MAX_FINGER_RADIUS_PX;
}

/**
 * Widest contact patch still credited to a fingertip, in CSS px.
 *
 * A fingertip reports roughly 10-25 here. A palm, a thigh through fabric, or a
 * jacket lining reports far more. Set generously: refusing a real tap is worse
 * than accepting a lucky one, because the lucky one still has to happen three
 * times without a miss.
 */
export const MAX_FINGER_RADIUS_PX = 45;

/** The outcome of a touch that landed on the target. */
export type HitResult =
  | { kind: 'ignored'; state: ShieldState }
  | { kind: 'progress'; state: ShieldState }
  | { kind: 'unlocked' };

/**
 * A touch on the target.
 *
 * `pick` chooses the next position and is passed in so a test can be
 * deterministic; it receives the count of positions and the current index, and
 * must not return the current one.
 */
export function onHit(
  state: ShieldState,
  at: number,
  pick: (count: number, current: number) => number
): HitResult {
  if (at - state.lastTapAt < MIN_TAP_GAP_MS) {
    return { kind: 'ignored', state };
  }
  const taps = state.taps + 1;
  if (taps >= TAPS_REQUIRED) return { kind: 'unlocked' };
  return {
    kind: 'progress',
    state: {
      taps,
      position: pick(BOX_POSITIONS.length, state.position),
      lastTapAt: at,
    },
  };
}

/**
 * A touch anywhere else.
 *
 * Progress resets, and this is the rule that does the real work. Three lucky
 * hits are conceivable over a long walk; three with no miss in between is not,
 * because a pocket generates far more misses than hits. It also moves the
 * target, so a contact that keeps returning to one spot never accumulates.
 */
export function onMiss(
  state: ShieldState,
  pick: (count: number, current: number) => number
): ShieldState {
  if (state.taps === 0 && state.position === INITIAL.position) return state;
  return {
    taps: 0,
    position: pick(BOX_POSITIONS.length, state.position),
    lastTapAt: 0,
  };
}

/** Picks any position except the one the target is already at. */
export function nextPosition(count: number, current: number): number {
  const offset = 1 + Math.floor(Math.random() * (count - 1));
  return (current + offset) % count;
}
