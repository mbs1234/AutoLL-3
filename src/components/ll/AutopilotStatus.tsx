import { CALL_TEXT, RefusalState, refusedCalls } from '@/autopilot/refusal';
import { MAX_CONSECUTIVE_FAILURES, syncedParkTime } from '@/autopilot/schedule';
import { MODE_TEXT } from '@/autopilot/status';
import { PollerStatus } from '@/autopilot/usePoller';
import Button from '@/components/Button';
import { Time } from '@/components/Time';

export const AUTOPILOT = 'Autopilot';

/**
 * What the poller is doing and what is in its way: mode, next drop, timing,
 * refusals, backoff, a stopped run, a spent budget.
 */
export default function AutopilotStatus({
  status,
  bookingsRemaining,
  actionBudget,
  onRefill,
  refusals,
}: {
  status: PollerStatus;
  bookingsRemaining: number;
  actionBudget: number;
  onRefill: () => void;
  refusals: RefusalState;
}) {
  // Only while something is running, like the budget notice below: off, this
  // describes earlier today rather than why nothing is happening now.
  const refused =
    status.mode === 'off' ? [] : refusedCalls(refusals, syncedParkTime());
  return (
    <div className="mt-3 text-sm">
      <div>
        <span className="font-semibold">Status:</span> {MODE_TEXT[status.mode]}
        {status.polls > 0 && (
          <span className="text-gray-500"> ({status.polls} checks)</span>
        )}
      </div>
      {status.target && (
        <div>
          <span className="font-semibold">Next drop:</span>{' '}
          <Time time={status.target} />
          {typeof status.secondsToTarget === 'number' &&
            status.secondsToTarget > 0 && (
              <span className="text-gray-500">
                {' '}
                (in {Math.round(status.secondsToTarget / 60)} min)
              </span>
            )}
        </div>
      )}
      {/* Only while it is running: stopped or off, these are facts about
          earlier rather than a reason for what is happening now. "Cycle"
          because it times the whole tick -- availability, plans, eligibility
          and any booking attempt -- not a single request. */}
      {status.mode !== 'off' &&
        status.mode !== 'stopped' &&
        status.lastCycleMs !== undefined && (
          <div className="text-gray-500">
            <span className="font-semibold">Local timing:</span> last cycle{' '}
            {status.lastCycleMs} ms, average {status.averageCycleMs} ms
          </div>
        )}
      {status.refillWindow && !status.target && (
        <div>
          <span className="font-semibold">Refill window:</span>{' '}
          <Time time={status.refillWindow.start} />
          &ndash;
          <Time time={status.refillWindow.end} />
        </div>
      )}
      {refused.length > 0 && (
        <div className="mt-2 rounded-sm bg-red-100 p-2 text-red-900">
          <p className="font-semibold">Disney is refusing these requests.</p>
          <p className="mt-1">
            {refused.map(call => CALL_TEXT[call]).join(', ')} &mdash; refused
            repeatedly for over a minute. Autopilot is still watching and will
            still alert you, but it cannot book, move or swap until this clears.
            Book by hand in Disney&rsquo;s app meanwhile.
          </p>
        </div>
      )}
      {/* Backing off, but not yet stopped.
          `mode` keeps reporting the cadence the policy asked for while the
          poller is actually waiting out an exponential backoff, so a run of
          failures looked exactly like an ordinary idle watch -- just slower.
          There was no way to tell 45s of idle from 60s of capped backoff from
          the screen, which is precisely the question asked when Autopilot
          "seems slow". */}
      {status.mode !== 'stopped' && status.consecutiveFailures > 0 && (
        <p className="mt-2 text-amber-800">
          <span className="font-semibold">
            {status.consecutiveFailures} failed{' '}
            {status.consecutiveFailures === 1 ? 'check' : 'checks'} in a row
          </span>{' '}
          &mdash; slowing down between tries
          {status.lastError ? `: ${status.lastError}` : ''}. It speeds back up
          as soon as one succeeds, and gives up after {MAX_CONSECUTIVE_FAILURES}
          .
        </p>
      )}
      {status.mode === 'stopped' && (
        <p className="mt-2 font-semibold text-red-700">
          Stopped after {status.consecutiveFailures} failed checks
          {status.lastError ? `: ${status.lastError}` : ''}. Turn it back on to
          retry.
        </p>
      )}
      {/* Only while something is running: off, the count is a fact about
          earlier today rather than a reason nothing is happening now. */}
      {status.mode !== 'off' && bookingsRemaining <= 0 && (
        <div className="mt-2 rounded-sm bg-amber-100 p-2 text-amber-900">
          <p className="font-semibold">
            Today&rsquo;s {actionBudget} actions are used up.
          </p>
          <p className="mt-1">
            Autopilot keeps watching and alerting, but will not book, move or
            swap again today until you top it up.
          </p>
          <Button type="small" onClick={onRefill}>
            Add 3 actions for today
          </Button>
        </div>
      )}
    </div>
  );
}
