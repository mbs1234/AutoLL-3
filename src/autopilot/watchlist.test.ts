import { mk, wdw } from '@/__fixtures__/resort';
import { Experience, FlexExperience } from '@/api/ll';
import { ParkTime } from '@/datetime';

import {
  WATCHLIST_KEY,
  WatchTarget,
  inWindow,
  loadWatchList,
  matchWatchList,
  saveWatchList,
  selectNewAlerts,
  targetActs,
  targetApplies,
} from './watchlist';

const BZ = '80010114';
const DB = '80010129';

/** An experience with a bookable Lightning Lane at `time`. */
function available(id: string, time: ParkTime): FlexExperience {
  return {
    ...wdw.experience(id),
    park: mk,
    standby: { available: true, waitTime: 30 },
    flex: { available: true, nextAvailableTime: time },
  } as FlexExperience;
}

function unavailable(id: string): Experience {
  return {
    ...wdw.experience(id),
    park: mk,
    standby: { available: true, waitTime: 30 },
    flex: { available: false },
  } as Experience;
}

const at = (h: number, m = 0) => new ParkTime(h, m);
const target = (experienceId: string, rest: Partial<WatchTarget> = {}) => ({
  experienceId,
  ...rest,
});

describe('targetActs()', () => {
  it.each(['autoBook', 'autoModify', 'bookThenMove', 'autoSwap'] as const)(
    'recognises %s as an automatic action',
    action => {
      expect(targetActs({ [action]: true })).toBe(true);
    }
  );

  it('keeps an alert-only target out of armed counts', () => {
    expect(targetActs({})).toBe(false);
  });
});

describe('inWindow()', () => {
  it('accepts anything with no bounds', () => {
    expect(inWindow(at(9), target(BZ))).toBe(true);
  });

  it('rejects times before the lower bound', () => {
    expect(inWindow(at(9), target(BZ, { after: at(10) }))).toBe(false);
  });

  it('rejects times after the upper bound', () => {
    expect(inWindow(at(18), target(BZ, { before: at(17) }))).toBe(false);
  });

  it('accepts times inside both bounds', () => {
    const t = target(BZ, { after: at(10), before: at(17) });
    expect(inWindow(at(13), t)).toBe(true);
  });

  it('treats both bounds as inclusive', () => {
    const t = target(BZ, { after: at(10), before: at(17) });
    expect(inWindow(at(10), t)).toBe(true);
    expect(inWindow(at(17), t)).toBe(true);
  });

  // ParkTime's 4am day origin puts after-midnight times last, so a late
  // window does not wrap around and reject everything.
  it('handles a window ending after midnight', () => {
    const t = target(BZ, { after: at(22), before: at(1) });
    expect(inWindow(at(23, 30), t)).toBe(true);
    expect(inWindow(at(0, 30), t)).toBe(true);
    expect(inWindow(at(21), t)).toBe(false);
  });
});

describe('matchWatchList()', () => {
  it('returns nothing when the list is empty', () => {
    expect(matchWatchList([available(BZ, at(11))], [])).toEqual([]);
  });

  it('returns nothing when no watched experience is present', () => {
    expect(matchWatchList([available(BZ, at(11))], [target(DB)])).toEqual([]);
  });

  it('matches an available watched experience', () => {
    const hits = matchWatchList([available(BZ, at(11))], [target(BZ)]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.experience.id).toBe(BZ);
    expect(hits[0]!.returnTime).toEqual(at(11));
  });

  it('ignores an unavailable experience', () => {
    expect(matchWatchList([unavailable(BZ)], [target(BZ)])).toEqual([]);
  });

  it('ignores an available experience with no return time', () => {
    const exp = {
      ...unavailable(BZ),
      flex: { available: true },
    } as Experience;
    expect(matchWatchList([exp], [target(BZ)])).toEqual([]);
  });

  // `experienced` means the party already used it or hit its limit, so an
  // offer is not actually bookable and alerting would be a false positive.
  it('ignores an already-experienced attraction', () => {
    const exp = { ...available(BZ, at(11)), experienced: true };
    expect(matchWatchList([exp], [target(BZ)])).toEqual([]);
  });

  it('flags the time window rather than filtering on it', () => {
    // Reporting an out-of-window match, flagged, is what lets the window gate
    // booking while alerts stay wide: a window that silenced alerts would hide
    // the one thing worth knowing.
    const exps = [available(BZ, at(9, 30))];
    expect(matchWatchList(exps, [target(BZ, { after: at(12) })])).toMatchObject(
      [{ inWindow: false }]
    );
    expect(matchWatchList(exps, [target(BZ, { after: at(9) })])).toMatchObject([
      { inWindow: true },
    ]);
    expect(matchWatchList(exps, [target(BZ, { before: at(9) })])).toMatchObject(
      [{ inWindow: false }]
    );
  });

  it('matches several targets at once', () => {
    const hits = matchWatchList(
      [available(BZ, at(11)), available(DB, at(14))],
      [target(BZ), target(DB)]
    );
    expect(hits.map(h => h.experience.id).sort()).toEqual([BZ, DB].sort());
  });
});

