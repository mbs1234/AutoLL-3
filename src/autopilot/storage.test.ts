import '@/autopilot/autobook';
import { BookingLogEntry } from '@/contexts/AutopilotContext';
import { ParkTime, parkDate } from '@/datetime';
import kvdb from '@/kvdb';
import { setTime } from '@/testing';

import {
  COMMITS_KEY,
  COMMIT_TTL_MS,
  DEFAULT_SETTINGS,
  LOCKS_KEY,
  LOG_KEY,
  LOG_LIMIT,
  SETTINGS_KEY,
  activeCommits,
  clearCommit,
  holdsLock,
  loadBookingLog,
  loadCommits,
  loadLocks,
  loadSettings,
  saveBookingLog,
  saveCommit,
  saveLocks,
  saveSettings,
} from './storage';

setTime('09:00');

const at = (h: number, m = 0) => new ParkTime(h, m);

beforeEach(() => localStorage.clear());

describe('booking log persistence', () => {
  it('starts empty', () => {
    expect(loadBookingLog()).toEqual([]);
  });

  it('round-trips every entry shape', () => {
    // Newest first, as the provider builds it: `addLogEntry` prepends, and the
    // store now orders by time before applying the cap so a stale writer
    // cannot decide which rows survive by writing last.
    const entries: BookingLogEntry[] = [
      {
        name: 'F',
        at: at(9, 51),
        status: 'dry-run',
        detail: 'book',
        returnTime: at(11),
        reason: 'rehearsed, nothing committed',
      },
      { name: 'E', at: at(9, 50), status: 'failed', detail: 'boom' },
      {
        name: 'C',
        at: at(9, 49),
        status: 'swapped',
        replacedName: 'D',
        fromTime: at(15),
        returnTime: at(12),
      },
      {
        name: 'B',
        at: at(9, 48),
        status: 'modified',
        fromTime: at(19),
        returnTime: at(11, 20),
      },
      { name: 'A', at: at(9, 47), status: 'booked', returnTime: at(11) },
    ];
    saveBookingLog(entries);
    expect(loadBookingLog()).toEqual(entries);
  });

  it('caps what it stores', () => {
    const entries: BookingLogEntry[] = Array.from(
      { length: LOG_LIMIT + 5 },
      (_, i) => ({ name: `R${i}`, at: at(9, i), status: 'booked' as const })
    );
    saveBookingLog(entries);
    expect(loadBookingLog()).toHaveLength(LOG_LIMIT);
  });

  // Yesterday's bookings are not useful on a new park day.
  it('is scoped to the park day', () => {
    saveBookingLog([{ name: 'A', at: at(9), status: 'booked' }]);
    expect(loadBookingLog()).toHaveLength(1);
    // Cross into the next park day (which begins at 4am).
    setTime('05:00');
    jest.setSystemTime(new Date(Date.now() + 24 * 60 * 60_000));
    expect(loadBookingLog()).toEqual([]);
    setTime('09:00');
  });

  it('drops malformed entries and keeps the rest', () => {
    kvdb.setDaily(LOG_KEY, [
      { name: 'ok', at: '09:00:00', status: 'booked' },
      { name: 'bad-time', at: 'nope', status: 'booked' },
      { name: 'bad-status', at: '09:00:00', status: 'exploded' },
      { at: '09:00:00', status: 'booked' },
      { name: 'bad-return', at: '09:00:00', status: 'booked', returnTime: 'x' },
    ]);
    expect(loadBookingLog()).toEqual([
      { name: 'ok', at: at(9), status: 'booked' },
      { name: 'bad-return', at: at(9), status: 'booked' },
    ]);
  });

  it('returns empty for a non-array value', () => {
    kvdb.setDaily(LOG_KEY, { nope: true });
    expect(loadBookingLog()).toEqual([]);
  });
});

