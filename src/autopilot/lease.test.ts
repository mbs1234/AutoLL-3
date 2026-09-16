import kvdb from '@/kvdb';

import {
  DOUBT_CONTRARY_READS,
  DOUBT_SETTLE_MS,
  LEASE_KEY,
  LEASE_TTL_MS,
  acquire,
  available,
  holder,
  leaseKey,
  quarantine,
  reconcile,
  release,
} from './lease';

const A = 'instance-a';
const B = 'instance-b';
const KEY = leaseKey('80010114', '2021-10-01');

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
    const other = leaseKey('80010129', '2021-10-01');
    await acquire(KEY, A);
    expect(await acquire(other, B)).toBe(true);
    expect(holder(KEY)).toBe(A);
    expect(holder(other)).toBe(B);
  });

  // The same ride on two days is two reservations.
  it('keeps the same attraction on different days apart', async () => {
    const tomorrow = leaseKey('80010114', '2021-10-02');
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
    it('refuses everyone, including the instance that raised it', async () => {
      await acquire(KEY, A);
      await quarantine(KEY, {}, 1000);
      await release(KEY, A);
      expect(await acquire(KEY, A)).toBe(false);
      expect(await acquire(KEY, B)).toBe(false);
    });

    it('does not expire the way a lease does', async () => {
      await quarantine(KEY, {}, 1000);
      expect(await acquire(KEY, A, 1000 + LEASE_TTL_MS * 10)).toBe(false);
    });

    /*
     * Positive evidence settles it at once: the reservation is no longer where
     * it was, so the change landed. The *before* is what is recorded, not the
     * intended after -- Disney can answer a move with a different time than the
     * one asked for, so "it is where we wanted" is not a test that can be
     * relied on, while "it has moved" is.
     */
    it('clears as soon as the reservation has moved', async () => {
      await quarantine(KEY, { from: '19:00:00' }, 1000);
      await reconcile(() => '11:00:00', 2000);
      expect(await acquire(KEY, A, 2000)).toBe(true);
    });

    // For a swap, the reservation being gone says the same thing.
    it('clears when the reservation has gone from plans', async () => {
      await quarantine(KEY, { from: '19:00:00' }, 1000);
      await reconcile(() => undefined, 2000);
      expect(await acquire(KEY, A, 2000)).toBe(true);
    });

    /*
     * One read is not enough to say it did *not* happen. This codebase already
     * demands two agreeing reads for the same question -- Disney's itinerary
     * lags, and a request that timed out on the client can still land after the
     * next read has started.
     */
    it('does not clear on a single read still showing the old time', async () => {
      await quarantine(KEY, { from: '19:00:00' }, 1000);
      await reconcile(() => '19:00:00', 1000 + DOUBT_SETTLE_MS);
      expect(await acquire(KEY, A, 1000 + DOUBT_SETTLE_MS)).toBe(false);
    });

    it('clears after enough reads keep saying nothing happened', async () => {
      await quarantine(KEY, { from: '19:00:00' }, 1000);
      const settled = 1000 + DOUBT_SETTLE_MS;
      for (let i = 0; i < DOUBT_CONTRARY_READS; ++i) {
        await reconcile(() => '19:00:00', settled);
      }
      expect(await acquire(KEY, A, settled)).toBe(true);
    });

    // And absence of change is not evidence at all until the change has had
    // time to show up.
    it('ignores contrary reads taken before it could have appeared', async () => {
      await quarantine(KEY, { from: '19:00:00' }, 1000);
      for (let i = 0; i < DOUBT_CONTRARY_READS * 3; ++i) {
        await reconcile(() => '19:00:00', 1500);
      }
      expect(await acquire(KEY, A, 1500)).toBe(false);
    });

    it('leaves other reservations alone', async () => {
      const other = leaseKey('80010129', '2021-10-01');
      await quarantine(KEY, {}, 1000);
      expect(await acquire(other, A)).toBe(true);
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
