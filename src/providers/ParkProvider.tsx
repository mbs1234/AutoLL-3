import { use, useEffect, useState } from 'react';

import { InvalidId, Park } from '@/api/resort';
import BookingDateContext from '@/contexts/BookingDateContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import ResortContext from '@/contexts/ResortContext';
import useUpdateParkFromPlans from '@/hooks/useUpdateParkFromPlans';
import kvdb from '@/kvdb';

export const PARK_KEY = 'autoll3.park';

export default function ParkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const resort = use(ResortContext);
  const [park, setPark] = useState(() => {
    const id = kvdb.getDaily<string>(PARK_KEY);
    if (!id) return {} as Park;
    try {
      return resort.park(id);
    } catch (error) {
      if (!(error instanceof InvalidId)) console.error(error);
      return resort.parks[0]!;
    }
  });

  useEffect(() => {
    if (park?.id) kvdb.setDaily(PARK_KEY, park.id);
  }, [park]);

  return (
    <ParkContext value={{ park, setPark }}>
      {park.id ? children : <ParkInitializer />}
    </ParkContext>
  );
}

function ParkInitializer() {
  const { plansLoaded, loaderElem } = use(PlansContext);
  const { bookingDate } = use(BookingDateContext);
  const updateParkFromPlans = useUpdateParkFromPlans();

  useEffect(() => {
    if (plansLoaded) updateParkFromPlans(bookingDate);
  }, [plansLoaded, bookingDate, updateParkFromPlans]);

  return loaderElem;
}
