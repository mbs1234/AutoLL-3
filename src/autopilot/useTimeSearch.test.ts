import { act, renderHook, waitFor } from '@testing-library/react';

import { RequestError } from '@/api/client';
import type { RequestControl } from '@/api/client';
import { Booking } from '@/api/itinerary';
import { LLMP, Offer, OfferError } from '@/api/ll';
import { DateTime, ParkTime } from '@/datetime';
import { TODAY } from '@/testing';

import { findSameReservation } from './automodify';
import { MAX_MUTATION_MS } from './mutation';
import { SearchGoal } from './timesearch';
import useTimeSearch, {
  CYCLE_MS,
  MAX_SETTLE_CYCLES,
  TimeSearchDeps,
} from './useTimeSearch';

jest.useFakeTimers();

const BZ = '80010114';
const at = (h: number, m = 0) => new ParkTime(h, m);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function booking(time: ParkTime, rest: Partial<LLMP> = {}): LLMP {
  return {
    type: 'LL',
    subtype: 'MP',
    id: 'ent-1',
    facilityId: BZ,
    name: 'Ride',
    start: new DateTime(TODAY, time),
    end: new DateTime(TODAY, time.add({ hours: 1 })),
    modifiable: true,
    guests: [],
    ...rest,
  } as unknown as LLMP;
}

/**
 * `heldAt` is Disney's own view of the reservation as of the offer. It is kept
 * for an accurate unresolved-change explanation; the exact requested time is
 * the automatic Plans evidence. Omitted means the offer did not name it.
 */
function offerAt(time: ParkTime, heldAt?: ParkTime): Offer<LLMP> {
  return {
    id: 'offer-1',
    offerSetId: 'set-1',
    start: new DateTime(TODAY, time),
    end: new DateTime(TODAY, time.add({ hours: 1 })),
    guests: { eligible: [], ineligible: [] },
    itinerary: heldAt
      ? [{ facilityId: BZ, startTime: heldAt, overlap: 'NONE' }]
      : [],
    booking: booking(time),
  } as unknown as Offer<LLMP>;
}

function setup({
  goal = { kind: 'soonest' } as SearchGoal,
  held = at(15),
  times = [[at(11)]] as ParkTime[][],
  quoted,
  commit,
  plans,
  confirmEveryMove,
  stopAfterConfirmedMove,
  findHeld = findSameReservation,
  claimCommit,
  releaseCommit,
  quarantineCommit,
  resolveCommit,
  retainCommit,
  keepCommitAlive,
  startCommit,
  beforeCommitStart,
  getTimes,
}: {
  goal?: SearchGoal;
  held?: ParkTime;
  times?: ParkTime[][];
  quoted?: jest.Mock;
  commit?: jest.Mock;
  plans?: jest.Mock;
  confirmEveryMove?: boolean;
  stopAfterConfirmedMove?: boolean;
  findHeld?: TimeSearchDeps['findHeld'];
  claimCommit?: jest.Mock;
  releaseCommit?: jest.Mock;
  quarantineCommit?: jest.Mock;
  resolveCommit?: jest.Mock;
  retainCommit?: jest.Mock;
  keepCommitAlive?: TimeSearchDeps['keepCommitAlive'];
  startCommit?: TimeSearchDeps['startCommit'];
  beforeCommitStart?: (control?: RequestControl) => Promise<void>;
  getTimes?: TimeSearchDeps['getTimes'];
} = {}) {
  let current = held;
  const rawCommit =
    commit ??
    jest.fn(async (o: Offer<LLMP>, _control?: RequestControl) => {
      void _control;
      current = o.start.time;
      return booking(current);
    });
  const controlledCommit = jest.fn(
    async (o: Offer<LLMP>, control?: RequestControl) => {
      await beforeCommitStart?.(control);
      const send = async () => {
        control?.onDispatch?.();
        const moved = await rawCommit(o, control);
        current = moved.start.time;
        return moved;
      };
      return control?.start ? control.start(send) : send();
    }
  );
  const deps: TimeSearchDeps = {
    booking: booking(held),
    goal,
    // The offer echoes the reservation it was handed, as Disney's does.
    createOffer: jest.fn(async (b: LLMP) => offerAt(current, b.start.time)),
    getTimes: getTimes ?? jest.fn(async () => times),
    changeTime: quoted ?? jest.fn(async (_o, t: ParkTime) => offerAt(t)),
    commit: controlledCommit,
    pollPlans:
      plans ??
      (jest.fn(async () => [booking(current)]) as () => Promise<Booking[]>),
    confirmEveryMove,
    stopAfterConfirmedMove,
    findHeld,
    claimCommit,
    releaseCommit,
    quarantineCommit,
    resolveCommit,
    retainCommit,
    keepCommitAlive,
    startCommit,
  };
  const view = renderHook(() => useTimeSearch(deps));
  return { ...view, deps };
}

