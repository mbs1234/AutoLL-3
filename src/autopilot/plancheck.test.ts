import { createBooking, hm, jc, multiExp, sm } from '@/__fixtures__/ll';
import { mk } from '@/__fixtures__/resort';
import { ParkTime } from '@/datetime';
import { TODAY, TOMORROW, setTime } from '@/testing';

import { PlanCheckInput, checkPlan } from './plancheck';

// The Tier 1 hold applies only to the current park day, and `checkPlan`
// compares its input against `parkDate()`. Without pinning the clock, TODAY
// is a 2021 fixture date and the real park day is not, so every Tier 1
// assertion would pass or fail by accident.
setTime('09:00');

const base = (): PlanCheckInput => ({
  targets: [{ experienceId: hm.id, autoBook: true }],
  parkId: mk.id,
  date: TODAY,
  experiences: [hm, jc, sm],
  plans: [],
  bookingsRemaining: 3,
  requireWholeParty: true,
  avoidOverlaps: true,
  dryRun: false,
  tierLimitLifted: false,
});

/** Every text at a level, for asserting what is *absent* as well as present. */
const texts = (input: PlanCheckInput, level?: string) =>
  checkPlan(input)
    .filter(item => !level || item.level === level)
    .map(item => item.text)
    .join('\n');

