import { loadSavedPartyIds } from '@/savedParty';

/**
 * How many guests the saved party holds, without applying it.
 *
 * `useSavedParty` re-applies the party to the client on mount, which is right
 * for the one screen that owns the party and wrong for a strip that only
 * wants to say how big it is. Zero means no party was saved, which the app
 * treats as everyone eligible.
 *
 * Read on every render rather than held in state: the party is saved by a
 * different screen in the same document, and no event announces that.
 */
export default function useSavedPartyCount(): number {
  return loadSavedPartyIds().length;
}
