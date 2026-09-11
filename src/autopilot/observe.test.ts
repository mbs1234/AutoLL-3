import { Experience } from '@/api/ll';
import { ParkTime } from '@/datetime';
import kvdb from '@/kvdb';

import {
  COVERAGE_KEY,
  Coverage,
  DropEvent,
  EARLIER_THRESHOLD_MIN,
  EVENTS_KEY,
  MAX_COVERAGE_DAYS,
  MAX_EVENTS,
  SNAPSHOT_STALE_MS,
  Snapshot,
  appendDropEvents,
  baselineUsable,
  coverageBucket,
  coverageDate,
  coverageKey,
  dayMinutes,
  detectDropEvents,
  detectReopenings,
  fromDayMinutes,
  loadCoverage,
  loadDropEvents,
  recordCoverage,
  recordWatched,
  saveCoverage,
  snapshotOf,
  summarizeDrops,
} from './observe';
import { BACKOFF_CAP_MS, IDLE_INTERVAL_MS } from './schedule';

const at = (h: number, m = 0) => new ParkTime(h, m);
const D1 = '2026-09-01';
const D2 = '2026-09-02';
const D3 = '2026-09-03';

const snap = (
  entries: [
    string,
    {
      available: boolean;
      next?: ParkTime;
      refillWindows?: { start: ParkTime; end: ParkTime }[];
    },
  ][]
): Snapshot => new Map(entries);

const exp = (id: string, flex?: Experience['flex']) =>
  ({ id, name: id, flex }) as Experience;

beforeEach(() => localStorage.clear());

describe('day minutes', () => {
  it('measures from the 4am park-day start', () => {
    expect(dayMinutes(at(4))).toBe(0);
    expect(dayMinutes(at(9, 47))).toBe(5 * 60 + 47);
  });

  // An after-midnight time is late in the park day, not early.
  it('orders after-midnight times after evening ones', () => {
    expect(dayMinutes(at(0, 30))).toBeGreaterThan(dayMinutes(at(23)));
  });

  it('round-trips through fromDayMinutes', () => {
    for (const t of [
      at(4),
      at(9, 47),
      at(15, 47),
      at(23, 59),
      at(0, 30),
      at(3, 59),
    ]) {
      expect(fromDayMinutes(dayMinutes(t))).toEqual(t);
    }
  });
});

describe('detectReopenings()', () => {
  it('reports watched attractions whose standby queue comes back', () => {
    expect(
      detectReopenings(
        new Map([['a', { available: false, temporarilyDown: true }]]),
        new Map([
          ['a', { available: false, standbyOpen: true }],
          ['b', { available: true, standbyOpen: true }],
        ]),
        new Set(['a'])
      )
    ).toEqual(['a']);
  });

  // Leaving TEMPORARILY_DOWN is not the same as coming back: the reason can
  // become CLOSED at the end of the night, or NOT_STANDBY_ENABLED, and the
  // flag clears either way. Alerting there says a ride is back up when it has
  // in fact shut for the day.
  it('does not report a ride that closed rather than reopened', () => {
    expect(
      detectReopenings(
        new Map([['a', { available: false, temporarilyDown: true }]]),
        new Map([['a', { available: false, standbyOpen: false }]]),
        new Set(['a'])
      )
    ).toEqual([]);
  });

  it('does not report an unwatched or baseline attraction', () => {
    expect(
      detectReopenings(
        new Map(),
        new Map([['a', { available: true }]]),
        new Set(['a'])
      )
    ).toEqual([]);
  });
});

describe('snapshotOf()', () => {
  it('records availability and next time for Multi Pass attractions', () => {
    const s = snapshotOf([
      exp('a', { available: true, nextAvailableTime: at(11) }),
      exp('b', { available: false }),
    ]);
    expect(s.get('a')).toEqual({
      available: true,
      next: at(11),
      standbyOpen: false,
    });
    expect(s.get('b')).toEqual({
      available: false,
      next: undefined,
      standbyOpen: false,
    });
  });

  it('ignores attractions with no flex offer at all', () => {
    expect(snapshotOf([exp('show')]).size).toBe(0);
  });
});