describe('checkPlan', () => {
  it('blocks a plan with no targets for the selected park and date', () => {
    expect(
      checkPlan({
        ...base(),
        targets: [{ experienceId: hm.id, parkId: 'somewhere-else' }],
      })
    ).toEqual([
      expect.objectContaining({
        level: 'blocker',
        text: expect.stringMatching(/No saved targets/),
        subject: { kind: 'targets' },
      }),
    ]);
  });

  it('finds an impossible window and an exhausted action budget', () => {
    const items = checkPlan({
      ...base(),
      bookingsRemaining: 0,
      targets: [
        {
          experienceId: hm.id,
          autoBook: true,
          after: new ParkTime(15),
          before: new ParkTime(10),
        },
      ],
    });
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'blocker',
          text: expect.stringMatching(/budget/),
        }),
        expect.objectContaining({
          level: 'blocker',
          text: expect.stringMatching(/impossible/),
        }),
      ])
    );
  });

  it('flags a paused action and an absent target', () => {
    expect(
      texts({
        ...base(),
        targets: [
          { experienceId: hm.id, autoBook: true, paused: true },
          { experienceId: 'missing', name: 'Missing ride', autoBook: true },
        ],
      })
    ).toMatch(/paused[\s\S]*|Missing ride/);
  });

  it('reports a clean plan without making any network-dependent claim', () => {
    expect(checkPlan(base())).toEqual([
      expect.objectContaining({
        level: 'ready',
        text: expect.stringMatching(/Eligibility, inventory/),
      }),
    ]);
  });

  // Each of the four action flags admits a target on its own. Only autoBook
  // was ever exercised, so dropping any of the others from `acts` was free.
  it.each(['autoBook', 'autoModify', 'bookThenMove', 'autoSwap'] as const)(
    'treats %s alone as an armed action',
    flag => {
      expect(
        texts({ ...base(), targets: [{ experienceId: hm.id, [flag]: true }] })
      ).not.toMatch(/watches and alerts only/);
    }
  );

  it('says so when nothing is armed', () => {
    expect(texts({ ...base(), targets: [{ experienceId: hm.id }] })).toMatch(
      /watches and alerts only/
    );
  });

  describe('the two global toggles', () => {
    it('reports whole-party-off', () => {
      expect(texts({ ...base(), requireWholeParty: false })).toMatch(
        /Whole party only is off/
      );
    });

    it('reports avoid-clashes-off', () => {
      expect(texts({ ...base(), avoidOverlaps: false })).toMatch(
        /Avoid clashes is off/
      );
    });

    // The most decisive setting there is: `stillPermitted` opens with
    // `!dryRun`, so a rehearsing plan books nothing at all.
    it('reports dry run', () => {
      expect(texts({ ...base(), dryRun: true })).toMatch(/Dry run is on/);
    });
  });

  describe('overlaps', () => {
    /** Straddles the trailing edge of an 11:00 booking's protected span. */
    const windowed = (id: string) => ({
      experienceId: id,
      autoBook: true,
      after: new ParkTime(11, 30),
      before: new ParkTime(12, 30),
    });

    it('reviews a bounded window that crosses a held plan', () => {
      expect(
        texts({
          ...base(),
          targets: [windowed(jc.id)],
          plans: [createBooking(hm, { startTime: new ParkTime(11) })],
        })
      ).toMatch(/Jungle Cruise.*overlaps/);
    });

    // The provider excludes the reservation being moved, because moving a
    // booking necessarily clashes with itself. This used to read "Jungle
    // Cruise's return window overlaps Jungle Cruise".
    it('does not clash a target against its own held reservation', () => {
      expect(
        texts({
          ...base(),
          targets: [{ ...windowed(jc.id), autoModify: true }],
          plans: [createBooking(jc, { startTime: new ParkTime(11) })],
        })
      ).not.toMatch(/Jungle Cruise’s return window/);
    });

    // `overlappingPlans` ignores a Multiple Experiences Pass and says why: it
    // constrains nothing, so protecting a band around it refuses return times
    // for no reason.
    it('does not treat a Multiple Experiences Pass as a clash', () => {
      expect(
        texts({
          ...base(),
          targets: [
            {
              experienceId: jc.id,
              autoBook: true,
              after: new ParkTime(15),
              before: new ParkTime(16),
            },
          ],
          plans: [multiExp],
        })
      ).not.toMatch(/overlaps/);
    });

    it('blocks a window that lies wholly inside a protected span', () => {
      expect(
        texts({
          ...base(),
          targets: [
            {
              experienceId: jc.id,
              autoBook: true,
              after: new ParkTime(11),
              before: new ParkTime(11, 20),
            },
          ],
          plans: [createBooking(hm, { startTime: new ParkTime(11) })],
        })
      ).toMatch(/entire return window/);
    });

    // With the setting off the provider never looks at plans, so an overlap
    // item here contradicted the "Avoid clashes is off" item beside it.
    it('says nothing about overlaps when avoid clashes is off', () => {
      const out = texts({
        ...base(),
        avoidOverlaps: false,
        targets: [windowed(jc.id)],
        plans: [createBooking(hm, { startTime: new ParkTime(11) })],
      });
      expect(out).not.toMatch(/Jungle Cruise/);
      // The global advisory is still expected -- it is the one that explains
      // why no per-target overlap is reported.
      expect(out).toMatch(/Avoid clashes is off/);
    });

    it('does not review an overlap for a target that is not on the tipboard', () => {
      expect(
        texts({
          ...base(),
          targets: [{ ...windowed('missing'), name: 'Missing ride' }],
          plans: [createBooking(hm, { startTime: new ParkTime(11) })],
        })
      ).not.toMatch(/Missing ride.*overlaps/);
    });
  });

  describe('the Tier 1 hold', () => {
    const tierOne = (): PlanCheckInput => ({
      ...base(),
      targets: [
        { experienceId: jc.id, autoBook: true },
        { experienceId: sm.id, autoBook: true },
      ],
    });

    it('warns when two Tier 1 targets are armed for booking', () => {
      expect(texts(tierOne())).toMatch(/More than one Tier 1/);
    });

    // Pausing is the remedy the warning itself recommends, and the provider
    // drops a paused target from the armed set before the hold is considered.
    it('stops warning once one of them is paused', () => {
      const input = tierOne();
      input.targets[1] = { ...input.targets[1]!, paused: true };
      expect(texts(input)).not.toMatch(/More than one Tier 1/);
    });

    it('stops warning once one of them is already held', () => {
      expect(
        texts({
          ...tierOne(),
          plans: [createBooking(sm, { startTime: new ParkTime(13) })],
        })
      ).not.toMatch(/More than one Tier 1/);
    });

    // The hold applies to a booking only; a move-only target cannot cause it.
    it('ignores a modify-only Tier 1 target', () => {
      expect(
        texts({
          ...base(),
          targets: [
            { experienceId: jc.id, autoBook: true },
            { experienceId: sm.id, autoModify: true },
          ],
        })
      ).not.toMatch(/More than one Tier 1/);
    });

    // `forToday` gates the whole hold in the provider.
    it('does not warn on a future date', () => {
      expect(texts({ ...tierOne(), date: TOMORROW })).not.toMatch(
        /More than one Tier 1/
      );
    });

    // Only a spent entitlement lifts the limit. A merely configured passkey
    // used to silence this, which is the "a reservation is not a redemption"
    // mistake the provider documents having already fixed.
    it('is not silenced by a passkey that has not been spent', () => {
      const input = tierOne();
      input.targets[0] = { ...input.targets[0]!, passkey: true };
      expect(texts(input)).toMatch(/More than one Tier 1/);
    });

    it('is silenced once the limit is reported lifted', () => {
      expect(texts({ ...tierOne(), tierLimitLifted: true })).not.toMatch(
        /More than one Tier 1/
      );
    });
  });

  // The tipboard is empty on first paint and after any failed refresh, and
  // while it is, every per-attraction check is skipped. Falling through to
  // "ready" made the most reassuring verdict the least informed one.
  it('does not report a clean plan when the tipboard has not loaded', () => {
    const items = checkPlan({ ...base(), experiences: [] });
    expect(items.some(item => item.level === 'ready')).toBe(false);
    expect(items[0]?.text).toMatch(/tipboard for this park and date has not/);
  });

  it('puts blockers above reviews so the heading count matches', () => {
    const items = checkPlan({
      ...base(),
      targets: [
        {
          experienceId: hm.id,
          after: new ParkTime(15),
          before: new ParkTime(10),
        },
      ],
    });
    expect(items.map(item => item.level)).toEqual(['blocker', 'review']);
  });
});