/** Let the loop run a few cycles. */
async function runCycles(n = 3) {
  for (let i = 0; i < n; ++i) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CYCLE_MS);
    });
  }
}

describe('useTimeSearch', () => {
  it('does nothing until started', async () => {
    const { result, deps } = setup();
    await runCycles(1);
    expect(deps.getTimes).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
  });

  it('moves a reservation earlier on its own', async () => {
    const { result } = setup();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.moves).toBe(1));
    expect(`${result.current.held}`).toBe('11:00:00');
  });

  // Giving up an earlier reservation is the one direction that cannot be
  // undone if the search was wrong, so it is offered rather than taken.
  it('offers a later move instead of taking it', async () => {
    const { result, deps } = setup({
      goal: { kind: 'at', target: at(15) },
      held: at(11),
      times: [[at(15)]],
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    expect(`${result.current.pending}`).toBe('15:00:00');
    expect(deps.commit).not.toHaveBeenCalled();
    expect(result.current.moves).toBe(0);
  });

  // The "Change attraction" search. Its grid belongs to the attraction being
  // taken, so the reservation being given up is no baseline: a `soonest` goal
  // refused every afternoon slot for TRON against a 10:05 Haunted Mansion and
  // reported that no replacement existed.
  it('offers a replacement later than the reservation being given up', async () => {
    const { result } = setup({
      goal: { kind: 'replace' },
      held: at(10, 5),
      times: [[at(16)]],
      confirmEveryMove: true,
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    expect(`${result.current.pending}`).toBe('16:00:00');
  });

  it('requires approval even for an earlier replacement when requested', async () => {
    const { result, deps } = setup({ confirmEveryMove: true });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('stops after Plans confirms a one-shot replacement', async () => {
    const { result } = setup({
      confirmEveryMove: true,
      stopAfterConfirmedMove: true,
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    act(() => result.current.accept());
    await runCycles(3);
    expect(result.current.stop).toBe('goal-met');
    expect(result.current.moves).toBe(1);
  });

  it('makes the later move once it is accepted', async () => {
    const { result, deps } = setup({
      goal: { kind: 'at', target: at(15) },
      held: at(11),
      times: [[at(15)]],
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    act(() => result.current.accept());
    await runCycles(2);
    expect(deps.commit).toHaveBeenCalled();
    expect(result.current.moves).toBe(1);
  });

  // As reported of the switch screen: the tap changed nothing on screen until
  // the next cycle reached it, and read as a tap that did nothing.
  it('shows an accepted move at once, and clears it once the move is made', async () => {
    const { result, deps } = setup({
      goal: { kind: 'at', target: at(15) },
      held: at(11),
      times: [[at(15)]],
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    act(() => result.current.accept());
    expect(result.current.pending).toBeUndefined();
    expect(result.current.accepting).toBe(true);
    expect(deps.commit).not.toHaveBeenCalled();
    await runCycles(2);
    expect(deps.commit).toHaveBeenCalled();
    expect(result.current.accepting).toBe(false);
  });

  it('stops saying a move is being made when the search is stopped', async () => {
    const { result } = setup({
      goal: { kind: 'at', target: at(15) },
      held: at(11),
      times: [[at(15)]],
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    act(() => result.current.accept());
    act(() => result.current.cancel());
    expect(result.current.accepting).toBe(false);
  });

  // As reported: opened on one person's 2:05 pm reservation while another
  // person held the same attraction at 9:10 am, the search re-read itself as
  // the 9:10 -- so 11:00, earlier than 2:05, counted as later and never moved.
  it('moves the reservation it was opened on, not the first for the ride', async () => {
    let mine = at(14, 5);
    const someoneElse = booking(at(9, 10), { id: 'ent-other' });
    const plans = jest.fn(async () => [someoneElse, booking(mine)]);
    const commit = jest.fn(async (o: Offer<LLMP>) => {
      mine = o.start.time;
      return booking(mine);
    });
    const { result, deps } = setup({
      held: at(14, 5),
      times: [[at(11)]],
      plans,
      commit,
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.moves).toBe(1));
    expect(`${result.current.held}`).toBe('11:00:00');
    expect(deps.createOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ent-1' })
    );
    expect(deps.createOffer).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ent-other' })
    );
  });

  it('does not commit when Stop is pressed while a quoted time is loading', async () => {
    const quote = deferred<Offer<LLMP>>();
    const changeTime = jest.fn(() => quote.promise);
    const { result, deps } = setup({ quoted: changeTime });
    act(() => result.current.start());
    await waitFor(() => expect(changeTime).toHaveBeenCalledTimes(1));

    act(() => result.current.cancel());
    expect(result.current.guard.phase).toBe('idle');
    await act(async () => quote.resolve(offerAt(at(11))));

    expect(deps.commit).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
  });

  it('passes the operation signal to work waiting before dispatch', async () => {
    const waiting = deferred<void>();
    let signal: AbortSignal | undefined;
    const commit = jest.fn(async () => booking(at(11)));
    const beforeCommitStart = jest.fn(async (control?: RequestControl) => {
      signal = control?.signal;
      await waiting.promise;
    });
    const { result } = setup({ commit, beforeCommitStart });
    act(() => result.current.start());
    await waitFor(() => expect(beforeCommitStart).toHaveBeenCalledTimes(1));

    act(() => result.current.cancel());
    const wasAborted = signal?.aborted;
    await act(async () => waiting.resolve());

    expect(wasAborted).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.guard.phase).toBe('idle');
  });

  it('releases an unaccepted move on Stop so a search can restart', async () => {
    const { result } = setup({ confirmEveryMove: true });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    expect(result.current.guard.phase).toBe('committing');

    act(() => result.current.cancel());
    expect(result.current.guard.phase).toBe('idle');
    expect(result.current.phase).toBe('idle');
    expect(result.current.pending).toBeUndefined();

    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBeDefined());
    expect(result.current.running).toBe(true);
  });

  it('preserves the guard when Stop lands after commit has started', async () => {
    const committed = deferred<LLMP>();
    const commit = jest.fn(() => committed.promise);
    const { result } = setup({ commit });
    act(() => result.current.start());
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    act(() => result.current.cancel());
    expect(result.current.guard.phase).toBe('committing');
    await act(async () => committed.resolve(booking(at(11))));

    expect(result.current.guard.phase).toBe('awaiting');
    expect(result.current.running).toBe(false);
    expect(result.current.stop).toBe('unconfirmed');
  });

  it('lets a stopped in-flight commit return a definitive rejection', async () => {
    const committed = deferred<LLMP>();
    let signal: AbortSignal | undefined;
    const commit = jest.fn((_offer: Offer<LLMP>, control?: RequestControl) => {
      signal = control?.signal;
      return committed.promise;
    });
    const quarantineCommit = jest.fn<
      Promise<boolean>,
      [string, unknown, number]
    >(async () => true);
    const resolveCommit = jest.fn(async () => undefined);
    const { result } = setup({ commit, quarantineCommit, resolveCommit });
    act(() => result.current.start());
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    act(() => result.current.cancel());
    await waitFor(() => expect(quarantineCommit).toHaveBeenCalledTimes(1));
    expect(signal?.aborted).toBe(false);
    await act(async () =>
      committed.reject(new RequestError({ ok: false, status: 410, data: {} }))
    );

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(resolveCommit).toHaveBeenCalledWith(
      quarantineCommit.mock.calls[0]![0]
    );
    expect(result.current.guard.phase).toBe('idle');
    expect(result.current.running).toBe(false);
  });

  it('lets an unmounted in-flight commit settle instead of aborting it', async () => {
    const committed = deferred<LLMP>();
    let signal: AbortSignal | undefined;
    const commit = jest.fn((_offer: Offer<LLMP>, control?: RequestControl) => {
      signal = control?.signal;
      return committed.promise;
    });
    const quarantineCommit = jest.fn(async () => true);
    const resolveCommit = jest.fn(async () => undefined);
    const { result, unmount } = setup({
      commit,
      quarantineCommit,
      resolveCommit,
    });
    act(() => result.current.start());
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    unmount();
    await waitFor(() => expect(quarantineCommit).toHaveBeenCalledTimes(1));
    expect(signal?.aborted).toBe(false);
    await act(async () =>
      committed.reject(new RequestError({ ok: false, status: 410, data: {} }))
    );

    await waitFor(() => expect(resolveCommit).toHaveBeenCalledTimes(1));
  });

  // Disney answers with the nearest slot it can rather than refusing, so a
  // different time is a decline -- and it must be remembered, or the loop
  // asks for it again every cycle for the rest of the day.
  it('declines a slot it did not get, and does not ask again', async () => {
    const changeTime = jest.fn(async () => offerAt(at(13)));
    const { result, deps } = setup({ times: [[at(11)]], quoted: changeTime });
    act(() => result.current.start());
    await waitFor(() => expect(changeTime).toHaveBeenCalledTimes(1));
    expect(result.current.guard.declined.has(+at(11))).toBe(true);
    await runCycles(3);
    expect(changeTime).toHaveBeenCalledTimes(1);
    expect(deps.commit).not.toHaveBeenCalled();
  });

  // A commit whose outcome cannot be established is absorbing until exact
  // Plans evidence, a definitive late response, or a person settles it. A
  // second attempt before then is how a party ends up at a time nobody chose.
  it('stops for good when a commit outcome is unknown', async () => {
    const commit = jest.fn(async () => {
      throw new RequestError({ ok: false, status: 0, data: {} });
    });
    const { result } = setup({ commit });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.stop).toBe('failed'));
    expect(result.current.guard.phase).toBe('unknown');
    expect(result.current.unresolved).toBeDefined();
    expect(commit).toHaveBeenCalledTimes(1);
    // And it cannot be restarted into a second attempt.
    act(() => result.current.start());
    await runCycles(2);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  // A rejection is proof that nothing happened, so the lock comes back.
  it('releases the lock for a rejected commit', async () => {
    const commit = jest
      .fn()
      .mockRejectedValueOnce(
        new RequestError({ ok: false, status: 410, data: {} })
      )
      .mockImplementation(async () => booking(at(11)));
    const { result } = setup({ commit });
    act(() => result.current.start());
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(result.current.guard.phase).not.toBe('unknown');
    await runCycles(3);
    expect(result.current.stop).not.toBe('failed');
  });

  /*
   * The engine's per-attraction lock.
   *
   * This hook drives a second booking engine against a reservation the
   * all-day Autopilot is still polling underneath the screen. Its commits used
   * to go straight to `ll.book(offer)`, outside the shared ledger entirely, so
   * nothing stopped both from modifying the same held pass within a few
   * seconds of each other.
   */
  describe('the shared action lock', () => {
    it('takes the lock before a move leaves the device', async () => {
      const claimCommit = jest.fn(async () => true);
      const commit = jest.fn(async () => booking(at(11)));
      const { result } = setup({ claimCommit, commit });
      act(() => result.current.start());
      await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
      expect(claimCommit).toHaveBeenCalled();
      expect(claimCommit.mock.invocationCallOrder[0]).toBeLessThan(
        commit.mock.invocationCallOrder[0]!
      );
    });

    it('stops cleanly when taking the lock fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const claimCommit = jest.fn(async () => {
        throw new Error('storage unavailable');
      });
      const commit = jest.fn(async () => booking(at(11)));
      const { result } = setup({ claimCommit, commit });

      act(() => result.current.start());

      await waitFor(() => expect(result.current.stop).toBe('failed'));
      expect(commit).not.toHaveBeenCalled();
      expect(result.current.guard.phase).toBe('idle');
      expect(result.current.running).toBe(false);
      expect(result.current.lastError).toMatch(/could not coordinate/i);
    });

    it('releases a claimed lock when keepalive setup fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const releaseCommit = jest.fn(async () => undefined);
      const keepCommitAlive = jest.fn(() => {
        throw new Error('web locks unavailable');
      });
      const commit = jest.fn(async () => booking(at(11)));
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        releaseCommit,
        keepCommitAlive,
        commit,
      });

      act(() => result.current.start());

      await waitFor(() => expect(result.current.stop).toBe('failed'));
      expect(commit).not.toHaveBeenCalled();
      expect(releaseCommit).toHaveBeenCalledTimes(1);
      expect(result.current.guard.phase).toBe('idle');
      expect(result.current.running).toBe(false);
      expect(result.current.lastError).toMatch(/could not keep.*lock alive/i);
    });

    // Refused means the engine is already acting on this reservation. A
    // foreground search is one the user is standing there asking for, so it
    // says so and keeps looking rather than committing on top or dying.
    it('does not commit while the engine holds the lock', async () => {
      const claimCommit = jest.fn(async () => false);
      const commit = jest.fn(async () => booking(at(11)));
      const { result } = setup({ claimCommit, commit });
      act(() => result.current.start());
      await runCycles(3);
      expect(commit).not.toHaveBeenCalled();
      expect(result.current.contended).toBe(true);
      expect(result.current.running).toBe(true);
      expect(result.current.stop).toBeUndefined();
    });

    // Held for the run, never given back between cycles -- that would leave the
    // engine a window on every one of them. Asked again before each commit
    // because the lease expires and asking is how a holder renews it: the
    // acquisition is re-entrant, so a renewal cannot lose the lease it holds.
    it('renews rather than releasing between moves in a run', async () => {
      const claimCommit = jest.fn(async () => true);
      // A grid that improves between cycles, so the search genuinely moves
      // more than once. A fixed grid gives one move and proves nothing here.
      const grids = [[[at(13)]], [[at(11)]], [[at(9)]]];
      let cycle = 0;
      const releaseCommit = jest.fn();
      const { result } = setup({
        claimCommit,
        releaseCommit,
        getTimes: async () => grids[Math.min(cycle++, grids.length - 1)]!,
      });
      act(() => result.current.start());
      await runCycles(5);
      expect(result.current.moves).toBeGreaterThan(1);
      // At least once per commit -- and more, because settling renews. What
      // matters is that it is never *released* between moves.
      expect(claimCommit.mock.calls.length).toBeGreaterThanOrEqual(
        result.current.moves
      );
      expect(releaseCommit).not.toHaveBeenCalled();
    });

    it('keeps the lease after a definite rejection while the run continues', async () => {
      const releaseCommit = jest.fn();
      const stopRenewal = jest.fn();
      let cycle = 0;
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        releaseCommit,
        keepCommitAlive: () => stopRenewal,
        getTimes: async () => (cycle++ === 0 ? [[at(11)]] : []),
        commit: jest
          .fn()
          .mockRejectedValue(
            new RequestError({ ok: false, status: 410, data: {} })
          ),
      });

      act(() => result.current.start());
      await waitFor(() => expect(cycle).toBe(1));
      await runCycles(1);

      expect(result.current.running).toBe(true);
      expect(releaseCommit).not.toHaveBeenCalled();
      expect(stopRenewal).not.toHaveBeenCalled();
    });

    // The `releaseAttempt` escape. Without it the search's own lock would
    // retire the attraction for the rest of the engine's session.
    it('gives the lock back when a settled search stops', async () => {
      const releaseCommit = jest.fn();
      // The default Plans mock follows the move, so the guard confirms and
      // returns to idle -- which is the only state that proves nothing is
      // outstanding. A search that never commits never claims a lock at all,
      // so there would be nothing to give back.
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        releaseCommit,
      });
      act(() => result.current.start());
      await waitFor(() => expect(result.current.moves).toBeGreaterThan(0));
      await runCycles(2);
      expect(result.current.guard.phase).toBe('idle');
      act(() => result.current.cancel());
      expect(releaseCommit).toHaveBeenCalled();
    });

    /*
     * But not while anything is outstanding, which is narrower than it looks.
     * `awaiting` means the move landed and Plans has not agreed yet -- exactly
     * when the engine acting on stale plans would be worst -- and `committing`
     * with a request still in the air is the same doubt by another name. Only
     * an idle guard is proof there is nothing left to protect.
     */
    it('keeps the lock when a stopped search is still settling', async () => {
      const releaseCommit = jest.fn();
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        releaseCommit,
        // Plans never catches up, so the guard stays `awaiting`.
        plans: jest.fn(async () => [booking(at(15))]) as never,
      });
      act(() => result.current.start());
      await waitFor(() => expect(result.current.moves).toBeGreaterThan(0));
      expect(result.current.guard.phase).toBe('awaiting');
      act(() => result.current.cancel());
      expect(releaseCommit).not.toHaveBeenCalled();
    });

    it('stops visibly when renewing a settling lock fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const claimCommit = jest
        .fn<Promise<boolean>, []>()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('storage unavailable'));
      const commit = jest.fn(async () => booking(at(11)));
      const { result } = setup({
        claimCommit,
        commit,
        plans: jest.fn(async () => [booking(at(15))]) as never,
      });

      act(() => result.current.start());
      await waitFor(() => expect(result.current.guard.phase).toBe('awaiting'));
      await runCycles(1);

      await waitFor(() => expect(result.current.stop).toBe('failed'));
      expect(commit).toHaveBeenCalledTimes(1);
      expect(result.current.guard.phase).toBe('awaiting');
      expect(result.current.running).toBe(false);
      expect(result.current.lastError).toMatch(/could not renew/i);
    });

    /*
     * The one outcome a lease cannot express. A move nobody learned the result
     * of must be protected until fresh plans say what happened, and that is not
     * a duration -- so the reservation is quarantined and the lease given back,
     * rather than a lease being held past its own expiry by a search that has
     * stopped and will never renew it again.
     */
    it('quarantines the reservation when an outcome is unknown', async () => {
      const releaseCommit = jest.fn();
      const quarantineCommit = jest.fn();
      const commit = jest.fn().mockRejectedValue(new Error('no response'));
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        releaseCommit,
        quarantineCommit,
        commit,
      });
      act(() => result.current.start());
      await waitFor(() => expect(result.current.stop).toBe('failed'));
      expect(result.current.guard.phase).toBe('unknown');
      expect(quarantineCommit).toHaveBeenCalled();
      expect(releaseCommit).toHaveBeenCalled();
    });

    it('uses page-local protection when quarantine cannot be persisted', async () => {
      const releaseCommit = jest.fn();
      const stopRenewal = jest.fn();
      const commit = jest.fn().mockRejectedValue(new Error('no response'));
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        releaseCommit,
        keepCommitAlive: () => stopRenewal,
        quarantineCommit: jest.fn(async () => false),
        commit,
      });

      act(() => result.current.start());

      await waitFor(() => expect(result.current.stop).toBe('failed'));
      expect(result.current.guard.phase).toBe('unknown');
      expect(result.current.lastError).toMatch(/could not be saved/i);
      expect(releaseCommit).not.toHaveBeenCalled();
      expect(stopRenewal).toHaveBeenCalled();
    });

    it('does not leak renewal when a custom quarantine callback rejects', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const stopRenewal = jest.fn();
      const quarantineCommit = jest.fn(async () => {
        throw new Error('storage unavailable');
      });
      const { result, unmount } = setup({
        claimCommit: jest.fn(async () => true),
        keepCommitAlive: () => stopRenewal,
        quarantineCommit,
        commit: jest.fn().mockRejectedValue(new Error('no response')),
      });

      act(() => result.current.start());
      await waitFor(() => expect(result.current.stop).toBe('failed'));
      unmount();

      expect(quarantineCommit).toHaveBeenCalled();
      expect(stopRenewal).toHaveBeenCalledTimes(1);
    });

    /*
     * And it records the reservation as it is at the moment of committing.
     *
     * An offered move waits on a person, and a person is slow. The engine
     * underneath, a second tab, or the Disney app itself can move the
     * reservation in that gap -- and the warning used to keep whatever the last
     * idle cycle had read. That made it describe a move from 3pm when the
     * reservation had already been at 1pm before the request went out.
     */
    it('records the reservation as it is when the move is accepted', async () => {
      const quarantineCommit = jest.fn();
      let held = at(15);
      const { result } = setup({
        goal: { kind: 'at', target: at(11) },
        confirmEveryMove: true,
        plans: jest.fn(async () => [booking(held)]) as never,
        claimCommit: jest.fn(async () => true),
        commit: jest.fn().mockRejectedValue(new Error('no response')),
        quarantineCommit,
      });
      act(() => result.current.start());
      await waitFor(() => expect(result.current.pending).toBeDefined());
      // It moves while the offer sits waiting for an answer.
      held = at(13);
      act(() => result.current.accept());
      // The commit happens on the next cycle, through the same guard.
      await runCycles(1);
      await waitFor(() => expect(quarantineCommit).toHaveBeenCalled());
      expect(quarantineCommit).toHaveBeenCalledWith(
        expect.any(String),
        {
          kind: 'modify',
          from: String(at(13)),
          to: String(at(11)),
          reservationIds: ['ent-1'],
        },
        expect.any(Number)
      );
    });

    /*
     * Renewal cannot go on forever either. Renewing a wedged commit
     * indefinitely held the reservation for the rest of the day behind a screen
     * still saying "Searching...". Past `MAX_MUTATION_MS` nothing is coming back
     * to settle it -- and since this only ever wraps the commit itself, the
     * request has already left the device, so the reservation is in doubt.
     */
    it('gives up on a commit that never returns', async () => {
      const quarantineCommit = jest.fn();
      const releaseCommit = jest.fn();
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        releaseCommit,
        quarantineCommit,
        commit: jest.fn(() => new Promise<LLMP>(() => {})),
      });
      act(() => result.current.start());
      await waitFor(() =>
        expect(result.current.guard.phase).toBe('committing')
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MAX_MUTATION_MS + 1);
      });
      expect(quarantineCommit).toHaveBeenCalled();
      expect(result.current.guard.phase).toBe('unknown');
      expect(result.current.unresolved).toBeDefined();
      expect(result.current.stop).toBe('failed');
    });

    it('uses a definitive late success to leave unknown safely', async () => {
      const inFlight = deferred<LLMP>();
      const quarantineCommit = jest.fn<
        Promise<void>,
        [string, unknown, number]
      >(async () => undefined);
      const retainCommit = jest.fn(async () => true);
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        quarantineCommit,
        retainCommit,
        commit: jest.fn(() => inFlight.promise),
      });
      act(() => result.current.start());
      await waitFor(() =>
        expect(result.current.guard.phase).toBe('committing')
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MAX_MUTATION_MS + 1);
      });
      expect(result.current.guard.phase).toBe('unknown');
      await act(async () => {
        inFlight.resolve(booking(at(11)));
        await inFlight.promise;
      });
      await waitFor(() => expect(result.current.moves).toBe(1));
      expect(result.current.guard.phase).toBe('awaiting');
      expect(result.current.unresolved).toBeUndefined();
      expect(retainCommit).toHaveBeenCalledWith(
        quarantineCommit.mock.calls[0]![0]
      );
    });

    it('stops safely when a known success cannot retain its protection', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const commit = jest.fn(async () => booking(at(11)));
      const stopRenewal = jest.fn();
      const retainCommit = jest.fn(async () => {
        throw new Error('storage unavailable');
      });
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        commit,
        keepCommitAlive: () => stopRenewal,
        retainCommit,
      });

      act(() => result.current.start());

      await waitFor(() => expect(result.current.moves).toBe(1));
      expect(result.current.running).toBe(false);
      expect(result.current.stop).toBe('unconfirmed');
      expect(result.current.guard.phase).toBe('awaiting');
      expect(result.current.lastError).toMatch(/could not retain/i);
      expect(stopRenewal).toHaveBeenCalledTimes(1);
      await runCycles(2);
      expect(commit).toHaveBeenCalledTimes(1);
    });

    it('uses a definitive late rejection to clear only that doubt', async () => {
      const inFlight = deferred<LLMP>();
      const quarantineCommit = jest.fn<
        Promise<void>,
        [string, unknown, number]
      >(async () => undefined);
      const resolveCommit = jest.fn<Promise<void>, [string]>(
        async () => undefined
      );
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        quarantineCommit,
        resolveCommit,
        commit: jest.fn(() => inFlight.promise),
      });
      act(() => result.current.start());
      await waitFor(() =>
        expect(result.current.guard.phase).toBe('committing')
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MAX_MUTATION_MS + 1);
      });
      expect(result.current.guard.phase).toBe('unknown');
      await act(async () => {
        inFlight.reject(new RequestError({ ok: false, status: 410, data: {} }));
        await inFlight.promise.catch(() => undefined);
      });
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      expect(result.current.guard.phase).toBe('idle');
      expect(result.current.unresolved).toBeUndefined();
      expect(resolveCommit).toHaveBeenCalledWith(
        quarantineCommit.mock.calls[0]![0]
      );
    });

    it('quarantines its own operation when renewal is refused after dispatch', async () => {
      const inFlight = deferred<LLMP>();
      const quarantineCommit = jest.fn<
        Promise<void>,
        [string, unknown, number]
      >(async () => undefined);
      let lose: () => void = () => undefined;
      const { result } = setup({
        claimCommit: jest.fn(async () => true),
        quarantineCommit,
        keepCommitAlive: onLost => {
          lose = onLost;
          return () => undefined;
        },
        commit: jest.fn(() => inFlight.promise),
      });
      act(() => result.current.start());
      await waitFor(() =>
        expect(result.current.guard.phase).toBe('committing')
      );
      await act(async () => lose());
      await waitFor(() => expect(quarantineCommit).toHaveBeenCalled());
      expect(result.current.guard.phase).toBe('unknown');
      expect(quarantineCommit.mock.calls[0]![0]).toEqual(expect.any(String));
    });

    /*
     * A commit can outlive one lease TTL: first-use sensor loading happens
     * before the HTTP timeout begins, and the mutation lifecycle deliberately
     * has its own longer absolute horizon. Without renewal, another engine
     * could take the reservation while the original operation is still live.
     * Asking again *is* renewing: acquisition is re-entrant for the holder.
     */
    it('keeps one renewal alive through the request and the run', async () => {
      const claimCommit = jest.fn(async () => true);
      const stopRenewal = jest.fn();
      const keepCommitAlive = jest.fn(() => stopRenewal);
      const inFlight = deferred<LLMP>();
      const commit = jest.fn(() => inFlight.promise);
      const { result } = setup({ claimCommit, commit, keepCommitAlive });
      act(() => result.current.start());
      await waitFor(() => expect(commit).toHaveBeenCalled());
      expect(keepCommitAlive).toHaveBeenCalledTimes(1);
      await act(async () => {
        inFlight.resolve(booking(at(11)));
        await inFlight.promise;
      });
      expect(stopRenewal).not.toHaveBeenCalled();
      act(() => result.current.cancel());
      expect(stopRenewal).toHaveBeenCalledTimes(1);
    });
  });

  // No offer right now is an ordinary outcome mid-day, not a fault.
  it('does not burn the failure budget on an empty offer', async () => {
    const { result, deps } = setup();
    (deps.createOffer as jest.Mock).mockRejectedValue(
      new OfferError({ eligible: [], ineligible: [] })
    );
    act(() => result.current.start());
    await runCycles(8);
    expect(result.current.stop).toBeUndefined();
  });

  it('stops when the reservation is no longer modifiable', async () => {
    const { result } = setup({
      plans: jest.fn(async () => [booking(at(15), { modifiable: false })]),
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.stop).toBe('not-modifiable'));
  });

  it('stops when the goal is met', async () => {
    const { result } = setup({
      goal: { kind: 'at', target: at(15) },
      held: at(15),
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.stop).toBe('goal-met'));
  });
});

