import { modifyDate, parkDate } from '@/datetime';
import kvdb from '@/kvdb';

import {
  LEASE_KEY,
  LEASE_TTL_MS,
  QUARANTINE_KEY,
  RENEW_INTERVAL_MS,
  acquire,
  available,
  holder,
  keepAlive,
  leaseKey,
  quarantine,
  quarantinedAt,
  quarantinedMutations,
  reconcile,
  release,
  resolveDoubt,
  resolveDoubtAndAcquire,
  startWhileHeld,
} from './lease';

const A = 'instance-a';
const B = 'instance-b';
// Derived rather than a fixture date. Doubts are pruned by the park day their
// key names, so a key hard-coded in the past expires the instant it is written
// and every quarantine test passes for the wrong reason.
const DATE = parkDate();
const KEY = leaseKey('80010114', DATE);
const OTHER_KEY = leaseKey('80010129', DATE);

beforeEach(() => {
  localStorage.clear();
  delete (navigator as { locks?: unknown }).locks;
});

/** A Web Locks stand-in that runs bodies one at a time, in order. */
function installWebLocks() {
  let chain: Promise<unknown> = Promise.resolve();
  (navigator as unknown as { locks: unknown }).locks = {
    request: (_name: string, body: () => unknown) => {
      const next = chain.then(() => body());
      chain = next.catch(() => undefined);
      return next;
    },
  };
}

