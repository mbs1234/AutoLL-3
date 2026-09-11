import { act, renderHook, waitFor } from '@testing-library/react';

import { DateTime } from '@/datetime';

import {
  BACKOFF_CAP_MS,
  IDLE_INTERVAL_MS,
  MAX_CONSECUTIVE_FAILURES,
  TICK_DEADLINE_MS,
} from './schedule';
import usePoller from './usePoller';

jest.mock('@/timesync');

// jest.config.js sets `fakeTimers` options but not `enableGlobally`, so fake
// timers are off unless a file opts in. Without this the loop's setTimeout
// runs on the real clock and the scheduled ticks never arrive inside a test.
jest.useFakeTimers();

/** Jump far enough ahead to guarantee the next scheduled tick has fired. */
async function advancePastNextTick(ms = IDLE_INTERVAL_MS * 2) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

describe('usePoller', () => {
  it('never ticks while disabled', async () => {
    const onTick = jest.fn(async () => undefined);
    const { result } = renderHook(() => usePoller({ enabled: false, onTick }));
    await advancePastNextTick();
    expect(onTick).not.toHaveBeenCalled();
    expect(result.current.mode).toBe('off');
  });

  it('ticks immediately when enabled', async () => {
    const onTick = jest.fn(async () => undefined);
    renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
  });

  it('keeps ticking on a schedule', async () => {
    const onTick = jest.fn(async () => undefined);
    renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    await advancePastNextTick();
    expect(onTick.mock.calls.length).toBeGreaterThan(1);
  });

  it('reports idle mode with no upcoming targets', async () => {
    const onTick = jest.fn(async () => undefined);
    const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(result.current.mode).toBe('idle'));
    expect(result.current.polls).toBeGreaterThan(0);
  });

  // Polls run strictly sequentially: the next is scheduled only once the
  // previous settles, so a slow request can never cause overlapping calls.
  it('does not overlap ticks', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const onTick = jest.fn(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, 5000));
      --inFlight;
    });
    renderHook(() => usePoller({ enabled: true, onTick }));
    await advancePastNextTick(IDLE_INTERVAL_MS * 5);
    expect(maxInFlight).toBe(1);
  });

  it('counts consecutive failures', async () => {
    const onTick = jest.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(result.current.consecutiveFailures).toBe(1));
    expect(result.current.lastError).toBe('boom');
  });

  it('resets the failure count after a success', async () => {
    let fail = true;
    const onTick = jest.fn(async () => {
      if (fail) throw new Error('boom');
    });
    const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(result.current.consecutiveFailures).toBe(1));
    fail = false;
    await advancePastNextTick(BACKOFF_CAP_MS);
    await waitFor(() => expect(result.current.consecutiveFailures).toBe(0));
  });

  // A stuck loop is worse than a stopped one: a 401 clears the auth store, so
  // retrying forever against dead credentials just generates noise.
  it('gives up after too many consecutive failures', async () => {
    const onTick = jest.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(result.current.consecutiveFailures).toBe(1));
    for (let i = 1; i < MAX_CONSECUTIVE_FAILURES; ++i) {
      await advancePastNextTick(BACKOFF_CAP_MS);
    }
    await waitFor(() => expect(result.current.mode).toBe('stopped'));
    const callsAtStop = onTick.mock.calls.length;
    await advancePastNextTick(BACKOFF_CAP_MS * 3);
    expect(onTick).toHaveBeenCalledTimes(callsAtStop);
  });

  /**
   * Local cycle timing.
   *
   * The point of the numbers is telling a slow network or device apart from
   * deliberate backoff, so a failure must not be averaged in: the cheapest
   * failure here is `RateLimit.enforce()` throwing before any fetch, which
   * would drag the average down and make it read healthiest exactly when
   * nothing is getting through.
   */
  describe('cycle timing', () => {
    it('reports a duration for a successful cycle', async () => {
      const onTick = jest.fn(async () => undefined);
      const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
      await waitFor(() => expect(result.current.lastCycleMs).toBeDefined());
      expect(result.current.averageCycleMs).toBe(result.current.lastCycleMs);
    });

    it('leaves the timing undefined until a cycle has succeeded', async () => {
      const onTick = jest.fn(async () => {
        throw new Error('nope');
      });
      const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
      await waitFor(() => expect(result.current.consecutiveFailures).toBe(1));
      expect(result.current.lastCycleMs).toBeUndefined();
      expect(result.current.averageCycleMs).toBeUndefined();
    });

    it('holds the last good numbers through a failure', async () => {
      let fail = false;
      const onTick = jest.fn(async () => {
        if (fail) throw new Error('nope');
      });
      const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
      await waitFor(() => expect(result.current.lastCycleMs).toBeDefined());
      const good = result.current.lastCycleMs;
      const average = result.current.averageCycleMs;
      fail = true;
      await advancePastNextTick();
      await waitFor(() =>
        expect(result.current.consecutiveFailures).toBeGreaterThan(0)
      );
      // Unchanged, rather than replaced by an instant failure or blanked: the
      // status area is already saying that checks are failing.
      expect(result.current.lastCycleMs).toBe(good);
      expect(result.current.averageCycleMs).toBe(average);
    });
  });

  it('stops ticking after unmount', async () => {
    const onTick = jest.fn(async () => undefined);
    const { unmount } = renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    unmount();
    const callsAtUnmount = onTick.mock.calls.length;
    await advancePastNextTick(IDLE_INTERVAL_MS * 3);
    expect(onTick).toHaveBeenCalledTimes(callsAtUnmount);
  });

  it('picks up a drop time and bursts', async () => {
    const onTick = jest.fn(async () => undefined);
    // Derive the target the same way the hook does. syncedParkTime() reads
    // the mocked timesync clock (Date.now()) through DateTime, which is fixed
    // to America/New_York -- building a ParkTime from the raw local time
    // instead would be off by the UTC offset the suite runs under.
    const soon = DateTime.from(Date.now() + 10_000).time;
    const { result } = renderHook(() =>
      usePoller({ enabled: true, onTick, dropTimes: [soon] })
    );
    await waitFor(() => expect(result.current.mode).toBe('burst'));
    expect(result.current.target).toEqual(soon);
  });
});

