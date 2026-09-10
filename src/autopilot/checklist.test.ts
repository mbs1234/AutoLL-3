import { checklist } from './checklist';

describe('checklist()', () => {
  const base = {
    partySize: 1,
    targets: [{ experienceId: 'ride', autoBook: true }],
    notifications: 'granted' as const,
  };

  it('marks Plan Check complete once this plan has been reviewed', () => {
    expect(checklist({ ...base, planChecked: true })).toContainEqual(
      expect.objectContaining({
        subject: 'plan-check',
        done: true,
        text: 'Plan Check reviewed',
      })
    );
  });

  it('keeps Plan Check outstanding before it has been opened', () => {
    expect(checklist({ ...base, planChecked: false })).toContainEqual(
      expect.objectContaining({ subject: 'plan-check', done: false })
    );
  });
});
