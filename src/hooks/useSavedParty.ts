import { use, useCallback, useEffect, useState } from 'react';

import ClientsContext from '@/contexts/ClientsContext';
import kvdb from '@/kvdb';

export const PARTY_IDS_KEY = 'autoll3.genie.partyIds';

export default function useSavedParty() {
  const { ll } = use(ClientsContext);
  const [partyIds, setPartyIds] = useState(() => {
    const partyIds = kvdb.get<string[]>(PARTY_IDS_KEY) ?? [];
    return new Set(Array.isArray(partyIds) ? partyIds : []);
  });

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
