import { ParkTime } from '@/datetime';

import {
  CommitGuard,
  GOAL_TOLERANCE_MINUTES,
  MIN_GAIN_MINUTES,
  SearchGoal,
  bestCandidate,
  candidates,
  distance,
  goalMet,
  isLaterMove,
} from './timesearch';

const at = (h: number, m = 0) => new ParkTime(h, m);
const grid = (...times: ParkTime[][]) => times;
const soonest: SearchGoal = { kind: 'soonest' };
const aimAt = (h: number, m = 0): SearchGoal => ({
  kind: 'at',
  target: at(h, m),
});

describe('candidates()', () => {
  it('flattens the hourly groups in order', () => {
    expect(candidates(grid([at(11), at(11, 30)], [at(12)]))).toEqual([
      at(11),
      at(11, 30),
      at(12),
    ]);
  });

  it('drops a time repeated across groups', () => {
    expect(candidates(grid([at(11)], [at(11), at(12)]))).toEqual([
      at(11),
      at(12),
    ]);
  });

  it('sorts a grid that arrives out of order', () => {
    expect(candidates(grid([at(15)], [at(9)]))).toEqual([at(9), at(15)]);
  });

  it('handles an empty grid', () => {
    expect(candidates([])).toEqual([]);
    expect(candidates(grid([]))).toEqual([]);
  });
});

describe('distance()', () => {
  // For `soonest` the distance IS the time, measured from the 4am park-day
  // start, so earlier is always closer.
  it('measures a soonest goal by how early the time is', () => {
    expect(distance(soonest, at(9))).toBeLessThan(distance(soonest, at(15)));
  });

  it('measures a targeted goal by absolute minutes either side', () => {
    expect(distance(aimAt(13), at(12, 30))).toBe(30);
    expect(distance(aimAt(13), at(13, 30))).toBe(30);
    expect(distance(aimAt(13), at(13))).toBe(0);
  });
});

describe('goalMet()', () => {
  it('is met inside the tolerance of a named time', () => {
    expect(goalMet(aimAt(13), at(13, GOAL_TOLERANCE_MINUTES))).toBe(true);
    expect(goalMet(aimAt(13), at(13, GOAL_TOLERANCE_MINUTES + 1))).toBe(false);
  });

  // There is no "early enough" -- a soonest search keeps looking until
  // nothing better is on offer, which is what `bestCandidate` reports.
  it('is never met for a soonest goal', () => {
    expect(goalMet(soonest, at(4))).toBe(false);
  });
});

