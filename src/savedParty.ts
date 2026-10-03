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
  return Array.isArray(ids)
    ? [
        ...new Set(
          ids.filter((id): id is string => typeof id === 'string' && !!id)
        ),
      ]
    : [];
}

let lastIdentity = '';
let generation = 0;
/** Includes a generation so A → B → A still invalidates prepared work. */
export function savedPartyScope(): string {
  const identity = JSON.stringify(loadSavedPartyIds().sort());
  if (identity !== lastIdentity) {
    lastIdentity = identity;
    generation++;
  }
  return `${generation}:${identity}`;
}

const listeners = new Set<() => void>();

/** A stored party as the scope compares it: its distinct ids, in order. */
function normalizedParty(raw: string | null): string {
  try {
    const ids: unknown = JSON.parse(raw ?? 'null');
    return JSON.stringify(
      Array.isArray(ids)
        ? [
            ...new Set(
              ids.filter((id): id is string => typeof id === 'string' && !!id)
            ),
          ].sort()
        : []
    );
  } catch {
    return raw ?? '';
  }
}

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
  savedPartyScope();
  kvdb.set<string[]>(PARTY_IDS_KEY, [...ids]);
  savedPartyScope();
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`. */
export function subscribeSavedParty(listener: () => void): () => void {
  listeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === PARTY_IDS_KEY || event.key === null) {
      // A → B → A may already have completed in the writing tab before this
      // tab handles either event. The events still invalidate prepared work.
      // Compared as the scope compares them, so the same people saved in
      // another order is no change.
      if (normalizedParty(event.oldValue) !== normalizedParty(event.newValue)) {
        generation++;
      }
      savedPartyScope();
      listener();
    }
  };
  window.addEventListener('storage', storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', storage);
  };
}
