import {
  BOX_POSITIONS,
  INITIAL,
  INITIAL_TOUCH_GESTURE,
  INITIAL_WIDE_TOUCH,
  MAX_FINGER_RADIUS_PX,
  MAX_TAP_SEQUENCE_MS,
  MAX_TAP_TRAVEL_PX,
  MAX_WIDE_TOUCH_SEQUENCE_MS,
  MAX_WIDE_TOUCH_TRAVEL_PX,
  MIN_TAP_GAP_MS,
  TAPS_REQUIRED,
  clearNormalProgress,
  isDeliberateTouch,
  nextPosition,
  onHit,
  onMiss,
  onWideTouch,
  onWideTouchCredit,
  reduceTouchGesture,
  reportedMajorRadius,
  reportedMinorRadius,
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

  it('accepts the same broad reading after the moving-target escape is learned', () => {
    expect(isDeliberateTouch(1, MAX_FINGER_RADIUS_PX + 1, true)).toBe(true);
  });

  // The reading is advisory. Some engines never report it and others report 0,
  // and treating that as suspicious would refuse every tap on those devices --
  // turning an unlockable shield into a bricked phone in a park.
  it('accepts a touch whose radius cannot be read', () => {
    expect(isDeliberateTouch(1)).toBe(true);
    expect(isDeliberateTouch(1, 0)).toBe(true);
  });
});

describe('the reported touch ellipse', () => {
  it('uses the narrow axis, whichever way the finger is rotated', () => {
    expect(reportedMinorRadius(20, 60)).toBe(20);
    expect(reportedMinorRadius(60, 20)).toBe(20);
    expect(reportedMajorRadius(20, 60)).toBe(60);
    expect(reportedMajorRadius(60, 20)).toBe(60);
  });

  it('cannot call an incomplete ellipse broad', () => {
    expect(reportedMinorRadius(60)).toBeUndefined();
    expect(reportedMinorRadius(0, 60)).toBeUndefined();
    expect(reportedMajorRadius(0, 60)).toBe(60);
  });
});

