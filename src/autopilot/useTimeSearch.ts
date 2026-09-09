import { useCallback, useEffect, useRef, useState } from 'react';

import { RequestError } from '@/api/client';
import { Booking } from '@/api/itinerary';
import { LLMP, Offer, OfferError } from '@/api/ll';
import { ParkTime, parkDate } from '@/datetime';
import { sleep } from '@/sleep';

import { actionWasRejected } from './autobook';
import { findExistingLL } from './automodify';
import {
  CommitGuard,
  SearchGoal,
  SearchStop,
  bestCandidate,
  goalMet,
  isLaterMove,
} from './timesearch';
import { holdScreenAwake, releaseScreenAwake } from './wakelock';

/**
 * Seconds between cycles.
 *
 * Slower than NextLL's 0.6s on purpose, and the reason is arithmetic rather
 * than caution. A cycle here is `times()` plus, when it acts,
 * `changeOfferTime()` and `book()` -- up to three requests, against a
 * `RateLimit(5)` shared with every other call in the app and with the user's
 * own taps. NextLL's cycle is one request against the tipboard. Six seconds
 * leaves room for a person to be pressing things at the same time.
 */
export const CYCLE_MS = 6000;

/** Consecutive failed cycles before the search gives up. */
export const MAX_FAILURES = 5;

/** Cycles with nothing worth taking before it stops looking. */
export const MAX_BARREN_CYCLES = 200;

/** Moves per run. A search that has moved this often is not converging. */
export const MAX_COMMITS = 6;

/**
 * Cycles spent waiting for Plans to show a move that was accepted.
 *
 * A committed move is not settled until the itinerary agrees, and the
 * itinerary lags -- `autobook.ts` needs two agreeing reads for the same
 * reason. But the wait cannot be unbounded: Disney can be inconsistent for
 * longer than anyone will sit and watch a screen say "Checking...". Ten
 * cycles is a minute at `CYCLE_MS`, after which the move is reported as made
 * but unconfirmed, which is the truth.
 */
export const MAX_SETTLE_CYCLES = 10;

export interface TimeSearchState {
  running: boolean;
  held?: ParkTime;
  /** A later move waiting for the user to accept it. */
  pending?: ParkTime;
  stop?: SearchStop;
  /** Set once a commit's outcome could not be determined. */
  unresolved?: ParkTime;
  cycles: number;
  moves: number;
  lastError?: string;
}

export interface TimeSearchDeps {
  booking: LLMP;
  goal: SearchGoal;
  /** `ll.offer(exp, guests, { booking })`, re-derived each time it is called. */
  createOffer: (booking: LLMP) => Promise<Offer<LLMP>>;
  getTimes: (offer: Offer<LLMP>) => Promise<ParkTime[][]>;
  changeTime: (offer: Offer<LLMP>, time: ParkTime) => Promise<Offer<LLMP>>;
  commit: (offer: Offer<LLMP>) => Promise<LLMP>;
  /** Silent plans refresh, for settling a move that was accepted. */
  pollPlans: () => Promise<Booking[]>;
  /**
   * Locates the reservation after a modification. A same-attraction search
   * uses the facility/date default; an attraction swap follows the original
   * entitlement instead, because its facility intentionally changes.
   */
  findHeld?: (plans: Booking[], booking: LLMP) => LLMP | undefined;
  /** A swap is always explicit, even when its offered time is earlier. */
  confirmEveryMove?: boolean;
  /** A confirmed swap is one replacement, not an unattended chain of moves. */
  stopAfterConfirmedMove?: boolean;
}

/**
 * Drives an automated search for a better return time on a held reservation.
 *
 * The correctness lives in `timesearch.ts` -- which slot to take, and whether
 * a commit may be attempted at all. This is the part that talks to Disney,
 * and its whole job is to do so in an order that cannot move a reservation
 * twice.
 *
 * Two rules shape everything here:
 *
 * 1. The guard is taken *before* the request goes out and released only on
 *    proof that nothing happened, because a move whose outcome is unknown
 *    cannot be settled later and must not be retried.
 * 2. A move to a *later* time is never committed on its own. Giving up an
 *    earlier reservation is the one direction that cannot be undone if the
 *    search was wrong about what the party wanted, so it is offered and the
 *    person decides.
 */