describe('selectNewAlerts()', () => {
  const hit = () => matchWatchList([available(BZ, at(11))], [target(BZ)]);

  it('alerts the first time an experience matches', () => {
    const { toAlert, alerted } = selectNewAlerts(hit(), new Set());
    expect(toAlert).toHaveLength(1);
    expect(alerted.has(BZ)).toBe(true);
  });

  // Burst mode ticks about once a second; alerting per matching tick would
  // fire sixty notifications a minute for one available ride.
  it('stays quiet while the same experience keeps matching', () => {
    const { alerted } = selectNewAlerts(hit(), new Set());
    expect(selectNewAlerts(hit(), alerted).toAlert).toEqual([]);
  });

  it('forgets an experience that stops matching', () => {
    const { alerted } = selectNewAlerts(hit(), new Set());
    const gone = selectNewAlerts([], alerted);
    expect(gone.alerted.size).toBe(0);
  });

  it('alerts again after an experience reappears', () => {
    let alerted = selectNewAlerts(hit(), new Set()).alerted;
    alerted = selectNewAlerts([], alerted).alerted;
    expect(selectNewAlerts(hit(), alerted).toAlert).toHaveLength(1);
  });
});

describe('watch list persistence', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    expect(loadWatchList()).toEqual([]);
  });

  it('round-trips targets with and without windows', () => {
    saveWatchList([
      target(BZ),
      target(DB, { after: at(12), before: at(17, 30) }),
    ]);
    expect(loadWatchList()).toEqual([
      { experienceId: BZ },
      { experienceId: DB, after: at(12), before: at(17, 30) },
    ]);
  });

  it('drops malformed entries without losing the rest', () => {
    localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify([
        { experienceId: BZ },
        { nope: true },
        { experienceId: DB, after: 'not-a-time' },
      ])
    );
    expect(loadWatchList()).toEqual([
      { experienceId: BZ },
      { experienceId: DB },
    ]);
  });

  it('round-trips the action flags', () => {
    saveWatchList([
      { experienceId: BZ, autoBook: true, bookThenMove: true, paused: true },
      { experienceId: DB, autoModify: true },
    ]);
    expect(loadWatchList()).toEqual([
      { experienceId: BZ, autoBook: true, bookThenMove: true, paused: true },
      { experienceId: DB, autoModify: true },
    ]);
  });

  it('round-trips a named, date- and park-scoped plan target', () => {
    saveWatchList([
      {
        experienceId: BZ,
        name: 'Buzz Lightyear',
        parkId: 'mk',
        date: '2031-02-14',
        rank: 1,
      },
    ]);
    expect(loadWatchList()).toEqual([
      {
        experienceId: BZ,
        name: 'Buzz Lightyear',
        parkId: 'mk',
        date: '2031-02-14',
        rank: 1,
      },
    ]);
  });

  // Only a literal true arms an action; anything else stored reads as off,
  // since guessing wrong means an unwanted booking.
  it('treats non-boolean flag values as off', () => {
    localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify([
        { experienceId: BZ, autoBook: 'yes', bookThenMove: 1, paused: 'true' },
      ])
    );
    expect(loadWatchList()).toEqual([{ experienceId: BZ }]);
  });

  it('returns empty for a non-array value', () => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify({ nope: true }));
    expect(loadWatchList()).toEqual([]);
  });
});

describe('targetApplies()', () => {
  const scoped = {
    experienceId: BZ,
    parkId: 'mk',
    date: '2031-02-14',
  };

  it('keeps a plan target within its selected park and date', () => {
    expect(targetApplies(scoped, 'mk', '2031-02-14')).toBe(true);
    expect(targetApplies(scoped, 'epcot', '2031-02-14')).toBe(false);
    expect(targetApplies(scoped, 'mk', '2031-02-15')).toBe(false);
  });

  it('keeps legacy targets available everywhere', () => {
    expect(targetApplies({ experienceId: BZ }, 'mk', '2031-02-14')).toBe(true);
  });
});
