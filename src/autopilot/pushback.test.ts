import { RequestError } from '@/api/client';

import {
  PUSHBACK_WARNING_MS,
  THROTTLE_WAIT_FIRST_MS,
  THROTTLE_WAIT_MAX_MS,
  THROTTLE_WAIT_MIN_MS,
  lastPushback,
  noteRefusal,
  noteThrottle,
  pushbackOf,
  pushbackOfStatus,
  recentPushback,
  refusalCount,
  resetPushback,
  subscribePushback,
  throttleWaitMs,
} from './pushback';

beforeEach(() => resetPushback());

describe('pushbackOfStatus()', () => {
  it('reads a 403 as Disney refusing', () => {
    expect(pushbackOfStatus(403)).toEqual({ kind: 'refused' });
  });

  it('reads a 429 as Disney asking to slow down, with its wait', () => {
    expect(pushbackOfStatus(429)).toEqual({ kind: 'throttled' });
    expect(pushbackOfStatus(429, 90_000)).toEqual({
      kind: 'throttled',
      retryAfterMs: 90_000,
    });
  });

  // 401 is a session, 410 a ride that sold out mid-drop, 0 a timeout. None of
  // them is Disney asking this app to stop, and stopping on them would end a
  // good morning.
  it.each([401, 409, 410, 500, 0, undefined])('ignores %p', status => {
    expect(pushbackOfStatus(status)).toBeUndefined();
  });
});

describe('pushbackOf()', () => {
  it('reads the response a request error carries', () => {
    const throttled = new RequestError({
      ok: false,
      status: 429,
      data: {},
      retryAfterMs: 60_000,
    });
    expect(pushbackOf(throttled)).toEqual({
      kind: 'throttled',
      retryAfterMs: 60_000,
    });
    const refused = new RequestError({ ok: false, status: 403, data: {} });
    expect(pushbackOf(refused)).toEqual({ kind: 'refused' });
  });

  it.each([new Error('Network request failed'), undefined, null, 'x'])(
    'finds nothing in %p',
    error => {
      expect(pushbackOf(error)).toBeUndefined();
    }
  );
});

describe('the refusal signal', () => {
  it('counts every refusal and tells whoever is listening', () => {
    const heard = jest.fn();
    const unsubscribe = subscribePushback(heard);
    expect(refusalCount()).toBe(0);
    noteRefusal(1000);
    noteRefusal(2000);
    expect(refusalCount()).toBe(2);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(lastPushback()).toEqual({ kind: 'refused', at: 2000 });
    unsubscribe();
    noteRefusal(3000);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  // Each routine answers its own 429s. A throttle anywhere must never read as
  // a refusal, or one search being told to slow down would stop Autopilot.
  it('records a throttle for the warning without counting it as a refusal', () => {
    noteThrottle(90_000, 1000);
    expect(refusalCount()).toBe(0);
    expect(lastPushback()).toEqual({
      kind: 'throttled',
      at: 1000,
      until: 91_000,
    });
  });
});

describe('recentPushback()', () => {
  it('warns about a pushback until it is half an hour old', () => {
    noteRefusal(1000);
    const pushback = lastPushback();
    expect(recentPushback(pushback, 1000 + PUSHBACK_WARNING_MS - 1)).toBe(
      pushback
    );
    expect(
      recentPushback(pushback, 1000 + PUSHBACK_WARNING_MS)
    ).toBeUndefined();
  });

  it('has nothing to warn about before any pushback', () => {
    expect(recentPushback(undefined)).toBeUndefined();
  });
});

describe('throttleWaitMs()', () => {
  it('starts at two minutes and doubles with each 429 in a row', () => {
    expect(throttleWaitMs(1)).toBe(THROTTLE_WAIT_FIRST_MS);
    expect(throttleWaitMs(2)).toBe(THROTTLE_WAIT_FIRST_MS * 2);
    expect(throttleWaitMs(3)).toBe(THROTTLE_WAIT_FIRST_MS * 4);
    expect(throttleWaitMs(4)).toBe(THROTTLE_WAIT_FIRST_MS * 8);
  });

  it('never waits longer than half an hour on its own reckoning', () => {
    expect(throttleWaitMs(5)).toBe(THROTTLE_WAIT_MAX_MS);
    expect(throttleWaitMs(50)).toBe(THROTTLE_WAIT_MAX_MS);
  });

  // Disney knows how long its pause lasts, and this build does not.
  it('waits as long as Disney asks, even past half an hour', () => {
    expect(throttleWaitMs(1, 45 * 60_000)).toBe(45 * 60_000);
    expect(throttleWaitMs(9, 90_000)).toBe(90_000);
  });

  it('never asks again at once, whatever Disney says', () => {
    expect(throttleWaitMs(1, 0)).toBe(THROTTLE_WAIT_MIN_MS);
  });
});