describe('one complete touch gesture', () => {
  it('credits one narrow contact that starts and ends on the target', () => {
    const started = reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
      phase: 'start',
      touches: 1,
      changedTouches: 1,
      minorRadius: 12,
      majorRadius: 12,
      onTarget: true,
    });
    expect(started.outcome).toBe('pending');
    expect(
      reduceTouchGesture(started.state, {
        phase: 'end',
        touches: 0,
        changedTouches: 1,
        minorRadius: 12,
        majorRadius: 12,
        onTarget: true,
      })
    ).toMatchObject({ outcome: 'hit', completion: 'normal' });
  });

  it('moves into the wide-touch path as soon as a broad target contact is visible', () => {
    const started = reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
      phase: 'start',
      touches: 1,
      changedTouches: 1,
      minorRadius: MAX_FINGER_RADIUS_PX + 1,
      majorRadius: MAX_FINGER_RADIUS_PX + 1,
      onTarget: true,
    });
    expect(started.outcome).toBe('wide-reset');
    expect(
      reduceTouchGesture(started.state, {
        phase: 'end',
        touches: 0,
        changedTouches: 1,
        minorRadius: 10,
        majorRadius: 10,
        onTarget: true,
      }).completion
    ).toBe('wide');
  });

  it('keeps a staggered two-finger release invalid until both are up', () => {
    const first = reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
      phase: 'start',
      touches: 1,
      changedTouches: 1,
      minorRadius: 12,
      majorRadius: 12,
      onTarget: true,
    });
    const second = reduceTouchGesture(first.state, {
      phase: 'start',
      touches: 2,
      changedTouches: 1,
      minorRadius: 12,
      majorRadius: 12,
      onTarget: false,
    });
    expect(second.outcome).toBe('reset');

    const oneLeft = reduceTouchGesture(second.state, {
      phase: 'end',
      touches: 1,
      changedTouches: 1,
      minorRadius: 12,
      majorRadius: 12,
      onTarget: true,
    });
    expect(oneLeft.state.maxContacts).toBe(2);
    expect(oneLeft.outcome).toBe('pending');
    expect(
      reduceTouchGesture(oneLeft.state, {
        phase: 'end',
        touches: 0,
        changedTouches: 1,
        minorRadius: 12,
        majorRadius: 12,
        onTarget: true,
      }).outcome
    ).not.toBe('hit');
  });

  it('remembers a contact that becomes broad during movement', () => {
    const started = reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
      phase: 'start',
      touches: 1,
      changedTouches: 1,
      minorRadius: 12,
      majorRadius: 12,
      onTarget: true,
    });
    const moved = reduceTouchGesture(started.state, {
      phase: 'move',
      touches: 1,
      changedTouches: 1,
      minorRadius: MAX_FINGER_RADIUS_PX + 1,
      majorRadius: MAX_FINGER_RADIUS_PX + 1,
      onTarget: true,
    });
    expect(moved.outcome).toBe('wide-reset');
    expect(moved.state.maxMinorRadius).toBe(MAX_FINGER_RADIUS_PX + 1);
  });

  it('rejects a drag even when it remains a narrow single contact', () => {
    const started = reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
      phase: 'start',
      touches: 1,
      changedTouches: 1,
      minorRadius: 12,
      majorRadius: 12,
      point: { x: 10, y: 10 },
      onTarget: true,
    });
    const moved = reduceTouchGesture(started.state, {
      phase: 'move',
      touches: 1,
      changedTouches: 1,
      minorRadius: 12,
      majorRadius: 12,
      point: { x: 10 + MAX_TAP_TRAVEL_PX + 1, y: 10 },
      onTarget: true,
    });
    expect(moved.outcome).toBe('reset');
    expect(moved.state.maxTravel).toBe(MAX_TAP_TRAVEL_PX + 1);
  });

  it('resets a cancelled gesture', () => {
    const started = reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
      phase: 'start',
      touches: 1,
      changedTouches: 1,
      onTarget: true,
    });
    expect(
      reduceTouchGesture(started.state, {
        phase: 'cancel',
        touches: 0,
        changedTouches: 1,
        onTarget: true,
      })
    ).toEqual({
      state: INITIAL_TOUCH_GESTURE,
      outcome: 'reset',
      completion: 'invalid',
    });
  });

  it('ignores a touchend that did not begin after the shield mounted', () => {
    expect(
      reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
        phase: 'end',
        touches: 0,
        changedTouches: 1,
        minorRadius: 12,
        majorRadius: 12,
        onTarget: true,
      })
    ).toEqual({
      state: INITIAL_TOUCH_GESTURE,
      outcome: 'pending',
      completion: 'none',
    });
  });

  it('allows a large contact to drift twice as far on the escape path', () => {
    const started = reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
      phase: 'start',
      touches: 1,
      changedTouches: 1,
      minorRadius: 20,
      majorRadius: MAX_FINGER_RADIUS_PX + 1,
      point: { x: 10, y: 10 },
      onTarget: true,
    });
    const moved = reduceTouchGesture(started.state, {
      phase: 'move',
      touches: 1,
      changedTouches: 1,
      minorRadius: 20,
      majorRadius: MAX_FINGER_RADIUS_PX + 1,
      point: { x: 10 + 50, y: 10 },
      onTarget: true,
    });
    expect(moved.outcome).toBe('wide-reset');
    expect(
      reduceTouchGesture(moved.state, {
        phase: 'end',
        touches: 0,
        changedTouches: 1,
        minorRadius: 20,
        majorRadius: MAX_FINGER_RADIUS_PX + 1,
        point: { x: 10 + 50, y: 10 },
        onTarget: true,
      }).completion
    ).toBe('wide');
  });

  it('refuses the escape when the large contact travels past its bound', () => {
    const started = reduceTouchGesture(INITIAL_TOUCH_GESTURE, {
      phase: 'start',
      touches: 1,
      changedTouches: 1,
      minorRadius: 20,
      majorRadius: MAX_FINGER_RADIUS_PX + 1,
      point: { x: 10, y: 10 },
      onTarget: true,
    });
    const moved = reduceTouchGesture(started.state, {
      phase: 'move',
      touches: 1,
      changedTouches: 1,
      minorRadius: 20,
      majorRadius: MAX_FINGER_RADIUS_PX + 1,
      point: { x: 10 + MAX_WIDE_TOUCH_TRAVEL_PX + 1, y: 10 },
      onTarget: true,
    });
    expect(
      reduceTouchGesture(moved.state, {
        phase: 'end',
        touches: 0,
        changedTouches: 1,
        minorRadius: 20,
        majorRadius: MAX_FINGER_RADIUS_PX + 1,
        point: { x: 10 + MAX_WIDE_TOUCH_TRAVEL_PX + 1, y: 10 },
        onTarget: true,
      }).completion
    ).toBe('invalid');
  });
});

