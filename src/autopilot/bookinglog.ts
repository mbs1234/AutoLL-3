import { BookingLogEntry } from '@/contexts/AutopilotContext';

/**
 * A failure described without quoting Disney back to the screen.
 *
 * `RequestError`'s message is `${message}: ${JSON.stringify(response)}` -- the
 * whole response object, `data` included. For an `ll.guests` call that data is
 * guest records: names, party composition, entitlement ids. It was going
 * straight into the activity log, which is rendered on the Activity screen and
 * persisted to localStorage on Disney's own origin, where it stayed for the
 * day. The status and the endpoint are all the diagnostics ever use.
 */
export function describeFailure(outcome: {
  error: string;
  httpStatus?: number;
}): string {
  if (outcome.httpStatus !== undefined) {
    return `Request failed (${outcome.httpStatus})`;
  }
  // Anything from the first brace on is a serialised body rather than a
  // message. Truncated as well, so an error from somewhere else cannot flood
  // the row either.
  const body = outcome.error.indexOf('{');
  const text = body === -1 ? outcome.error : outcome.error.slice(0, body);
  return text.replace(/[:\s]+$/, '').slice(0, 120) || 'Request failed';
}

/** How many rows the activity log keeps. */
export const LOG_ROWS = 20;

/**
 * Add one entry, collapsing a repeat of the failure already at the top.
 *
 * During a refusal every tick produces the same failure, and in burst cadence
 * that is several a second against a twenty-row log -- so the day's real
 * bookings were gone within a minute, replaced by copies of one error. The row
 * carries a count instead, and keeps the time of the most recent occurrence.
 */
export function addLogEntry(
  log: BookingLogEntry[],
  entry: BookingLogEntry
): BookingLogEntry[] {
  const [newest, ...rest] = log;
  const sameFailure =
    newest &&
    newest.status === 'failed' &&
    entry.status === 'failed' &&
    newest.name === entry.name &&
    newest.detail === entry.detail;
  if (sameFailure) {
    return [{ ...entry, repeated: (newest.repeated ?? 1) + 1 }, ...rest].slice(
      0,
      LOG_ROWS
    );
  }
  return [entry, ...log].slice(0, LOG_ROWS);
}
