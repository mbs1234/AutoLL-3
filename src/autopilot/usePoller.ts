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

/** Why a loop stopped, which is what the screen and the alert have to say. */
export type StopReason =
  /** `MAX_CONSECUTIVE_FAILURES` checks failed in a row. */
  | 'failures'
  /** Disney refused a request, this routine's or another's: `pushback.ts`. */
  | 'refused'
  /** Disney asked a search a person started to slow down, so it stopped. */
  | 'throttled'
  /** A search a person started ran its whole session with nothing to show. */
  | 'session'
  /** A search a person started holds what it was asked for: "that will do". */
  | 'goal';

export interface PollerStatus {
  /**
   * `off` when disabled; `stopped` when it gave up, and `stopReason` says why;
   * `waiting` when it is sitting out a wait Disney asked for, still running,
   * until `waitUntil`.
   */
  mode: PollMode | 'off' | 'stopped' | 'waiting';
  stopReason?: StopReason;
  /** When a `waiting` loop checks again, as a `Date.now()` time. */
  waitUntil?: number;
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
  /**
   * `refusalCount()`, from `pushback.ts`. A change while running ends the run
   * as `stopped`, reason `refused`, however far the tick has got and whichever
   * routine was refused. The next run starts from the new number, so the
   * refusal after that stops it again.
   */
  stopEpoch?: number;
  /**
   * A count the caller bumps to start a new run while it stays enabled. A
   * change starts the loop over from nothing, as switching off and on would,
   * and the new run takes the refusal count as it is now, so a run a refusal
   * stopped can start again. Turning off and on in one tap cannot do this:
   * React batches the two, and `enabled` never changes.
   */
  runEpoch?: number;
}

/**
 * Thrown from `onTick` to end the run now, saying why.
 *
 * Not a failure: it spends no failure budget and nothing retries it. The run
 * is over until somebody starts it again.
 */
export class PollerStop extends Error {
  readonly name = 'PollerStop';

  constructor(
    readonly reason: Exclude<StopReason, 'failures'>,
    message: string
  ) {
    super(message);
  }
}

/**
 * Thrown from `onTick` to sit out a wait and then carry on, still running.
 *
 * `until` is a `Date.now()` time. Not a failure either: a wait Disney asked
 * for is Disney's instruction, not this loop going wrong, so it neither backs
 * off nor counts toward giving up.
 */
export class PollerWait extends Error {
  readonly name = 'PollerWait';

  constructor(
    readonly until: number,
    message: string
  ) {
    super(message);
  }
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
  stopEpoch = 0,
  runEpoch = 0,
}: PollerOptions): PollerStatus {
  const [status, setStatus] = useState<PollerStatus>(OFF);
  // The refusal count when this run was switched on. Undefined while off.
  const epochAtStartRef = useRef<number | undefined>(undefined);
  // The run count this run started under. Undefined while off.
  const runAtStartRef = useRef<number | undefined>(undefined);

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
      epochAtStartRef.current = undefined;
      runAtStartRef.current = undefined;
      setStatus(OFF);
      return;
    }
    if (runAtStartRef.current !== runEpoch) {
      // A new run: switched on, or restarted while on. It counts refusals
      // from now, and starts with nothing carried over from the last.
      runAtStartRef.current = runEpoch;
      epochAtStartRef.current = stopEpoch;
      setStatus(OFF);
    } else if (stopEpoch !== epochAtStartRef.current) {
      // Refused since this run started, by any routine. The run just torn
      // down by this very change is not restarted: stopping everything at the
      // first refusal is the point.
      setStatus(current => ({
        ...current,
        mode: 'stopped',
        stopReason: 'refused',
        waitUntil: undefined,
      }));
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
      let stop: PollerStop | undefined;
      let wait: PollerWait | undefined;
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
        if (error instanceof PollerStop) stop = error;
        else if (error instanceof PollerWait) wait = error;
        else {
          failed = true;
          failures += 1;
          lastError = error instanceof Error ? error.message : String(error);
          console.error(error);
        }
      } finally {
        if (deadline) clearTimeout(deadline);
      }
      ++polls;
      let timing: { lastCycleMs?: number; averageCycleMs?: number } = {};
      // A tick cut short by a stop or a wait is not a cycle to time.
      if (!failed && !stop && !wait) {
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

      if (stop) {
        setStatus({
          mode: 'stopped',
          stopReason: stop.reason,
          consecutiveFailures: failures,
          lastError: stop.message,
          polls,
          ...timing,
        });
        return;
      }

      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        // Give up rather than retry forever. A 401 clears the auth store, so
        // a loop against expired credentials would spin generating noise.
        setStatus({
          mode: 'stopped',
          stopReason: 'failures',
          consecutiveFailures: failures,
          lastError,
          polls,
          ...timing,
        });
        return;
      }

      if (wait) {
        setStatus({
          mode: 'waiting',
          waitUntil: wait.until,
          consecutiveFailures: failures,
          lastError: wait.message,
          polls,
          ...timing,
        });
        timer = setTimeout(run, Math.max(0, wait.until - Date.now()));
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
    // Depends on `enabled`, a refusal while running and a restart, by
    // design; everything else is read from refs at tick time. See the note on
    // the refs above.
  }, [enabled, stopEpoch, runEpoch]);

  return status;
}