describe('useTimeSearch restarting', () => {
  // A slot Disney could not honour an hour ago may be free now, and the
  // budget is a statement about one search rather than about the afternoon.
  it('forgets declined slots and the commit budget on a new search', async () => {
    const changeTime = jest.fn(async () => offerAt(at(13)));
    const { result } = setup({ times: [[at(11)]], quoted: changeTime });
    act(() => result.current.start());
    await waitFor(() =>
      expect(result.current.guard.declined.has(+at(11))).toBe(true)
    );
    act(() => result.current.cancel());

    act(() => result.current.start());
    expect(result.current.guard.declined.size).toBe(0);
    expect(result.current.guard.commits).toBe(0);
    expect(result.current.cycles).toBe(0);
    expect(result.current.moves).toBe(0);
    await runCycles(2);
    expect(changeTime.mock.calls.length).toBeGreaterThan(1);
  });

  // Restarting must not be a way around the one lock that is not per-run.
  it('will not restart after an unknown outcome', async () => {
    const commit = jest.fn(async () => {
      throw new RequestError({ ok: false, status: 0, data: {} });
    });
    const { result } = setup({ commit });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.guard.phase).toBe('unknown'));
    act(() => result.current.start());
    expect(result.current.running).toBe(false);
    await runCycles(2);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  // The move happened -- `book()` returned -- so this is not the unknown
  // case. Plans simply has not caught up, and saying so beats a screen that
  // says "Checking..." over a reservation that already moved.
  it('stops rather than waiting forever for Plans to agree', async () => {
    let polls = 0;
    const { result } = setup({
      // Plans keeps reporting the old time however many times it is asked.
      plans: jest.fn(async () => {
        ++polls;
        return [booking(at(15))];
      }),
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.moves).toBe(1));
    await runCycles(MAX_SETTLE_CYCLES + 2);
    expect(result.current.stop).toBe('unconfirmed');
    expect(polls).toBeGreaterThan(MAX_SETTLE_CYCLES);
  });
});

