import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

import ClientsContext from '@/contexts/ClientsContext';
import {
  PARTY_IDS_KEY,
  loadSavedPartyIds,
  saveSavedPartyIds,
  subscribeSavedParty,
} from '@/savedParty';

export { PARTY_IDS_KEY };

/** Text, so an unchanged party is the same snapshot from one read to the next. */
const snapshot = () => JSON.stringify(loadSavedPartyIds());

export default function useSavedParty() {
  const { ll } = use(ClientsContext);
  // One party for every screen. It is saved from Party Selection while others
  // stay mounted underneath, and reaches them at once. See `saveSavedPartyIds`.
  const saved = useSyncExternalStore(subscribeSavedParty, snapshot);
  const partyIds = useMemo(
    () => new Set<string>(JSON.parse(saved) as string[]),
    [saved]
  );

  useEffect(() => ll.setPartyIds([...partyIds]), [ll, partyIds]);

  const savePartyIds = useCallback(
    (partyIds: Set<string>) => {
      ll.setPartyIds([...partyIds]);
      saveSavedPartyIds([...partyIds]);
    },
    [ll]
  );

  return [partyIds, savePartyIds] as const;
}
