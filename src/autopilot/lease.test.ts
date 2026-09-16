import { modifyDate, parkDate } from '@/datetime';
import kvdb from '@/kvdb';

import {
  DOUBT_CONTRARY_READS,
  DOUBT_READ_SPACING_MS,
  DOUBT_SETTLE_MS,
  LEASE_KEY,
  LEASE_TTL_MS,
  MAX_RENEWAL_MS,
  QUARANTINE_KEY,
  RENEW_INTERVAL_MS,
  acquire,
  available,
  holder,
  keepAlive,
  leaseKey,
  quarantine,
  quarantinedAt,
  reconcile,
  release,
} from './lease';

const A = 'instance-a';
const B = 'instance-b';
// Derived rather than a fixture date. Doubts are pruned by the park day their
// key names, so a key hard-coded in the past expires the instant it is written
// and every quarantine test passes for the wrong reason.
const DATE = parkDate();
const KEY = leaseKey('80010114', DATE);

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
    const other = leaseKey('80010129', DATE);
    await acquire(KEY, A);
    expect(await acquire(other, B)).toBe(true);
    expect(holder(KEY)).toBe(A);
    expect(holder(other)).toBe(B);
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
    const SETTLED = RAISED + DOUBT_SETTLE_MS;
    const modifyDoubt = { kind: 'modify' as const, from: '19:00:00' };
    const swapDoubt = {
      kind: 'swap' as const,
      from: '19:00:00',
      gaining: '80010129',
    };
    /** What a plans read reporting nothing at all looks like. */
    const nothing = () => undefined;
    /** A read that started after the doubt was raised, as every real one does. */
    const read =
      (seen: (key: string) => string | undefined, at: number) => () =>
        reconcile(seen, at);

    it('refuses everyone, including the instance that raised it', async () => {
      await acquire(KEY, A);
      await quarantine(KEY, modifyDoubt, RAISED);
      await release(KEY, A);
      expect(await acquire(KEY, A)).toBe(false);
      expect(await acquire(KEY, B)).toBe(false);
    });

    it('does not expire the way a lease does', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      expect(await acquire(KEY, A, RAISED + LEASE_TTL_MS * 10)).toBe(false);
    });

    /*
     * Positive evidence settles it at once: the reservation is no longer where
     * it was, so the change landed. The *before* is what is recorded, not the
     * intended after -- Disney can answer a move with a different time than the
     * one asked for, so "it is where we wanted" is not a test that can be
     * relied on, while "it has moved" is.
     */
    it('clears as soon as a modified reservation has moved', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      await read(() => '11:00:00', 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(true);
    });

    /*
     * The reservation being missing is not the same evidence, and treating it
     * as though it were is how the protection cleared itself. A modify leaves
     * the reservation in place at a new time; a disappearance says the read is
     * incomplete -- and this codebase already knows a single plans response can
     * omit a reservation that is still there, which is why `CONFIRM_ABSENT_POLLS`
     * exists at all.
     */
    it('does not take a missing reservation as proof a move landed', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      await read(nothing, 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    /*
     * A swap does make the reservation disappear, so absence is consistent with
     * it -- and equally consistent with the swap never having happened. The
     * proof is the attraction it was for turning up in the slot instead.
     */
    it('clears a swap when the incoming attraction appears', async () => {
      await quarantine(KEY, swapDoubt, RAISED);
      await read(
        key => (key === leaseKey('80010129', DATE) ? '13:00:00' : undefined),
        2000
      )();
      expect(await acquire(KEY, A, 2000)).toBe(true);
    });

    it('does not clear a swap on the victim being gone alone', async () => {
      await quarantine(KEY, swapDoubt, RAISED);
      await read(nothing, 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    /*
     * One read is not enough to say it did *not* happen. This codebase already
     * demands two agreeing reads for the same question -- Disney's itinerary
     * lags, and a request that timed out on the client can still land after the
     * next read has started.
     */
    it('does not clear on a single read still showing the old time', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      await read(() => '19:00:00', SETTLED)();
      expect(await acquire(KEY, A, SETTLED)).toBe(false);
    });

    it('clears after enough separate reads keep saying nothing happened', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      for (let i = 0; i < DOUBT_CONTRARY_READS; ++i) {
        await read(() => '19:00:00', SETTLED + i * DOUBT_READ_SPACING_MS)();
      }
      const last = SETTLED + (DOUBT_CONTRARY_READS - 1) * DOUBT_READ_SPACING_MS;
      expect(await acquire(KEY, A, last)).toBe(true);
    });

    /*
     * Two reads have to be two *observations*. `fetchJson` hands concurrent
     * identical requests the same promise, so two `pollPlans()` calls in one
     * tick are one HTTP response -- and counting it twice let a single
     * observation satisfy a rule written to need two.
     */
    it('does not count two reads close enough together to be one response', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      await read(() => '19:00:00', SETTLED)();
      await read(() => '19:00:00', SETTLED + DOUBT_READ_SPACING_MS - 1)();
      expect(await acquire(KEY, A, SETTLED + DOUBT_READ_SPACING_MS - 1)).toBe(
        false
      );
    });

    // And absence of change is not evidence at all until the change has had
    // time to show up.
    it('ignores contrary reads taken before it could have appeared', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      for (let i = 0; i < DOUBT_CONTRARY_READS * 3; ++i) {
        await read(() => '19:00:00', 1500 + i)();
      }
      expect(await acquire(KEY, A, 1500)).toBe(false);
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
      await reconcile(() => '11:00:00', RAISED - 1);
      expect(await acquire(KEY, A, SETTLED)).toBe(false);
    });

    /*
     * The window is measured from when a read *started*, because that is all a
     * read can ever speak about. Gating it on the completion time collapsed the
     * whole rule: a response that took four minutes to arrive satisfied a
     * two-minute window while only ever having seen the world as it was when it
     * left. A slow read is not an old read.
     */
    it('measures the window from when a read started, not when it landed', async () => {
      await quarantine(KEY, modifyDoubt, RAISED);
      // Two reads that began moments after the doubt, whenever they arrived.
      await read(() => '19:00:00', RAISED + 10_000)();
      await read(() => '19:00:00', RAISED + 10_000 + DOUBT_READ_SPACING_MS)();
      expect(await acquire(KEY, A, RAISED + DOUBT_SETTLE_MS * 3)).toBe(false);
    });

    /*
     * The other half of the pair, and the half that still works when the offer
     * did not say where the reservation started. Seeing it at exactly the time
     * the request asked for is about as direct as evidence gets.
     */
    it('clears a modify sitting at the time the request asked for', async () => {
      await quarantine(KEY, { kind: 'modify', to: '11:00:00' }, RAISED);
      await read(() => '11:00:00', 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(true);
    });

    /*
     * And without a baseline the offer vouched for, "somewhere else" is not
     * evidence of anything. It was the caller's snapshot that used to fill that
     * gap, and a snapshot one move behind had an untouched reservation read as
     * proof the change had landed.
     */
    it('does not clear a modify with no baseline that is merely elsewhere', async () => {
      await quarantine(KEY, { kind: 'modify', to: '11:00:00' }, RAISED);
      await read(() => '17:00:00', 2000)();
      expect(await acquire(KEY, A, 2000)).toBe(false);
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
        { kind: 'modify', from: '19:00:00', to: '17:00:00' },
        RAISED + 1
      );
      // Answers the modify outright, and says nothing at all about the swap:
      // the attraction that one was for is nowhere in plans.
      await read(key => (key === KEY ? '17:00:00' : undefined), 2000)();
      expect(quarantinedAt(KEY)).toBe(RAISED);
      expect(await acquire(KEY, A, 2000)).toBe(false);
    });

    it('leaves other reservations alone', async () => {
      const other = leaseKey('80010129', DATE);
      await quarantine(KEY, modifyDoubt, RAISED);
      expect(await acquire(other, A)).toBe(true);
    });

    /*
     * Scoped to the reservation's own park day, not to the day it was raised.
     * Stored through `getDaily` it was scoped to *today*, so every doubt
     * vanished at the 4am rollover -- including one raised minutes before it,
     * whose settle window had not run, and every doubt about a future-dated
     * reservation, which is most of what this app books.
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
        value: { [KEY]: { at: RAISED, from: '19:00:00', contrary: 0 } },
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
        value: { [later]: { at: RAISED, from: '19:00:00', contrary: 0 } },
      });
      expect(quarantinedAt(later)).toBe(RAISED);
    });

    // Pruning is still the key's job, and the key names the reservation's day.
    it('prunes an old store by each reservation, not by the wrapper', async () => {
      const past = leaseKey('80010114', modifyDate(parkDate(), -3));
      kvdb.set(QUARANTINE_KEY, {
        date: modifyDate(parkDate(), -1),
        value: { [past]: { at: RAISED, from: '19:00:00', contrary: 0 } },
      });
      expect(quarantinedAt(past)).toBeUndefined();
    });

    it('drops a doubt whose park day is over', async () => {
      const past = leaseKey('80010114', modifyDate(DATE, -1));
      await quarantine(past, modifyDoubt, RAISED);
      expect(quarantinedAt(past)).toBeUndefined();
      expect(await acquire(past, A)).toBe(true);
    });
  });

  /*
   * The lease has to outlast the request, not the tick that started it.
   *
   * `TICK_DEADLINE_MS` abandons an overrunning tick without cancelling it, and
   * a response body that stops arriving has no bound of its own -- so a lease
   * acquired once and left to its TTL expired at 120 seconds under a request
   * still in the air, and the next actor took the reservation Disney was about
   * to change.
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
      jest.advanceTimersByTime(LEASE_TTL_MS + RENEW_INTERVAL_MS);
      expect(holder(KEY)).toBe(A);
      expect(await acquire(KEY, B)).toBe(false);
      stop();
    });

    /*
     * Renewal cannot go on forever, and the bound is not a detail. The poller
     * abandons a tick without cancelling it, sensor generation is awaited
     * outside any request timeout, and a promise that never settles never
     * reaches the cleanup that stops the timer -- so renewing unconditionally
     * turned one wedged request into a reservation held for the rest of the
     * day, with nothing on any screen saying why.
     */
    it('reports abandonment once an operation has run too long', async () => {
      jest.useFakeTimers({ now: 0, advanceTimers: false });
      const lost = jest.fn();
      await acquire(KEY, A);
      keepAlive(KEY, A, lost);
      jest.advanceTimersByTime(MAX_RENEWAL_MS - 1);
      expect(lost).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(lost).toHaveBeenCalledWith('abandoned');
      // And stops renewing, so the lease lapses the way it did before renewal.
      jest.advanceTimersByTime(LEASE_TTL_MS);
      expect(holder(KEY)).toBeUndefined();
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

    // The canceller is the caller saying it is done, which is not a loss.
    it('says nothing when the caller stops it', async () => {
      jest.useFakeTimers({ now: 0, advanceTimers: false });
      const lost = jest.fn();
      await acquire(KEY, A);
      keepAlive(KEY, A, lost)();
      jest.advanceTimersByTime(MAX_RENEWAL_MS * 2);
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