describe('bestCandidate()', () => {
  describe('a soonest search', () => {
    it('takes the earliest time that beats what is held', () => {
      expect(
        bestCandidate(soonest, at(15), grid([at(14), at(11), at(16)]))
      ).toEqual(at(11));
    });

    it('will not move later, even when the grid is all later', () => {
      expect(
        bestCandidate(soonest, at(11), grid([at(12), at(15)]))
      ).toBeUndefined();
    });

    it('ignores a gain smaller than one slot', () => {
      expect(
        bestCandidate(soonest, at(11), grid([at(10, 58)]))
      ).toBeUndefined();
      expect(
        bestCandidate(
          soonest,
          at(11),
          grid([at(11 - 1, 60 - MIN_GAIN_MINUTES)])
        )
      ).toEqual(at(10, 60 - MIN_GAIN_MINUTES));
    });

    it('reports nothing when the grid is empty', () => {
      expect(bestCandidate(soonest, at(11), [])).toBeUndefined();
    });
  });

  describe('a targeted search', () => {
    // The whole point of the module: the party holds 11:00, wants 15:00, and
    // the only way to get there is a move in the direction the engine has
    // always refused.
    it('moves later when that is closer to the target', () => {
      expect(
        bestCandidate(aimAt(15), at(11), grid([at(12), at(14, 45), at(19)]))
      ).toEqual(at(14, 45));
    });

    it('moves earlier when that is closer to the target', () => {
      expect(
        bestCandidate(aimAt(11), at(15), grid([at(11, 10), at(14)]))
      ).toEqual(at(11, 10));
    });

    it('prefers the closest of several candidates on both sides', () => {
      expect(
        bestCandidate(aimAt(13), at(9), grid([at(12), at(13, 10), at(16)]))
      ).toEqual(at(13, 10));
    });

    // Held is the baseline: nothing further from the target is ever a move,
    // in either direction.
    it('refuses a candidate further from the target than what is held', () => {
      expect(
        bestCandidate(aimAt(13), at(12, 55), grid([at(11), at(16)]))
      ).toBeUndefined();
    });

    it('ignores a gain smaller than one slot', () => {
      expect(
        bestCandidate(aimAt(13), at(13, 10), grid([at(13, 7)]))
      ).toBeUndefined();
    });

    it('takes an exact hit over a near miss', () => {
      expect(
        bestCandidate(aimAt(13), at(9), grid([at(12, 30), at(13)]))
      ).toEqual(at(13));
    });
  });

  // A move must be worth a round trip and a reservation in flight, so the
  // caller can raise the bar for its own reasons.
  it('honours a caller-supplied minimum gain', () => {
    expect(
      bestCandidate(soonest, at(11), grid([at(10, 45)]), {
        minGainMinutes: 30,
      })
    ).toBeUndefined();
    expect(
      bestCandidate(soonest, at(11), grid([at(10, 15)]), {
        minGainMinutes: 30,
      })
    ).toEqual(at(10, 15));
  });

  // The 4am park-day origin: a 1am slot is late in the day, not early in it,
  // so a soonest search must not treat it as the best time available.
  it('reads a post-midnight slot as late in the park day', () => {
    expect(bestCandidate(soonest, at(22), grid([at(1)]))).toBeUndefined();
    expect(bestCandidate(aimAt(0, 30), at(22), grid([at(1)]))).toEqual(at(1));
  });
});

describe('bestCandidate() with declined slots', () => {
  // `changeOfferTime` returns the nearest slot it can rather than refusing,
  // so a time the loop asked for and did not get must never be asked for
  // again -- otherwise it re-quotes it every tick for the rest of the day.
  it('skips a slot that was already declined', () => {
    const declined = new Set([+at(11)]);
    expect(
      bestCandidate(soonest, at(15), grid([at(11), at(12)]), {
        exclude: declined,
      })
    ).toEqual(at(12));
  });

  it('reports nothing when every candidate has been declined', () => {
    expect(
      bestCandidate(soonest, at(15), grid([at(11), at(12)]), {
        exclude: new Set([+at(11), +at(12)]),
      })
    ).toBeUndefined();
  });
});

describe('isLaterMove()', () => {
  it('names the direction that gives up an earlier reservation', () => {
    expect(isLaterMove(at(11), at(15))).toBe(true);
    expect(isLaterMove(at(15), at(11))).toBe(false);
    expect(isLaterMove(at(11), at(11))).toBe(false);
  });
});

/**
 * The guard is the whole safety story for an automated move, so it is tested
 * as a state machine rather than through the loop that drives it.
 */
