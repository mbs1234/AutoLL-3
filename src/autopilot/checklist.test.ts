import { checklist } from './checklist';

describe('checklist()', () => {
  const base = {
    partySize: 1,
    targets: [{ experienceId: 'ride', autoBook: true }],
    notifications: 'granted' as const,
    sound: 'idle' as const,
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
});
