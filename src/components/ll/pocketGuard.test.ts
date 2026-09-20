import {
  BOX_POSITIONS,
  INITIAL,
  MAX_FINGER_RADIUS_PX,
  MIN_TAP_GAP_MS,
  TAPS_REQUIRED,
  isDeliberateTouch,
  nextPosition,
  onHit,
  onMiss,
} from './pocketGuard';

/** Deterministic: always the next position round. */
const pick = (count: number, current: number) => (current + 1) % count;

describe('what counts as a deliberate touch', () => {
  it('accepts one finger', () => {
    expect(isDeliberateTouch(1, 12)).toBe(true);
  });

  // A pocket puts several contacts down at once; a person puts one.
  it('refuses more than one contact at a time', () => {
    expect(isDeliberateTouch(2, 12)).toBe(false);
    expect(isDeliberateTouch(3)).toBe(false);
  });

  it('refuses a contact patch too wide to be a fingertip', () => {
    expect(isDeliberateTouch(1, MAX_FINGER_RADIUS_PX + 1)).toBe(false);
  });

  // The reading is advisory. Some engines never report it and others report 0,
  // and treating that as suspicious would refuse every tap on those devices --
  // turning an unlockable shield into a bricked phone in a park.
  it('accepts a touch whose radius cannot be read', () => {
    expect(isDeliberateTouch(1)).toBe(true);
    expect(isDeliberateTouch(1, 0)).toBe(true);
  });
});

describe('lifting the shield', () => {
  it('takes three taps on the target', () => {
    let state = INITIAL;
    for (let i = 1; i < TAPS_REQUIRED; ++i) {
      const result = onHit(state, i * 1000, pick);
      expect(result.kind).toBe('progress');
      if (result.kind !== 'progress') throw new Error('unreachable');
      state = result.state;
      expect(state.taps).toBe(i);
    }
    expect(onHit(state, 9000, pick).kind).toBe('unlocked');
  });

  it('moves the target after every tap', () => {
    const first = onHit(INITIAL, 1000, pick);
    if (first.kind !== 'progress') throw new Error('expected progress');
    expect(first.state.position).not.toBe(INITIAL.position);
  });

  // One contact dragging across the glass emits a burst of events. A person
  // tapping three separate places cannot beat this floor, so it costs nothing.
  it('ignores a second tap inside the gap floor', () => {
    const first = onHit(INITIAL, 1000, pick);
    if (first.kind !== 'progress') throw new Error('expected progress');
    const tooSoon = onHit(first.state, 1000 + MIN_TAP_GAP_MS - 1, pick);
    expect(tooSoon.kind).toBe('ignored');
    expect(tooSoon.kind === 'ignored' && tooSoon.state.taps).toBe(1);
  });
});

describe('a touch that misses', () => {
  // The load-bearing rule. Three lucky hits over a long walk are conceivable;
  // three with no miss between them are not, because a pocket produces far more
  // misses than hits.
  it('resets progress to nothing', () => {
    const first = onHit(INITIAL, 1000, pick);
    if (first.kind !== 'progress') throw new Error('expected progress');
    expect(onMiss(first.state, pick).taps).toBe(0);
  });

  it('moves the target, so a contact returning to one spot never accumulates', () => {
    const first = onHit(INITIAL, 1000, pick);
    if (first.kind !== 'progress') throw new Error('expected progress');
    expect(onMiss(first.state, pick).position).not.toBe(first.state.position);
  });

  it('clears the gap floor, so the next real tap is never swallowed', () => {
    const first = onHit(INITIAL, 1000, pick);
    if (first.kind !== 'progress') throw new Error('expected progress');
    const after = onMiss(first.state, pick);
    expect(onHit(after, 1001, pick).kind).toBe('progress');
  });
});

describe('the target position', () => {
  it('is never where it already was', () => {
    for (let current = 0; current < BOX_POSITIONS.length; ++current) {
      for (let i = 0; i < 50; ++i) {
        expect(nextPosition(BOX_POSITIONS.length, current)).not.toBe(current);
      }
    }
  });

  // The centre is where a pocket press lands and where the eye goes first, so
  // the target is always somewhere that had to be looked for.
  it('is never the centre of the shield', () => {
    for (const { x, y } of BOX_POSITIONS) {
      expect(Math.abs(x - 0.5) > 0.15 || Math.abs(y - 0.5) > 0.15).toBe(true);
    }
  });
});
