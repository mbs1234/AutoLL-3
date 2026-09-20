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
 * Longest time allowed from the first accepted tap to the third, in ms.
 *
 * The moving target and miss reset make three accidental hits unlikely, but
 * without a ceiling they could accumulate over an entire pocketed hour. Ten
 * seconds is generous for a person reading and following the target, while
 * making that lucky long-running sequence impossible.
 */
export const MAX_TAP_SEQUENCE_MS = 10_000;

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
  /** When this sequence's first accepted tap landed, for the window ceiling. */
  firstTapAt: number;
}

export const INITIAL: ShieldState = {
  taps: 0,
  position: 0,
  lastTapAt: 0,
  firstTapAt: 0,
};

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

/** Maximum drift still treated as a tap rather than a drag. */
export const MAX_TAP_TRAVEL_PX = 32;

export type TouchGesturePhase = 'start' | 'move' | 'end' | 'cancel';

/** The touch facts the component can read without constructing DOM objects. */
export interface TouchGestureEvent {
  phase: TouchGesturePhase;
  /** Contacts still on the glass after this event. */
  touches: number;
  /** Contacts added, moved, removed or cancelled by this event. */
  changedTouches: number;
  /** Widest radius reported anywhere in either touch list. */
  maxRadius?: number;
  /** Current position of the gesture's primary contact, when reported. */
  point?: { x: number; y: number };
  /** Whether this gesture began on the moving unlock target. */
  onTarget: boolean;
}

/** Everything learned across one complete touch gesture. */
export interface TouchGestureState {
  active: boolean;
  startedOnTarget: boolean;
  invalid: boolean;
  maxContacts: number;
  maxRadius: number;
  startX?: number;
  startY?: number;
  maxTravel: number;
}

export const INITIAL_TOUCH_GESTURE: TouchGestureState = {
  active: false,
  startedOnTarget: false,
  invalid: false,
  maxContacts: 0,
  maxRadius: 0,
  maxTravel: 0,
};

export type TouchGestureResult = {
  state: TouchGestureState;
  /** `reset` is emitted once, at the first evidence the gesture is invalid. */
  outcome: 'pending' | 'reset' | 'hit';
};

/**
 * Accumulate the whole touch sequence rather than judging its last event.
 *
 * On a staggered two-finger release, `touches` and `changedTouches` can each
 * contain one contact. Looking at either list alone calls that a one-finger
 * gesture; adding them at the end preserves the two contacts that existed
 * immediately before the release. Once invalid, a gesture stays invalid until
 * every finger is up, so a later single-finger end cannot rehabilitate it.
 */
export function reduceTouchGesture(
  state: TouchGestureState,
  event: TouchGestureEvent
): TouchGestureResult {
  if (event.phase === 'cancel') {
    return {
      state: INITIAL_TOUCH_GESTURE,
      outcome: state.invalid ? 'pending' : 'reset',
    };
  }

  const startsGesture = !state.active;
  const startedOnTarget = startsGesture
    ? event.onTarget
    : state.startedOnTarget;
  const contacts =
    event.phase === 'end'
      ? event.touches + event.changedTouches
      : event.touches;
  const maxContacts = Math.max(state.maxContacts, contacts);
  const maxRadius = Math.max(state.maxRadius, event.maxRadius ?? 0);
  const startX = startsGesture
    ? event.point?.x
    : (state.startX ?? event.point?.x);
  const startY = startsGesture
    ? event.point?.y
    : (state.startY ?? event.point?.y);
  const travel =
    event.point && startX !== undefined && startY !== undefined
      ? Math.hypot(event.point.x - startX, event.point.y - startY)
      : 0;
  const maxTravel = Math.max(state.maxTravel, travel);
  const invalid =
    state.invalid ||
    !startedOnTarget ||
    !isDeliberateTouch(maxContacts, maxRadius) ||
    maxTravel > MAX_TAP_TRAVEL_PX;
  const completed = event.phase === 'end' && event.touches === 0;

  if (completed) {
    if (!invalid) {
      return { state: INITIAL_TOUCH_GESTURE, outcome: 'hit' };
    }
    return {
      state: INITIAL_TOUCH_GESTURE,
      outcome: state.invalid ? 'pending' : 'reset',
    };
  }

  return {
    state: {
      active: true,
      startedOnTarget,
      invalid,
      maxContacts,
      maxRadius,
      startX,
      startY,
      maxTravel,
    },
    outcome: invalid && !state.invalid ? 'reset' : 'pending',
  };
}

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
  // An expired sequence does not swallow the deliberate tap that revealed
  // it. It becomes tap one of a fresh sequence, at the target just pressed.
  const current =
    state.taps > 0 && at - state.firstTapAt > MAX_TAP_SEQUENCE_MS
      ? { ...state, taps: 0, lastTapAt: 0, firstTapAt: 0 }
      : state;
  if (at - current.lastTapAt < MIN_TAP_GAP_MS) {
    return { kind: 'ignored', state: current };
  }
  const taps = current.taps + 1;
  if (taps >= TAPS_REQUIRED) return { kind: 'unlocked' };
  return {
    kind: 'progress',
    state: {
      taps,
      position: pick(BOX_POSITIONS.length, current.position),
      lastTapAt: at,
      firstTapAt: current.taps === 0 ? at : current.firstTapAt,
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
    firstTapAt: 0,
  };
}

/** Picks any position except the one the target is already at. */
export function nextPosition(count: number, current: number): number {
  const offset = 1 + Math.floor(Math.random() * (count - 1));
  return (current + offset) % count;
}
