import { useEffect, useState } from 'react';

import {
  QuarantinedMutation,
  SettledMutation,
  quarantinedMutations,
  settledMutations,
  subscribeQuarantine,
} from './lease';

/** A live view of unresolved mutations from this tab and other tabs. */
export default function useQuarantine(): QuarantinedMutation[] {
  const [doubts, setDoubts] = useState(quarantinedMutations);

  useEffect(() => {
    const update = () => setDoubts(quarantinedMutations());
    const unsubscribe = subscribeQuarantine(update);
    // Close the render-to-effect window: a mutation can become unresolved
    // after the state initializer ran but before this subscription attached.
    update();
    return unsubscribe;
  }, []);

  return doubts;
}

/** A live view of the protections settled today, oldest first. */
export function useSettledMutations(): SettledMutation[] {
  const [settled, setSettled] = useState(settledMutations);

  useEffect(() => {
    // Every settling removes a doubt, so the same notice reports both.
    const update = () => setSettled(settledMutations());
    const unsubscribe = subscribeQuarantine(update);
    update();
    return unsubscribe;
  }, []);

  return settled;
}