describe('detectDropEvents()', () => {
  const now = at(9, 47);

  it('records an attraction becoming available', () => {
    const events = detectDropEvents(
      snap([['a', { available: false }]]),
      snap([['a', { available: true, next: at(10) }]]),
      now,
      D1
    );
    expect(events).toEqual([
      { experienceId: 'a', date: D1, time: '09:47', kind: 'appeared' },
    ]);
  });

  // New inventory pushes the earliest offered time backward even when the
  // attraction was already available.
  it('records the next time jumping meaningfully earlier', () => {
    const events = detectDropEvents(
      snap([['a', { available: true, next: at(18) }]]),
      snap([['a', { available: true, next: at(11) }]]),
      now,
      D1
    );
    expect(events).toEqual([
      { experienceId: 'a', date: D1, time: '09:47', kind: 'earlier' },
    ]);
  });

  it('ignores a small earlier shift', () => {
    const before = at(18);
    const after = before.add({ minutes: -(EARLIER_THRESHOLD_MIN - 1) });
    const events = detectDropEvents(
      snap([['a', { available: true, next: before }]]),
      snap([['a', { available: true, next: after }]]),
      now,
      D1
    );
    expect(events).toEqual([]);
  });

  it('treats exactly the threshold as a drop', () => {
    const before = at(18);
    const after = before.add({ minutes: -EARLIER_THRESHOLD_MIN });
    expect(
      detectDropEvents(
        snap([['a', { available: true, next: before }]]),
        snap([['a', { available: true, next: after }]]),
        now,
        D1
      )
    ).toHaveLength(1);
  });

  // Inventory being taken moves the time later; that is not a drop.
  it('ignores the next time moving later', () => {
    expect(
      detectDropEvents(
        snap([['a', { available: true, next: at(11) }]]),
        snap([['a', { available: true, next: at(18) }]]),
        now,
        D1
      )
    ).toEqual([]);
  });

  it('ignores an attraction that stays unavailable', () => {
    expect(
      detectDropEvents(
        snap([['a', { available: false }]]),
        snap([['a', { available: false }]]),
        now,
        D1
      )
    ).toEqual([]);
  });

  // The first poll of a session sees everything as new; that is a baseline,
  // not a drop.
  it('ignores attractions with no baseline', () => {
    expect(
      detectDropEvents(
        snap([]),
        snap([['a', { available: true, next: at(10) }]]),
        now,
        D1
      )
    ).toEqual([]);
  });

  it('handles several attractions in one tick', () => {
    const events = detectDropEvents(
      snap([
        ['a', { available: false }],
        ['b', { available: true, next: at(18) }],
        ['c', { available: true, next: at(12) }],
      ]),
      snap([
        ['a', { available: true, next: at(10) }],
        ['b', { available: true, next: at(11) }],
        ['c', { available: true, next: at(12) }],
      ]),
      now,
      D1
    );
    expect(events.map(e => `${e.experienceId}:${e.kind}`).sort()).toEqual([
      'a:appeared',
      'b:earlier',
    ]);
  });

  it('pads the time to HH:MM', () => {
    const [e] = detectDropEvents(
      snap([['a', { available: false }]]),
      snap([['a', { available: true, next: at(10) }]]),
      at(8, 5),
      D1
    );
    expect(e!.time).toBe('08:05');
  });
});

