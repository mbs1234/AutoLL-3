import { useSyncExternalStore } from 'react';

import {
  lastPushback,
  recentPushback,
  subscribePushback,
} from '@/autopilot/pushback';
import { syncedParkTimeAt } from '@/autopilot/schedule';
import { Time } from '@/components/Time';

/**
 * The "user beware" note beside a Start button, after Disney pushed back.
 *
 * Starting again is allowed -- the owner's rule is a warning, not a lock-out
 * -- so this says what the risk is and leaves the button alone. It lasts half
 * an hour from the last pushback, whichever routine met it.
 *
 * A note and not a confirmation step on purpose: turning Autopilot on has to
 * happen inside the tap that asks for it, and a step in between would break
 * the sound and the wake lock on an iPhone.
 */
export default function PushbackWarning() {
  const pushback = recentPushback(
    useSyncExternalStore(subscribePushback, lastPushback)
  );
  if (!pushback) return null;
  return (
    <p role="status" className="mt-2 text-sm font-semibold text-amber-800">
      {pushback.kind === 'refused' ? (
        <>
          Disney refused a request at{' '}
          <Time time={syncedParkTimeAt(pushback.at)} />. You can start again,
          but the next refusal stops everything again.
        </>
      ) : (
        <>
          Disney asked to slow down at{' '}
          <Time time={syncedParkTimeAt(pushback.at)} />
          {pushback.until !== undefined && (
            <>
              {' '}
              and suggested waiting until{' '}
              <Time time={syncedParkTimeAt(pushback.until)} />
            </>
          )}
          . You can start again early, but it may ask again.
        </>
      )}
    </p>
  );
}
