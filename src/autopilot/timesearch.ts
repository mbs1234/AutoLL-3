import { HourlyTimes } from '@/api/ll';
import { ParkTime } from '@/datetime';

/**
 * What a search of the return-time grid is trying to reach.
 *
 * Two shapes, and the difference between them is the whole reason this
 * module exists rather than reusing `automodify`'s rule:
 *
 * - `soonest` is what Autopilot already does -- take the earliest time on
 *   offer, never move later. The engine can do this because the tipboard
 *   hands it exactly one candidate, the earliest.
 * - `at` aims at a named time and may move a reservation in *either*
 *   direction to get closer to it. That is only expressible against the full
 *   grid from `ll.times()`, which is why it lives here.
 */
export type SearchGoal =
  | { kind: 'soonest' }
  | { kind: 'at'; target: ParkTime }
  /**
   * The earliest time on offer for a *different* attraction.
   *
   * A swap has no baseline to beat: the grid belongs to the attraction being
   * taken, not the one being given up, so measuring a candidate against the
   * held reservation compares two different queues. Done that way -- the
   * "Change attraction" screen passed `soonest` -- a replacement had to be at
   * least five minutes earlier than the reservation being replaced, which is
   * the opposite of why anyone swaps: you give up a good early slot for a
   * headliner later in the day. Every offered time is a candidate here, and
   * `confirmEveryMove` is what stands between the search and a commitment.
   */
  | { kind: 'replace' };

/**
 * The smallest move worth making, in minutes.
 *
 * A "move" to the same time spends a modify to achieve nothing, and the
 * grid is quantised to five-minute slots in practice -- so anything under a
 * slot is noise. Deliberately smaller than `automodify`'s unattended
 * 30-minute bar: a person is watching this one and named what they wanted.
 */
export const MIN_GAIN_MINUTES = 5;

/** How far from the target still counts as arriving. */
export const GOAL_TOLERANCE_MINUTES = 5;

/** Distance from a goal, in minutes. Lower is better; 0 is exact. */
export function distance(goal: SearchGoal, time: ParkTime): number {
  return goal.kind === 'at' ? Math.abs(+time - +goal.target) / 60 : +time / 60;
}

/** Whether `time` is close enough to stop searching. */
export function goalMet(goal: SearchGoal, time: ParkTime): boolean {
  return goal.kind === 'at'
    ? distance(goal, time) <= GOAL_TOLERANCE_MINUTES
    : false;
}

/**
 * Flatten `ll.times()` and drop anything not worth considering.
 *
 * The grid arrives grouped by hour and can repeat a time across groups, so
 * duplicates are removed and the result is ordered. Order matters only for
 * making `bestCandidate` deterministic when two slots tie.
 */
export function candidates(times: HourlyTimes): ParkTime[] {
  const seen = new Map<number, ParkTime>();
  for (const group of times) {
    for (const time of group) {
      if (!seen.has(+time)) seen.set(+time, time);
    }
  }
  return [...seen.values()].sort((a, b) => +a - +b);
}

/**
 * The best time to move to, or nothing worth moving for.
 *
 * `current` is what the party holds right now, and it is the baseline every
 * decision is measured against -- so a caller must pass the *live* held time
 * after every successful move, never the time the search started from.
 * Getting that wrong is how a "move earlier" loop walks a reservation later
 * one step at a time.
 *
 * Returns undefined when nothing beats what is held, which is also how the
 * caller learns to stop.
 */
export function bestCandidate(
  goal: SearchGoal,
  current: ParkTime,
  times: HourlyTimes,
  {
    minGainMinutes = MIN_GAIN_MINUTES,
    exclude,
  }: { minGainMinutes?: number; exclude?: ReadonlySet<number> } = {}
): ParkTime | undefined {
  // A replacement is measured against nothing: `current` belongs to the
  // attraction being given up, and an infinite baseline is what makes every
  // offered time for the incoming one a candidate.
  const held = goal.kind === 'replace' ? Infinity : distance(goal, current);
  let best: ParkTime | undefined;
  let bestDistance = held;
  for (const time of candidates(times)) {
    // Already asked for and not granted. `changeOfferTime` does not refuse a
    // slot it cannot honour -- it returns the nearest one it can, which the
    // caller then declines -- so nothing else stops the loop asking for the
    // same unavailable time on every tick for the rest of the afternoon.
    if (exclude?.has(+time)) continue;
    const d = distance(goal, time);
    // Strictly closer, and closer by enough to be worth a round trip and a
    // reservation in flight.
    if (d >= bestDistance || held - d < minGainMinutes) continue;
    // A `soonest` search may never move later, whatever the arithmetic says.
    // For that goal distance *is* the time, so this is already implied -- it
    // is asserted anyway, because it is the rule that must not be lost if
    // the distance function is ever changed.
    if (goal.kind === 'soonest' && +time >= +current) continue;
    best = time;
    bestDistance = d;
  }
  return best;
}

/** Why a search stopped, for the screen to explain. */
export type SearchStop =
  | 'goal-met'
  | 'nothing-better'
  | 'failed'
  | 'not-modifiable'
  /** Moved, but Plans never showed it, so the search stopped rather than wait. */
  | 'unconfirmed'
  | 'stopped';

