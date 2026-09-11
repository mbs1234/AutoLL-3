import { ParkTime } from '@/datetime';

import {
  APPROACH_INTERVAL_MS,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  BURST_INTERVAL_MS,
  BURST_LEAD_S,
  IDLE_INTERVAL_MS,
  MIN_INTERVAL_MS,
  RAPID_INTERVAL_MS,
  RAPID_MIN_INTERVAL_MS,
  TOMORROW_INTERVAL_MS,
  backoffMs,
  cadence,
  secondsUntil,
  withJitter,
} from './schedule';

const at = (h: number, m = 0, s = 0) => new ParkTime(h, m, s);
const DROP = at(9, 47);

describe('secondsUntil()', () => {
  it('is positive for a future target', () => {
    expect(secondsUntil(at(9, 45), DROP)).toBe(120);
  });

  it('is negative for a past target', () => {
    expect(secondsUntil(at(9, 48), DROP)).toBe(-60);
  });

  it('is zero at the target', () => {
    expect(secondsUntil(DROP, DROP)).toBe(0);
  });

  // ParkTime measures from a 4am day start, so after-midnight times sort
  // after late-evening ones rather than wrapping to a huge negative.
  it('handles a target after midnight', () => {
    expect(secondsUntil(at(23, 30), at(0, 30))).toBe(3600);
  });
});

