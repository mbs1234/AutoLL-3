import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import { PARTY_IDS_KEY } from '@/savedParty';
import { act, render, screen } from '@/testing';

import useSavedParty from './useSavedParty';
import useSavedPartyCount from './useSavedPartyCount';

let save: (ids: Set<string>) => void = () => {};

/** Party Selection: the screen that saves the party. */
function Selector() {
  const [, savePartyIds] = useSavedParty();
  save = savePartyIds;
  return null;
}

/** NextLL: a screen that sits mounted underneath while the party is saved. */
function Reader() {
  const [partyIds] = useSavedParty();
  return <p data-testid="party">{[...partyIds].join(',')}</p>;
}

function Count() {
  return <p data-testid="count">{useSavedPartyCount()}</p>;
}

beforeEach(() => localStorage.clear());

// As found in the harness: saving a party of one from Party Selection left
// NextLL, mounted underneath, holding the party it read when it mounted -- so
// it kept warning that the saved party did not say whose reservation to move.
it('reaches every screen at once when the party is saved', () => {
  localStorage.setItem(PARTY_IDS_KEY, JSON.stringify(['p1', 'p2']));
  const setPartyIds = jest.fn();
  render(
    <ClientsContext value={{ ll: { setPartyIds } } as unknown as Clients}>
      <Selector />
      <Reader />
      <Count />
    </ClientsContext>
  );
  expect(screen.getByTestId('party')).toHaveTextContent('p1,p2');
  act(() => save(new Set(['p2'])));
  expect(screen.getByTestId('party')).toHaveTextContent(/^p2$/);
  expect(screen.getByTestId('count')).toHaveTextContent('1');
  expect(JSON.parse(localStorage.getItem(PARTY_IDS_KEY)!)).toEqual(['p2']);
  expect(setPartyIds).toHaveBeenLastCalledWith(['p2']);
});