describe('booking log merging', () => {
  // NextLL nests an AutopilotProvider inside the app's own, so there are
  // routinely two instances holding two copies of the day's log. The write used
  // to be wholesale from state loaded at mount, so whichever screen wrote last
  // erased the other's record of a real booking.
  it("keeps an entry this writer's copy never had", () => {
    saveBookingLog([{ name: 'From NextLL', at: at(10, 5), status: 'booked' }]);
    saveBookingLog([{ name: 'From the app', at: at(10), status: 'booked' }]);
    expect(
      loadBookingLog()
        .map(e => e.name)
        .sort()
    ).toEqual(['From NextLL', 'From the app']);
  });

  it('does not duplicate an entry both copies hold', () => {
    const shared = { name: 'Shared', at: at(10), status: 'booked' as const };
    saveBookingLog([shared]);
    saveBookingLog([shared]);
    expect(loadBookingLog()).toEqual([shared]);
  });

  it("preserves the caller's order and appends the rest", () => {
    saveBookingLog([{ name: 'Other', at: at(9), status: 'booked' }]);
    saveBookingLog([
      { name: 'Mine newest', at: at(11), status: 'booked' },
      { name: 'Mine older', at: at(10), status: 'booked' },
    ]);
    expect(loadBookingLog().map(e => e.name)).toEqual([
      'Mine newest',
      'Mine older',
      'Other',
    ]);
  });

  it('still caps the stored log', () => {
    saveBookingLog(
      Array.from({ length: LOG_LIMIT + 10 }, (_, i) => ({
        name: `Ride ${i}`,
        at: at(9, i),
        status: 'booked' as const,
      }))
    );
    expect(loadBookingLog()).toHaveLength(LOG_LIMIT);
  });

  /*
   * The flood. `addLogEntry` collapses a refusal burst into one row carrying a
   * count and the time of the *most recent* occurrence -- so with the time in
   * the merge key every rewrite of that row looked like a new event, the stored
   * copy was kept as well, and the twenty rows became twenty copies of one
   * error inside half a minute. The day's real bookings went with them.
   */
  it('does not append a new row each time a repeat count climbs', () => {
    const booking = { name: 'Slinky', at: at(9), status: 'booked' as const };
    saveBookingLog([booking]);
    for (let n = 1; n <= 12; ++n) {
      saveBookingLog([
        {
          name: 'A',
          at: at(10, n),
          status: 'failed',
          detail: 'boom',
          repeated: n,
        },
        booking,
      ]);
    }
    const stored = loadBookingLog();
    expect(stored.filter(e => e.status === 'failed')).toHaveLength(1);
    expect(stored[0]?.repeated).toBe(12);
    // The point of the cap: the day's real booking survives the burst.
    expect(stored.map(e => e.name)).toContain('Slinky');
  });

  // The merge key ignores the time for a failure, so it must still tell two
  // genuine failures apart -- by attraction, and by what went wrong.
  it('still separates failures on different attractions and details', () => {
    saveBookingLog([
      { name: 'A', at: at(10), status: 'failed', detail: 'boom' },
    ]);
    saveBookingLog([
      { name: 'B', at: at(10, 1), status: 'failed', detail: 'boom' },
    ]);
    saveBookingLog([
      { name: 'A', at: at(10, 2), status: 'failed', detail: 'different' },
    ]);
    expect(loadBookingLog()).toHaveLength(3);
  });

  it('round-trips a repeat count', () => {
    saveBookingLog([
      { name: 'A', at: at(10), status: 'failed', detail: 'boom', repeated: 7 },
    ]);
    expect(loadBookingLog()[0]?.repeated).toBe(7);
  });

  it('ignores a repeat count of one or less', () => {
    saveBookingLog([
      { name: 'A', at: at(10), status: 'failed', detail: 'boom', repeated: 1 },
    ]);
    expect(loadBookingLog()[0]?.repeated).toBeUndefined();
  });
});