describe('cadence()', () => {
  it('uses a bounded daytime cadence for an intentional tomorrow watch', () => {
    const c = cadence({ now: at(10), tomorrow: true });
    expect(c.mode).toBe('approach');
    expect(c.intervalMs).toBe(TOMORROW_INTERVAL_MS);
  });

  // The band's edges, which nothing pinned: it runs 07:00 to 21:59, and
  // shrinking it to 09:00-19:59 left every existing assertion passing. These
  // are the hours in which autopilot watches for the next day's booking window
  // to open, so narrowing it silently stops pre-booking early and late.
  it('watches from 07:00, the first hour of the band', () => {
    expect(cadence({ now: at(7), tomorrow: true }).mode).toBe('approach');
  });

  it('does not watch at 06:59, just before the band', () => {
    expect(cadence({ now: at(6, 59), tomorrow: true }).mode).toBe('idle');
  });

  it('still watches at 21:59, the last minute of the band', () => {
    expect(cadence({ now: at(21, 59), tomorrow: true }).mode).toBe('approach');
  });

  it('stops watching at 22:00, just past the band', () => {
    expect(cadence({ now: at(22), tomorrow: true }).mode).toBe('idle');
  });

  it('does not keep a tomorrow watch warm overnight', () => {
    expect(cadence({ now: at(23), tomorrow: true }).mode).toBe('idle');
  });

  it('idles with no targets at all', () => {
    const c = cadence({ now: at(9, 0) });
    expect(c.mode).toBe('idle');
    expect(c.intervalMs).toBe(IDLE_INTERVAL_MS);
    expect(c.target).toBeUndefined();
  });

  it('idles when the next drop is far off', () => {
    expect(cadence({ now: at(9, 0), dropTimes: [DROP] }).mode).toBe('idle');
  });

  it('approaches within five minutes of a drop', () => {
    const c = cadence({ now: at(9, 43), dropTimes: [DROP] });
    expect(c.mode).toBe('approach');
    expect(c.intervalMs).toBe(APPROACH_INTERVAL_MS);
    expect(c.secondsToTarget).toBe(240);
  });

  it('bursts just before a drop', () => {
    const c = cadence({ now: at(9, 46, 40), dropTimes: [DROP] });
    expect(c.mode).toBe('burst');
    expect(c.intervalMs).toBe(BURST_INTERVAL_MS);
    expect(c.secondsToTarget).toBe(20);
  });

  it('starts the burst two minutes before a scheduled drop', () => {
    const c = cadence({ now: at(9, 45), dropTimes: [DROP] });
    expect(BURST_LEAD_S).toBe(120);
    expect(c.mode).toBe('burst');
    expect(c.secondsToTarget).toBe(120);
  });

  it('bursts exactly at the drop', () => {
    expect(cadence({ now: DROP, dropTimes: [DROP] }).mode).toBe('burst');
  });

  // Dropped inventory trickles in, so the window after matters as much as the
  // window before.
  it('keeps bursting shortly after a drop', () => {
    const c = cadence({ now: at(9, 48), dropTimes: [DROP] });
    expect(c.mode).toBe('burst');
    expect(c.secondsToTarget).toBe(-60);
  });

  it('returns to idle once the drop is well past', () => {
    expect(cadence({ now: at(9, 50), dropTimes: [DROP] }).mode).toBe('idle');
  });

  // The point of the plural field. Under the single earliest window, this is
  // what an 11:00 slot that has come and gone looked like: idling at 45s
  // through the 13:30 one Disney had already announced.
  it('bursts for a later window once the first has passed', () => {
    const c = cadence({
      now: at(13, 30),
      nextBookTimes: [at(11, 0), at(13, 30, 10)],
    });
    expect(c.mode).toBe('burst');
    expect(c.target).toEqual(at(13, 30, 10));
  });

  it('treats a booking window as a target', () => {
    const c = cadence({ now: at(13, 0), nextBookTimes: [at(13, 0, 10)] });
    expect(c.mode).toBe('burst');
    expect(c.target).toEqual(at(13, 0, 10));
  });

  it('picks the nearest burst target when several are in range', () => {
    const c = cadence({
      now: at(9, 47, 5),
      dropTimes: [at(9, 47), at(9, 47, 30)],
    });
    expect(c.mode).toBe('burst');
    // 5s behind beats 25s ahead.
    expect(c.target).toEqual(at(9, 47));
  });

  it('picks the soonest approach target when several are in range', () => {
    const c = cadence({ now: at(9, 43), dropTimes: [at(9, 48), at(9, 47)] });
    expect(c.mode).toBe('approach');
    expect(c.secondsToTarget).toBe(240);
  });

  it('lets a burst target win over a nearer approach target', () => {
    const c = cadence({
      now: at(9, 46, 50),
      dropTimes: [DROP, at(9, 49)],
      nextBookTimes: [at(9, 48)],
    });
    expect(c.mode).toBe('burst');
  });

  it('ignores drops from earlier in the day', () => {
    const c = cadence({
      now: at(15, 0),
      dropTimes: [at(9, 47), at(11, 47), at(13, 47)],
    });
    expect(c.mode).toBe('idle');
  });

  it('uses the moderate cadence inside a refill window', () => {
    const window = { start: at(9), end: at(10, 30) };
    const c = cadence({ now: at(9, 45), refillWindows: [window] });
    expect(c.mode).toBe('approach');
    expect(c.intervalMs).toBe(APPROACH_INTERVAL_MS);
    expect(c.refillWindow).toEqual(window);
    expect(c.target).toBeUndefined();
  });

  it('does not poll a refill window before or after its span', () => {
    const window = { start: at(9), end: at(10, 30) };
    expect(cadence({ now: at(8, 59, 59), refillWindows: [window] }).mode).toBe(
      'idle'
    );
    expect(cadence({ now: at(10, 30, 1), refillWindows: [window] }).mode).toBe(
      'idle'
    );
  });

  it('lets a scheduled drop burst win over an active refill window', () => {
    const c = cadence({
      now: at(9, 47),
      dropTimes: [DROP],
      refillWindows: [{ start: at(9), end: at(10, 30) }],
    });
    expect(c.mode).toBe('burst');
    expect(c.target).toEqual(DROP);
    expect(c.refillWindow).toBeUndefined();
  });
});

