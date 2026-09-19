import { checklist } from './checklist';

describe('checklist()', () => {
  const base = {
    partySize: 1,
    targets: [{ experienceId: 'ride', autoBook: true }],
    notifications: 'granted' as const,
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
});