describe('coverage', () => {
  it('buckets time into 5-minute slots', () => {
    expect(coverageBucket(at(4))).toBe(0);
    expect(coverageBucket(at(4, 4))).toBe(0);
    expect(coverageBucket(at(4, 5))).toBe(1);
  });

  it('records a new bucket and reports the change', () => {
    const r = recordCoverage({}, D1, at(9, 47));
    expect(r.changed).toBe(true);
    expect(r.coverage[D1]).toEqual([coverageBucket(at(9, 47))]);
  });

  // The overwhelmingly common tick adds nothing; callers skip the save.
  it('reports no change for an already-covered bucket', () => {
    const first = recordCoverage({}, D1, at(9, 47)).coverage;
    const r = recordCoverage(first, D1, at(9, 48));
    expect(r.changed).toBe(false);
    expect(r.coverage).toBe(first);
  });

  it('keeps buckets sorted', () => {
    let c = recordCoverage({}, D1, at(15)).coverage;
    c = recordCoverage(c, D1, at(9)).coverage;
    expect(c[D1]).toEqual([...c[D1]!].sort((a, b) => a - b));
  });

  it('prunes to the most recent days', () => {
    let c: Coverage = {};
    for (let i = 0; i < MAX_COVERAGE_DAYS + 3; ++i) {
      const day = String(i + 1).padStart(2, '0');
      c = recordCoverage(c, `2026-08-${day}`, at(9)).coverage;
    }
    const dates = Object.keys(c).sort();
    expect(dates).toHaveLength(MAX_COVERAGE_DAYS);
    expect(dates[0]).toBe('2026-08-04');
  });
});

describe('summarizeDrops()', () => {
  const ev = (
    experienceId: string,
    date: string,
    time: string,
    kind: DropEvent['kind'] = 'appeared'
  ): DropEvent => ({ experienceId, date, time, kind });

  // Observers logging :48 for a :47 drop is the expected poll lag, so the two
  // are one drop, labelled by the earliest minute.
  it('clusters observations within tolerance under the earliest minute', () => {
    const [s] = summarizeDrops(
      [ev('a', D1, '09:47'), ev('a', D2, '09:48'), ev('a', D3, '09:47')],
      {},
      new Map()
    );
    expect(s!.observed).toEqual([{ time: at(9, 47), days: 3, count: 3 }]);
  });

  it('keeps distinct drops apart', () => {
    const [s] = summarizeDrops(
      [ev('a', D1, '09:47'), ev('a', D1, '11:47'), ev('a', D2, '11:48')],
      {},
      new Map()
    );
    expect(s!.observed.map(o => [String(o.time), o.days])).toEqual([
      ['09:47:00', 1],
      ['11:47:00', 2],
    ]);
  });

  it('counts distinct days, not events', () => {
    const [s] = summarizeDrops(
      [ev('a', D1, '09:47'), ev('a', D1, '09:47', 'earlier')],
      {},
      new Map()
    );
    expect(s!.observed[0]).toEqual({ time: at(9, 47), days: 1, count: 2 });
  });

  it('checks each scheduled time against observations and coverage', () => {
    const coverage: Coverage = {
      [D1]: [coverageBucket(at(9, 47)), coverageBucket(at(15, 47))],
      [D2]: [coverageBucket(at(9, 47))],
      [D3]: [coverageBucket(at(15, 47))],
    };
    const [s] = summarizeDrops(
      [ev('a', D1, '09:48'), ev('a', D2, '09:47')],
      coverage,
      new Map([['a', [at(9, 47), at(15, 47)]]]),
      undefined,
      // Coverage says the poller was looking; this says what it was looking at.
      { [D1]: ['a'], [D2]: ['a'], [D3]: ['a'] }
    );
    expect(s!.scheduled).toEqual([
      { time: at(9, 47), observedDays: 2, coveredDays: 2 },
      // Watched on two days at 15:47 and never seen: real evidence.
      { time: at(15, 47), observedDays: 0, coveredDays: 2 },
    ]);
  });

  // Absence is only evidence when the poller was actually watching.
  it('reports zero covered days for a time never watched', () => {
    const [s] = summarizeDrops(
      [],
      { [D1]: [coverageBucket(at(9))] },
      new Map([['a', [at(15, 47)]]])
    );
    expect(s!.scheduled[0]).toEqual({
      time: at(15, 47),
      observedDays: 0,
      coveredDays: 0,
    });
  });

  it('does not count coverage recorded for a different park', () => {
    const [s] = summarizeDrops(
      [],
      {
        [coverageKey('epcot', D1)]: [coverageBucket(at(9, 47))],
        [coverageKey('mk', D2)]: [coverageBucket(at(9, 47))],
      },
      new Map([['a', [at(9, 47)]]]),
      'mk',
      { [coverageKey('epcot', D1)]: ['a'], [coverageKey('mk', D2)]: ['a'] }
    );
    expect(s!.scheduled[0]).toMatchObject({ coveredDays: 1 });
  });

  it('reports attractions that drop on no written schedule', () => {
    const [s] = summarizeDrops([ev('mystery', D1, '13:17')], {}, new Map());
    expect(s!.experienceId).toBe('mystery');
    expect(s!.observed).toHaveLength(1);
    expect(s!.scheduled).toEqual([]);
  });

  it('skips events with unparseable times', () => {
    const [s] = summarizeDrops(
      [ev('a', D1, 'nope'), ev('a', D1, '09:47')],
      {},
      new Map()
    );
    expect(s!.observed).toHaveLength(1);
  });

  it('returns nothing for no data', () => {
    expect(summarizeDrops([], {}, new Map())).toEqual([]);
  });
});

