import {
  DEFAULT_ACTIONS_PER_DAY,
  MAX_ACTIONS_PER_DAY,
  MIN_ACTIONS_PER_DAY,
} from '@/autopilot/autobook';
import { BookingLogEntry } from '@/contexts/AutopilotContext';
import { ParkTime } from '@/datetime';
import kvdb from '@/kvdb';
import { setTime } from '@/testing';

import {
  BUDGET_KEY,
  DEFAULT_SETTINGS,
  LOCKS_KEY,
  LOG_KEY,
  LOG_LIMIT,
  SETTINGS_KEY,
  loadBookingLog,
  loadBudget,
  loadLocks,
  loadSettings,
  sanitizeBudget,
  saveBookingLog,
  saveBudget,
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
    const entries: BookingLogEntry[] = [
      { name: 'A', at: at(9, 47), status: 'booked', returnTime: at(11) },
      {
        name: 'B',
        at: at(9, 48),
        status: 'modified',
        fromTime: at(19),
        returnTime: at(11, 20),
      },
      {
        name: 'C',
        at: at(9, 49),
        status: 'swapped',
        replacedName: 'D',
        fromTime: at(15),
        returnTime: at(12),
      },
      { name: 'E', at: at(9, 50), status: 'failed', detail: 'boom' },
      {
        name: 'F',
        at: at(9, 51),
        status: 'dry-run',
        detail: 'book',
        returnTime: at(11),
      },
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
  it('defaults to avoiding clashes, and only a literal false turns it off', () => {
    expect(DEFAULT_SETTINGS.avoidOverlaps).toBe(true);
    kvdb.set(SETTINGS_KEY, { avoidOverlaps: 0 });
    expect(loadSettings().avoidOverlaps).toBe(true);
    kvdb.set(SETTINGS_KEY, { avoidOverlaps: false });
    expect(loadSettings().avoidOverlaps).toBe(false);
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

describe('the day budget', () => {
  it('clamps a stored allowance into range on read', () => {
    expect(sanitizeBudget(12)).toBe(12);
    expect(sanitizeBudget(0)).toBe(MIN_ACTIONS_PER_DAY);
    expect(sanitizeBudget(9999)).toBe(MAX_ACTIONS_PER_DAY);
    expect(sanitizeBudget(7.8)).toBe(7);
    expect(sanitizeBudget('nonsense')).toBe(DEFAULT_ACTIONS_PER_DAY);
    expect(sanitizeBudget(undefined)).toBe(DEFAULT_ACTIONS_PER_DAY);
  });

  it('round-trips the day record', () => {
    saveBudget({ spent: 3, granted: 6 });
    expect(loadBudget()).toEqual({ spent: 3, granted: 6 });
  });

  it('starts clean when nothing is stored', () => {
    expect(loadBudget()).toEqual({ spent: 0, granted: 0 });
  });

  // `granted` adds to the ceiling and lives in localStorage, so leaving it
  // unbounded would let an edited value remove the limit entirely -- the exact
  // failure the ceiling exists to prevent.
  it('clamps a hand-edited refill total', () => {
    kvdb.setDaily(BUDGET_KEY, { spent: -5, granted: 100_000 });
    expect(loadBudget()).toEqual({ spent: 0, granted: MAX_ACTIONS_PER_DAY });
  });

  // Day-scoped through kvdb, so a new park day starts clean without anything
  // having to notice the rollover.
  it('ignores a record from another park day', () => {
    kvdb.set(BUDGET_KEY, {
      date: '2020-01-01',
      value: { spent: 9, granted: 3 },
    });
    expect(loadBudget()).toEqual({ spent: 0, granted: 0 });
  });
});

describe("the day's action locks", () => {
  it('starts empty', () => {
    expect(loadLocks()).toEqual([]);
  });

  it('round-trips a lock', () => {
    saveLocks(['book:A']);
    expect(loadLocks()).toEqual(['book:A']);
  });

  // The union is what stops a slower write from one instance dropping a lock
  // another instance took in the meantime.
  it('keeps a lock this writer does not hold', () => {
    saveLocks(['book:A']);
    saveLocks(['book:B']);
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
    saveLocks(['book:A', 'modify:B']);
    saveLocks(['modify:B'], ['book:A']);
    expect(loadLocks()).toEqual(['modify:B']);
  });

  it('removes a released lock the stored copy holds and this writer does not', () => {
    saveLocks(['book:A']);
    saveLocks([], ['book:A']);
    expect(loadLocks()).toEqual([]);
  });

  it('leaves other locks alone when one is released', () => {
    saveLocks(['book:A', 'book:B', 'swap:C']);
    saveLocks(['book:B', 'swap:C'], ['book:A']);
    expect(loadLocks().sort()).toEqual(['book:B', 'swap:C']);
  });

  // Re-locking wins over releasing in the same write. `markAttempted` clears
  // the key from the ledger's released set for this reason, so the two lists
  // cannot disagree in practice -- but the write must not resurrect a release
  // either way.
  it('drops a key that is both held and released', () => {
    saveLocks(['book:A'], ['book:A']);
    expect(loadLocks()).toEqual([]);
  });
});
