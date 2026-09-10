import { SKIP_TEXT } from '@/autopilot/events';
import { TimeSearchState } from '@/autopilot/useTimeSearch';
import Disclosure from '@/components/Disclosure';
import { Time } from '@/components/Time';
import { BookingLogEntry, Skip } from '@/contexts/AutopilotContext';

function Action({ entry }: { entry: BookingLogEntry }) {
  return (
    <li className="py-0.5">
      <Time time={entry.at} />{' '}
      {entry.status === 'booked' ? (
        <>
          booked <b>{entry.name}</b>
          {entry.returnTime && (
            <>
              {' '}
              for <Time time={entry.returnTime} />
            </>
          )}
        </>
      ) : entry.status === 'modified' ? (
        <>
          moved <b>{entry.name}</b>
          {entry.fromTime && entry.returnTime && (
            <>
              {' '}
              from <Time time={entry.fromTime} /> to{' '}
              <Time time={entry.returnTime} />
            </>
          )}
        </>
      ) : entry.status === 'swapped' ? (
        <>
          swapped in <b>{entry.name}</b>
          {entry.replacedName ? (
            <>
              {' '}
              for <b>{entry.replacedName}</b>
            </>
          ) : null}
        </>
      ) : entry.status === 'failed' ? (
        <>
          <span className="text-red-700">failed</span> on <b>{entry.name}</b>
          {entry.detail ? `: ${entry.detail}` : ''}
        </>
      ) : entry.status === 'dry-run' ? (
        <>
          would have{' '}
          {entry.detail === 'modify'
            ? 'moved'
            : entry.detail === 'swap'
              ? 'swapped in'
              : 'booked'}{' '}
          <b>{entry.name}</b>
        </>
      ) : (
        <>
          skipped <b>{entry.name}</b>
          {entry.detail ? `: ${SKIP_TEXT[entry.detail] ?? entry.detail}` : ''}
        </>
      )}
    </li>
  );
}

/** Activity owned by NextLL's nested quick-booking provider. */
export function NextLLBookingActivity({
  active,
  polls,
  entries,
  skipCounts,
  lastSkip,
}: {
  active: boolean;
  polls: number;
  entries: BookingLogEntry[];
  skipCounts: Record<string, number>;
  lastSkip?: Skip;
}) {
  const skips = Object.entries(skipCounts).sort((a, b) => b[1] - a[1]);
  if (!active && polls === 0 && entries.length === 0 && skips.length === 0) {
    return null;
  }

  return (
    <Disclosure title="Activity" count={entries.length}>
      <p className="text-sm text-gray-600">
        {polls} {polls === 1 ? 'check' : 'checks'} in this search.
      </p>
      <h3 className="mt-2">Booking activity</h3>
      {entries.length > 0 ? (
        <ul className="text-sm">
          {entries.map((entry, index) => (
            <Action key={`${entry.name}-${entry.at}-${index}`} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">No booking or move yet.</p>
      )}

      {lastSkip && (
        <p className="mt-2 text-sm">
          Latest check: <b>{lastSkip.name}</b> &mdash;{' '}
          {SKIP_TEXT[lastSkip.reason] ?? lastSkip.reason}.
        </p>
      )}
      {skips.length > 0 && (
        <>
          <h3 className="mt-2">Why no action was taken</h3>
          <ul className="text-sm">
            {skips.map(([reason, count]) => (
              <li key={reason} className="py-0.5">
                <span className="font-semibold">{count}&times;</span>{' '}
                {SKIP_TEXT[reason] ?? reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </Disclosure>
  );
}

const STOP_TEXT: Record<NonNullable<TimeSearchState['stop']>, string> = {
  'goal-met': 'The requested result was confirmed.',
  'nothing-better': 'The search ended without finding a better option.',
  'not-modifiable': 'Disney no longer allows this reservation to be changed.',
  unconfirmed: 'The change was accepted but is not yet confirmed in Plans.',
  stopped: 'You stopped the search.',
  failed: 'The search stopped after repeated errors.',
};

/** Compact diagnostics shared by both held-reservation NextLL searches. */
export function NextLLTimeSearchActivity({
  search,
  requested,
}: {
  search: Pick<
    TimeSearchState,
    | 'running'
    | 'pending'
    | 'stop'
    | 'unresolved'
    | 'cycles'
    | 'moves'
    | 'lastError'
    | 'phase'
  >;
  requested?: TimeSearchState['held'];
}) {
  const started =
    search.running ||
    search.cycles > 0 ||
    search.moves > 0 ||
    !!search.stop ||
    !!search.unresolved ||
    search.phase !== 'idle';
  if (!started) return null;

  return (
    <Disclosure title="Activity">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
        <dt className="font-semibold">Checks</dt>
        <dd>{search.cycles}</dd>
        <dt className="font-semibold">Changes</dt>
        <dd>{search.moves}</dd>
      </dl>
      <p className="mt-2 text-sm">
        {search.unresolved ? (
          <>
            Outcome unknown for the change to <Time time={search.unresolved} />.
          </>
        ) : search.pending ? (
          <>
            Waiting for your approval of <Time time={search.pending} />.
          </>
        ) : search.stop ? (
          STOP_TEXT[search.stop]
        ) : search.phase === 'awaiting' && requested ? (
          <>
            Waiting for Plans to confirm <Time time={requested} />.
          </>
        ) : (
          'Searching for an acceptable option.'
        )}
      </p>
      {search.lastError && (
        <p className="mt-1 text-sm text-red-700">
          Last error: {search.lastError}
        </p>
      )}
    </Disclosure>
  );
}
