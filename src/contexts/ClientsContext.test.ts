import { LLClient } from '@/api/ll';
import kvdb from '@/kvdb';
import { PARTY_IDS_KEY } from '@/savedParty';

import { createClients } from './ClientsContext';

jest.mock('@/api/auth');

const resort = { id: 'WDW' } as Parameters<typeof createClients>[0];

describe('createClients()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('applies the saved party to the LL client', () => {
    kvdb.set<string[]>(PARTY_IDS_KEY, ['mickey', 'minnie']);
    const { ll } = createClients(resort);
    expect(partyIdsOf(ll)).toEqual(new Set(['mickey', 'minnie']));
  });

  it('leaves the filter off when nothing is saved', () => {
    expect(partyIdsOf(createClients(resort).ll).size).toBe(0);
  });

  it('ignores a mangled saved value', () => {
    kvdb.set(PARTY_IDS_KEY, 'not-a-list');
    expect(partyIdsOf(createClients(resort).ll).size).toBe(0);
  });
});

/** `partyIds` is protected; the test reads what the client will filter on. */
function partyIdsOf(ll: LLClient): Set<string> {
  return (ll as unknown as { partyIds: Set<string> }).partyIds;
}
