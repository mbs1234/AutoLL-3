import type { AudioStatus } from './alert';
import { WatchTarget, targetActs } from './watchlist';

export interface ChecklistItem {
  done: boolean;
  text: string;
  subject:
    | 'party'
    | 'targets'
    | 'settings'
    | 'notifications'
    | 'sound'
    | 'plan-check';
}

/**
 * The alert channel a phone will actually use.
 *
 * Notifications where the browser has them. Where it does not -- Safari on an
 * iPhone, outside an installed web app -- the chime is the only alert, so the
 * line is about the chime, and it is done only once the chime has played. It
 * used to tick "Browser notifications unavailable" as done, as though nothing
 * were left to check, while the one channel left went untested.
 */
function alertItem(
  notifications: 'granted' | 'denied' | 'default' | 'unsupported',
  sound: AudioStatus
): ChecklistItem {
  if (notifications !== 'unsupported') {
    return {
      done: notifications === 'granted',
      text:
        notifications === 'granted'
          ? 'Notifications allowed'
          : 'Enable notifications if you want alerts',
      subject: 'notifications',
    };
  }
  if (sound === 'unsupported') {
    return {
      done: false,
      text: 'No alerts here: this browser can neither notify nor play the alert sound',
      subject: 'sound',
    };
  }
  return sound === 'armed'
    ? {
        done: true,
        text: 'Alert sound works: it is the only alert here',
        subject: 'sound',
      }
    : {
        done: false,
        text: 'Test the alert sound: it is the only alert here',
        subject: 'sound',
      };
}

/** A deliberately local, no-request pre-trip readiness summary. */
export function checklist({
  partySize,
  targets,
  notifications,
  sound,
  planReviewed,
  planBlockers,
}: {
  partySize: number;
  targets: WatchTarget[];
  notifications: 'granted' | 'denied' | 'default' | 'unsupported';
  /** The alert sound's state, which matters where notifications do not exist. */
  sound: AudioStatus;
  /** Whether the current park/date/configuration's result was actually shown. */
  planReviewed: boolean;
  /** Blocking findings in that current result. */
  planBlockers: number;
}): ChecklistItem[] {
  const actions = targets.some(target => !target.paused && targetActs(target));
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
    alertItem(notifications, sound),
    {
      done: planReviewed && planBlockers === 0,
      text:
        planBlockers > 0
          ? `Plan Check found ${planBlockers} blocker${planBlockers === 1 ? '' : 's'}`
          : planReviewed
            ? 'Plan Check reviewed'
            : 'Run Plan Check before enabling Autopilot',
      subject: 'plan-check',
    },
  ];
}