describe('the wide-touch escape sequence', () => {
  it('unlocks after three qualifying attempts', () => {
    const first = onWideTouch(INITIAL_WIDE_TOUCH, 1000);
    expect(first.kind).toBe('progress');
    if (first.kind !== 'progress') throw new Error('expected progress');
    const second = onWideTouch(first.state, 1000 + MIN_TAP_GAP_MS);
    expect(second.kind).toBe('progress');
    if (second.kind !== 'progress') throw new Error('expected progress');
    expect(onWideTouch(second.state, 2000).kind).toBe('unlocked');
  });

  it('starts a fresh sequence after twenty seconds', () => {
    const first = onWideTouch(INITIAL_WIDE_TOUCH, 1000);
    if (first.kind !== 'progress') throw new Error('expected progress');
    const second = onWideTouch(first.state, 1000 + MIN_TAP_GAP_MS);
    if (second.kind !== 'progress') throw new Error('expected progress');
    const expired = onWideTouch(
      second.state,
      1000 + MAX_WIDE_TOUCH_SEQUENCE_MS + 1
    );
    expect(expired.kind).toBe('progress');
    if (expired.kind !== 'progress') throw new Error('expected progress');
    expect(expired.state.taps).toBe(1);
  });

  it('clears normal progress without moving a target for an unfinished attempt', () => {
    const first = onHit(INITIAL, 1000, pick);
    if (first.kind !== 'progress') throw new Error('expected progress');
    const cleared = clearNormalProgress(first.state);
    expect(cleared.taps).toBe(0);
    expect(cleared.position).toBe(first.state.position);
  });

  it('moves the target exactly once when a wide attempt is credited', () => {
    const pickOnce = jest.fn(pick);
    expect(onWideTouchCredit(INITIAL, pickOnce).position).not.toBe(
      INITIAL.position
    );
    expect(pickOnce).toHaveBeenCalledTimes(1);
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

  it('accepts all three taps at the sequence-window boundary', () => {
    const first = onHit(INITIAL, 1000, pick);
    if (first.kind !== 'progress') throw new Error('expected progress');
    const second = onHit(first.state, 1000 + MIN_TAP_GAP_MS, pick);
    if (second.kind !== 'progress') throw new Error('expected progress');
    expect(onHit(second.state, 1000 + MAX_TAP_SEQUENCE_MS, pick).kind).toBe(
      'unlocked'
    );
  });

  it('starts over when the three taps exceed the sequence window', () => {
    const first = onHit(INITIAL, 1000, pick);
    if (first.kind !== 'progress') throw new Error('expected progress');
    const second = onHit(first.state, 1000 + MIN_TAP_GAP_MS, pick);
    if (second.kind !== 'progress') throw new Error('expected progress');
    const expired = onHit(second.state, 1000 + MAX_TAP_SEQUENCE_MS + 1, pick);
    expect(expired.kind).toBe('progress');
    if (expired.kind !== 'progress') throw new Error('expected fresh progress');
    expect(expired.state.taps).toBe(1);
    expect(expired.state.firstTapAt).toBe(1000 + MAX_TAP_SEQUENCE_MS + 1);
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
