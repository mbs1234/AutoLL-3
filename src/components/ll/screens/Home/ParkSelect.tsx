import { use, useMemo } from 'react';

import Select from '@/components/Select';
import ClientsContext from '@/contexts/ClientsContext';
import ParkContext from '@/contexts/ParkContext';
import RebookingContext from '@/contexts/RebookingContext';
import ResortContext from '@/contexts/ResortContext';

import useScopeGuard from '../../useScopeGuard';

export default function ParkSelect(props: { className?: string }) {
  const { parks } = use(ResortContext);
  const { ll } = use(ClientsContext);
  const { park, setPark } = use(ParkContext);
  const rebooking = use(RebookingContext);
  const { guard, dialog } = useScopeGuard();

  const parkOptions = useMemo(
    () =>
      new Map(
        parks.map(park => [
          park.id,
          {
            value: park,
            icon: park.icon,
            text: park.name,
          },
        ])
      ),
    [parks]
  );

  return (
    <>
      <Select
        {...props}
        options={parkOptions}
        selected={park.id}
        onChange={next => {
          if (next.id === park.id) return;
          guard(next.name, () => setPark(next));
        }}
        disabled={!!rebooking.current && !ll.rules.parkModify}
        title="Park"
      />
      {dialog}
    </>
  );
}
