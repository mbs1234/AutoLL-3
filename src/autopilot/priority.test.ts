import { wdw } from '@/__fixtures__/resort';
import { Experience } from '@/api/ll';
import { ParkTime } from '@/datetime';

import {
  ArmedExperience,
  comparePriority,
  isTier1,
  orderByPriority,
  shouldHoldTierSlot,
} from './priority';
import { WatchHit } from './watchlist';

const at = (h: number, m = 0) => new ParkTime(h, m);

const exp = (id: string, rest: Partial<Experience> = {}) =>
  ({ id, name: id, ...rest }) as Experience;

const hit = (
  experience: Experience,
  target: Partial<WatchHit['target']> = {}
): WatchHit =>
  ({
    target: { experienceId: experience.id, autoBook: true, ...target },
    experience,
    returnTime: at(11),
  }) as WatchHit;

const armed = (experience: Experience): ArmedExperience => ({
  target: { experienceId: experience.id, autoBook: true },
  experience,
});

describe('isTier1()', () => {
  it('recognizes the tier marker', () => {
    expect(isTier1(exp('a', { tier: 1 }))).toBe(true);
  });

  // Absence means untiered; the data never carries any value but 1.
  it('treats a missing tier as untiered', () => {
    expect(isTier1(exp('a'))).toBe(false);
  });
});

describe('comparePriority()', () => {
  it('ranks a lower priority number first', () => {
    expect(
      comparePriority(exp('a', { priority: 1.1 }), exp('b', { priority: 2.3 }))
    ).toBeLessThan(0);
  });

  it('sorts missing priority last', () => {
    expect(
      comparePriority(exp('a'), exp('b', { priority: 4.1 }))
    ).toBeGreaterThan(0);
  });

  // Matches the LL list's Priority sort, so the booker agrees with what the
  // user sees ranked on screen.
  it('breaks ties on the longer average wait', () => {
    const a = exp('a', { priority: 2, avgWait: 60 });
    const b = exp('b', { priority: 2, avgWait: 20 });
    expect(comparePriority(a, b)).toBeLessThan(0);
  });

  it('treats two identical attractions as equal', () => {
    const a = exp('a', { priority: 2, avgWait: 30 });
    const b = exp('b', { priority: 2, avgWait: 30 });
    expect(comparePriority(a, b)).toBe(0);
  });
});

