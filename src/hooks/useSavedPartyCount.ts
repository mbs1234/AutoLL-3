import { useSyncExternalStore } from 'react';

import { loadSavedPartyIds, subscribeSavedParty } from '@/savedParty';

/**
 * How many guests the saved party holds, without applying it.
 *
 * `useSavedParty` re-applies the party to the client on mount, which is right
 * for the one screen that owns the party and wrong for a strip that only
 * wants to say how big it is. Zero means no party was saved, which the app
 * treats as everyone eligible.
 *
 * Subscribed rather than held in state: the party is saved by a different
 * screen in the same document, and `saveSavedPartyIds` announces it.
 */
export default function useSavedPartyCount(): number {
  return useSyncExternalStore(
    subscribeSavedParty,
    () => loadSavedPartyIds().length
  );
}