// Stopping the loop is not stopping the tick. Turning autopilot off only
// prevents the *next* tick being scheduled; a tick already past its awaits
// carries on, and the last thing it does is spend an entitlement.
describe('usePoller cancellation', () => {
  it('tells a running tick that it has been cancelled', async () => {
    let release!: () => void;
    const started = new Promise<void>(resolve => (release = resolve));
    let seenAfter: boolean | undefined;
    let gate!: () => void;
    const held = new Promise<void>(resolve => (gate = resolve));

    const onTick = jest.fn(async (cancelled: () => boolean) => {
      release();
      await held;
      // What an action site sees when it asks, mid-tick.
      seenAfter = cancelled();
    });

    const { unmount } = renderHook(() => usePoller({ enabled: true, onTick }));
    await act(async () => {
      await started;
    });

    // The stop happens while the tick is still in flight.
    unmount();
    await act(async () => {
      gate();
      await Promise.resolve();
    });

    expect(seenAfter).toBe(true);
  });

  it('reports not cancelled while the run is live', async () => {
    let seen: boolean | undefined;
    const onTick = jest.fn(async (cancelled: () => boolean) => {
      seen = cancelled();
    });
    renderHook(() => usePoller({ enabled: true, onTick }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(seen).toBe(false);
  });
});

/**
 * A tick that never settles.
 *
 * The loop is deliberately sequential: one tick at a time, the next scheduled
 * only when the last returns. So a promise that neither resolves nor rejects
 * parked it permanently -- no failure counted, no backoff, no failure ceiling,
 * and a status frozen on whatever mode it was in. The eight-second client
 * timeout does not cover every path: a captive portal can leave a fetch
 * hanging, and the dynamic import of the sensor-data module has no timeout.
 */
describe('usePoller deadline', () => {
  /** A tick that hangs forever, and a way to see whether it may still act. */
  function hangingTick() {
    const seen: (() => boolean)[] = [];
    const onTick = jest.fn(async (cancelled: () => boolean) => {
      seen.push(cancelled);
      await new Promise<void>(() => undefined);
    });
    return { onTick, seen };
  }

  it('abandons a tick that outlives the deadline', async () => {
    const { onTick } = hangingTick();
    const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(TICK_DEADLINE_MS + 1000);
    });
    expect(result.current.consecutiveFailures).toBeGreaterThan(0);
  });

  it('keeps polling after abandoning one', async () => {
    const { onTick } = hangingTick();
    renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(TICK_DEADLINE_MS * 2 + 5000);
    });
    expect(onTick.mock.calls.length).toBeGreaterThan(1);
  });

  it('names the reason it gave up on the tick', async () => {
    const { onTick } = hangingTick();
    const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(TICK_DEADLINE_MS + 1000);
    });
    expect(result.current.lastError).toMatch(/too long/);
  });

  // The abandoned tick keeps running -- there is no way to stop it -- so what
  // matters is that it can no longer commit anything. Every guard inside it
  // consults this callback before acting.
  it('tells the abandoned tick it is cancelled', async () => {
    const { onTick, seen } = hangingTick();
    renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    expect(seen[0]?.()).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(TICK_DEADLINE_MS + 1000);
    });
    expect(seen[0]?.()).toBe(true);
  });

  // A tick that is merely slow must not be treated as wedged.
  it('leaves a slow but finishing tick alone', async () => {
    const onTick = jest.fn(
      async () =>
        new Promise<void>(resolve => {
          setTimeout(resolve, TICK_DEADLINE_MS / 2);
        })
    );
    const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(TICK_DEADLINE_MS);
    });
    expect(result.current.consecutiveFailures).toBe(0);
  });

  // Eight abandoned ticks in a row is the same signal as eight errors.
  it('eventually stops, like any other repeated failure', async () => {
    const { onTick } = hangingTick();
    const { result } = renderHook(() => usePoller({ enabled: true, onTick }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(
        (TICK_DEADLINE_MS + BACKOFF_CAP_MS) * (MAX_CONSECUTIVE_FAILURES + 2)
      );
    });
    expect(result.current.mode).toBe('stopped');
  });
});
