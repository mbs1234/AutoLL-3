import { use, useState } from 'react';

import { targetActs } from '@/autopilot/watchlist';
import Button from '@/components/Button';
import Overlay from '@/components/Overlay';
import BookingDateContext from '@/contexts/BookingDateContext';
import ParkContext from '@/contexts/ParkContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';
import { formatDate, parkDate } from '@/datetime';

/** A booking date as the guard's sentence says it: "today", or its short date. */
export function dayLabel(date: string): string {
  return date === parkDate() ? 'today' : formatDate(date, 'short');
}

/**
 * Ask before moving a running Autopilot off what it is watching.
 *
 * The park and the booking date are one setting for the whole app, and the
 * engine follows them on its next check. So looking at another park -- even on
 * the read-only Times tab -- pointed a running Autopilot at that park, where
 * nothing was armed, and the only sign was "0 armed" in the footer. While the
 * day plan runs with something armed, a switch now asks first; otherwise it
 * happens at once, exactly as before.
 *
 * `guard(to, go)` runs `go` straight away when there is nothing to lose, and
 * otherwise shows `dialog` until the person chooses. `to` names where the
 * switch goes, for the sentence: a park, a day, or both.
 */
export default function useScopeGuard() {
  const autopilot = use(TopAutopilotContext);
  const { park } = use(ParkContext);
  const { bookingDate } = use(BookingDateContext);
  const [pending, setPending] = useState<{ to: string; go: () => void }>();
  const armed = autopilot?.enabled
    ? autopilot.targetsHere.filter(t => targetActs(t) && !t.paused).length
    : 0;

  function guard(to: string, go: () => void) {
    if (armed === 0) {
      go();
      return;
    }
    setPending({ to, go });
  }

  const dialog = pending && (
    <Overlay>
      <div
        role="alertdialog"
        aria-labelledby="scope-guard-title"
        className="max-w-sm rounded-lg bg-white p-4 text-black"
      >
        <h3 id="scope-guard-title" className="mt-0 font-semibold">
          Autopilot is running
        </h3>
        <p className="mt-2 mb-0">
          It is watching {armed} armed at {park.name} for{' '}
          {dayLabel(bookingDate)}. Switching to {pending.to} points it there
          instead, and those {armed} wait until you switch back.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            color="bg-white text-black"
            onClick={() => setPending(undefined)}
          >
            Stay
          </Button>
          <Button
            onClick={() => {
              const { go } = pending;
              setPending(undefined);
              go();
            }}
          >
            Switch
          </Button>
        </div>
      </div>
    </Overlay>
  );

  return { guard, dialog };
}
