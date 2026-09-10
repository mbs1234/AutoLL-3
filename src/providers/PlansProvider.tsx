import { use, useCallback, useEffect, useState } from 'react';

import { Booking } from '@/api/itinerary';
import ClientsContext from '@/contexts/ClientsContext';
import PlansContext from '@/contexts/PlansContext';
import useDataLoader from '@/hooks/useDataLoader';
import useThrottleable from '@/hooks/useThrottleable';

export default function PlansProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { itinerary } = use(ClientsContext);
  const { loadData, loaderElem } = useDataLoader();
  const [plans, setPlans] = useState<Booking[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>();

  /**
   * The actual fetch, awaitable and free of UI side effects. Rejects on
   * failure so background callers can back off; `refreshPlans` wraps it in
   * `loadData` for the visible path.
   */
  const fetchPlans = useCallback(async () => {
    const fetched = await itinerary.plans();
    setPlans(fetched);
    setPlansLoaded(true);
    setLastUpdated(Date.now());
    // Returned as well as stored: `plans` will not reflect this until the next
    // render, so a background caller acting within the same tick needs the
    // value directly.
    return fetched;
  }, [itinerary]);

  const refreshPlans = useThrottleable(
    useCallback(() => {
      // Return value discarded: the visible path renders from `plans` state.
      loadData(async () => {
        await fetchPlans();
      });
    }, [fetchPlans, loadData])
  );

  useEffect(refreshPlans, [refreshPlans]);

  return (
    <PlansContext
      value={{
        plans,
        plansLoaded,
        lastUpdated,
        refreshPlans,
        pollPlans: fetchPlans,
        loaderElem,
      }}
    >
      {children}
    </PlansContext>
  );
}
