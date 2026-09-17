import { CALL_TEXT, RefusalState, refusedCalls } from '@/autopilot/refusal';
import { PollerStatus } from '@/autopilot/usePoller';
import {
  AutopilotHit,
  BookingLogEntry,
  Skip,
} from '@/contexts/AutopilotContext';
import { ParkTime, formatTime } from '@/datetime';

/** Plain-language labels for skip reasons; unknown ones show as-is. */
export const SKIP_TEXT: Record<string, string> = {
  'partial-party': 'not everyone in the party was eligible',
  'tier-hold': 'held the Tier 1 slot for a better attraction',
  'offer-outside-window': 'the offered time was outside the window',
  'not-an-improvement': 'the time was not enough better to move for',
  'offer-not-an-improvement': 'the offer came back not enough better',
  'no-eligible-guests': 'nobody was eligible',
  'not-full': 'a slot was free, so it booked instead of swapping',
  'no-worse-reservation': 'nothing held was worth giving up',
  'already-attempted': 'a booking for it was already held or in flight',
  'outside-window': 'the advertised time was outside the window',
  'overlaps-plans': 'it clashed with something already booked',
  'not-modifiable': 'Disney marked the reservation unmodifiable',
  'no-longer-wanted': 'you changed the plan while the request was in flight',
  'not-enabled': 'that action is not switched on for this attraction',
  'no-existing-booking': 'there was no reservation to move',
  'already-held': 'you already hold a pass for it',
  // Raised by the provider, not by a helper, which is how it was missed: a
  // rejected action waits out a cooldown before it is tried again, and during
  // that wait the log said "waiting-to-retry" -- a raw identifier, shown at
  // exactly the moment the user is asking why nothing is booking.
  'waiting-to-retry':
    'it failed a moment ago and is waiting before trying again',
};

export const skipText = (reason: string) => SKIP_TEXT[reason] ?? reason;

export type EventLevel = 'info' | 'warn' | 'error';

export interface AutopilotEvent {
  /** When it happened; absent for a find, which the engine does not stamp. */
  at?: ParkTime;
  text: string;
  level: EventLevel;
}

export interface EventFacts {
  status: PollerStatus;
  refusals?: RefusalState;
  /** Newest first, as the provider keeps it. */
  bookingLog: BookingLogEntry[];
  lastSkip?: Skip;
  lastHit?: AutopilotHit;
  now: ParkTime;
}

/** How long an action outranks the cadence while the poller is busy at a drop. */
export const RECENT_S = 120;

const fmt = (time: ParkTime) => formatTime(time);

function actionEvent(entry: BookingLogEntry): AutopilotEvent {
  const { name, at, returnTime, fromTime, detail } = entry;
  const forTime = returnTime ? ` for ${fmt(returnTime)}` : '';
  if (entry.status === 'booked') {
    return { at, level: 'info', text: `Booked ${name}${forTime}` };
  }
  if (entry.status === 'modified') {
    const span =
      fromTime && returnTime
        ? ` from ${fmt(fromTime)} to ${fmt(returnTime)}`
        : '';
    return { at, level: 'info', text: `Moved ${name}${span}` };
  }
  if (entry.status === 'swapped') {
    const gaveUp = entry.replacedName ? ` for ${entry.replacedName}` : '';
    return { at, level: 'info', text: `Swapped in ${name}${gaveUp}` };
  }
  if (entry.status === 'dry-run') {
    const verb =
      detail === 'modify'
        ? 'moved'
        : detail === 'swap'
          ? 'swapped in'
          : 'booked';
    return { at, level: 'info', text: `Would have ${verb} ${name}${forTime}` };
  }
  if (entry.status === 'skipped') {
    const why = detail ? `: ${skipText(detail)}` : '';
    return { at, level: 'info', text: `Skipped ${name}${why}` };
  }
  const why = detail ? `: ${detail}` : '';
  return { at, level: 'warn', text: `Failed on ${name}${why}` };
}

function skipEvent(skip: Skip): AutopilotEvent {
  return {
    at: skip.at,
    level: 'info',
    text: `Skipped ${skip.name}: ${skipText(skip.reason)}`,
  };
}

export interface ActivityFacts {
  /** Newest first, as the provider keeps it. */
  bookingLog: BookingLogEntry[];
  lastSkip?: Skip;
  lastHit?: AutopilotHit;
}

/** The newer of the last logged action and the last skip, if either. */
function newestAction({ bookingLog, lastSkip }: ActivityFacts) {
  return [
    bookingLog[0] ? actionEvent(bookingLog[0]) : undefined,
    lastSkip ? skipEvent(lastSkip) : undefined,
  ]
    .filter((event): event is AutopilotEvent => !!event)
    .sort((a, b) => +(b.at ?? 0) - +(a.at ?? 0))[0];
}

function findEvent(hit: AutopilotHit): AutopilotEvent {
  return {
    level: 'info',
    text: `Found ${hit.name} at ${fmt(hit.returnTime)}`,
  };
}

/**
 * What Autopilot last did, or last saw, with no status mixed in.
 *
 * For a screen that already reports the cadence and the failures itself and
 * wants one more line: the newest action or skip, else the last find.
 */
export function latestActivity(
  facts: ActivityFacts
): AutopilotEvent | undefined {
  return (
    newestAction(facts) ??
    (facts.lastHit ? findEvent(facts.lastHit) : undefined)
  );
}

/**
 * The one line worth showing about Autopilot right now.
 *
 * Most urgent first: a poller that has given up; Disney refusing the booking
 * path; the newest action or skip; the cadence, when the poller is busy around
 * a drop and nothing has happened in the last two minutes; the last find; and
 * finally the fact that it is watching. Off with nothing to report says
 * nothing, so a screen can leave the line out.
 */
export function latestEvent(facts: EventFacts): AutopilotEvent | undefined {
  const { status, refusals, bookingLog, lastSkip, lastHit, now } = facts;

  if (status.mode === 'stopped') {
    const why = status.lastError ? `: ${status.lastError}` : '';
    return {
      at: now,
      level: 'error',
      text: `Stopped after ${status.consecutiveFailures} failed checks${why}`,
    };
  }

  const refused =
    status.mode === 'off' || !refusals ? [] : refusedCalls(refusals, now);
  if (refused.length > 0) {
    return {
      at: now,
      level: 'error',
      text: `Disney is refusing ${refused.map(c => CALL_TEXT[c]).join(' and ')}`,
    };
  }

  const newest = newestAction({ bookingLog, lastSkip });
  const busy = status.mode === 'burst' || status.mode === 'approach';
  const recent = newest?.at !== undefined && +now - +newest.at <= RECENT_S;
  if (newest && (!busy || recent)) return newest;

  if (busy) {
    const pace =
      status.mode === 'burst' ? 'Checking rapidly' : 'Checking often';
    const drop = status.target ? ` for the ${fmt(status.target)} drop` : '';
    return { at: now, level: 'info', text: `${pace}${drop}` };
  }
  if (lastHit) return findEvent(lastHit);
  if (status.mode === 'idle') {
    return { at: now, level: 'info', text: 'Watching' };
  }
  return undefined;
}