describe('storage', () => {
  it('starts empty', () => {
    expect(loadDropEvents()).toEqual([]);
    expect(loadCoverage()).toEqual({});
  });

  it('appends and returns the full list', () => {
    const e1 = {
      experienceId: 'a',
      date: D1,
      time: '09:47',
      kind: 'appeared' as const,
    };
    const e2 = {
      experienceId: 'b',
      date: D1,
      time: '09:48',
      kind: 'earlier' as const,
    };
    appendDropEvents([e1]);
    expect(appendDropEvents([e2])).toEqual([e1, e2]);
    expect(loadDropEvents()).toEqual([e1, e2]);
  });

  it('does not write when there is nothing to append', () => {
    appendDropEvents([]);
    expect(localStorage.getItem(EVENTS_KEY)).toBeNull();
  });

  it('caps stored events, keeping the newest', () => {
    const many = Array.from({ length: MAX_EVENTS + 10 }, (_, i) => ({
      experienceId: `e${i}`,
      date: D1,
      time: '09:47',
      kind: 'appeared' as const,
    }));
    const all = appendDropEvents(many);
    expect(all).toHaveLength(MAX_EVENTS);
    expect(all[0]!.experienceId).toBe('e10');
  });

  it('drops malformed events on load', () => {
    kvdb.set(EVENTS_KEY, [
      { experienceId: 'a', date: D1, time: '09:47', kind: 'appeared' },
      { experienceId: 'a', date: D1, time: '09:47', kind: 'exploded' },
      { date: D1, time: '09:47', kind: 'appeared' },
      'garbage',
    ]);
    expect(loadDropEvents()).toHaveLength(1);
  });

  it('round-trips coverage and sanitizes it', () => {
    saveCoverage({ [D1]: [1, 2] });
    expect(loadCoverage()).toEqual({ [D1]: [1, 2] });
    kvdb.set(COVERAGE_KEY, { [D1]: [1, 'x', 2.5], [D2]: 'nope' });
    expect(loadCoverage()).toEqual({ [D1]: [1] });
    kvdb.set(COVERAGE_KEY, [1, 2]);
    expect(loadCoverage()).toEqual({});
  });
});