describe('settings persistence', () => {
  it('defaults to booking for whoever is eligible', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.requireWholeParty).toBe(false);
  });

  it('round-trips', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      requireWholeParty: true,
      dryRun: true,
    });
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      requireWholeParty: true,
      dryRun: true,
    });
  });

  it('defaults dry run to off', () => {
    expect(DEFAULT_SETTINGS.dryRun).toBe(false);
  });

  // The opposite default to the other two, and so the opposite parse: this one
  // costs a wasted slot when wrongly off, not a booking when wrongly on.
  // Changed in 2026-09 from defaulting on. Both halves have to agree: while
  // `loadSettings` read this as `!== false`, absence meant on no matter what
  // DEFAULT_SETTINGS said, so a flip of one alone would have been a no-op that
  // still read as a deliberate change in the diff.
  it('defaults to allowing clashes, and only a literal true avoids them', () => {
    expect(DEFAULT_SETTINGS.avoidOverlaps).toBe(false);
    expect(loadSettings().avoidOverlaps).toBe(false);
    kvdb.set(SETTINGS_KEY, { avoidOverlaps: 1 });
    expect(loadSettings().avoidOverlaps).toBe(false);
    kvdb.set(SETTINGS_KEY, { avoidOverlaps: true });
    expect(loadSettings().avoidOverlaps).toBe(true);
  });

  // A phone that has already saved this setting keeps what it saved. The
  // provider persists settings in an effect that runs on mount, so almost
  // every existing install has a value stored whether or not anyone chose it
  // -- and a new default must not reach in and change one.
  it('leaves an already-stored preference alone', () => {
    kvdb.set(SETTINGS_KEY, { avoidOverlaps: true });
    expect(loadSettings().avoidOverlaps).toBe(true);
  });

  it('treats a non-boolean dry-run value as off', () => {
    kvdb.set(SETTINGS_KEY, { dryRun: 1 });
    expect(loadSettings().dryRun).toBe(false);
  });

  // Guessing wrong here means booking for a subset when the user asked never
  // to, so only a literal true counts.
  it('treats a non-boolean stored value as off', () => {
    kvdb.set(SETTINGS_KEY, { requireWholeParty: 'yes' });
    expect(loadSettings().requireWholeParty).toBe(false);
  });

  it('survives garbage', () => {
    kvdb.set(SETTINGS_KEY, 'not an object');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

const OWNER = 'owner-a';
const OTHER = 'owner-b';

describe("the day's action locks", () => {
  it('starts empty', () => {
    expect(loadLocks()).toEqual([]);
  });

  it('round-trips a lock', () => {
    saveLocks(OWNER, ['book:A']);
    expect(loadLocks()).toEqual(['book:A']);
  });

  // The union is what stops a slower write from one instance dropping a lock
  // another instance took in the meantime.
  it('keeps a lock this writer does not hold', () => {
    saveLocks(OWNER, ['book:A']);
    saveLocks(OWNER, ['book:B']);
    expect(loadLocks().sort()).toEqual(['book:A', 'book:B']);
  });

  it('discards a non-array and a non-string entry', () => {
    kvdb.setDaily(LOCKS_KEY, 'nonsense');
    expect(loadLocks()).toEqual([]);
    kvdb.setDaily(LOCKS_KEY, ['book:A', 7, null, 'modify:B']);
    expect(loadLocks()).toEqual(['book:A', 'modify:B']);
  });

  it('ignores locks from another park day', () => {
    kvdb.set(LOCKS_KEY, { date: '2020-01-01', value: ['book:A'] });
    expect(loadLocks()).toEqual([]);
  });

  // The regression. Until `remove` existed the write was the union alone, so a
  // release could never be recorded: the key came straight back on the next
  // read and autopilot refused to act on that attraction for the rest of the
  // day. Cancel a Lightning Lane by hand and the earlier one that drops an
  // hour later would never be taken.
  it('removes a released lock instead of preserving it', () => {
    saveLocks(OWNER, ['book:A', 'modify:B']);
    saveLocks(OWNER, ['modify:B'], ['book:A']);
    expect(loadLocks()).toEqual(['modify:B']);
  });

  it('removes a released lock the stored copy holds and this writer does not', () => {
    saveLocks(OWNER, ['book:A']);
    saveLocks(OWNER, [], ['book:A']);
    expect(loadLocks()).toEqual([]);
  });

  it('leaves other locks alone when one is released', () => {
    saveLocks(OWNER, ['book:A', 'book:B', 'swap:C']);
    saveLocks(OWNER, ['book:B', 'swap:C'], ['book:A']);
    expect(loadLocks().sort()).toEqual(['book:B', 'swap:C']);
  });

  // Re-locking wins over releasing in the same write. `markAttempted` clears
  // the key from the ledger's released set for this reason, so the two lists
  // cannot disagree in practice -- but the write must not resurrect a release
  // either way.
  it('drops a key that is both held and released', () => {
    saveLocks(OWNER, ['book:A'], ['book:A']);
    expect(loadLocks()).toEqual([]);
  });

  /*
   * A release only takes effect for the instance holding the lock.
   *
   * Without this, an instance that had adopted a lock from the day's copy and
   * later gave it back was withdrawing somebody else's protection rather than
   * its own -- so the engine that was mid-action on that reservation lost the
   * one thing stopping a second engine acting on it too.
   */
  it('ignores a release from an instance that does not hold the lock', () => {
    saveLocks(OWNER, ['modify:A']);
    saveLocks(OTHER, [], ['modify:A']);
    expect(loadLocks()).toEqual(['modify:A']);
  });

  it('lets the holder release its own lock', () => {
    saveLocks(OWNER, ['modify:A']);
    saveLocks(OWNER, [], ['modify:A']);
    expect(loadLocks()).toEqual([]);
  });

  // Re-publishing never takes a lock away from the instance that holds it:
  // each writer only ever sends the keys it owns.
  it('keeps each lock against the instance that took it', () => {
    saveLocks(OWNER, ['modify:A']);
    saveLocks(OTHER, ['modify:B']);
    expect(holdsLock('modify:A', OWNER)).toBe(true);
    expect(holdsLock('modify:B', OTHER)).toBe(true);
    expect(holdsLock('modify:A', OTHER)).toBe(false);
  });

  // The shape before owners existed. Nobody can release those, which is the
  // safe reading; they age out with the park day.
  it('treats a lock stored without an owner as no one to release it', () => {
    kvdb.setDaily(LOCKS_KEY, ['book:A']);
    expect(loadLocks()).toEqual(['book:A']);
    saveLocks(OWNER, [], ['book:A']);
    expect(loadLocks()).toEqual(['book:A']);
  });

  /**
   * A characterisation guard, not a behaviour change: this passes on the build
   * before action locks carried a booking date as much as on the one after.
   *
   * It is here because that is the whole reason the key could gain a date with
   * no storage migration a week before a freeze. Keys are opaque strings to
   * this file and the stored string is the identity -- so a future edit that
   * starts parsing or rewriting one on the way in would desync the owner-scoped
   * removal above, and this is what would say so.
   */
  it('round-trips a dated key byte for byte', () => {
    const key = '2026-10-18:book:80010114';
    saveLocks(OWNER, [key]);
    expect(loadLocks()).toEqual([key]);
    expect(holdsLock(key, OWNER)).toBe(true);
    saveLocks(OWNER, [], [key]);
    expect(loadLocks()).toEqual([]);
  });
});

describe("the day's committed return times", () => {
  it('starts empty', () => {
    expect(loadCommits()).toEqual([]);
  });

  it('round-trips a commit', () => {
    saveCommit({ facilityId: 'a', time: '16:10:00' });
    expect(loadCommits()).toEqual([
      { facilityId: 'a', time: '16:10:00', at: expect.any(Number) },
    ]);
  });

  // The stamp is what bounds a commit's reach: without it a move's or a swap's
  // record sat in this list all day, blocking return times around a
  // reservation the party no longer held.
  it('stamps a commit with the time it was written', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    saveCommit({ facilityId: 'a', time: '16:10:00' });
    expect(loadCommits()[0]?.at).toBe(1_000_000);
  });

  it('counts a fresh commit as active', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    saveCommit({ facilityId: 'a', time: '16:10:00' });
    expect(activeCommits(1_000_000 + COMMIT_TTL_MS - 1)).toHaveLength(1);
  });

  it('stops believing one past its lifetime', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    saveCommit({ facilityId: 'a', time: '16:10:00' });
    expect(activeCommits(1_000_000 + COMMIT_TTL_MS)).toEqual([]);
  });

  // A record an older build wrote carries no stamp, so its age cannot be
  // known. Believing it for the rest of the day is the failure this replaces.
  it('does not believe an unstamped record', () => {
    kvdb.setDaily(COMMITS_KEY, [{ facilityId: 'a', time: '16:10:00' }]);
    expect(loadCommits()).toHaveLength(1);
    expect(activeCommits()).toEqual([]);
  });

  it('keeps commits for other attractions', () => {
    saveCommit({ facilityId: 'a', time: '16:10:00' });
    saveCommit({ facilityId: 'b', time: '11:00:00' });
    expect(
      loadCommits()
        .map(c => c.facilityId)
        .sort()
    ).toEqual(['a', 'b']);
  });

  // Legacy records have no reservation identity, so facility/date is the only
  // replacement key available for them.
  it('replaces an earlier legacy commit for the same attraction', () => {
    saveCommit({ facilityId: 'a', time: '16:10:00' });
    saveCommit({ facilityId: 'a', time: '13:15:00' });
    expect(loadCommits()).toEqual([
      { facilityId: 'a', time: '13:15:00', at: expect.any(Number) },
    ]);
  });

  it('keeps split-party commits for the same attraction separate', () => {
    saveCommit({
      facilityId: 'a',
      time: '16:10:00',
      reservationIds: ['ent-1'],
    });
    saveCommit({
      facilityId: 'a',
      time: '13:15:00',
      reservationIds: ['ent-2'],
    });
    expect(loadCommits()).toHaveLength(2);
  });

  it('replaces only the matching split-party commit', () => {
    saveCommit({
      facilityId: 'a',
      time: '16:10:00',
      reservationIds: ['ent-1'],
    });
    saveCommit({
      facilityId: 'a',
      time: '13:15:00',
      reservationIds: ['ent-2'],
    });
    saveCommit({
      facilityId: 'a',
      time: '12:05:00',
      reservationIds: ['ent-1'],
    });
    expect(loadCommits()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          time: '13:15:00',
          reservationIds: ['ent-2'],
        }),
        expect.objectContaining({
          time: '12:05:00',
          reservationIds: ['ent-1'],
        }),
      ])
    );
    expect(loadCommits()).toHaveLength(2);
  });

  it('clears only the matching split-party commit', () => {
    saveCommit({
      facilityId: 'a',
      time: '16:10:00',
      reservationIds: ['ent-1'],
    });
    saveCommit({
      facilityId: 'a',
      time: '13:15:00',
      reservationIds: ['ent-2'],
    });
    clearCommit('a', parkDate(), ['ent-1']);
    expect(loadCommits()).toEqual([
      expect.objectContaining({
        facilityId: 'a',
        time: '13:15:00',
        reservationIds: ['ent-2'],
      }),
    ]);
  });

  it('forgets one that plans show is gone', () => {
    saveCommit({ facilityId: 'a', time: '16:10:00' });
    saveCommit({ facilityId: 'b', time: '11:00:00' });
    clearCommit('a');
    expect(loadCommits()).toEqual([
      { facilityId: 'b', time: '11:00:00', at: expect.any(Number) },
    ]);
  });

  it('discards malformed entries', () => {
    kvdb.setDaily(COMMITS_KEY, [
      { facilityId: 'a', time: '16:10:00' },
      { facilityId: 'b' },
      'nonsense',
      null,
    ]);
    expect(loadCommits()).toEqual([{ facilityId: 'a', time: '16:10:00' }]);
  });

  it('ignores commits from another park day', () => {
    kvdb.set(COMMITS_KEY, {
      date: '2020-01-01',
      value: [{ facilityId: 'a', time: '16:10:00' }],
    });
    expect(loadCommits()).toEqual([]);
  });
});
