import { use, useEffect, useState } from 'react';

import { Guest } from '@/api/ll';
import FloatingButton from '@/components/FloatingButton';
import GuestList from '@/components/GuestList';
import Screen from '@/components/Screen';
import ClientsContext from '@/contexts/ClientsContext';
import useDataLoader from '@/hooks/useDataLoader';
import useSavedParty from '@/hooks/useSavedParty';

export default function PartySelector() {
  const { ll } = use(ClientsContext);
  const { loadData, loaderElem } = useDataLoader();
  const [guests, setGuests] = useState<Guest[]>();
  const [savedPartyIds, savePartyIds] = useSavedParty();
  const [partyIds, setPartyIds] = useState(savedPartyIds);
  const [auto, setAuto] = useState(partyIds.size === 0);

  useEffect(() => {
    loadData(async () => {
      const guests = await ll.guests();
      setGuests(
        [...guests.eligible, ...guests.ineligible].sort(
          (a, b) => +!a.primary - +!b.primary || a.name.localeCompare(b.name)
        )
      );
    });
  }, [ll, loadData]);

  useEffect(() => {
    if (auto) setPartyIds(new Set());
  }, [auto]);

  const partyGuests = guests?.filter(g => partyIds.has(g.id));
  const nonpartyGuests = guests?.filter(g => !partyIds.has(g.id));
  // Saved guests this account no longer returns -- unlinked, or saved under
  // another account. They are invisible in the lists above, and with "whole
  // party only" on they make every booking wait for someone who cannot be
  // booked here, so they are named and saving drops them.
  const missing = guests
    ? [...partyIds].filter(id => !guests.some(g => g.id === id))
    : [];

  const Mode = (props: { auto: boolean; children: string }) => (
    <li>
      <label className="flex items-center mt-2">
        <input
          type="radio"
          name="auto"
          onChange={() => setAuto(props.auto)}
          checked={auto === props.auto}
          className="mr-2"
        />{' '}
        {props.children}
      </label>
    </li>
  );

  return (
    <Screen title="Party Selection">
      <p>
        By default, all eligible guests (up to a maximum of 12) are
        automatically selected when you book a Lightning Lane. If you would like
        to limit who you book for, you can manually select your party here.
      </p>
      <ul>
        <Mode auto={true}>Book for all eligible guests</Mode>
        <Mode auto={false}>Only book for selected guests</Mode>
      </ul>

      {auto ? null : guests?.length === 0 ? (
        <p className="text-red-d">No guests to select</p>
      ) : partyGuests && nonpartyGuests ? (
        <>
          {partyGuests.length > 0 && (
            <>
              <h3>Your Party</h3>
              <GuestList
                guests={partyGuests}
                selectable={{
                  isSelected: () => true,
                  onToggle: g => {
                    const newPartyIds = new Set(partyIds);
                    newPartyIds.delete(g.id);
                    setPartyIds(newPartyIds);
                  },
                }}
              />
            </>
          )}
          {nonpartyGuests.length > 0 && (
            <>
              <h3>Add to Your Party</h3>
              <GuestList
                guests={nonpartyGuests}
                selectable={{
                  isSelected: () => false,
                  onToggle: g => {
                    setPartyIds(new Set(partyIds).add(g.id));
                  },
                }}
              />
            </>
          )}
        </>
      ) : null}
      {!auto && missing.length > 0 && (
        <p className="text-red-d" role="status">
          {missing.length === 1
            ? '1 saved guest is no longer on this account.'
            : `${missing.length} saved guests are no longer on this account.`}{' '}
          Saving removes them from your party.
        </p>
      )}
      {loaderElem}
      <FloatingButton
        back
        disabled={!auto && partyIds.size - missing.length === 0}
        onClick={() =>
          savePartyIds(
            new Set([...partyIds].filter(id => !missing.includes(id)))
          )
        }
      >
        Save
      </FloatingButton>
    </Screen>
  );
}