describe('CommitGuard', () => {
  it('starts idle and lets one decision through', () => {
    const guard = new CommitGuard();
    expect(guard.idle).toBe(true);
    expect(guard.begin(at(11))).toBe(true);
    expect(guard.phase).toBe('committing');
    expect(guard.requested).toEqual(at(11));
  });

  // The lock is taken before the request goes out, so nothing else can decide
  // while one is in flight.
  it('refuses a second decision while one is committing', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    expect(guard.begin(at(12))).toBe(false);
    expect(guard.requested).toEqual(at(11));
  });

  it('releases for a failure that changed nothing', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.release();
    expect(guard.idle).toBe(true);
    expect(guard.requested).toBeUndefined();
  });

  it('remembers a declined slot and frees the lock', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.decline(at(11));
    expect(guard.declined.has(+at(11))).toBe(true);
    expect(guard.idle).toBe(true);
  });

  // A committed move is not settled until plans agree, so no further decision
  // is taken on a baseline that may still be the old one.
  it('waits for confirmation after a commit', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.markCommitted();
    expect(guard.phase).toBe('awaiting');
    expect(guard.commits).toBe(1);
    expect(guard.begin(at(12))).toBe(false);
    guard.confirm();
    expect(guard.idle).toBe(true);
  });

  it('only confirms out of awaiting', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.confirm();
    expect(guard.phase).toBe('committing');
  });

  // The whole point. A timed-out move may or may not have applied, nothing
  // that arrives later can settle it, and a second attempt is how a party
  // ends up at a time nobody chose.
  describe('an unknown outcome', () => {
    it('is absorbing', () => {
      const guard = new CommitGuard();
      guard.begin(at(11));
      guard.markUnknown();
      expect(guard.phase).toBe('unknown');
      guard.release();
      expect(guard.phase).toBe('unknown');
      guard.confirm();
      expect(guard.phase).toBe('unknown');
      expect(guard.begin(at(12))).toBe(false);
    });

    it('cannot be escaped by declining either', () => {
      const guard = new CommitGuard();
      guard.begin(at(11));
      guard.markUnknown();
      guard.decline(at(11));
      expect(guard.phase).toBe('unknown');
      expect(guard.begin(at(12))).toBe(false);
    });
  });

  it('counts only committed moves', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.release();
    guard.begin(at(12));
    guard.decline(at(12));
    expect(guard.commits).toBe(0);
  });
});

/**
 * Restarting is a new run, so the limits that say "per run" have to mean it.
 */
describe('CommitGuard.reset()', () => {
  it('clears the declined slots a previous run collected', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.decline(at(11));
    expect(guard.reset()).toBe(true);
    expect(guard.declined.size).toBe(0);
  });

  it('clears the commit budget a previous run spent', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.markCommitted();
    guard.confirm();
    expect(guard.commits).toBe(1);
    guard.reset();
    expect(guard.commits).toBe(0);
  });

  it('only clears a settled guard', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    // In flight: Stop can land here, and the lock is the only thing between
    // that and a second commit.
    expect(guard.reset()).toBe(false);
    expect(guard.phase).toBe('committing');
    guard.release();
    expect(guard.reset()).toBe(true);
    expect(guard.idle).toBe(true);
  });

  // The one lock that is not per-run: a commit whose outcome nobody can
  // establish must not be cleared by pressing the button again.
  it('refuses to clear an unknown outcome, and changes nothing', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.decline(at(11));
    guard.begin(at(12));
    guard.markUnknown();
    expect(guard.reset()).toBe(false);
    expect(guard.phase).toBe('unknown');
    expect(guard.declined.has(+at(11))).toBe(true);
  });
});

/**
 * The two phases a restart must not clear, and why they differ.
 */
describe('CommitGuard phases that survive a restart', () => {
  it('will not clear a move that is still waiting on Plans', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.markCommitted();
    expect(guard.reset()).toBe(false);
    expect(guard.phase).toBe('awaiting');
    expect(guard.requested).toEqual(at(11));
  });

  // A run may still *begin* while awaiting -- it resumes the settle wait --
  // whereas an unknown outcome bars starting at all.
  it('is startable while awaiting, and not while unknown', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    expect(guard.startable).toBe(false);
    guard.markCommitted();
    expect(guard.startable).toBe(true);
    guard.markUnknown();
    expect(guard.startable).toBe(false);
  });

  it('becomes resettable once Plans confirms', () => {
    const guard = new CommitGuard();
    guard.begin(at(11));
    guard.markCommitted();
    guard.confirm();
    expect(guard.reset()).toBe(true);
    expect(guard.commits).toBe(0);
  });
});