describe('orderByPriority()', () => {
  // Without this the booker takes whatever the tipboard listed first, and the
  // first booking constrains what the next can be.
  it('puts the best attraction first', () => {
    const ordered = orderByPriority([
      hit(exp('c', { priority: 3.1 })),
      hit(exp('a', { priority: 1.0 })),
      hit(exp('b', { priority: 2.3 })),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts unranked attractions last', () => {
    const ordered = orderByPriority([
      hit(exp('none')),
      hit(exp('ranked', { priority: 4.1 })),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual(['ranked', 'none']);
  });

  /**
   * The two ordering keys this fork added, both ahead of the built-in priority.
   *
   * Neither had a test: deleting either left the whole suite green, and the
   * suite is what gates the deploy. This is the comparator that decides which
   * attraction autopilot attempts first, and the first booking constrains what
   * the next can be -- so a silent change of order here is a silent change to
   * every action of the day.
   */
  it('puts a user-set rank ahead of the built-in priority', () => {
    const ordered = orderByPriority([
      hit(exp('best-by-data', { priority: 1 })),
      hit(exp('ranked-by-user', { priority: 4 }), { rank: 1 }),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual([
      'ranked-by-user',
      'best-by-data',
    ]);
  });

  it('orders two user-set ranks by the lower number', () => {
    const ordered = orderByPriority([
      hit(exp('c'), { rank: 3 }),
      hit(exp('a'), { rank: 1 }),
      hit(exp('b'), { rank: 2 }),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to the built-in priority for an unranked target', () => {
    const ordered = orderByPriority([
      hit(exp('unranked-worse', { priority: 3 })),
      hit(exp('unranked-better', { priority: 1 })),
      hit(exp('ranked', { priority: 4 }), { rank: 2 }),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual([
      'ranked',
      'unranked-better',
      'unranked-worse',
    ]);
  });

  // The passkey exists to be redeemed early so Disney lifts the one-Tier-1
  // limit, which is worth nothing if it is not booked first.
  it('puts the passkey first when asked', () => {
    const ordered = orderByPriority(
      [
        hit(exp('headliner', { priority: 1, tier: 1 })),
        hit(exp('passkey', { priority: 4 }), { passkey: true }),
      ],
      true
    );
    expect(ordered.map(h => h.experience.id)).toEqual(['passkey', 'headliner']);
  });

  it('leaves the passkey in priority order when not asked', () => {
    const ordered = orderByPriority([
      hit(exp('headliner', { priority: 1, tier: 1 })),
      hit(exp('passkey', { priority: 4 }), { passkey: true }),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual(['headliner', 'passkey']);
  });

  // Passkey outranks a user rank: the rank orders the day's plan, the passkey
  // decides what has to happen before the plan is possible at all.
  it('puts the passkey ahead even of a user-set rank', () => {
    const ordered = orderByPriority(
      [
        hit(exp('ranked-first'), { rank: 1 }),
        hit(exp('passkey', { priority: 4 }), { passkey: true }),
      ],
      true
    );
    expect(ordered.map(h => h.experience.id)).toEqual([
      'passkey',
      'ranked-first',
    ]);
  });

  it('does not mutate the input', () => {
    const hits = [
      hit(exp('c', { priority: 3 })),
      hit(exp('a', { priority: 1 })),
    ];
    orderByPriority(hits);
    expect(hits.map(h => h.experience.id)).toEqual(['c', 'a']);
  });

  it('handles an empty list', () => {
    expect(orderByPriority([])).toEqual([]);
  });
});

describe('shouldHoldTierSlot()', () => {
  const better = exp('better', {
    tier: 1,
    priority: 1.1,
    dropTimes: [at(13, 17), at(15, 47)],
  });
  const worse = exp('worse', { tier: 1, priority: 2.3 });

  // Booking a Tier 1 can consume the party's only Tier 1 selection, so taking
  // the lesser one first can make the better one unbookable all day.
  it('holds the slot when a better Tier 1 drops within the horizon', () => {
    // 13:17 is 47 minutes out.
    expect(shouldHoldTierSlot(hit(worse), [armed(better)], at(12, 30))).toBe(
      true
    );
  });

  // The bug this horizon exists for. Tiana's drop list runs to 21:47, so
  // "any drop still ahead today" meant that at Magic Kingdom an armed Space
  // Mountain was declined from park open until the party's first tap-in --
  // a whole morning holding the Tier 1 slot for a drop eight hours away.
  it('does not hold all day for a drop list that runs to the evening', () => {
    const allDay = exp('allday', {
      tier: 1,
      priority: 1.1,
      dropTimes: [at(13, 47), at(17, 47), at(19, 47), at(21, 47)],
    });
    expect(shouldHoldTierSlot(hit(worse), [armed(allDay)], at(8))).toBe(false);
    // Still holds once one of them is genuinely close.
    expect(shouldHoldTierSlot(hit(worse), [armed(allDay)], at(13))).toBe(true);
  });

  it('does not hold for a drop just beyond the horizon', () => {
    const soon = exp('soon', {
      tier: 1,
      priority: 1.1,
      dropTimes: [at(10, 31)],
    });
    expect(shouldHoldTierSlot(hit(worse), [armed(soon)], at(9))).toBe(false);
    expect(shouldHoldTierSlot(hit(worse), [armed(soon)], at(9, 1))).toBe(true);
  });

  // Self-releasing: once the better attraction's drops have passed there is
  // no longer a reason to expect it, so the hold must not deadlock.
  it('releases once the better attraction has no drops left', () => {
    expect(shouldHoldTierSlot(hit(worse), [armed(better)], at(16))).toBe(false);
  });

  // A drop already past is not "upcoming" however close it is.
  it('does not hold for a drop that has just gone', () => {
    expect(shouldHoldTierSlot(hit(worse), [armed(better)], at(13, 18))).toBe(
      false
    );
  });

  it('does not hold for an attraction with no drop times at all', () => {
    const noDrops = exp('nodrops', { tier: 1, priority: 1.0 });
    expect(shouldHoldTierSlot(hit(worse), [armed(noDrops)], at(9))).toBe(false);
  });

  it('never holds for a non-Tier-1 candidate', () => {
    const untiered = exp('untiered', { priority: 4.1 });
    expect(shouldHoldTierSlot(hit(untiered), [armed(better)], at(9))).toBe(
      false
    );
  });

  it('does not hold for a worse Tier 1', () => {
    expect(shouldHoldTierSlot(hit(better), [armed(worse)], at(9))).toBe(false);
  });

  it('does not hold for an equally ranked Tier 1', () => {
    const tie = exp('tie', {
      tier: 1,
      priority: 2.3,
      dropTimes: [at(15, 47)],
    });
    expect(shouldHoldTierSlot(hit(worse), [armed(tie)], at(9))).toBe(false);
  });

  it('does not hold against itself', () => {
    expect(shouldHoldTierSlot(hit(better), [armed(better)], at(9))).toBe(false);
  });

  it('ignores a better untiered attraction', () => {
    const betterUntiered = exp('bu', {
      priority: 1.0,
      dropTimes: [at(15, 47)],
    });
    expect(shouldHoldTierSlot(hit(worse), [armed(betterUntiered)], at(9))).toBe(
      false
    );
  });

  it('does not hold when nothing else is armed', () => {
    expect(shouldHoldTierSlot(hit(worse), [], at(9))).toBe(false);
  });

  // Wait Magic's FAQ: once any selection is redeemed, the party is no longer
  // limited to a single Tier 1, so there is no slot left to protect.
  it('never holds once the party has redeemed today', () => {
    expect(shouldHoldTierSlot(hit(worse), [armed(better)], at(9), true)).toBe(
      false
    );
  });

  it('still holds before any redemption', () => {
    expect(
      shouldHoldTierSlot(hit(worse), [armed(better)], at(12, 30), false)
    ).toBe(true);
  });

  it('holds if any one of several armed targets qualifies', () => {
    const irrelevant = exp('irr', { priority: 4.1 });
    expect(
      shouldHoldTierSlot(
        hit(worse),
        [armed(irrelevant), armed(better)],
        at(12, 30)
      )
    ).toBe(true);
  });
});

// Over the real attraction table, not synthetic ranks.
//
// The ranking data has been reverted once already by a wholesale adoption of
// upstream's values (a474377), and nothing failed: every test above builds its
// own experiences, so the numbers that actually decide Magic Kingdom's single
// Tier 1 selection were unguarded. These assert the *behaviour* PLAN.md 3.2
// asks for rather than the digits, so a future merge is free to renumber as
// long as the outcome holds.
describe('Magic Kingdom Tier 1 ranking, as shipped', () => {
  const BIG_THUNDER = '80010110';
  const JINGLE_CRUISE = '412010035';
  // The resort fixture strips every drop time and seeds two of its own, so
  // schedules have to be supplied here. Ranks, tiers and average waits are the
  // real shipped values, which is what these tests are about.
  const of = (id: string, dropTimes?: ParkTime[]) => ({
    ...(wdw.experience(id) as Experience),
    ...(dropTimes ? { dropTimes } : {}),
  });

  it('attempts Big Thunder before Jingle Cruise in the same tick', () => {
    const ordered = orderByPriority([
      hit(of(JINGLE_CRUISE)),
      hit(of(BIG_THUNDER)),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual([
      BIG_THUNDER,
      JINGLE_CRUISE,
    ]);
  });

  // A tie is not merely a cosmetic problem: `shouldHoldTierSlot` needs a
  // strictly better rank, so while these two shared a priority the hold was
  // disabled for the only pair at Magic Kingdom it matters for.
  it('can hold the Tier 1 slot for Big Thunder over Jingle Cruise', () => {
    expect(
      shouldHoldTierSlot(
        hit(of(JINGLE_CRUISE)),
        [armed(of(BIG_THUNDER, [at(8, 47)]))],
        at(8)
      )
    ).toBe(true);
  });

  it('never holds the slot the other way round', () => {
    expect(
      shouldHoldTierSlot(
        hit(of(BIG_THUNDER)),
        [armed(of(JINGLE_CRUISE, [at(8, 47)]))],
        at(8)
      )
    ).toBe(false);
  });

  // Both are Tier 1 at Magic Kingdom, which is what makes the ordering
  // consequential -- only one of them can be held before the first tap-in.
  it('has both as Tier 1', () => {
    expect(isTier1(of(BIG_THUNDER))).toBe(true);
    expect(isTier1(of(JINGLE_CRUISE))).toBe(true);
  });
});

// The same treatment for the two rankings this fork corrected after finding
// them reverted by the same upstream merge, plus the drop schedule that merge
// invented. Behaviour, not digits.
describe('Animal Kingdom ranking, as shipped', () => {
  const SAFARIS = '80010157';
  const EVEREST = '26068';
  const KALI = '80010154';
  const ZOOTOPIA = '412430582';
  const of = (id: string) => wdw.experience(id) as Experience;

  // They collide at the 12:47 drop, which is the same-tick case
  // `orderByPriority` decides. Shipped at 4 against Everest's 3.1, autopilot
  // attempted the lesser ride first through December's busiest drop.
  it('attempts Kilimanjaro Safaris before Expedition Everest', () => {
    const ordered = orderByPriority([hit(of(EVEREST)), hit(of(SAFARIS))]);
    expect(ordered.map(h => h.experience.id)).toEqual([SAFARIS, EVEREST]);
  });

  it('ranks both headliners above Kali River Rapids', () => {
    const ordered = orderByPriority([
      hit(of(KALI)),
      hit(of(EVEREST)),
      hit(of(SAFARIS)),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual([SAFARIS, EVEREST, KALI]);
  });

  // Unranked, it sorted last of everything -- and `chooseSwapVictim` reads
  // "worst ranked" as "cheapest to give up".
  it('ranks Zootopia between Everest and Kali', () => {
    const ordered = orderByPriority([
      hit(of(KALI)),
      hit(of(ZOOTOPIA)),
      hit(of(EVEREST)),
    ]);
    expect(ordered.map(h => h.experience.id)).toEqual([
      EVEREST,
      ZOOTOPIA,
      KALI,
    ]);
  });
});

describe('Hollywood Studios Tier 1 ranking, as shipped', () => {
  const FALCON = '19263735';
  const RUNAWAY_RAILWAY = '19259335';
  const of = (id: string, dropTimes?: ParkTime[]) => ({
    ...(wdw.experience(id) as Experience),
    ...(dropTimes ? { dropTimes } : {}),
  });

  // Both Tier 1, so only one can be held before the first tap-in. Millennium
  // Falcon carries a rank so that an unranked Tier 1 is not sorted last and
  // surrendered first -- but it must not be a rank that declines the harder
  // get to hold the slot for the easier one.
  it('never holds the Tier 1 slot for the Falcon over Runaway Railway', () => {
    expect(
      shouldHoldTierSlot(
        hit(of(RUNAWAY_RAILWAY)),
        [armed(of(FALCON, [at(10, 47)]))],
        at(10)
      )
    ).toBe(false);
  });

  it('gives the Falcon a rank at all', () => {
    expect(of(FALCON).priority).toBeDefined();
  });

  // Without this the hold assertion above could pass for the dull reason that
  // one of them is not a Tier 1 at all -- which is exactly how the first draft
  // of it passed against a parade's facility id.
  it('has both as Tier 1', () => {
    expect(isTier1(of(FALCON))).toBe(true);
    expect(isTier1(of(RUNAWAY_RAILWAY))).toBe(true);
  });

  // The other direction: Runaway Railway may hold the slot against the Falcon.
  it('can hold the slot for Runaway Railway over the Falcon', () => {
    expect(
      shouldHoldTierSlot(
        hit(of(FALCON)),
        [armed(of(RUNAWAY_RAILWAY, [at(11, 47)]))],
        at(11)
      )
    ).toBe(true);
  });
});

// PLAN.md 3.4: every current source says the ride has no predictable pop-up
// schedule since reopening, and `park.dropTimes` is the union of every
// experience's -- so one invented entry bursts the whole park at 1.2s and
// hands Big Thunder an "upcoming drop" that suppresses better Tier 1 offers.
describe('Big Thunder drop times, as shipped', () => {
  it('ships none', () => {
    expect(wdw.experience('80010110').dropTimes).toBeUndefined();
  });
});
