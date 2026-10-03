import { use, useEffect, useState } from 'react';

import {
  type QuarantinedMutation,
  SETTLE_AFTER_MS,
  quarantinedMutations,
} from '@/autopilot/lease';
import type { ManualMutation } from '@/autopilot/manualMutation';
import useQuarantine from '@/autopilot/useQuarantine';
import PlansContext from '@/contexts/PlansContext';

function blocks(keys: readonly string[], doubt: QuarantinedMutation): boolean {
  return keys.some(
    key => key === doubt.key || doubt.blockingKeys?.includes(key)
  );
}

/** The unresolved changes that block this manual action. */
export function useMutationDoubts(mutation: ManualMutation) {
  return useQuarantine().filter(doubt => blocks(mutation.keys, doubt));
}

/**
 * A screen's "Disney did not answer" state, which gives way once the change it
 * is about is settled.
 *
 * It used to last until the person left the screen. Once the protection it
 * stands for is gone -- plans settled it, or the person cleared it in the
 * panel below -- the action is offered again here too.
 *
 * Asked of the store itself rather than the subscribed copy. The store changes
 * the moment a doubt is raised or settled, so neither the render before the
 * doubt reaches this screen nor plans settling it before it ever showed can be
 * misread.
 *
 * Plans are what settle it, so it keeps asking for them while it waits: soon,
 * again once the settling window has passed, then every minute. One read at
 * the moment the answer was lost is the read least likely to have caught up,
 * and with Autopilot off nothing else would ask.
 */
export function useUnanswered(
  mutation: ManualMutation
): [boolean, (value: boolean) => void] {
  const [unanswered, setUnanswered] = useState(false);
  const { refreshPlans } = use(PlansContext);
  // Subscribed only so that a change brings the check below round again.
  const doubts = useQuarantine();
  const keys = mutation.keys.join('\n');
  useEffect(() => {
    if (!unanswered) return;
    const mine = keys ? keys.split('\n') : [];
    if (!quarantinedMutations().some(doubt => blocks(mine, doubt))) {
      setUnanswered(false);
    }
  }, [unanswered, doubts, keys]);
  useEffect(() => {
    if (!unanswered) return;
    const refresh = () => refreshPlans();
    const timers = [5_000, SETTLE_AFTER_MS + 5_000].map(ms =>
      setTimeout(refresh, ms)
    );
    const interval = setInterval(refresh, 60_000);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(interval);
    };
  }, [unanswered, refreshPlans]);
  return [unanswered, setUnanswered];
}