describe('the operation lease', () => {
  it('is free until somebody takes it', async () => {
    expect(holder(KEY)).toBeUndefined();
    expect(await acquire(KEY, A)).toBe(true);
    expect(holder(KEY)).toBe(A);
  });

  it('refuses a second instance while it is live', async () => {
    await acquire(KEY, A);
    expect(await acquire(KEY, B)).toBe(false);
    expect(holder(KEY)).toBe(A);
  });

  // Re-entrant on purpose: a foreground search holds one for the length of a
  // run, and renewing is how it does that without expiring underneath itself.
  it('renews rather than refusing its own holder', async () => {
    await acquire(KEY, A, 1000);
    expect(await acquire(KEY, A, 2000)).toBe(true);
    expect(holder(KEY, 2000)).toBe(A);
  });

  /*
   * The property the retained `change:` attempt lock did not have. A tab closed
   * mid-move leaves its lease behind and nothing will ever come back to release
   * it, so without expiry that reservation was locked until the 4am rollover --
   * a silent, day-long loss of cover on a ride you armed.
   */
  it('lets a stale lease be taken over', async () => {
    await acquire(KEY, A, 1000);
    expect(await acquire(KEY, B, 1000 + LEASE_TTL_MS)).toBe(true);
    expect(holder(KEY, 1000 + LEASE_TTL_MS)).toBe(B);
  });

  it('reports nobody once a lease has expired', async () => {
    await acquire(KEY, A, 1000);
    expect(holder(KEY, 1000 + LEASE_TTL_MS)).toBeUndefined();
  });

  it('does not expire one that is still being renewed', async () => {
    await acquire(KEY, A, 1000);
    await acquire(KEY, A, 1000 + LEASE_TTL_MS - 1);
    expect(holder(KEY, 1000 + LEASE_TTL_MS + 1)).toBe(A);
  });

  // Only the holder releases. Otherwise an instance that merely read the store
  // could withdraw the cover another was relying on mid-request.
  it('ignores a release from an instance that does not hold it', async () => {
    await acquire(KEY, A);
    await release(KEY, B);
    expect(holder(KEY)).toBe(A);
  });

  it('lets the holder release', async () => {
    await acquire(KEY, A);
    await release(KEY, A);
    expect(holder(KEY)).toBeUndefined();
    expect(await acquire(KEY, B)).toBe(true);
  });

  it('keeps leases on other reservations apart', async () => {
    await acquire(KEY, A);
    expect(await acquire(OTHER_KEY, B)).toBe(true);
    expect(holder(KEY)).toBe(A);
    expect(holder(OTHER_KEY)).toBe(B);
  });

  it('acquires a conflict set all-or-nothing', async () => {
    await acquire(OTHER_KEY, A);

    expect(await acquire([KEY, OTHER_KEY], B)).toBe(false);
    expect(holder(KEY)).toBeUndefined();
    expect(holder(OTHER_KEY)).toBe(A);
  });

  it('treats reversed conflict-key order as the same lease set', async () => {
    expect(await acquire([KEY, OTHER_KEY], A)).toBe(true);
    expect(holder(KEY)).toBe(A);
    expect(holder(OTHER_KEY)).toBe(A);

    expect(await acquire([OTHER_KEY, KEY], B)).toBe(false);
    await release([OTHER_KEY, KEY], A);
    expect(holder(KEY)).toBeUndefined();
    expect(holder(OTHER_KEY)).toBeUndefined();
  });

  // The same ride on two days is two reservations.
  it('keeps the same attraction on different days apart', async () => {
    const tomorrow = leaseKey('80010114', modifyDate(DATE, 1));
    await acquire(KEY, A);
    expect(await acquire(tomorrow, B)).toBe(true);
  });

  it('discards a malformed store rather than trusting it', async () => {
    kvdb.set(LEASE_KEY, 'nonsense');
    expect(holder(KEY)).toBeUndefined();
    kvdb.set(LEASE_KEY, { [KEY]: { owner: 7 } });
    expect(holder(KEY)).toBeUndefined();
    expect(await acquire(KEY, A)).toBe(true);
  });

  /*
   * Doubt, which a lease cannot express. A lease expires; "until plans say what
   * happened" is not a duration. Releasing on a status-0 and trusting the
   * ledger's attempt lock was the mistake: that lock is keyed by action and
   * attraction, a foreground search does not consult it, and a swap for a
   * different incoming attraction can target the very reservation in doubt.
   */
  describe('quarantine', () => {
    const RAISED = 1000;
    const modifyDoubt = {
      id: 'modify-1',
      kind: 'modify' as const,
      from: '19:00:00',
      to: '11:00:00',
      reservationIds: ['booking-1'],
    };
    const swapDoubt = {
      id: 'swap-1',
      kind: 'swap' as const,
      from: '19:00:00',
      to: '13:00:00',
      gaining: '80010129',
      reservationIds: ['booking-1'],
    };
    /** What a plans read reporting nothing at all looks like. */
    const nothing = () => undefined;
    /** A read that started after the doubt was raised, as every real one does. */
    const read =
      (
        seen: (
          key: string,
          reservationIds: readonly string[],
          requestedTime: string
        ) => { time: string; reservationIds: string[] } | undefined,
        at: number
      ) =>
      () =>
        reconcile(seen, at);
    const seenAt = (time: string, id = 'booking-1') => ({
      time,
      reservationIds: [id],
    });

    it('refuses everyone, including the instance that raised it', async () => {
      await acquire(KEY, A);
      await quarantine(KEY, modifyDoubt, RAISED);
      await release(KEY, A);
      expect(await acquire(KEY, A)).toBe(false);
      expect(await acquire(KEY, B)).toBe(false);
    });

    it('fails closed in this page when durable quarantine storage fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const realSet = kvdb.set.bind(kvdb);
      const set = jest.spyOn(kvdb, 'set').mockImplementation((key, value) => {
        if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
        realSet(key, value);
      });

      const result = await quarantine(KEY, modifyDoubt, RAISED);

      expect(result.durable).toBe(false);
      expect(quarantinedAt(KEY)).toBe(RAISED);
      expect(quarantinedMutations()).toEqual([
        expect.objectContaining({ id: modifyDoubt.id, durable: false }),
      ]);
      expect(await acquire(KEY, A)).toBe(false);

      set.mockRestore();
      await resolveDoubt(KEY, modifyDoubt.id);
    });

    /*
     * A doubt that only ever lived in this page still needs a way out.
     *
     * Its durable write failed, so `reconcile()` cannot find it in storage --
     * it has a separate pass over the volatile store, and that pass is the only
     * automatic terminus a page-local doubt has. Without it the reservation
     * stays blocked until the reload the panel warns destroys protection.
     */
    it('settles a page-local doubt on the same evidence as a durable one', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const realSet = kvdb.set.bind(kvdb);
      const set = jest.spyOn(kvdb, 'set').mockImplementation((key, value) => {
        if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
        realSet(key, value);
      });
      const raised = await quarantine(
        KEY,
        {
          id: 'page-local',
          kind: 'modify',
          to: '11:00:00',
          reservationIds: ['booking-1'],
        },
        RAISED
      );
      expect(raised.durable).toBe(false);
      set.mockRestore();

      try {
        await read(() => seenAt('11:00:00'), 2000)();
        expect(quarantinedAt(KEY)).toBeUndefined();
        expect(await acquire(KEY, A, 2000)).toBe(true);
      } finally {
        await resolveDoubt(KEY, 'page-local');
      }
    });

    /*
     * And a way out the user can take, even when the broken thing is the read.
     *
     * `resolveDoubt` consults durable storage first; if that throws, the
     * page-local copy it was raised alongside used to survive the failure --
     * so pressing "I checked Disney" reported an error and left the
     * reservation blocked. The volatile clear belongs in a `finally`, which is
     * where `reconcile()` has always had it.
     */
    it('clears a page-local doubt by hand even when the durable read fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const realSet = kvdb.set.bind(kvdb);
      const set = jest.spyOn(kvdb, 'set').mockImplementation((key, value) => {
        if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
        realSet(key, value);
      });
      await quarantine(KEY, { id: 'page-local', kind: 'modify' }, RAISED);
      set.mockRestore();

      const get = jest.spyOn(kvdb, 'get').mockImplementation(key => {
        if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
        return undefined;
      });
      try {
        await expect(resolveDoubt(KEY, 'page-local')).rejects.toThrow(
          'storage unavailable'
        );
      } finally {
        get.mockRestore();
      }

      expect(quarantinedAt(KEY)).toBeUndefined();
      expect(await acquire(KEY, A)).toBe(true);
    });

    it('does not infer that quarantine is empty when storage cannot be read', async () => {
      const get = jest.spyOn(kvdb, 'get').mockImplementation(key => {
        if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
        return undefined;
      });

      await expect(acquire(KEY, A)).rejects.toThrow('storage unavailable');

      get.mockRestore();
    });

    it('evicts a pre-existing lease so clearing doubt cannot revive it', async () => {
      await acquire(KEY, A);
      await quarantine(KEY, modifyDoubt, RAISED);
      await resolveDoubt(KEY, modifyDoubt.id);
      expect(holder(KEY)).toBeUndefined();
      expect(await acquire(KEY, B)).toBe(true);
    });

    it('stores one swap doubt that blocks both victim and gained attraction', async () => {
      await acquire([KEY, OTHER_KEY], A);
      await quarantine(
        KEY,
        { ...swapDoubt, blockingKeys: [KEY, OTHER_KEY] },
        RAISED
      );

      expect(holder(KEY)).toBeUndefined();
      expect(holder(OTHER_KEY)).toBeUndefined();
      expect(quarantinedAt(KEY)).toBe(RAISED);
      expect(quarantinedAt(OTHER_KEY)).toBe(RAISED);
      expect(quarantinedMutations()).toEqual([
        expect.objectContaining({
          id: swapDoubt.id,
          key: KEY,
          blockingKeys: expect.arrayContaining([KEY, OTHER_KEY]),
        }),
      ]);
      expect(await acquire(OTHER_KEY, B)).toBe(false);

      await resolveDoubt(KEY, swapDoubt.id);
      expect(await acquire([KEY, OTHER_KEY], B)).toBe(true);
    });

    it('does not expire the way a lease does', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      expect(await acquire(KEY, A, RAISED + LEASE_TTL_MS * 10)).toBe(false);
    });

    it('clears a modify only at the exact time sent to Disney', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      await read(() => seenAt('11:00:00'), 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(true);
    });

    it('does not clear a modify merely because it moved elsewhere', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      await read(() => seenAt('12:00:00'), 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    it('does not let another reservation at the requested time answer the doubt', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      await read(() => seenAt('11:00:00', 'another-booking'), 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    it('keeps a legacy doubt without reservation identity for manual review', async () => {
      await quarantine(
        KEY,
        { id: 'legacy-shape', kind: 'modify', to: '11:00:00' },
        RAISED
      );
      await read(() => seenAt('11:00:00'), 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    it('clears a swap when the incoming attraction appears at the sent time', async () => {
      await quarantine(KEY, swapDoubt, RAISED);
      await read(
        key =>
          key === leaseKey('80010129', DATE)
            ? seenAt('13:00:00', 'booking-1')
            : undefined,
        2000
      )();
      expect(await acquire(KEY, A, 2000)).toBe(true);
    });

    it('does not clear a swap when the incoming attraction has another time', async () => {
      await quarantine(KEY, swapDoubt, RAISED);
      await read(
        key =>
          key === leaseKey('80010129', DATE)
            ? seenAt('13:05:00', 'booking-1')
            : undefined,
        2000
      )();
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    it('does not clear a swap from another incoming reservation', async () => {
      await quarantine(KEY, swapDoubt, RAISED);
      await read(
        key =>
          key === leaseKey('80010129', DATE)
            ? seenAt('13:00:00', 'another-booking')
            : undefined,
        2000
      )();
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    it('does not clear a swap on the victim being gone alone', async () => {
      await quarantine(KEY, swapDoubt, RAISED);
      await read(nothing, 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    it('never clears from elapsed time or contrary reads alone', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      for (let i = 0; i < 20; ++i) {
        await read(() => seenAt('19:00:00'), RAISED + i * LEASE_TTL_MS)();
      }
      expect(await acquire(KEY, A, RAISED + 30 * LEASE_TTL_MS)).toBe(false);
    });

    /*
     * A response already in flight when the doubt was raised is a photograph
     * taken before the event. It cannot clear the doubt and it cannot count
     * against it, and the plans pipeline knows when each read *started* for
     * exactly this reason.
     */
    it('ignores a read that started before the doubt was raised', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      // Data that would settle it outright, from a read that began earlier.
      await reconcile(() => seenAt('11:00:00'), RAISED);
      expect(await acquire(KEY, A, RAISED + LEASE_TTL_MS)).toBe(false);
    });

    /*
     * Two unknown requests against one reservation are two questions.
     *
     * Reachable through the overlap this module already acknowledges: a lease
     * that lapsed under an operation the poller had abandoned. A single slot
     * per reservation had the second doubt overwrite the first, so evidence
     * that answered one unlocked the reservation for both.
     */
    it('frees the reservation only when every doubt about it has settled', async () => {
      await quarantine(KEY, swapDoubt, RAISED);
      await quarantine(
        KEY,
        {
          id: 'modify-2',
          kind: 'modify',
          from: '19:00:00',
          to: '17:00:00',
          reservationIds: ['booking-1'],
        },
        RAISED + 1
      );
      // Answers the modify outright, and says nothing at all about the swap:
      // the attraction that one was for is nowhere in plans.
      await read(key => (key === KEY ? seenAt('17:00:00') : undefined), 2000)();
      expect(quarantinedAt(KEY)).toBe(RAISED);
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    it('keeps identical evidence from different mutation ids independent', async () => {
      await quarantine(KEY, { ...modifyDoubt, id: 'generation-a' }, RAISED);
      await quarantine(KEY, { ...modifyDoubt, id: 'generation-b' }, RAISED + 1);
      expect(quarantinedMutations().map(doubt => doubt.id)).toEqual([
        'generation-a',
        'generation-b',
      ]);
      await resolveDoubt(KEY, 'generation-a');
      expect(await acquire(KEY, A)).toBe(false);
      await resolveDoubt(KEY, 'generation-b');
      expect(await acquire(KEY, A)).toBe(true);
    });

    it('can resolve a late success and retain the lease without a gap', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      expect(await resolveDoubtAndAcquire(KEY, modifyDoubt.id, A, 2000)).toBe(
        true
      );
      expect(holder(KEY, 2000)).toBe(A);
      expect(await acquire(KEY, B, 2000)).toBe(false);
    });

    it('retains every swap conflict key after a definitive late success', async () => {
      await quarantine(
        KEY,
        { ...swapDoubt, blockingKeys: [KEY, OTHER_KEY] },
        RAISED
      );
      expect(
        await resolveDoubtAndAcquire([KEY, OTHER_KEY], swapDoubt.id, A, 2000)
      ).toBe(true);
      expect(holder(KEY, 2000)).toBe(A);
      expect(holder(OTHER_KEY, 2000)).toBe(A);
      expect(await acquire(OTHER_KEY, B, 2000)).toBe(false);
    });

    it('keeps the doubt when late-success reacquisition is refused', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      // Represents a competing context in a browser without Web Locks, or a
      // person who manually cleared protection and let new work begin before
      // the original response arrived.
      kvdb.set(LEASE_KEY, { [KEY]: { owner: B, at: 2000 } });

      expect(await resolveDoubtAndAcquire(KEY, modifyDoubt.id, A, 2000)).toBe(
        false
      );
      expect(quarantinedAt(KEY)).toBe(RAISED);
      expect(holder(KEY, 2000)).toBe(B);
    });

    it('leaves other reservations alone', async () => {
      const other = leaseKey('80010129', DATE);
      await quarantine(KEY, modifyDoubt, RAISED);
      expect(await acquire(other, A)).toBe(true);
    });

    /*
     * Scoped to the reservation's own park day, not to the day it was raised.
     * Stored through `getDaily` it was scoped to *today*, so every doubt
     * vanished at the 4am rollover -- including one raised minutes before it
     * could be inspected, and every doubt about a future-dated reservation,
     * which is most of what this app books.
     */
    it('keeps a doubt about a reservation on a later day', async () => {
      const later = leaseKey('80010114', modifyDate(DATE, 1));
      await quarantine(later, modifyDoubt, RAISED);
      expect(quarantinedAt(later)).toBe(RAISED);
      expect(await acquire(later, A)).toBe(false);
    });

    /*
     * The upgrade lands as a page reload, which is exactly when a doubt matters
     * most -- the script that raised it is gone and its request may still have
     * reached Disney. Dropping the old day-scoped wrapper would have the deploy
     * itself unprotect a reservation.
     */
    it('still honours a doubt written in the old day-scoped shape', async () => {
      kvdb.set(QUARANTINE_KEY, {
        date: parkDate(),
        value: { [KEY]: { at: RAISED, from: '19:00:00' } },
      });
      expect(quarantinedAt(KEY)).toBe(RAISED);
      expect(await acquire(KEY, A)).toBe(false);
    });

    /*
     * And whatever day that wrapper names. Its date says when the store was
     * *written*, not what is inside it -- and most of what this app books is
     * dated weeks out, so yesterday's wrapper can easily hold a doubt about a
     * December reservation. Honouring only today's threw exactly those away.
     */
    it('honours an old store written on an earlier day', async () => {
      const later = leaseKey('80010114', modifyDate(parkDate(), 40));
      kvdb.set(QUARANTINE_KEY, {
        date: modifyDate(parkDate(), -1),
        value: { [later]: { at: RAISED, from: '19:00:00' } },
      });
      expect(quarantinedAt(later)).toBe(RAISED);
    });

    // Pruning is still the key's job, and the key names the reservation's day.
    it('prunes an old store by each reservation, not by the wrapper', async () => {
      const past = leaseKey('80010114', modifyDate(parkDate(), -3));
      kvdb.set(QUARANTINE_KEY, {
        date: modifyDate(parkDate(), -1),
        value: { [past]: { at: RAISED, from: '19:00:00' } },
      });
      expect(quarantinedAt(past)).toBeUndefined();
    });

    it('drops a doubt whose park day is over', async () => {
      const past = leaseKey('80010114', modifyDate(DATE, -1));
      await quarantine(past, modifyDoubt, RAISED);
      expect(quarantinedAt(past)).toBeUndefined();
      expect(await acquire(past, A)).toBe(true);
    });

    it('ignores malformed reservation keys from storage', () => {
      kvdb.set(QUARANTINE_KEY, {
        'not-a-reservation': { ...modifyDoubt, at: RAISED },
        '2026-99-99:bad-date': { ...modifyDoubt, at: RAISED },
      });
      expect(quarantinedMutations()).toEqual([]);
    });

    it('ignores malformed blocking keys without dropping the primary doubt', async () => {
      kvdb.set(QUARANTINE_KEY, {
        [KEY]: {
          ...modifyDoubt,
          at: RAISED,
          blockingKeys: { unexpected: true },
        },
      });

      expect(quarantinedAt(KEY)).toBe(RAISED);
      expect(quarantinedAt(OTHER_KEY)).toBeUndefined();
      expect(await acquire(KEY, A)).toBe(false);
    });
  });

  /*
   * The lease has to outlast the request, not the tick that started it.
   *
   * `TICK_DEADLINE_MS` abandons an overrunning tick without cancelling it, and
   * first-use sensor loading happens before the HTTP timeout begins. A lease
   * acquired once and left to its TTL can therefore expire under an operation
   * still in the air, letting the next actor take the reservation Disney is
   * about to change.
   */
  describe('renewal', () => {
    afterEach(() => jest.useRealTimers());

    /** Advance fake timers and let the promises they started run. */
    const act = async (ms: number) => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
      await Promise.resolve();
    };

    it('holds the lease past its TTL while a request is outstanding', async () => {
      jest.useFakeTimers({ now: 0, advanceTimers: false });
      await acquire(KEY, A);
      const stop = keepAlive(KEY, A);
      // Well past the TTL: without renewal the lease is long gone by here.
      for (let elapsed = 0; elapsed < LEASE_TTL_MS * 3; ) {
        await act(RENEW_INTERVAL_MS);
        elapsed += RENEW_INTERVAL_MS;
      }
      expect(holder(KEY)).toBe(A);
      expect(await acquire(KEY, B)).toBe(false);
      stop();
    });

    /*
     * A refused renewal means somebody quarantined the reservation, or took the
     * lease over after it lapsed. Renewing quietly through that had the holder
     * go on to commit believing it still had cover it had lost.
     */
    it('reports a renewal the lease refused', async () => {
      jest.useFakeTimers({ now: 0, advanceTimers: false });
      const lost = jest.fn();
      await acquire(KEY, A);
      keepAlive(KEY, A, lost);
      await quarantine(KEY, { kind: 'modify' });
      await act(RENEW_INTERVAL_MS);
      expect(lost).toHaveBeenCalledWith('refused');
    });

    it('reports a renewal whose coordination request rejects', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.useFakeTimers({ now: 0, advanceTimers: false });
      const lost = jest.fn();
      const request = jest
        .fn()
        .mockImplementationOnce((_name: string, body: () => unknown) =>
          Promise.resolve(body())
        )
        .mockRejectedValueOnce(new Error('lock manager unavailable'));
      (navigator as unknown as { locks: unknown }).locks = { request };
      await acquire(KEY, A);
      keepAlive(KEY, A, lost);

      await jest.advanceTimersByTimeAsync(RENEW_INTERVAL_MS);

      expect(lost).toHaveBeenCalledWith('refused');
    });

    /*
     * Renewal has its own quarantine gate, and it is the one that stops a
     * holder walking into a doubt raised while its request was being prepared.
     * Its existing test passes without it, because `quarantine()` also evicts
     * the lease and the owner check then refuses first. A doubt that could not
     * be persisted evicts nothing, so this is the state that tells them apart.
     */
    it('reports a loss when a page-local doubt appears under a live lease', async () => {
      jest.useFakeTimers({ now: 0, advanceTimers: false });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lost = jest.fn();
      await acquire(KEY, A);
      const realSet = kvdb.set.bind(kvdb);
      const set = jest.spyOn(kvdb, 'set').mockImplementation((key, value) => {
        if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
        realSet(key, value);
      });
      await quarantine(KEY, { id: 'page-local', kind: 'modify' });
      set.mockRestore();
      // The lease survived, because eviction shares the failed write's section.
      expect(holder(KEY)).toBe(A);

      try {
        const stop = keepAlive(KEY, A, lost);
        // Async: the renewal goes through the same `exclusive()` critical
        // section as everything else, so the refusal is a promise, not a
        // synchronous return.
        await jest.advanceTimersByTimeAsync(RENEW_INTERVAL_MS);
        expect(lost).toHaveBeenCalledWith('refused');
        stop();
      } finally {
        // `volatileQuarantine` is module state that `beforeEach` cannot reach,
        // so a page-local doubt outlives its own test unless it is cleared
        // here -- and it has to be cleared on the failure path too, or one
        // broken assertion takes the rest of the file with it.
        jest.useRealTimers();
        await resolveDoubt(KEY, 'page-local');
      }
    });

    // The canceller is the caller saying it is done, which is not a loss.
    it('says nothing when the caller stops it', async () => {
      jest.useFakeTimers({ now: 0, advanceTimers: false });
      const lost = jest.fn();
      await acquire(KEY, A);
      keepAlive(KEY, A, lost)();
      jest.advanceTimersByTime(LEASE_TTL_MS * 4);
      expect(lost).not.toHaveBeenCalled();
    });

    // Renewal is the holder saying it is still working. Once it stops saying
    // so, expiry is what reclaims the lease of an instance that died.
    it('lets the lease expire once renewal stops', async () => {
      jest.useFakeTimers({ now: 0, advanceTimers: false });
      await acquire(KEY, A);
      const stop = keepAlive(KEY, A);
      jest.advanceTimersByTime(RENEW_INTERVAL_MS);
      stop();
      jest.advanceTimersByTime(LEASE_TTL_MS);
      expect(holder(KEY)).toBeUndefined();
      expect(await acquire(KEY, B)).toBe(true);
    });
  });

  describe('dispatch revalidation', () => {
    afterEach(() => jest.useRealTimers());

    it('starts the request while the browser mutex still covers the check', async () => {
      const calls: string[] = [];
      (navigator as unknown as { locks: unknown }).locks = {
        request: async (_name: string, body: () => unknown) => {
          calls.push('lock');
          const value = await body();
          calls.push('unlock');
          return value;
        },
      };
      await acquire(KEY, A);
      const result = await startWhileHeld(
        KEY,
        A,
        () => true,
        async () => {
          calls.push('send');
          return 'ok';
        }
      );
      expect(result).toEqual({ started: true, value: 'ok' });
      expect(calls.indexOf('send')).toBeLessThan(calls.lastIndexOf('unlock'));
    });

    it('refuses to resurrect a lease that expired before dispatch', async () => {
      await acquire(KEY, A, 1000);
      const send = jest.fn(async () => 'sent');
      expect(
        await startWhileHeld(KEY, A, () => true, send, 1000 + LEASE_TTL_MS)
      ).toEqual({ started: false });
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses when commit-time authorization changed its answer', async () => {
      await acquire(KEY, A);
      const authorize = jest.fn(() => false);
      const send = jest.fn(async () => 'sent');

      expect(await startWhileHeld(KEY, A, authorize, send)).toEqual({
        started: false,
      });
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses a group dispatch when any conflict key was lost', async () => {
      await acquire([KEY, OTHER_KEY], A);
      await release(OTHER_KEY, A);
      const send = jest.fn(async () => 'sent');

      expect(
        await startWhileHeld([KEY, OTHER_KEY], A, () => true, send)
      ).toEqual({ started: false });
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses dispatch when the reservation became quarantined', async () => {
      await acquire(KEY, A);
      await quarantine(KEY, { id: 'new-doubt', kind: 'modify' });
      const send = jest.fn(async () => 'sent');

      expect(await startWhileHeld(KEY, A, () => true, send)).toEqual({
        started: false,
      });
      expect(send).not.toHaveBeenCalled();
    });

    /*
     * The gate that is only reachable when the doubt could not be persisted.
     *
     * `quarantine()` normally evicts the holder's lease in the same critical
     * section, so the owner check a line below fires first and this one never
     * runs -- which is why deleting it left the whole suite green. When the
     * durable write fails the eviction never happens either: the doubt lives
     * only in this page, and a live lease then sits alongside a real doubt.
     * This check is the only thing between that pair and a dispatch.
     */
    it('refuses dispatch on a doubt that could not be persisted', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const realSet = kvdb.set.bind(kvdb);
      const set = jest.spyOn(kvdb, 'set').mockImplementation((key, value) => {
        if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
        realSet(key, value);
      });
      await acquire(KEY, A);
      const raised = await quarantine(KEY, {
        id: 'page-local-doubt',
        kind: 'modify',
      });
      expect(raised.durable).toBe(false);
      // The lease survived, because eviction shares the failed write's section.
      expect(holder(KEY)).toBe(A);

      const send = jest.fn(async () => 'sent');
      expect(await startWhileHeld(KEY, A, () => true, send)).toEqual({
        started: false,
      });
      expect(send).not.toHaveBeenCalled();

      set.mockRestore();
      await resolveDoubt(KEY, 'page-local-doubt');
    });

    it('checks expiry when the browser mutex is entered, not when queued', async () => {
      jest.useFakeTimers({ now: 1100, advanceTimers: false });
      await acquire(KEY, A, 1000);
      let enter = () => undefined;
      (navigator as unknown as { locks: unknown }).locks = {
        request: (_name: string, body: () => unknown) =>
          new Promise((resolve, reject) => {
            enter = () => {
              Promise.resolve().then(body).then(resolve, reject);
            };
          }),
      };
      const send = jest.fn(async () => 'sent');
      const pending = startWhileHeld(KEY, A, () => true, send);

      jest.setSystemTime(1000 + LEASE_TTL_MS);
      enter();

      await expect(pending).resolves.toEqual({ started: false });
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('exclusivity', () => {
    it('says when the browser cannot provide it', () => {
      expect(available()).toBe(false);
      installWebLocks();
      expect(available()).toBe(true);
    });

    /*
     * The finding this module exists for: without a mutex two tabs read the
     * same store, both write, and both believe they won -- and no amount of
     * re-publishing afterwards can unsend two requests already made.
     *
     * Asserted as "the browser's cross-context mutex is actually used", because
     * that is the part a unit test can prove. The race itself is between two
     * JavaScript contexts, and jsdom has one: two `acquire` calls here run
     * their synchronous bodies one after the other whatever this module does,
     * so a test written as two racing callers passes with the mutex removed.
     */
    it('serialises acquisition through the browser mutex', async () => {
      const request = jest.fn((_name: string, body: () => unknown) =>
        Promise.resolve(body())
      );
      (navigator as unknown as { locks: unknown }).locks = { request };
      await acquire(KEY, A);
      await release(KEY, A);
      expect(request).toHaveBeenCalledTimes(2);
      expect(
        request.mock.calls.every(([name]) => name === request.mock.calls[0]![0])
      ).toBe(true);
    });

    // Stated rather than hidden: without Web Locks this is the old behaviour,
    // and `available()` is what lets a caller report it.
    it('still acts when the browser has no mutex', async () => {
      expect(available()).toBe(false);
      expect(await acquire(KEY, A)).toBe(true);
      expect(await acquire(KEY, B)).toBe(false);
    });
  });
});
