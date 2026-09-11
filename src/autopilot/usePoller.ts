import { useEffect, useRef, useState } from 'react';

import { ParkTime } from '@/datetime';
import { syncTime } from '@/timesync';

import {
  MAX_CONSECUTIVE_FAILURES,
  PollMode,
  RAPID_MIN_INTERVAL_MS,
  TICK_DEADLINE_MS,
  backoffMs,
  cadence,
  syncedParkTime,
  withJitter,
} from './schedule';
import type { RefillWindow } from './schedule';

export interface PollerStatus {
  /** `off` when disabled, `stopped` after giving up on repeated failures. */
  mode: PollMode | 'off' | 'stopped';
  consecutiveFailures: number;
  lastError?: string;
  /** The drop or booking time currently driving the cadence. */
  target?: ParkTime;
  secondsToTarget?: number;
  /** A refill period currently driving the moderate cadence. */
  refillWindow?: RefillWindow;
  /** Ticks attempted since the loop started; useful for display and tests. */
  polls: number;
  /**
   * How long the last *successful* cycle took, and the average of those.
   *
   * Local wall-clock only: never sent anywhere, and never read back into the
   * cadence. It brackets the whole tick rather than one request -- fetching
   * availability, plans on the tenth tick, per-target eligibility, and any
   * booking attempt -- so a tick that acted is legitimately slower than one
   * that only looked. That is what makes it useful for telling a slow network
   * apart from deliberate backoff, and why the label says "cycle".
   *
   * Failed cycles are excluded from both. The cheapest failure here is also
   * the most consequential -- `RateLimit.enforce()` throws before any fetch,
   * in about no time at all -- so averaging failures in made the number read
   * *healthiest* exactly when nothing was getting through.
   */
  lastCycleMs?: number;
  averageCycleMs?: number;
}

export interface PollerOptions {
  enabled: boolean;
  /**
   * One unit of work. Must reject on failure so the loop can back off --
   * the silent `pollExperiences`/`pollPlans` context functions do; the
   * visible `refreshExperiences`/`refreshPlans` do not.
   */
  /**
   * One poll.
   *
   * Receives a cancellation check because stopping the loop is not the same
   * as stopping the tick: turning autopilot off, changing the park or the
   * date, or unmounting only prevents the *next* tick from being scheduled.
   * A tick already past its awaits carries on, and the last thing it does is
   * spend an entitlement. Anything that books, moves or swaps must ask.
   */
  onTick: (cancelled: () => boolean) => Promise<void>;
  dropTimes?: ParkTime[];
  refillWindows?: RefillWindow[];
  nextBookTimes?: ParkTime[];
  /** Poll flat-out, ignoring the drop schedule. */
  rapid?: boolean;
  /** A deliberate tomorrow watch, paced for cancellation releases. */
  tomorrow?: boolean;
}

const OFF: PollerStatus = { mode: 'off', consecutiveFailures: 0, polls: 0 };

/**
 * A single coordinated polling loop, paced by the drop-aware cadence policy.
 *
 * One loop, not one per screen. cscull's fork mounts an independent 1-4s
 * timer on each of three tabs, all drawing on the same RateLimit(5) that the
 * user's own taps also draw on; with all three on, they collectively burst
 * well past the limit. Here a single `setTimeout` chain runs strictly
 * sequentially -- the next tick is scheduled only after the previous one
 * settles -- so polls can never overlap or stack up.
 *
 * Note on mobile: background tabs are heavily timer-throttled, so this is
 * reliable only while the page is foregrounded.
 */
