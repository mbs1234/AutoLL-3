import { ParkTime } from '@/datetime';

import { checklist, windowsKey } from './checklist';
import { WatchTarget } from './watchlist';

describe('checklist()', () => {
  const base = {
    partySize: 1,
    targets: [{ experienceId: 'ride', autoBook: true }],
    notifications: 'granted' as const,
    sound: 'idle' as const,
    windowsConfirmed: false,
  };

  it('marks Plan Check complete once this plan has been reviewed', () => {
    expect(
      checklist({ ...base, planReviewed: true, planBlockers: 0 })
    ).toContainEqual(
      expect.objectContaining({
        subject: 'plan-check',
        done: true,
        text: 'Plan Check reviewed',
      })
    );
  });

  it('keeps Plan Check outstanding before it has been opened', () => {
    expect(
      checklist({ ...base, planReviewed: false, planBlockers: 0 })
    ).toContainEqual(
      expect.objectContaining({ subject: 'plan-check', done: false })
    );
  });

  it('does not certify a reviewed plan that still has blockers', () => {
    expect(
      checklist({ ...base, planReviewed: true, planBlockers: 2 })
    ).toContainEqual(
      expect.objectContaining({
        subject: 'plan-check',
        done: false,
        text: 'Plan Check found 2 blockers',
      })
    );
  });

  const alertLine = (
    notifications: 'granted' | 'unsupported',
    sound: 'idle' | 'armed' | 'unsupported'
  ) =>
    checklist({
      ...base,
      notifications,
      sound,
      planReviewed: true,
      planBlockers: 0,
    }).find(
      item => item.subject === 'notifications' || item.subject === 'sound'
    );

  // An iPhone in Safari has no notifications, so the chime is its only
  // alert. The line used to tick "unavailable" as done and leave the chime
  // untested.
  it('asks for the sound to be tested where there are no notifications', () => {
    expect(alertLine('unsupported', 'idle')).toEqual({
      subject: 'sound',
      done: false,
      text: 'Test the alert sound: it is the only alert here',
    });
  });

  it('is done there once the sound has played', () => {
    expect(alertLine('unsupported', 'armed')).toMatchObject({
      subject: 'sound',
      done: true,
    });
  });

  it('says plainly when nothing can alert at all', () => {
    expect(alertLine('unsupported', 'unsupported')).toMatchObject({
      subject: 'sound',
      done: false,
      text: expect.stringMatching(/neither notify nor play/),
    });
  });

  it('keeps asking about notifications where they exist', () => {
    expect(alertLine('granted', 'idle')).toMatchObject({
      subject: 'notifications',
      done: true,
    });
  });

  // FUTURE §2.5: "windows set where wanted" has no objective done state, so
  // it is the person's say-so, and it asks again when a window changes.
  describe('the return windows', () => {
    const windowsLine = (
      targets: Parameters<typeof checklist>[0]['targets'],
      windowsConfirmed = false
    ) =>
      checklist({
        ...base,
        targets,
        windowsConfirmed,
        planReviewed: true,
        planBlockers: 0,
      }).find(item => item.subject === 'windows');

    it('asks for them to be confirmed, saying how many are set', () => {
      expect(
        windowsLine([
          { experienceId: 'a', after: new ParkTime(9, 45) },
          { experienceId: 'b', before: new ParkTime(14) },
          { experienceId: 'c' },
        ])
      ).toEqual({
        subject: 'windows',
        done: false,
        text: 'Confirm the return windows (2 of 3 set)',
      });
    });

    it('says when none is set, which means any time', () => {
      expect(windowsLine([{ experienceId: 'a' }])?.text).toBe(
        'Confirm the return windows (none set, so any time)'
      );
    });

    it('is done once they are confirmed', () => {
      expect(windowsLine([{ experienceId: 'a' }], true)).toMatchObject({
        done: true,
        text: 'Return windows confirmed (none set, so any time)',
      });
    });

    it('is not a step until there is a target', () => {
      expect(windowsLine([])).toBeUndefined();
    });

    it('comes after the actions and before the alerts', () => {
      expect(
        checklist({ ...base, planReviewed: true, planBlockers: 0 }).map(
          item => item.subject
        )
      ).toEqual([
        'party',
        'targets',
        'settings',
        'windows',
        'notifications',
        'plan-check',
      ]);
    });
  });
});

describe('windowsKey()', () => {
  const mk = 'mk';
  const day = 'day';
  const a: WatchTarget = { experienceId: 'a', after: new ParkTime(9, 45) };
  const b: WatchTarget = { experienceId: 'b' };
  const plan = [a, b];

  it('is the same for the same windows, in any order', () => {
    expect(windowsKey([...plan].reverse(), mk, day)).toBe(
      windowsKey(plan, mk, day)
    );
  });

  // What makes a confirmed tick lapse by itself.
  it('changes when a window changes', () => {
    expect(
      windowsKey([{ ...a, after: new ParkTime(10) }, b], mk, day)
    ).not.toBe(windowsKey(plan, mk, day));
    expect(
      windowsKey([a, { ...b, before: new ParkTime(14) }], mk, day)
    ).not.toBe(windowsKey(plan, mk, day));
  });

  it('changes when a target comes or goes', () => {
    expect(windowsKey([a], mk, day)).not.toBe(windowsKey(plan, mk, day));
    expect(windowsKey([...plan, { experienceId: 'c' }], mk, day)).not.toBe(
      windowsKey(plan, mk, day)
    );
  });

  it('is for one park and one day', () => {
    expect(windowsKey(plan, 'ep', day)).not.toBe(windowsKey(plan, mk, day));
    expect(windowsKey(plan, mk, 'other')).not.toBe(windowsKey(plan, mk, day));
  });
});