describe('backoffMs()', () => {
  it('is zero when nothing has failed', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(-1)).toBe(0);
  });

  it('doubles from the base delay', () => {
    expect(backoffMs(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(2)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffMs(3)).toBe(BACKOFF_BASE_MS * 4);
  });

  // Without a cap, a handful of failures would push the next attempt past the
  // length of an entire drop window.
  it('caps the delay', () => {
    expect(backoffMs(20)).toBe(BACKOFF_CAP_MS);
    expect(backoffMs(1000)).toBe(BACKOFF_CAP_MS);
  });

  it('never exceeds the cap at any failure count', () => {
    for (let i = 0; i <= 50; ++i) {
      expect(backoffMs(i)).toBeLessThanOrEqual(BACKOFF_CAP_MS);
    }
  });
});

describe('withJitter()', () => {
  it('stays within +/-20% of the interval', () => {
    for (const rand of [0, 0.25, 0.5, 0.75, 0.999]) {
      const ms = withJitter(10_000, () => rand);
      expect(ms).toBeGreaterThanOrEqual(8000);
      expect(ms).toBeLessThanOrEqual(12_000);
    }
  });

  it('is centered on the interval', () => {
    expect(withJitter(10_000, () => 0.5)).toBe(10_000);
  });

  it('spans the full range at the extremes', () => {
    expect(withJitter(10_000, () => 0)).toBe(8000);
    expect(withJitter(10_000, () => 1)).toBe(12_000);
  });

  it('never returns less than the floor', () => {
    expect(withJitter(MIN_INTERVAL_MS, () => 0)).toBe(MIN_INTERVAL_MS);
    expect(withJitter(500, () => 0)).toBe(MIN_INTERVAL_MS);
  });

  it('produces a spread of values with real randomness', () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => withJitter(BURST_INTERVAL_MS))
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('cadence() in rapid mode', () => {
  // A hand-started search in the park is waiting for somebody else to cancel,
  // which has no schedule to approach. Pacing to the drop table would leave it
  // idling at 45s through exactly the minutes the user is standing there for.
  it('bursts regardless of what is or is not coming up', () => {
    const c = cadence({ now: at(14, 3), rapid: true });
    expect(c.mode).toBe('burst');
    expect(c.intervalMs).toBe(RAPID_INTERVAL_MS);
    expect(RAPID_INTERVAL_MS).toBeLessThan(BURST_INTERVAL_MS);
  });

  it('ignores drop times entirely rather than being pulled toward them', () => {
    const c = cadence({
      now: at(14, 3),
      dropTimes: [at(9, 47)],
      nextBookTimes: [at(20)],
      rapid: true,
    });
    expect(c.mode).toBe('burst');
    expect(c.target).toBeUndefined();
  });

  // ApiClient shares a RateLimit(5) with the user's own taps, and exceeding it
  // throws rather than throttling -- a five-second cooldown at the worst
  // possible moment. Rapid mode spends part of that headroom but must leave
  // enough for the prewarm and for the user tapping something.
  it('stays well inside the shared rate limit', () => {
    const { intervalMs } = cadence({ now: at(14), rapid: true });
    expect(intervalMs).toBeGreaterThanOrEqual(RAPID_MIN_INTERVAL_MS);
    expect(1000 / intervalMs).toBeLessThan(3);
  });

  it('jitters down to the rapid floor, not the ordinary one', () => {
    expect(RAPID_MIN_INTERVAL_MS).toBeLessThan(MIN_INTERVAL_MS);
    expect(withJitter(RAPID_INTERVAL_MS, () => 0, RAPID_MIN_INTERVAL_MS)).toBe(
      RAPID_MIN_INTERVAL_MS
    );
    expect(withJitter(RAPID_INTERVAL_MS, () => 1, RAPID_MIN_INTERVAL_MS)).toBe(
      Math.round(RAPID_INTERVAL_MS * 1.2)
    );
  });

  // The floor is opt-in: nothing but a hand-started search may use it.
  it('leaves the ordinary floor alone by default', () => {
    expect(withJitter(BURST_INTERVAL_MS, () => 0)).toBeGreaterThanOrEqual(
      MIN_INTERVAL_MS
    );
  });
});