/**
 * Stop, then Start, while a committed move has not yet appeared in Plans.
 *
 * The itinerary lags, so a fresh run would read the OLD time and decide
 * again on top of a move that already landed. This is the sequence the whole
 * guard exists to prevent, and the restart fix opened it.
 */
describe('useTimeSearch restarting mid-settle', () => {
  /** Plans that keep reporting the old time, so the move never settles. */
  function stubbornPlans(oldTime: ParkTime) {
    return jest.fn(async () => [booking(oldTime)]);
  }

  it('offers confirmation recovery when stopped while Plans is settling', async () => {
    const { result } = setup({
      plans: stubbornPlans(at(15)),
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.guard.phase).toBe('awaiting'));

    act(() => result.current.cancel());
    expect(result.current.stop).toBe('unconfirmed');
    expect(result.current.guard.phase).toBe('awaiting');
  });

  it('does not decide again before Plans confirms a committed move', async () => {
    const commit = jest.fn(async () => booking(at(11)));
    const { result, deps } = setup({
      held: at(15),
      times: [[at(11)]],
      commit,
      plans: stubbornPlans(at(15)),
    });
    act(() => result.current.start());
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(result.current.guard.phase).toBe('awaiting');

    act(() => result.current.cancel());
    act(() => result.current.start());
    // The lock survived the restart, so the run resumes settling rather than
    // deciding from the stale time Plans is still reporting.
    expect(result.current.guard.phase).toBe('awaiting');
    await runCycles(3);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(deps.changeTime).toHaveBeenCalledTimes(1);
  });

  it('carries on once Plans catches up', async () => {
    let reported = at(15);
    const commit = jest.fn(async () => {
      reported = at(11);
      return booking(at(11));
    });
    const { result } = setup({
      held: at(15),
      times: [[at(11)]],
      commit,
      plans: jest.fn(async () => [booking(reported)]),
    });
    act(() => result.current.start());
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    act(() => result.current.cancel());
    act(() => result.current.start());
    await runCycles(2);
    expect(result.current.guard.phase).not.toBe('awaiting');
    expect(`${result.current.held}`).toBe('11:00:00');
  });
});
