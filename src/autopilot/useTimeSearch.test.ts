import { act, renderHook, waitFor } from '@testing-library/react';

import { RequestError } from '@/api/client';
import { Booking } from '@/api/itinerary';
import { LLMP, Offer, OfferError } from '@/api/ll';
import { DateTime, ParkTime } from '@/datetime';
import { TODAY } from '@/testing';

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

function offerAt(time: ParkTime): Offer<LLMP> {
  return {
    id: 'offer-1',
    offerSetId: 'set-1',
    start: new DateTime(TODAY, time),
    end: new DateTime(TODAY, time.add({ hours: 1 })),
    guests: { eligible: [], ineligible: [] },
    itinerary: [],
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
  findHeld,
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
} = {}) {
  let current = held;
  const deps: TimeSearchDeps = {
    booking: booking(held),
    goal,
    createOffer: jest.fn(async () => offerAt(current)),
    getTimes: jest.fn(async () => times),
    changeTime: quoted ?? jest.fn(async (_o, t: ParkTime) => offerAt(t)),
    commit:
      commit ??
      jest.fn(async (o: Offer<LLMP>) => {
        current = o.start.time;
        return booking(current);
      }),
    pollPlans:
      plans ??
      (jest.fn(async () => [booking(current)]) as () => Promise<Booking[]>),
    confirmEveryMove,
    stopAfterConfirmedMove,
    findHeld,
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

  it('releases the visible guard when a stopped commit is rejected', async () => {
    const committed = deferred<LLMP>();
    const commit = jest.fn(() => committed.promise);
    const { result } = setup({ commit });
    act(() => result.current.start());
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));

    act(() => result.current.cancel());
    await act(async () =>
      committed.reject(new RequestError({ ok: false, status: 410, data: {} }))
    );

    expect(result.current.guard.phase).toBe('idle');
    expect(result.current.phase).toBe('idle');
    expect(result.current.running).toBe(false);
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

  // The whole safety story: a commit whose outcome cannot be established is
  // absorbing. Nothing that arrives later can settle it, and a second attempt
  // is how a party ends up at a time nobody chose.
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
