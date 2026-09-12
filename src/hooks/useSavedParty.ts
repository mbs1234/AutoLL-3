import { use, useCallback, useEffect, useState } from 'react';

import ClientsContext from '@/contexts/ClientsContext';
import kvdb from '@/kvdb';
import { PARTY_IDS_KEY, loadSavedPartyIds } from '@/savedParty';

export { PARTY_IDS_KEY };

export default function useSavedParty() {
  const { ll } = use(ClientsContext);
  const [partyIds, setPartyIds] = useState(() => new Set(loadSavedPartyIds()));

  useEffect(() => ll.setPartyIds([...partyIds]), [ll, partyIds]);

  const savePartyIds = useCallback(
    (partyIds: Set<string>) => {
      kvdb.set<string[]>(PARTY_IDS_KEY, [...partyIds]);
      ll.setPartyIds([...partyIds]);
      setPartyIds(partyIds);
    },
    [ll]
  );

  return [partyIds, savePartyIds] as const;
}
