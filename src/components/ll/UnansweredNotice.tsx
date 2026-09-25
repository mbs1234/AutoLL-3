import { use } from 'react';

import Button from '@/components/Button';
import NavContext from '@/contexts/NavContext';

import Home from './screens/Home';

const WHAT = {
  booking: 'booking',
  change: 'change',
  cancel: 'cancel',
} as const;

/**
 * Disney took a hand-made change and never said what happened.
 *
 * Not a failure: it may have gone through. So the screen that shows this stops
 * offering the same tap, and points to Plans, the one place that knows. Mirrors
 * what the engine does with an unanswered action, which quarantines it rather
 * than trying again.
 */
export default function UnansweredNotice({
  action,
}: {
  action: keyof typeof WHAT;
}) {
  const { goBack } = use(NavContext);
  return (
    <div
      role="alert"
      className="mt-4 rounded-sm bg-amber-100 p-3 text-amber-900"
    >
      <p className="mt-0 font-semibold">Disney did not answer.</p>
      <p className="mt-1">
        The {WHAT[action]} may or may not have gone through, so check Plans
        before trying again.
      </p>
      <Button
        type="small"
        className="mt-2"
        onClick={() => goBack({ screen: Home, props: { tabName: 'Plans' } })}
      >
        Open Plans
      </Button>
    </div>
  );
}
