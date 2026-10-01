import type { AudioStatus } from './alert';
import { WatchTarget, targetActs } from './watchlist';

export interface ChecklistItem {
  done: boolean;
  text: string;
  subject:
    | 'party'
    | 'targets'
    | 'unknown'
    | 'settings'
    | 'windows'
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

/**
 * What a "return windows confirmed" tick was given for: these targets'
 * windows, at this park, on this date. A window changed, or a target added or
 * taken away, makes a different key, so the tick lapses by itself, as Plan
 * Check's reviewed tick does when the plan changes.
 */
export function windowsKey(
  targets: WatchTarget[],
  parkId: string,
  date: string
): string {
  return JSON.stringify({
    parkId,
    date,
    windows: targets
      .map(target => [
        target.experienceId,
        target.after ? String(target.after) : '',
        target.before ? String(target.before) : '',
      ])
      .sort(),
  });
}

/**
 * Whether the return windows are where they are wanted: an acknowledgement,
 * not a test. No window is wrong in itself, and "any time" is often the
 * point, so only the person can say. Offered once there is a target.
 */
function windowsItem(
  targets: WatchTarget[],
  confirmed: boolean
): ChecklistItem {
  const set = targets.filter(target => target.after || target.before).length;
  const summary =
    set === 0 ? 'none set, so any time' : `${set} of ${targets.length} set`;
  return {
    done: confirmed,
    text: confirmed
      ? `Return windows confirmed (${summary})`
      : `Confirm the return windows (${summary})`,
    subject: 'windows',
  };
}

/** A deliberately local, no-request pre-trip readiness summary. */
export function checklist({
  partySize,
  targets,
  notifications,
  sound,
  windowsConfirmed,
  unknownAttractions = 0,
  planReviewed,
  planBlockers,
}: {
  partySize: number;
  targets: WatchTarget[];
  notifications: 'granted' | 'denied' | 'default' | 'unsupported';
  /** The alert sound's state, which matters where notifications do not exist. */
  sound: AudioStatus;
  /** Whether these targets' windows, as they are now, were confirmed. */
  windowsConfirmed: boolean;
  /**
   * How many attractions Disney lists that this build does not recognise.
   * They cannot be watched, so a plan may be missing one; Configure names
   * them.
   */
  unknownAttractions?: number;
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
    // Not a step anyone can tick: only an update to the build's data can
    // recognise a ride. It is here so the route to the names is a tap, where
    // Today's red line about it only said where to look.
    ...(unknownAttractions > 0
      ? [
          {
            done: false,
            text: `Disney lists ${unknownAttractions} attraction${unknownAttractions === 1 ? '' : 's'} this build does not recognise`,
            subject: 'unknown' as const,
          },
        ]
      : []),
    {
      done: actions,
      text: actions
        ? 'An action is armed'
        : 'Watch-only plan — review actions before the trip',
      subject: 'settings',
    },
    ...(targets.length > 0 ? [windowsItem(targets, windowsConfirmed)] : []),
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
