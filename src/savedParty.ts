import kvdb from './kvdb';

/**
 * The party the user picked in the LL tab, as facility guest ids.
 *
 * Its own module rather than a constant on `useSavedParty`, because the
 * clients are built before any hook runs and `useSavedParty` imports
 * `ClientsContext` -- reading the key from there would make the two modules
 * import each other.
 */
export const PARTY_IDS_KEY = 'autoll3.genie.partyIds';

/** Whatever is saved, or an empty list. Never throws on a mangled value. */
export function loadSavedPartyIds(): string[] {
  const ids = kvdb.get<string[]>(PARTY_IDS_KEY);
  return Array.isArray(ids) ? ids : [];
}