/** Whether a move is in the direction that gives up an earlier reservation. */
export function isLaterMove(current: ParkTime, candidate: ParkTime): boolean {
  return +candidate > +current;
}

export type CommitPhase = 'idle' | 'committing' | 'awaiting' | 'unknown';

/**
 * The one thing that makes an automated move safe: it cannot happen twice.
 *
 * A booking that times out is recoverable -- Disney refuses a duplicate, and
 * the ledger's doubt-hold makes it count against the day until plans settle
 * it. A *move* is neither. `fetch` turns every timeout into `status: 0`,
 * which `actionWasRejected` correctly declines to read as "nothing happened",
 * and a duplicate move is not rejected by anything: it is a plausible-looking
 * success that lands the party at a time nobody chose. `markAttempted`
 * returns early for non-book kinds, so there is no doubt-hold for a modify
 * anywhere in this codebase.
 *
 * So this holds the lock instead, and the rule is `AutoBookLedger`'s: taken
 * *before* the request goes out, released only on proof that nothing
 * happened. Anything else -- a timeout, a 5xx, a dropped connection -- is
 * absorbing. The run stops and the user is told to check Plans, because from
 * here the question cannot be answered and guessing at it is what moves a
 * reservation twice.
 *
 * Deliberately a plain class rather than component state: it must be held in
 * a ref that survives StrictMode's mount / unmount / mount, or the app ships
 * two engines with two independent commit budgets.
 */
export class CommitGuard {
  #phase: CommitPhase = 'idle';
  #commits = 0;
  #requested?: ParkTime;
  /** Slots asked for and not granted, so the loop stops re-asking. */
  readonly declined = new Set<number>();

  get phase(): CommitPhase {
    return this.#phase;
  }
  get commits(): number {
    return this.#commits;
  }
  get requested(): ParkTime | undefined {
    return this.#requested;
  }
  /** Whether a decision may be taken at all. */
  get idle(): boolean {
    return this.#phase === 'idle';
  }

  /**
   * Whether a run may begin.
   *
   * `idle` and `awaiting` qualify; `committing` and `unknown` do not. An
   * awaiting move only needs Plans to catch up, so a restarted run picks the
   * wait back up and decides nothing until it does. A committing request is
   * still in flight, while an unknown one has no answer coming at all.
   */
  get startable(): boolean {
    return this.#phase === 'idle' || this.#phase === 'awaiting';
  }

  /** Take the lock. False when anything is already in flight or unresolved. */
  begin(time: ParkTime): boolean {
    if (this.#phase !== 'idle') return false;
    this.#phase = 'committing';
    this.#requested = time;
    return true;
  }

  /** The offered slot was not the one asked for, and was declined. */
  decline(time: ParkTime): void {
    this.declined.add(+time);
    this.release();
  }

  /**
   * Give the lock back, for a failure that provably changed nothing.
   *
   * The caller must have established that from `actionWasRejected`; this
   * refuses to be the place that decides it.
   */
  release(): void {
    if (this.#phase === 'unknown') return;
    this.#phase = 'idle';
    this.#requested = undefined;
  }

  /** The move was accepted. Now wait for plans to agree before deciding again. */
  markCommitted(): void {
    this.#phase = 'awaiting';
    ++this.#commits;
  }

  /** Plans agree the reservation moved; the loop may decide again. */
  confirm(): void {
    if (this.#phase !== 'awaiting') return;
    this.#phase = 'idle';
    this.#requested = undefined;
  }

  /**
   * Clear the state that is meant to last one run.
   *
   * `declined` and the commit count are per-run limits -- a slot Disney could
   * not honour an hour ago may be free now, and six moves is a statement
   * about one search not converging, not about the afternoon. Without this
   * they survived Stop and Start on the same screen, so a restarted search
   * could refuse a time that had since become available, or stop immediately
   * because a previous run had used the budget.
   *
   * Returns false, and changes nothing, from every phase but `idle` -- each
   * for a reason a restart must not override:
   *
   * - `unknown`, because no evidence that could settle it ever arrives. Only
   *   leaving the screen clears that, by which point the user has been told
   *   to check Plans.
   * - `awaiting`, because a move that succeeded but is not yet visible in
   *   Plans is exactly the state where deciding again is dangerous. Clearing
   *   it let Stop-then-Start hand a fresh run the *old* reservation time --
   *   the itinerary lags -- and a second modification on top of a move that
   *   had already landed. It is settled by `confirm()` when Plans agrees, or
   *   by the caller's bounded wait giving up; a restart resumes that wait
   *   rather than skipping it.
   * - `committing`, for the same reason in a narrower window: Stop can land
   *   between the request going out and its result, and the lock is the only
   *   thing standing between that and a second one.
   *
   * So: only a settled guard may be cleared, which is the rule stated once
   * rather than as a list of phases to remember.
   */
  reset(): boolean {
    if (this.#phase !== 'idle') return false;
    this.#phase = 'idle';
    this.#requested = undefined;
    this.#commits = 0;
    this.declined.clear();
    return true;
  }

  /**
   * The outcome is unknown, and stays unknown.
   *
   * Absorbing on purpose: there is no evidence that could arrive later to
   * settle it, so the only safe posture is to stop and hand back.
   */
  markUnknown(): void {
    this.#phase = 'unknown';
  }
}
