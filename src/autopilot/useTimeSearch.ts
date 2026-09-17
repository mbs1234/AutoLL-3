import { useCallback, useEffect, useRef, useState } from 'react';

import { RequestError, RequestNotSent } from '@/api/client';
import type { RequestControl } from '@/api/client';
import { Booking } from '@/api/itinerary';
import { LLMP, Offer, OfferError } from '@/api/ll';
import { ParkTime, parkDate } from '@/datetime';
import { sleep } from '@/sleep';

import { actionWasRejected } from './autobook';
import { findExistingLL, offerBaseline } from './automodify';
import { mutationId } from './lease';
import { MAX_MUTATION_MS, MutationOperation } from './mutation';
import type { MutationEvidence } from './mutation';
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
  commit: (offer: Offer<LLMP>, control?: RequestControl) => Promise<LLMP>;
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
  /** Renew the claimed lease from the first commit until the run stops. */
  keepCommitAlive?: (onLost: () => void) => () => void;
  /** Atomically revalidate the lease and start the HTTP request. */
  startCommit?: <T>(
    authorize: () => boolean,
    send: () => Promise<T>
  ) => Promise<T>;
  /** Give the lease back when nothing is outstanding. */
  releaseCommit?: () => void | Promise<void>;
  /**
   * Mark the reservation as being in an unknown state.
   *
   * For the one outcome a lease cannot express. A lease expires, and a move
   * whose result nobody learned has to be protected until fresh plans say what
   * happened -- which is not a duration. Without this the search's lease simply
   * ran out while its own guard still forbade another move, and another engine
   * could take a reservation the guard was still protecting. Return false when
   * protection exists only in this page rather than durable browser storage;
   * legacy void callbacks are treated as durable.
   */
  quarantineCommit?: (
    id: string,
    change: MutationEvidence,
    dispatchedAt: number
  ) => boolean | void | Promise<boolean | void>;
  /** Remove this operation's doubt after a definitive rejection. */
  resolveCommit?: (id: string) => void | Promise<void>;
  /** Resolve a definitive success and retain the lease without a gap. */
  retainCommit?: (id: string) => boolean | Promise<boolean>;
  /** Swap searches use different positive evidence from same-ride moves. */
  mutationKind?: 'modify' | 'swap';
  /** Facility gained by a swap, captured at the commit boundary. */
  gainingFacility?: () => string | undefined;
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
 * 1. A live-work lease is taken before the request, while the mutation object
 *    records the exact post-sensor dispatch boundary. An unanswered request
 *    becomes visible quarantine before the lease is released; if durable
 *    storage fails, the page-local fallback and its limitation are surfaced.
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
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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
  /** The one commit whose sensor/fetch path can still be cancelled or settled. */
  const activeOperationRef = useRef<MutationOperation | undefined>(undefined);
  /** Cancels the one renewal loop owned by this whole search run. */
  const stopRenewalRef = useRef<(() => void) | undefined>(undefined);
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
   * Where the *offer* said the reservation was, at the last commit boundary.
   *
   * Mirrored into a ref because the doubt is raised from the run loop, which
   * closes over the state of the render that started it -- and the time will
   * have moved since if the search has already committed once.
   *
   * Deliberately not `state.held`, which is what the screen shows and comes
   * from Plans. Only Disney's own view at the offer is admissible in the
   * mutation record; a stale snapshot would make the warning itself lie about
   * what was being changed. Undefined when the offer did not name it. The exact
   * requested destination in `guard.requested` is the automatic evidence.
   */
  const baselineRef = useRef<ParkTime | undefined>(undefined);
  const wakeOwner = useRef({}).current;

  /** Take the engine's lock, or report that something else has it. */
  const claimLock = useCallback(async () => {
    const claim = depsRef.current.claimCommit;
    // Unwired (the hook's own tests, and any caller with no engine to contend
    // with): behave exactly as before rather than refusing to commit.
    if (!claim) return true;
    // Asked again at each commit/settle boundary as an immediate ownership
    // check. The run-scoped keepalive handles elapsed time between them, and
    // acquisition remains re-entrant for this holder.
    const got = await claim();
    // Only a successful claim means this search holds it. Keeping a stale true
    // here is what let a lost lease go unnoticed.
    holdsLockRef.current = got;
    return got;
  }, []);

  const dropLock = useCallback(async () => {
    if (!holdsLockRef.current) return;
    await depsRef.current.releaseCommit?.();
    // Keep ownership true when release itself fails so a later cleanup can
    // retry instead of silently forgetting a lease that may still be live.
    holdsLockRef.current = false;
  }, []);

  const stopRenewal = useCallback(() => {
    const cancel = stopRenewalRef.current;
    stopRenewalRef.current = undefined;
    cancel?.();
  }, []);

  const stop = useCallback(
    (reason: SearchStop) => {
      runningRef.current = false;
      acceptedRef.current = false;
      activeOperationRef.current?.abandon('stopped');
      stopRenewal();
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
      if (guard.phase === 'idle' && !commitInFlightRef.current) {
        void dropLock().catch(error => console.error(error));
      }
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
    [wakeOwner, dropLock, stopRenewal]
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

    /** Commit one quoted offer through the shared mutation lifecycle. */
    async function commitQuoted(quoted: Offer<LLMP>): Promise<void> {
      const guard = guardRef.current;
      let claimed = false;
      try {
        claimed = await claimLock();
      } catch (error) {
        console.error(error);
        guard.release();
        if (mountedRef.current) {
          setState(s => ({
            ...s,
            lastError:
              'AutoLL-3 could not coordinate this reservation. Reload before trying again.',
            phase: guard.phase,
          }));
          stop('failed');
        }
        return;
      }
      if (!claimed) {
        guard.release();
        setState(s => ({ ...s, contended: true, phase: guard.phase }));
        return;
      }
      setState(s => (s.contended ? { ...s, contended: false } : s));

      const kind = depsRef.current.mutationKind ?? 'modify';
      const gaining = depsRef.current.gainingFacility?.();
      const evidence: MutationEvidence = {
        kind,
        ...(baselineRef.current ? { from: String(baselineRef.current) } : {}),
        to: String(quoted.start.time),
        ...(kind === 'swap' && gaining ? { gaining } : {}),
        reservationIds: [
          ...new Set([
            quoted.booking.id,
            ...quoted.booking.guests.map(guest => guest.entitlementId),
          ]),
        ],
      };
      const operation = new MutationOperation({
        id: mutationId(`search-${kind}`),
        kind,
        abandonAt: Date.now() + MAX_MUTATION_MS,
        onAbandon: async abandoned => {
          if (abandoned.dispatched && abandoned.evidence) {
            guard.markUnknown();
            commitInFlightRef.current = false;
            let protectedUnknown = false;
            let durableUnknown = false;
            let protectionError: unknown;
            const saveQuarantine = depsRef.current.quarantineCommit;
            if (saveQuarantine) {
              try {
                const durable =
                  (await saveQuarantine(
                    abandoned.id,
                    abandoned.evidence,
                    abandoned.dispatchedAt!
                  )) !== false;
                protectedUnknown = true;
                durableUnknown = durable;
                if (!durable) {
                  protectionError = new Error(
                    'Protection is available only in this open page'
                  );
                }
              } catch (error) {
                protectionError = error;
                console.error(error);
              }
            } else {
              protectionError = new Error(
                'No unresolved-change store is configured'
              );
            }
            // Durable or page-local quarantine replaces the live lease. The
            // production store always returns one of those two outcomes; a
            // rejecting custom dependency is treated as an explicit failure,
            // not an invisible renewal loop that can outlive this screen.
            if (protectedUnknown) {
              stopRenewal();
              // A durable doubt replaces the lease. Page-local protection is
              // supplemented by the existing lease record until its TTL, but
              // the renewal loop still stops with the run.
              if (durableUnknown) {
                try {
                  await dropLock();
                } catch (error) {
                  protectionError ??= error;
                  console.error(error);
                }
              }
            }
            if (mountedRef.current) {
              setState(s => ({
                ...s,
                unresolved: guard.requested,
                phase: guard.phase,
                ...(protectionError
                  ? {
                      lastError:
                        'The change is unresolved and its protection could not be saved. Do not make another change until you check Disney Plans.',
                    }
                  : {}),
              }));
              stop('failed');
            }
            return;
          }

          // Nothing left the device. Release promptly; a stopped or unmounted
          // screen needs no further state update, while a refused renewal is a
          // visible contention rather than a mysterious failure.
          stopRenewal();
          guard.release();
          commitInFlightRef.current = false;
          try {
            await dropLock();
          } catch (error) {
            console.error(error);
            if (mountedRef.current) {
              setState(s => ({
                ...s,
                lastError:
                  'AutoLL-3 could not release the reservation lock. Reload before trying again.',
              }));
            }
          }
          if (
            mountedRef.current &&
            abandoned.abandonReason === 'lease-refused'
          ) {
            setState(s => ({
              ...s,
              contended: true,
              phase: guard.phase,
            }));
          }
        },
      });
      activeOperationRef.current = operation;
      try {
        if (!stopRenewalRef.current && depsRef.current.keepCommitAlive) {
          stopRenewalRef.current = depsRef.current.keepCommitAlive(() => {
            // keepAlive has already stopped itself before reporting loss.
            stopRenewalRef.current = undefined;
            holdsLockRef.current = false;
            const active = activeOperationRef.current;
            if (active && !active.settled) {
              active.abandon('lease-refused');
              return;
            }
            if (mountedRef.current) {
              setState(s => ({
                ...s,
                contended: true,
                lastError:
                  'AutoLL-3 lost the reservation lock. Refresh Plans before trying again.',
              }));
              stop('failed');
            }
          });
        }
      } catch (error) {
        console.error(error);
        operation.abandon('stopped');
        try {
          await operation.waitForAbandonment();
        } catch (abandonmentError) {
          console.error(abandonmentError);
        }
        if (activeOperationRef.current === operation) {
          activeOperationRef.current = undefined;
        }
        if (mountedRef.current) {
          setState(s => ({
            ...s,
            lastError:
              'AutoLL-3 could not keep the reservation lock alive. Reload before trying again.',
            phase: guard.phase,
          }));
          stop('failed');
        }
        return;
      }

      const control: RequestControl = {
        signal: operation.signal,
        start: async send => {
          const authorize = () =>
            !operation.abandoned && !stopped() && runningRef.current;
          if (depsRef.current.startCommit) {
            return depsRef.current.startCommit(authorize, send);
          }
          if (!authorize()) {
            throw new RequestNotSent('Search stopped before send');
          }
          return send();
        },
        onDispatch: () => {
          if (!operation.markDispatched(evidence)) {
            throw new RequestNotSent('Search stopped before send');
          }
          commitInFlightRef.current = true;
        },
      };

      let moved: LLMP;
      try {
        moved = await depsRef.current.commit(quoted, control);
      } catch (error) {
        operation.settle();
        await operation.waitForAbandonment();
        const rejected = !operation.dispatched || actionWasRejected(error);
        if (rejected) {
          let resolutionError: unknown;
          try {
            await depsRef.current.resolveCommit?.(operation.id);
          } catch (caught) {
            resolutionError = caught;
            console.error(caught);
          }
          if (!guard.resolveUnknownRejection()) guard.release();
          commitInFlightRef.current = false;
          if (activeOperationRef.current === operation) {
            activeOperationRef.current = undefined;
          }
          // A definite Disney rejection is one completed cycle, not the end of
          // a foreground run. Keep the run-scoped lease through the next
          // barren/offer cycles so the background engine cannot take this
          // reservation in between. Local cancellations and late results after
          // Stop have no continuing run and release promptly.
          const keepRunLease =
            operation.dispatched &&
            actionWasRejected(error) &&
            !stopped() &&
            holdsLockRef.current;
          if (!keepRunLease) {
            stopRenewal();
            try {
              await dropLock();
            } catch (caught) {
              resolutionError ??= caught;
              console.error(caught);
            }
          }
          if (mountedRef.current) {
            setState(s => ({
              ...s,
              unresolved: undefined,
              phase: guard.phase,
              ...(resolutionError
                ? {
                    lastError:
                      'The request was rejected, but AutoLL-3 could not clear its saved protection. Resolve it from Activity after checking Plans.',
                  }
                : {}),
            }));
          }
          // A local cancellation or contention is an ordinary skipped commit,
          // not one of the repeated Disney failures that stops the search.
          if (error instanceof RequestNotSent) {
            if (operation.abandonReason === 'deadline' && mountedRef.current) {
              setState(s => ({
                ...s,
                lastError: 'The change could not be sent before its deadline.',
              }));
              stop('failed');
            } else if (!stopped() && mountedRef.current) {
              setState(s => ({ ...s, contended: true }));
            }
            return;
          }
          throw error;
        }

        if (!operation.abandoned) {
          guard.markUnknown();
          let protectedUnknown = false;
          let durableUnknown = false;
          let protectionError: unknown;
          const saveQuarantine = depsRef.current.quarantineCommit;
          if (saveQuarantine) {
            try {
              const durable =
                (await saveQuarantine(
                  operation.id,
                  evidence,
                  operation.dispatchedAt!
                )) !== false;
              protectedUnknown = true;
              durableUnknown = durable;
              if (!durable) {
                protectionError = new Error(
                  'Protection is available only in this open page'
                );
              }
            } catch (caught) {
              protectionError = caught;
              console.error(caught);
            }
          }
          if ((!protectedUnknown || protectionError) && mountedRef.current) {
            setState(s => ({
              ...s,
              lastError:
                'The change is unresolved and its protection could not be saved. Do not make another change until you check Disney Plans.',
            }));
          }
          if (protectedUnknown) {
            stopRenewal();
            if (durableUnknown) {
              try {
                await dropLock();
              } catch (caught) {
                console.error(caught);
              }
            }
          }
        }
        commitInFlightRef.current = false;
        if (activeOperationRef.current === operation) {
          activeOperationRef.current = undefined;
        }
        if (mountedRef.current) {
          setState(s => ({
            ...s,
            unresolved: guard.requested,
            phase: guard.phase,
          }));
          stop('failed');
        }
        return;
      }

      operation.settle();
      try {
        await operation.waitForAbandonment();
      } catch (error) {
        // `onAbandon` handles and reports its own persistence failures. Keep
        // this guard here so a future callback cannot strand a known success
        // in `committing` merely by rejecting.
        console.error(error);
      }
      let retained = true;
      let retainError: unknown;
      try {
        retained = (await depsRef.current.retainCommit?.(operation.id)) ?? true;
      } catch (error) {
        retained = false;
        retainError = error;
        console.error(error);
      }
      holdsLockRef.current = retained;
      if (!guard.resolveUnknownSuccess()) guard.markCommitted();
      commitInFlightRef.current = false;
      if (activeOperationRef.current === operation) {
        activeOperationRef.current = undefined;
      }
      try {
        depsRef.current.onCommitted?.(moved);
      } catch (error) {
        retainError ??= error;
        console.error(error);
      }
      const canContinue = retained && !retainError;
      // Renewal belongs to the run, not this request. A healthy success keeps
      // it through settling and later cycles; an inability to retain the lease
      // ends both together.
      if (!canContinue) stopRenewal();
      setState(s => ({
        ...s,
        moves: s.moves + 1,
        held: moved.start.time,
        unresolved: undefined,
        phase: guard.phase,
        ...(retainError
          ? {
              lastError:
                'The move succeeded, but AutoLL-3 could not retain all local protection. Refresh Plans before making another change.',
            }
          : {}),
        ...(!runningRef.current || !canContinue
          ? { stop: 'unconfirmed' as const }
          : {}),
        ...(!canContinue
          ? { running: false, ...(!retained ? { contended: true } : {}) }
          : {}),
      }));
      if (!canContinue) {
        runningRef.current = false;
        void releaseScreenAwake(wakeOwner);
      }
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
        // The baseline moves with the offer. It was previously left at
        // whatever the last idle cycle saw, so a reservation that changed while
        // the offer sat waiting for the user quarantined against a time nobody
        // held -- and the next plans read then cleared that doubt by finding
        // the reservation exactly where it had been all along.
        const fresh = await depsRef.current.createOffer(current);
        if (stopped()) return;
        baselineRef.current = offerBaseline(fresh, current);
        const quoted = await depsRef.current.changeTime(fresh, want);
        if (stopped()) return;
        if (+quoted.start.time !== +want) {
          guard.decline(want);
          return;
        }
        await commitQuoted(quoted);
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
        let renewed = false;
        try {
          renewed = await claimLock();
        } catch (error) {
          console.error(error);
          setState(s => ({
            ...s,
            lastError:
              'AutoLL-3 could not renew the reservation lock. Refresh Plans before making another change.',
          }));
          stop('failed');
          return;
        }
        if (!renewed) {
          holdsLockRef.current = false;
          setState(s => ({ ...s, contended: true }));
          return;
        }
        const now = await readHeld();
        if (stopped()) return;
        if (now && guard.requested && +now.start.time === +guard.requested) {
          settling = 0;
          guard.confirm();
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
      setState(s => ({ ...s, held: current.start.time }));
      if (goalMet(goal, current.start.time)) return stop('goal-met');

      // A fresh offer every cycle: `changeOfferTime` replaces both ids, and
      // `times()` is scoped to the offer that produced it, so a grid outlives
      // nothing.
      offer = await depsRef.current.createOffer(current);
      if (stopped()) return;
      baselineRef.current = offerBaseline(offer, current);
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
      await commitQuoted(quoted);
    }

    async function run() {
      while (!cancelled) {
        try {
          await cycle();
          failures = 0;
        } catch (error) {
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
      activeOperationRef.current?.abandon('unmounted');
      stopRenewal();
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
        void dropLock().catch(error => console.error(error));
      }
      void releaseScreenAwake(wakeOwner);
    };
  }, [state.running, stop, wakeOwner, claimLock, dropLock, stopRenewal]);

  return {
    ...state,
    start,
    accept,
    /** Named `cancel` so it cannot shadow `state.stop`, the reason it ended. */
    cancel: () => stop('stopped'),
    guard: guardRef.current,
  };
}
