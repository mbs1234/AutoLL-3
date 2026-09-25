import kvdb from './kvdb';
import { storageKey } from './storageNamespace';

/**
 * The party the user picked in the LL tab, as facility guest ids.
 *
 * Its own module rather than a constant on `useSavedParty`, because the
 * clients are built before any hook runs and `useSavedParty` imports
 * `ClientsContext` -- reading the key from there would make the two modules
 * import each other.
 */
export const PARTY_IDS_KEY = storageKey('genie.partyIds');

/** Whatever is saved, or an empty list. Never throws on a mangled value. */
export function loadSavedPartyIds(): string[] {
  const ids = kvdb.get<string[]>(PARTY_IDS_KEY);
  return Array.isArray(ids) ? ids : [];
}

const listeners = new Set<() => void>();

/**
 * Save the party, and tell every screen that shows or uses it.
 *
 * Party Selection saves it while other screens sit mounted underneath -- the
 * navigator hides screens rather than unmounting them -- and each kept the copy
 * it read when it mounted. NextLL went on warning that the saved party did not
 * say whose reservation to move after the party had been changed to say
 * exactly that.
 */
export function saveSavedPartyIds(ids: readonly string[]): void {
  kvdb.set<string[]>(PARTY_IDS_KEY, [...ids]);
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`. */
export function subscribeSavedParty(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