// The cap is "the last N park days", and it went wrong when the key gained a
// park prefix: sorting keys then ordered by park id, so one park was always
// evicted first and the cap became a global budget.
describe('recordCoverage() pruning', () => {
  const AK = '80007823'; // sorts first of the four WDW parks
  const HS = '80007998'; // sorts last
  const day = (n: number) => `2026-12-${String(n).padStart(2, '0')}`;

  function fill(parks: string[], days: number): Coverage {
    let coverage: Coverage = {};
    for (let d = 1; d <= days; ++d) {
      for (const park of parks) {
        coverage = recordCoverage(
          coverage,
          coverageKey(park, day(d)),
          new ParkTime(9)
        ).coverage;
      }
    }
    return coverage;
  }

  it('keeps every park for the days it keeps', () => {
    const coverage = fill([AK, HS], 20);
    const dates = new Set(Object.keys(coverage).map(coverageDate));
    for (const date of dates) {
      expect(coverage[coverageKey(AK, date)]).toBeDefined();
      expect(coverage[coverageKey(HS, date)]).toBeDefined();
    }
  });

  // The bug: with four parks the 30-key cap was reached in eight days, and
  // Animal Kingdom -- lexicographically first -- was discarded every time.
  it('does not evict one park before another', () => {
    const coverage = fill([AK, HS], 25);
    const akDays = Object.keys(coverage).filter(k => k.startsWith(AK)).length;
    const hsDays = Object.keys(coverage).filter(k => k.startsWith(HS)).length;
    expect(akDays).toBe(hsDays);
    expect(akDays).toBeGreaterThan(0);
  });

  it('keeps the most recent dates, not the earliest', () => {
    const coverage = fill([AK], MAX_COVERAGE_DAYS + 5);
    const dates = [...new Set(Object.keys(coverage).map(coverageDate))].sort();
    expect(dates).toHaveLength(MAX_COVERAGE_DAYS);
    expect(dates.at(-1)).toBe(day(MAX_COVERAGE_DAYS + 5));
    expect(dates[0]).toBe(day(6));
  });
});

/**
 * Absence is only evidence where the attraction was actually armed.
 *
 * `detectDropEvents` records events for watched attractions only, so an
 * attraction nobody armed has no observations by construction. Reading that
 * silence as evidence printed "never seen in N watched days" in red against the
 * built-in drop times of rides nobody was watching -- and the screen's own copy
 * promises the opposite.
 */
describe('summarizeDrops() coverage attribution', () => {
  const schedule = new Map([['a', [at(9, 47)]]]);
  const coverage: Coverage = { [D1]: [coverageBucket(at(9, 47))] };

  it('claims no coverage for an attraction that was never armed', () => {
    const [s] = summarizeDrops([], coverage, schedule, undefined, {
      [D1]: ['something-else'],
    });
    expect(s!.scheduled[0]).toMatchObject({
      observedDays: 0,
      coveredDays: 0,
    });
  });

  it('counts a day the attraction was armed on', () => {
    const [s] = summarizeDrops([], coverage, schedule, undefined, {
      [D1]: ['a'],
    });
    expect(s!.scheduled[0]).toMatchObject({
      observedDays: 0,
      coveredDays: 1,
    });
  });

  // Old stored coverage has no companion record, and guessing would reinstate
  // the false claim. Degrading to "not watched yet" understates instead.
  it('claims no coverage when nothing is recorded for the day', () => {
    const [s] = summarizeDrops([], coverage, schedule);
    expect(s!.scheduled[0]).toMatchObject({ coveredDays: 0 });
  });
});

describe('recordWatched()', () => {
  it('records what was armed for a park day', () => {
    const { watched, changed } = recordWatched({}, D1, ['a', 'b']);
    expect(changed).toBe(true);
    expect(watched[D1]).toEqual(['a', 'b']);
  });

  it('merges without duplicating', () => {
    const first = recordWatched({}, D1, ['a']);
    const second = recordWatched(first.watched, D1, ['a', 'b']);
    expect(second.watched[D1]).toEqual(['a', 'b']);
  });

  it('reports no change when nothing is new', () => {
    const first = recordWatched({}, D1, ['a']);
    expect(recordWatched(first.watched, D1, ['a']).changed).toBe(false);
  });

  it('keeps the same span of park days as coverage', () => {
    let watched = {};
    for (let i = 0; i < MAX_COVERAGE_DAYS + 5; ++i) {
      const date = `2026-10-${String(i + 1).padStart(2, '0')}`;
      watched = recordWatched(watched, coverageKey('mk', date), ['a']).watched;
    }
    expect(Object.keys(watched)).toHaveLength(MAX_COVERAGE_DAYS);
  });
});