export default function useTimeSearch(deps: TimeSearchDeps) {
  const [state, setState] = useState<TimeSearchState>({
    running: false,
    held: deps.booking.start.time,
    cycles: 0,
    moves: 0,
  });
  // Held in a ref rather than state, and deliberately: StrictMode mounts,
  // cleans up and mounts again, so a guard created inside the effect would
  // give the app two engines with two independent commit budgets. A ref
  // survives that, so both runs share one lock.
  const guardRef = useRef(new CommitGuard());
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const runningRef = useRef(false);
  /** Set when the user has approved the later move the guard is holding. */
  const acceptedRef = useRef(false);
  const wakeOwner = useRef({}).current;

  const stop = useCallback(
    (reason: SearchStop) => {
      runningRef.current = false;
      setState(s => ({ ...s, running: false, stop: reason }));
      void releaseScreenAwake(wakeOwner);
    },
    [wakeOwner]
  );

  /**
   * Accept a later move that was offered.
   *
   * Only sets the flag; the commit happens on the next cycle, through the
   * same path and the same guard as an automatic one. Committing from the
   * click handler would be a second commit path to get right, and the guard
   * is already holding the lock for this exact time.
   */
  const accept = useCallback(() => {
    if (!guardRef.current.requested) return;
    acceptedRef.current = true;
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    // Two different questions. `startable` is whether a run may begin at all:
    // no, while a commit's outcome is unknown. `reset()` is whether the
    // per-run limits are cleared: not while a committed move is still waiting
    // on Plans, because that run is not finished -- the restart resumes its
    // settle wait and decides nothing until the itinerary agrees.
    if (!guardRef.current.startable) return;
    guardRef.current.reset();
    acceptedRef.current = false;
    runningRef.current = true;
    setState(s => ({
      ...s,
      running: true,
      stop: undefined,
      pending: undefined,
      lastError: undefined,
      cycles: 0,
      moves: 0,
    }));
    void holdScreenAwake(wakeOwner);
  }, [wakeOwner]);

  useEffect(() => {
    if (!state.running) return;
    let cancelled = false;
    let failures = 0;
    let barren = 0;
    let settling = 0;
    let offer: Offer<LLMP> | undefined;

    /**
     * The reservation as Disney currently reports it.
     *
     * Read from plans rather than carried forward from a commit response,
     * because the baseline every decision is measured against must never
     * regress -- a stale baseline is what licenses a move in the wrong
     * direction. Returns undefined when plans do not yet agree, which is a
     * reason to wait rather than to act.
     */
    async function readHeld(): Promise<LLMP | undefined> {
      const plans = await depsRef.current.pollPlans();
      return depsRef.current.findHeld
        ? depsRef.current.findHeld(plans, depsRef.current.booking)
        : findExistingLL(
            plans,
            depsRef.current.booking.facilityId,
            parkDate(depsRef.current.booking.start)
          );
    }

    async function cycle() {
      const guard = guardRef.current;
      const { goal } = depsRef.current;

      // A later move the user approved: commit the exact time the guard is
      // already holding, without re-deciding. Re-deriving here would let the
      // grid change under an answer the person already gave.
      if (acceptedRef.current && guard.phase === 'committing') {
        const want = guard.requested!;
        acceptedRef.current = false;
        setState(s => ({ ...s, pending: undefined }));
        const current = await readHeld();
        if (!current) {
          guard.release();
          return;
        }
        const fresh = await depsRef.current.createOffer(current);
        const quoted = await depsRef.current.changeTime(fresh, want);
        if (+quoted.start.time !== +want) {
          guard.decline(want);
          return;
        }
        const moved = await depsRef.current.commit(quoted);
        guard.markCommitted();
        setState(s => ({ ...s, moves: s.moves + 1, held: moved.start.time }));
        return;
      }

      // Settle a committed move before deciding anything else.
      if (guard.phase === 'awaiting') {
        const now = await readHeld();
        if (now && guard.requested && +now.start.time === +guard.requested) {
          settling = 0;
          guard.confirm();
          setState(s => ({ ...s, held: now.start.time }));
          if (depsRef.current.stopAfterConfirmedMove) stop('goal-met');
          return;
        }
        // Bounded, because the alternative is a screen that says "Checking..."
        // forever over a move that already happened. The commit succeeded --
        // `book()` returned -- so this is not the unknown-outcome case; it is
        // only that Plans has not caught up, and saying so is better than
        // waiting silently.
        if (++settling >= MAX_SETTLE_CYCLES) stop('unconfirmed');
        return;
      }
      if (!guard.idle) return;

      const current = await readHeld();
      if (!current) return;
      if (!current.modifiable) return stop('not-modifiable');
      setState(s => ({ ...s, held: current.start.time }));
      if (goalMet(goal, current.start.time)) return stop('goal-met');

      // A fresh offer every cycle: `changeOfferTime` replaces both ids, and
      // `times()` is scoped to the offer that produced it, so a grid outlives
      // nothing.
      offer = await depsRef.current.createOffer(current);
      const times = await depsRef.current.getTimes(offer);
      const want = bestCandidate(goal, current.start.time, times, {
        exclude: guard.declined,
      });
      if (!want) {
        if (++barren >= MAX_BARREN_CYCLES) stop('nothing-better');
        return;
      }
      barren = 0;
      if (guard.commits >= MAX_COMMITS) return stop('nothing-better');

      // Giving up an earlier reservation is the one move that is not
      // obviously an improvement, so it is offered rather than taken.
      if (
        depsRef.current.confirmEveryMove ||
        isLaterMove(current.start.time, want)
      ) {
        if (!guard.begin(want)) return;
        setState(s => ({ ...s, pending: want }));
        return;
      }
      if (!guard.begin(want)) return;
      const quoted = await depsRef.current.changeTime(offer, want);
      // Disney answers with the nearest slot it can rather than refusing, so
      // a different time is a decline, not an error -- and it is remembered,
      // or the loop asks for it again every cycle.
      if (+quoted.start.time !== +want) {
        guard.decline(want);
        return;
      }
      const moved = await depsRef.current.commit(quoted);
      guard.markCommitted();
      setState(s => ({
        ...s,
        moves: s.moves + 1,
        held: moved.start.time,
      }));
    }

    async function run() {
      while (!cancelled) {
        try {
          await cycle();
          failures = 0;
        } catch (error) {
          const guard = guardRef.current;
          // The whole safety question, in one branch. A rejection is proof
          // that nothing happened, so the lock comes back. Anything else --
          // a timeout, a 5xx, a dropped connection -- leaves a move that may
          // or may not have applied, and nothing that arrives later can
          // settle it.
          if (guard.phase === 'committing') {
            if (actionWasRejected(error)) {
              guard.release();
            } else {
              guard.markUnknown();
              setState(s => ({ ...s, unresolved: guard.requested }));
              stop('failed');
              return;
            }
          }
          // No offer available right now is an ordinary outcome mid-day, not
          // a fault: it must not burn the failure budget.
          const fatal =
            !(error instanceof OfferError) &&
            !(error instanceof RequestError && error.response?.status === 410);
          if (fatal && ++failures >= MAX_FAILURES) {
            setState(s => ({
              ...s,
              lastError: error instanceof Error ? error.message : String(error),
            }));
            stop('failed');
            return;
          }
        }
        setState(s => ({ ...s, cycles: s.cycles + 1 }));
        await sleep(CYCLE_MS);
      }
    }

    void run();
    return () => {
      cancelled = true;
      void releaseScreenAwake(wakeOwner);
    };
  }, [state.running, stop, wakeOwner]);

  return {
    ...state,
    start,
    accept,
    /** Named `cancel` so it cannot shadow `state.stop`, the reason it ended. */
    cancel: () => stop('stopped'),
    guard: guardRef.current,
  };
}
