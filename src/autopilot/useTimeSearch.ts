import { useCallback, useEffect, useRef, useState } from 'react';

import { RequestError } from '@/api/client';
import { Booking } from '@/api/itinerary';
import { LLMP, Offer, OfferError } from '@/api/ll';
import { ParkTime, parkDate } from '@/datetime';
import { sleep } from '@/sleep';

import { actionWasRejected } from './autobook';
import { commitBaseline, findExistingLL } from './automodify';
import { RENEW_INTERVAL_MS } from './lease';
import {
  CommitGuard,
  CommitPhase,
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
  /**
   * The top-level engine holds the action lock for this reservation.
   *
   * Reported rather than acted on. A foreground search is one the user is
   * standing there asking for, so it keeps looking and says why it is not
   * committing, instead of stopping with no explanation.
   */
  contended?: boolean;
  cycles: number;
  moves: number;
  lastError?: string;
  /** Commit state; awaiting means a successful move is still settling in Plans. */
  phase: CommitPhase;
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
  /**
   * Take the top-level engine's per-attraction action lock before committing.
   *
   * Without it this hook's commits went straight to `ll.book(offer)`, outside
   * the ledger the engine shares -- so Autopilot, still polling underneath this
   * screen, could modify the same held pass in the same few seconds. Returns
   * false when the lock is already held, which is reported rather than treated
   * as a failure.
   *
   * Optional: the tests that drive this hook directly do not need a ledger.
   */
  claimCommit?: () => Promise<boolean>;
  /** Give the lease back when nothing is outstanding. */
  releaseCommit?: () => void | Promise<void>;
  /**
   * Mark the reservation as being in an unknown state.
   *
   * For the one outcome a lease cannot express. A lease expires, and a move
   * whose result nobody learned has to be protected until fresh plans say what
   * happened -- which is not a duration. Without this the search's lease simply
   * ran out while its own guard still forbade another move, and another engine
   * could take a reservation the guard was still protecting.
   */
  quarantineCommit?: (from?: string) => void;
  /**
   * Publish a committed return time for other instances to see.
   *
   * The engine does this for every action it takes, so another instance's
   * overlap check cannot pass against a snapshot taken before it existed. This
   * hook commits outside the engine, so without it there is a window -- until
   * Plans next refreshes -- where a second tab can book a time that lands on
   * the move the person is watching happen.
   */
  onCommitted?: (booking: LLMP) => void;
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
    phase: 'idle',
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
  /**
   * True only after `commit()` has actually been called and until its outcome
   * is classified. A `committing` guard can also mean that a quoted slot is
   * waiting for approval or still being prepared; Stop may safely release
   * those locks, but it must preserve one whose request has left the device.
   */
  const commitInFlightRef = useRef(false);
  /**
   * Whether this search currently holds the engine's per-attraction lock.
   *
   * Claimed before the first commit of a run and held for the rest of it: the
   * top-level Autopilot keeps polling underneath this screen, and a lock that
   * were taken and given back between cycles would leave a window on every one
   * of them. Released when the run stops -- except when a commit's outcome is
   * unknown, where a move may have landed and nothing else may pile on.
   */
  const holdsLockRef = useRef(false);
  /**
   * The reservation's return time at the last commit boundary this search
   * reached, and before that the freshest time it has read.
   *
   * Mirrored into a ref because the doubt is raised from the run loop, which
   * closes over the state of the render that started it -- and the time will
   * have moved since if the search has already committed once.
   *
   * Kept slightly apart from `state.held`, which is what the screen shows and
   * comes from Plans. This is the baseline a doubt is settled against, so it
   * takes the offer's own itinerary when that is fresher -- the same rule
   * `attemptAutoModify` follows, and for the same reason: the quarantine asks
   * "has it moved?", and a stale baseline makes an untouched reservation
   * answer yes.
   */
  const heldRef = useRef<ParkTime | undefined>(deps.booking.start.time);
  const wakeOwner = useRef({}).current;

  /** Take the engine's lock, or report that something else has it. */
  const claimLock = useCallback(async () => {
    const claim = depsRef.current.claimCommit;
    // Unwired (the hook's own tests, and any caller with no engine to contend
    // with): behave exactly as before rather than refusing to commit.
    if (!claim) return true;
    // Asked every time rather than only when not already held. The lease
    // expires, so a run longer than its TTL has to renew, and asking is how it
    // renews -- acquisition is re-entrant for the holder.
    const got = await claim();
    // Only a successful claim means this search holds it. Keeping a stale true
    // here is what let a lost lease go unnoticed.
    holdsLockRef.current = got;
    return got;
  }, []);

  const dropLock = useCallback(() => {
    if (!holdsLockRef.current) return;
    holdsLockRef.current = false;
    void depsRef.current.releaseCommit?.();
  }, []);

  const stop = useCallback(
    (reason: SearchStop) => {
      runningRef.current = false;
      acceptedRef.current = false;
      const guard = guardRef.current;
      if (guard.phase === 'committing' && !commitInFlightRef.current) {
        guard.release();
      }
      // The `releaseAttempt` escape: the lock is held to the end of the run so
      // the engine cannot move the same reservation mid-search, and given back
      // here so it does not retire the attraction for the rest of the session.
      //
      // Only when nothing is outstanding, which is narrower than it first
      // looked. `unknown` is the obvious case -- a move may have landed. But
      // `committing` with a request still in flight is the same doubt by
      // another name (the guard three lines up is preserved for exactly that
      // reason, and releasing the lock while keeping the guard was
      // contradictory), and `awaiting` means the move *did* land and Plans has
      // not agreed yet, which is precisely when the engine acting on stale
      // plans would be worst. Only an idle guard with no request outstanding
      // is proof there is nothing left to protect.
      if (guard.phase === 'idle' && !commitInFlightRef.current) dropLock();
      const stoppedReason =
        reason === 'stopped' && guard.phase === 'awaiting'
          ? 'unconfirmed'
          : reason;
      setState(s => ({
        ...s,
        running: false,
        stop: stoppedReason,
        pending: undefined,
        phase: guard.phase,
      }));
      void releaseScreenAwake(wakeOwner);
    },
    [wakeOwner, dropLock]
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
      phase: guardRef.current.phase,
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
    // Captured at effect scope for the cleanup below: the guard is created once
    // and never replaced, so this is the same object either way, but reading a
    // ref inside a cleanup is the pattern that hides a stale-node bug and the
    // lint is right to ask.
    const guardForCleanup = guardRef.current;
    const stopped = () => cancelled || !runningRef.current;

    /**
     * Keep the claim alive while a request is genuinely in the air.
     *
     * The lease expires at a fixed TTL, and a commit is the one call here with
     * no bound on how long it can take -- the request timeout does not cover
     * reading the response body. Without this, a slow commit could outlive its
     * own lease and another engine could take the reservation mid-flight.
     * Renewing is re-entrant for the holder, so this is the same ask the
     * commit already made, repeated.
     */
    function renewing<T>(body: Promise<T>): Promise<T> {
      const timer = setInterval(() => void claimLock(), RENEW_INTERVAL_MS);
      return body.finally(() => clearInterval(timer));
    }

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
        if (stopped()) return;
        if (!current) {
          guard.release();
          return;
        }
        // The baseline moves with the read. It was previously left at whatever
        // the last idle cycle saw, so a reservation that changed while the
        // offer sat waiting for the user quarantined against a time nobody
        // held -- and the next plans read then cleared that doubt by finding
        // the reservation exactly where it had been all along.
        heldRef.current = current.start.time;
        const fresh = await depsRef.current.createOffer(current);
        if (stopped()) return;
        heldRef.current = commitBaseline(fresh, current);
        const quoted = await depsRef.current.changeTime(fresh, want);
        if (stopped()) return;
        if (+quoted.start.time !== +want) {
          guard.decline(want);
          return;
        }
        // Last gate before the move leaves the device: the engine's lock for
        // this attraction. Refused means Autopilot (or a second tab, or the
        // provider NextLL nests) is already acting on this reservation, and
        // committing on top of that is the collision the shared ledger exists
        // to prevent. The search keeps looking and says so rather than dying.
        if (!(await claimLock())) {
          guard.release();
          setState(s => ({ ...s, contended: true, phase: guard.phase }));
          return;
        }
        setState(s => (s.contended ? { ...s, contended: false } : s));
        commitInFlightRef.current = true;
        const moved = await renewing(depsRef.current.commit(quoted));
        guard.markCommitted();
        commitInFlightRef.current = false;
        depsRef.current.onCommitted?.(moved);
        setState(s => ({
          ...s,
          moves: s.moves + 1,
          held: moved.start.time,
          phase: guard.phase,
          // Stop cannot recall a request already sent. If it landed while the
          // search was stopping, hand the screen to the existing Plans
          // confirmation recovery instead of leaving an awaiting guard with
          // no visible way to resume it.
          ...(!runningRef.current ? { stop: 'unconfirmed' as const } : {}),
        }));
        return;
      }

      // Settle a committed move before deciding anything else.
      if (guard.phase === 'awaiting') {
        // Renewed while settling. Ten cycles of waiting plus ten plans requests
        // can outlast the lease, and letting it lapse here would hand the
        // reservation to another engine while this guard still forbids a second
        // move -- the guard and the lease disagreeing about the same fact.
        //
        // Awaited, and the refusal acted on. Fire-and-forget left
        // `holdsLockRef` true after somebody else had taken the lease, so this
        // search believed it held something it did not and said nothing: a
        // phone backgrounded past the TTL is exactly how that happens.
        if (!(await claimLock())) {
          holdsLockRef.current = false;
          setState(s => ({ ...s, contended: true }));
          return;
        }
        const now = await readHeld();
        if (stopped()) return;
        if (now && guard.requested && +now.start.time === +guard.requested) {
          settling = 0;
          guard.confirm();
          heldRef.current = now.start.time;
          setState(s => ({ ...s, held: now.start.time, phase: guard.phase }));
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
      if (stopped()) return;
      if (!current) return;
      if (!current.modifiable) return stop('not-modifiable');
      heldRef.current = current.start.time;
      setState(s => ({ ...s, held: current.start.time }));
      if (goalMet(goal, current.start.time)) return stop('goal-met');

      // A fresh offer every cycle: `changeOfferTime` replaces both ids, and
      // `times()` is scoped to the offer that produced it, so a grid outlives
      // nothing.
      offer = await depsRef.current.createOffer(current);
      if (stopped()) return;
      heldRef.current = commitBaseline(offer, current);
      const times = await depsRef.current.getTimes(offer);
      if (stopped()) return;
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
        setState(s => ({ ...s, pending: want, phase: guard.phase }));
        return;
      }
      if (!guard.begin(want)) return;
      const quoted = await depsRef.current.changeTime(offer, want);
      if (stopped()) return;
      // Disney answers with the nearest slot it can rather than refusing, so
      // a different time is a decline, not an error -- and it is remembered,
      // or the loop asks for it again every cycle.
      if (+quoted.start.time !== +want) {
        guard.decline(want);
        return;
      }
      // Last gate before the move leaves the device: the engine's lock for
      // this attraction. Refused means Autopilot (or a second tab, or the
      // provider NextLL nests) is already acting on this reservation, and
      // committing on top of that is the collision the shared ledger exists
      // to prevent. The search keeps looking and says so rather than dying.
      if (!(await claimLock())) {
        guard.release();
        setState(s => ({ ...s, contended: true, phase: guard.phase }));
        return;
      }
      setState(s => (s.contended ? { ...s, contended: false } : s));
      commitInFlightRef.current = true;
      const moved = await renewing(depsRef.current.commit(quoted));
      guard.markCommitted();
      commitInFlightRef.current = false;
      depsRef.current.onCommitted?.(moved);
      setState(s => ({
        ...s,
        moves: s.moves + 1,
        held: moved.start.time,
        phase: guard.phase,
        ...(!runningRef.current ? { stop: 'unconfirmed' as const } : {}),
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
            if (!commitInFlightRef.current || actionWasRejected(error)) {
              guard.release();
              setState(s => ({ ...s, phase: guard.phase }));
              // And the lease, if this run has already been stopped. `stop`
              // refuses to release anything that is not settled, which is right
              // while a request is in the air -- but a definite rejection *is*
              // the settlement, and it can arrive after the person has pressed
              // Stop or left the screen. Without this the lease stood until it
              // expired, on a reservation provably untouched.
              // `cancelled` as well as `runningRef`: an unmount leaves the ref
              // set, so a rejection arriving after the screen closed would
              // otherwise hold the lease until it expired, on a reservation
              // provably untouched.
              if (!runningRef.current || cancelled) dropLock();
            } else {
              guard.markUnknown();
              // The search stops here and never renews again, so the lease is
              // the wrong instrument: quarantine the reservation instead, which
              // outlives this screen and is cleared by evidence rather than by
              // a clock.
              depsRef.current.quarantineCommit?.(
                heldRef.current ? String(heldRef.current) : undefined
              );
              dropLock();
              setState(s => ({
                ...s,
                unresolved: guard.requested,
                phase: guard.phase,
              }));
              stop('failed');
              return;
            }
          }
          commitInFlightRef.current = false;
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
        if (stopped()) return;
        setState(s => ({ ...s, cycles: s.cycles + 1 }));
        await sleep(CYCLE_MS);
      }
    }

    void run();
    return () => {
      cancelled = true;
      // Back is the ordinary way to leave this screen, and `NavProvider`
      // unmounts a popped screen -- so without this a claimed lock stayed
      // published and the engine underneath silently stopped acting on that
      // attraction for the rest of the session. Losing coverage on a ride you
      // armed, with nothing on screen saying so, is the worst shape this can
      // take.
      //
      // Phase-aware, for the same reason as `stop`: an unsettled move keeps
      // its lock, because leaving the screen tells us nothing about whether
      // the request landed. That lock is then the engine's own to settle
      // through the ledger, which is where an unsettled action belongs.
      if (guardForCleanup.phase === 'idle' && !commitInFlightRef.current) {
        dropLock();
      }
      void releaseScreenAwake(wakeOwner);
    };
  }, [state.running, stop, wakeOwner, claimLock, dropLock]);

  return {
    ...state,
    start,
    accept,
    /** Named `cancel` so it cannot shadow `state.stop`, the reason it ended. */
    cancel: () => stop('stopped'),
    guard: guardRef.current,
  };
}
