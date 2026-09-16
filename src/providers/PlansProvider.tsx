import { use, useCallback, useEffect, useRef, useState } from 'react';

import { Booking } from '@/api/itinerary';
import { leaseParts, reconcile } from '@/autopilot/lease';
import ClientsContext from '@/contexts/ClientsContext';
import PlansContext from '@/contexts/PlansContext';
import { parkDate } from '@/datetime';
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
  // Manual refresh, Autopilot, and post-booking confirmation can all request
  // Plans at once. A slower, older response must not replace the newest view.
  const requestSequence = useRef(0);
  const publishedSequence = useRef(0);

  /**
   * The actual fetch, awaitable and free of UI side effects. Rejects on
   * failure so background callers can back off; `refreshPlans` wraps it in
   * `loadData` for the visible path.
   */
  const fetchPlans = useCallback(async () => {
    const request = ++requestSequence.current;
    const fetched = await itinerary.plans();
    // Latest *successful* request wins. If a newer request fails, an older
    // success is still better than discarding valid data; if the newer one
    // succeeds first, this prevents the older snapshot from regressing it.
    if (request > publishedSequence.current) {
      publishedSequence.current = request;
      setPlans(fetched);
      setPlansLoaded(true);
      setLastUpdated(Date.now());
    }
    // Every successful read is evidence about a reservation left in an unknown
    // state, so reconciliation belongs here rather than in one engine's poll
    // loop. It used to live in Autopilot's every-tenth tick, which meant a
    // doubt raised by a foreground search went unexamined whenever Autopilot
    // was switched off -- and then vanished at the 4am rollover having never
    // been settled by anything.
    //
    // Not awaited: this is bookkeeping about the read, and a caller waiting on
    // plans should not also wait on a lock.
    void reconcile(key => {
      const { date, facilityId } = leaseParts(key);
      const booking = fetched.find(
        b => b.facilityId === facilityId && parkDate(b.start) === date
      );
      return booking?.start?.time ? String(booking.start.time) : undefined;
    });
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
