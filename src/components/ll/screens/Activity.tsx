import { use } from 'react';

import { SKIP_TEXT } from '@/autopilot/events';
import {
  DEMOTION_MIN_COVERED_DAYS,
  LEARNED_MIN_DAYS,
} from '@/autopilot/learned';
import Screen from '@/components/Screen';
import { Time } from '@/components/Time';
import ContextStrip from '@/components/ll/ContextStrip';
import AutopilotContext from '@/contexts/AutopilotContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';

export const ACTIVITY = 'Activity';

/**
 * Whether the evidence for one scheduled time is entirely negative.
 *
 * Not the same as "the poller has stopped bursting at it". That decision is
 * made per minute across the whole park -- a minute stays active while any
 * attraction sharing it still has evidence -- and demotion does not act at
 * all yet (see DEMOTION_ENABLED). So this describes the evidence, and the
 * copy below says so rather than claiming the time is unused.
 */
function hasOnlyNegativeEvidence(coveredDays: number, observedDays: number) {
  return coveredDays >= DEMOTION_MIN_COVERED_DAYS && observedDays === 0;
}

/**
 * What Autopilot has done, why it has not, and what it has learned.
 *
 * Reference material: the day's log, the skip counts, the drop times seen.
 * Today headlines the newest of these; this is the rest, on a screen of its
 * own so the tab stays short.
 */
export default function Activity() {
  const { bookingLog, skipCounts, dropSummaries } = use(AutopilotContext);
  const { experiences } = use(ExperiencesContext);
  const { park } = use(ParkContext);

  const nameOf = (experienceId: string) =>
    experiences.find(e => e.id === experienceId)?.name ?? experienceId;
  // Only attractions with something to say: an observation, or a scheduled
  // time the poller has actually watched for at least once.
  const learned = dropSummaries.filter(
    d => d.observed.length > 0 || d.scheduled.some(c => c.coveredDays > 0)
  );
  const observationCount = dropSummaries.reduce(
    (n, d) => n + d.observed.reduce((m, o) => m + o.count, 0),
    0
  );

  return (
    <Screen title={ACTIVITY} theme={park.theme} subhead={<ContextStrip />}>
      <h3>Booking activity ({bookingLog.length})</h3>
      {bookingLog.length === 0 ? (
        <p className="text-sm text-gray-600">
          Nothing booked, moved or swapped yet today.
        </p>
      ) : (
        <ul className="text-sm">
          {bookingLog.map((entry, i) => (
            <li key={`${entry.name}-${i}`} className="py-0.5">
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
              ) : entry.status === 'dry-run' ? (
                <>
                  <span className="text-yellow-700">would have</span>{' '}
                  {entry.detail === 'modify'
                    ? 'moved'
                    : entry.detail === 'swap'
                      ? 'swapped in'
                      : 'booked'}{' '}
                  <b>{entry.name}</b>
                  {entry.returnTime && (
                    <>
                      {' '}
                      for <Time time={entry.returnTime} />
                    </>
                  )}
                </>
              ) : entry.status === 'swapped' ? (
                <>
                  swapped in <b>{entry.name}</b>
                  {entry.replacedName && (
                    <>
                      {' '}
                      for <b>{entry.replacedName}</b>
                    </>
                  )}
                  {entry.returnTime && (
                    <>
                      {' '}
                      at <Time time={entry.returnTime} />
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
              ) : (
                <>
                  <span className="text-red-700">failed</span> on{' '}
                  <b>{entry.name}</b>
                  {entry.detail ? `: ${entry.detail}` : ''}
                  {entry.repeated && entry.repeated > 1 ? (
                    <span className="text-gray-600">
                      {' '}
                      &times;{entry.repeated}
                    </span>
                  ) : null}
                </>
              )}
              {entry.reason && (
                <span className="text-gray-600"> &mdash; {entry.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {Object.keys(skipCounts).length > 0 && (
        <>
          <h3>Why nothing was booked</h3>
          <ul className="text-sm">
            {Object.entries(skipCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <li key={reason} className="py-0.5">
                  <span className="font-semibold">{count}&times;</span>{' '}
                  {SKIP_TEXT[reason] ?? reason}
                </li>
              ))}
          </ul>
        </>
      )}

      {learned.length > 0 && (
        <>
          <h3>Learned drop times ({learned.length})</h3>
          <p className="text-xs text-gray-600">
            Autopilot records when availability actually appears while it runs,
            and compares that with the built-in drop schedule. A drop seen on{' '}
            {LEARNED_MIN_DAYS} or more days is added to the times Autopilot
            speeds up for. Absence is only reported for times it was actually
            watching. {observationCount} observation
            {observationCount === 1 ? '' : 's'} so far.
          </p>
          <ul className="text-sm">
            {learned.map(d => (
              <li key={d.experienceId} className="py-1">
                <div className="font-semibold">{nameOf(d.experienceId)}</div>
                {d.observed.length > 0 && (
                  <div>
                    Seen:{' '}
                    {d.observed.map((o, i) => (
                      <span key={String(o.time)}>
                        {i > 0 && ', '}
                        <Time time={o.time} />{' '}
                        <span className="text-gray-500">
                          ({o.days} day{o.days === 1 ? '' : 's'}
                          {o.days >= LEARNED_MIN_DAYS
                            ? ', used for timing'
                            : ''}
                          )
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {d.scheduled.length > 0 && (
                  <div>
                    Scheduled:{' '}
                    {d.scheduled.map((c, i) => (
                      <span key={String(c.time)}>
                        {i > 0 && ', '}
                        <Time time={c.time} />{' '}
                        <span
                          className={
                            hasOnlyNegativeEvidence(
                              c.coveredDays,
                              c.observedDays
                            )
                              ? 'text-red-700'
                              : 'text-gray-500'
                          }
                        >
                          {c.coveredDays === 0
                            ? '(not watched yet)'
                            : hasOnlyNegativeEvidence(
                                  c.coveredDays,
                                  c.observedDays
                                )
                              ? `(never seen in ${c.coveredDays} watched days)`
                              : `(seen ${c.observedDays} of ${c.coveredDays} watched)`}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  );
}
