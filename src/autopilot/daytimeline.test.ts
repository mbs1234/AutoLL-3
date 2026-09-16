import { createBooking, hm, jc, multiExp, sm } from '@/__fixtures__/ll';
import { WatchTarget } from '@/autopilot/watchlist';
import { ParkTime } from '@/datetime';
import { TODAY } from '@/testing';

import { dayPercent, dayTimeline } from './daytimeline';

const time = (hour: number, minute = 0) => new ParkTime(hour, minute);

/**
 * A held Multi Pass, built from the real fixture rather than a cast.
 *
 * The previous version of this file hand-rolled `type: 'LLMP'`, which is not
 * a shape an LLMP can have -- a real one is `type: 'LL', subtype: 'MP'` -- and
 * a double cast hid it. `clashWindow` branches on `type === 'LL'`, so the
 * fixture was quietly exercising the wrong path.
 */
function lane(exp: typeof hm, start: ParkTime, end?: ParkTime) {
  const booking = createBooking(exp, { startTime: start });
  return end
    ? booking
    : ({ ...booking, end: { date: TODAY } } as typeof booking);
}

function target(id: string, after?: ParkTime, before?: ParkTime): WatchTarget {
  return { experienceId: id, name: `Target ${id}`, after, before };
}

describe('dayTimeline()', () => {
  it('sorts held reservations and marks an assumed end for a missing one', () => {
    const result = dayTimeline(
      [lane(sm, time(15), time(16)), lane(jc, time(9))],
      [],
      TODAY
    );

    expect(result.lanes.map(item => item.name)).toEqual([jc.name, sm.name]);
    expect(result.lanes[0]?.end).toEqual(time(9, 30));
    // Flagged rather than presented as fact: the day summary above the
    // timeline prints "no return time" for the same booking.
    expect(result.lanes[0]?.endAssumed).toBe(true);
    expect(result.lanes[1]?.endAssumed).toBe(false);
  });

  it('carries the exact protected span used by booking checks', () => {
    const result = dayTimeline([lane(hm, time(12), time(13))], [], TODAY);
    expect(result.lanes[0]?.protectedFrom).toEqual(time(11, 20));
    expect(result.lanes[0]?.protectedTo).toEqual(time(12, 40));
  });

  it('marks a bounded target window that crosses a held reservation buffer', () => {
    const result = dayTimeline(
      [lane(hm, time(12), time(13))],
      [
        target('clear', time(14, 30), time(15)),
        target('clash', time(11, 30), time(12, 15)),
      ],
      TODAY
    );

    expect(result.targets.find(t => t.id === 'clash')?.clashes).toHaveLength(1);
    expect(result.targets.find(t => t.id === 'clear')?.clashes).toEqual([]);
  });

  // An un-windowed target is the default -- starring an attraction sets no
  // bounds -- and it spans the whole day, so it intersects everything held.
  // Flagging it made every default plan read as a warning.
  it('does not flag a target with no window, and marks it unbounded', () => {
    const result = dayTimeline(
      [lane(hm, time(12), time(13))],
      [target('open')],
      TODAY
    );
    const open = result.targets[0]!;
    expect(open.bounded).toBe(false);
    expect(open.clashes).toEqual([]);
    expect(+open.after).toBe(0);
    expect(+open.before).toBe(86_399);
  });

  it('reports a window wholly inside a protected span as covered', () => {
    const result = dayTimeline(
      [lane(hm, time(12), time(13))],
      [target('inside', time(12), time(12, 30))],
      TODAY
    );
    expect(result.targets[0]?.covered).toHaveLength(1);
  });

  it('marks an inverted window impossible and does not clash it', () => {
    const result = dayTimeline(
      [lane(hm, time(12), time(13))],
      [target('backwards', time(15), time(10))],
      TODAY
    );
    expect(result.targets[0]?.impossible).toBe(true);
    expect(result.targets[0]?.clashes).toEqual([]);
  });

  // The booker ignores a Multiple Experiences Pass because it constrains
  // nothing; the picture of the day must agree with it.
  it('does not treat a Multiple Experiences Pass as a clashing hold', () => {
    const result = dayTimeline(
      [multiExp as never],
      [target('afternoon', time(15), time(16))],
      TODAY
    );
    expect(result.targets[0]?.clashes).toEqual([]);
  });

  it('ignores a reservation held on another park day', () => {
    const result = dayTimeline(
      [createBooking(hm, { date: '2020-01-01', startTime: time(12) })],
      [target('clash', time(11, 30), time(12, 15))],
      TODAY
    );
    expect(result.targets[0]?.clashes).toEqual([]);
  });

  describe('column packing', () => {
    it('gives simultaneous holds their own columns', () => {
      const result = dayTimeline(
        [lane(hm, time(12), time(14)), lane(sm, time(12), time(12, 30))],
        [],
        TODAY
      );
      expect(result.lanes.map(l => l.column).sort()).toEqual([0, 1]);
      expect(result.lanes.every(l => l.columns === 2)).toBe(true);
    });

    // Two default targets both spanned the full rail with identical geometry
    // and opaque backgrounds, so only the last one drawn was visible.
    it('separates two full-day targets', () => {
      const result = dayTimeline([], [target('a'), target('b')], TODAY);
      expect(result.targets.map(t => t.column).sort()).toEqual([0, 1]);
    });

    it('reuses a column once the previous bar has ended', () => {
      const result = dayTimeline(
        [lane(hm, time(9), time(10)), lane(sm, time(12), time(13))],
        [],
        TODAY
      );
      expect(result.lanes.map(l => l.column)).toEqual([0, 0]);
      expect(result.lanes[0]?.columns).toBe(1);
    });
  });

  it('places the start of a park day at the beginning of the rail', () => {
    expect(dayPercent(time(4))).toBe(0);
    expect(dayPercent(time(3, 59))).toBeGreaterThan(99.9);
  });
});