/**
 * A refill window is a span where inventory returns by design, so the churn
 * inside it is not a drop.
 *
 * `watchedIds` cannot bound this: a refill window is only ever declared for an
 * attraction somebody watches, so the churn is inside the bound. Jungle Cruise
 * and Haunted Mansion both declare 11:00-14:30, which at the approach cadence is
 * around 2,100 polls, and two park days of that jitter was enough to promote it
 * into permanent midday burst bands -- the API hammered and the action budget
 * spent on minutes that were never drops.
 */
describe('detectDropEvents() inside a refill window', () => {
  const window = [{ start: at(11), end: at(14, 30) }];

  it('ignores an attraction appearing inside the window', () => {
    const events = detectDropEvents(
      snap([['a', { available: false, refillWindows: window }]]),
      snap([['a', { available: true, next: at(15), refillWindows: window }]]),
      at(12, 30),
      D1
    );
    expect(events).toEqual([]);
  });

  it('ignores the next time jumping earlier inside the window', () => {
    const events = detectDropEvents(
      snap([['a', { available: true, next: at(19), refillWindows: window }]]),
      snap([['a', { available: true, next: at(15), refillWindows: window }]]),
      at(12, 30),
      D1
    );
    expect(events).toEqual([]);
  });

  // A real scheduled drop outside the span is still learned from.
  it('still records a flip before the window opens', () => {
    const events = detectDropEvents(
      snap([['a', { available: false, refillWindows: window }]]),
      snap([['a', { available: true, next: at(15), refillWindows: window }]]),
      at(9, 47),
      D1
    );
    expect(events).toHaveLength(1);
  });

  it('still records a flip after the window closes', () => {
    const events = detectDropEvents(
      snap([['a', { available: false, refillWindows: window }]]),
      snap([['a', { available: true, next: at(18), refillWindows: window }]]),
      at(15, 47),
      D1
    );
    expect(events).toHaveLength(1);
  });

  // Both bounds inclusive, matching how `cadence` treats the same span.
  it('treats the window edges as inside it', () => {
    for (const edge of [at(11), at(14, 30)]) {
      expect(
        detectDropEvents(
          snap([['a', { available: false, refillWindows: window }]]),
          snap([['a', { available: true, refillWindows: window }]]),
          edge,
          D1
        )
      ).toEqual([]);
    }
  });

  it('leaves an attraction with no declared window alone', () => {
    const events = detectDropEvents(
      snap([['a', { available: false }]]),
      snap([['a', { available: true, next: at(15) }]]),
      at(12, 30),
      D1
    );
    expect(events).toHaveLength(1);
  });
});

describe('baselineUsable()', () => {
  it('refuses a baseline that was never taken', () => {
    expect(baselineUsable(undefined, 1_000_000)).toBe(false);
  });

  it('accepts one from the last poll', () => {
    expect(baselineUsable(1_000_000, 1_000_000 + 45_000)).toBe(true);
  });

  it('accepts one at the staleness bound', () => {
    expect(baselineUsable(0, SNAPSHOT_STALE_MS)).toBe(true);
  });

  // The gap case: a backgrounded phone, a booking-date switch, a failure streak.
  it('refuses one from beyond the bound', () => {
    expect(baselineUsable(0, SNAPSHOT_STALE_MS + 1)).toBe(false);
  });

  // Wide enough that ordinary backoff never discards a usable baseline.
  it('clears the slowest cadence with room for backoff', () => {
    expect(SNAPSHOT_STALE_MS).toBeGreaterThan(
      IDLE_INTERVAL_MS + BACKOFF_CAP_MS
    );
  });
});