export default function usePoller({
  enabled,
  onTick,
  dropTimes,
  refillWindows,
  nextBookTimes,
  rapid,
  tomorrow,
}: PollerOptions): PollerStatus {
  const [status, setStatus] = useState<PollerStatus>(OFF);

  // Latest values, read at tick time. Held in refs so that a park change, a
  // new set of booking windows, or a re-created onTick does not tear the loop
  // down and restart it -- a restart fires an immediate extra poll, and
  // ExperiencesProvider re-creates its callback on every park or date change,
  // so the loop would rarely survive.
  const onTickRef = useRef(onTick);
  const dropTimesRef = useRef(dropTimes);
  const refillWindowsRef = useRef(refillWindows);
  const nextBookTimesRef = useRef(nextBookTimes);
  const rapidRef = useRef(rapid);
  const tomorrowRef = useRef(tomorrow);
  onTickRef.current = onTick;
  dropTimesRef.current = dropTimes;
  refillWindowsRef.current = refillWindows;
  nextBookTimesRef.current = nextBookTimes;
  rapidRef.current = rapid;
  tomorrowRef.current = tomorrow;

  useEffect(() => {
    if (!enabled) {
      setStatus(OFF);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let polls = 0;
    let cycles = 0;
    let totalCycleMs = 0;
    let lastGoodMs: number | undefined;

    const run = async () => {
      let failed = false;
      let lastError: string | undefined;
      const startedAt = performance.now();
      // Per-run, so a tick that outlives its deadline stops being allowed to
      // commit anything while the loop moves on without it.
      let expired = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          deadline = setTimeout(() => {
            expired = true;
            reject(new Error('Check took too long and was abandoned'));
          }, TICK_DEADLINE_MS);
          onTickRef.current(() => cancelled || expired).then(resolve, reject);
        });
        failures = 0;
      } catch (error) {
        failed = true;
        failures += 1;
        lastError = error instanceof Error ? error.message : String(error);
        console.error(error);
      } finally {
        if (deadline) clearTimeout(deadline);
      }
      ++polls;
      let timing: { lastCycleMs?: number; averageCycleMs?: number } = {};
      if (!failed) {
        const lastCycleMs = Math.round(performance.now() - startedAt);
        ++cycles;
        totalCycleMs += lastCycleMs;
        timing = {
          lastCycleMs,
          averageCycleMs: Math.round(totalCycleMs / cycles),
        };
      } else if (cycles > 0) {
        // Keep the last good numbers rather than blanking the row mid-backoff:
        // the status area is already saying that checks are failing.
        timing = {
          lastCycleMs: lastGoodMs,
          averageCycleMs: Math.round(totalCycleMs / cycles),
        };
      }
      if (timing.lastCycleMs !== undefined) lastGoodMs = timing.lastCycleMs;
      if (cancelled) return;

      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        // Give up rather than retry forever. A 401 clears the auth store, so
        // a loop against expired credentials would spin generating noise.
        setStatus({
          mode: 'stopped',
          consecutiveFailures: failures,
          lastError,
          polls,
          ...timing,
        });
        return;
      }

      const next = cadence({
        now: syncedParkTime(),
        dropTimes: dropTimesRef.current,
        refillWindows: refillWindowsRef.current,
        nextBookTimes: nextBookTimesRef.current,
        rapid: rapidRef.current,
        tomorrow: tomorrowRef.current,
      });

      // Keep the clock offset fresh while something is actually coming up.
      // syncTime() self-throttles to once every five minutes, so calling it
      // per tick costs nothing, and drop timing depends on it being current.
      if (next.mode !== 'idle') {
        void syncTime().catch(() => undefined);
      }

      setStatus({
        mode: next.mode,
        consecutiveFailures: failures,
        lastError,
        target: next.target,
        secondsToTarget: next.secondsToTarget,
        refillWindow: next.refillWindow,
        polls,
        ...timing,
      });

      timer = setTimeout(
        run,
        failed
          ? backoffMs(failures)
          : withJitter(
              next.intervalMs,
              undefined,
              rapidRef.current ? RAPID_MIN_INTERVAL_MS : undefined
            )
      );
    };

    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Depends only on `enabled` by design; everything else is read from refs
    // at tick time. See the note on the refs above.
  }, [enabled]);

  return status;
}
