import { WatchTarget } from './watchlist';

export interface ChecklistItem {
  done: boolean;
  text: string;
  subject: 'party' | 'targets' | 'settings' | 'notifications' | 'plan-check';
}

/** A deliberately local, no-request pre-trip readiness summary. */
export function checklist({
  partySize,
  targets,
  notifications,
}: {
  partySize: number;
  targets: WatchTarget[];
  notifications: 'granted' | 'denied' | 'default' | 'unsupported';
}): ChecklistItem[] {
  const actions = targets.some(
    target =>
      !target.paused &&
      (target.autoBook ||
        target.autoModify ||
        target.autoSwap ||
        target.bookThenMove)
  );
  return [
    {
      done: partySize > 0,
      text: partySize > 0 ? `Party saved (${partySize})` : 'Choose a party',
      subject: 'party',
    },
    {
      done: targets.length > 0,
      text:
        targets.length > 0
          ? `${targets.length} target${targets.length === 1 ? '' : 's'} selected`
          : 'Choose at least one target',
      subject: 'targets',
    },
    {
      done: actions,
      text: actions
        ? 'An action is armed'
        : 'Watch-only plan — review actions before the trip',
      subject: 'settings',
    },
    {
      done: notifications === 'granted' || notifications === 'unsupported',
      text:
        notifications === 'granted'
          ? 'Notifications allowed'
          : notifications === 'unsupported'
            ? 'Browser notifications unavailable'
            : 'Enable notifications if you want alerts',
      subject: 'notifications',
    },
    {
      done: false,
      text: 'Run Plan Check before enabling Autopilot',
      subject: 'plan-check',
    },
  ];
}
