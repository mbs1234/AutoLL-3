import { use, useCallback, useEffect, useRef, useState } from 'react';

import { Booking, LLMP } from '@/api/itinerary';
import { isLLMP, isMultipleExperiences } from '@/api/itinerary';
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
  // Separate from `publishedSequence` on purpose. That one lets an older
  // success stand when a newer request failed, because stale data beats no
  // data on screen. Evidence has the opposite rule: an older response can only
  // ever weaken a doubt raised since, so a read that has already been overtaken
  // is not offered as evidence at all.
  const reconciledSequence = useRef(0);

  /**
   * The actual fetch, awaitable and free of UI side effects. Rejects on
   * failure so background callers can back off; `refreshPlans` wraps it in
   * `loadData` for the visible path.
   */
  const fetchPlans = useCallback(async () => {
    const request = ++requestSequence.current;
    // When the read *started*, which is the only honest measure of what it can
    // speak about. A response already in flight when a reservation fell into
    // doubt describes the world before the request that caused the doubt went
    // out -- it is a photograph taken before the event, and reading either
    // verdict out of it is wrong in both directions.
    const polledAt = Date.now();
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
    if (request > reconciledSequence.current) {
      reconciledSequence.current = request;
      void reconcile((key, reservationIds, requestedTime) => {
        const { date, facilityId } = leaseParts(key);
        // Evidence asks a different question from swap eligibility. A fully
        // redeemed pass no longer occupies a slot, but its exact requested
        // time still proves that the mutation landed before it was redeemed.
        // A historical/non-cancellable entry, another booking kind, or a
        // Multiple Experiences replacement cannot answer merely because it
        // shares a facility id.
        const expected = new Set(reservationIds);
        const idsOf = (plan: LLMP) => [
          plan.id,
          ...plan.guests.map(guest => guest.entitlementId),
        ];
        const booking = fetched.find((plan): plan is LLMP => {
          if (
            !isLLMP(plan) ||
            parkDate(plan.start) !== date ||
            !plan.cancellable ||
            isMultipleExperiences(plan) ||
            plan.facilityId !== facilityId ||
            String(plan.start.time) !== requestedTime
          ) {
            return false;
          }
          return idsOf(plan).some(id => expected.has(id));
        });
        return booking
          ? {
              time: String(booking.start.time),
              reservationIds: idsOf(booking),
            }
          : undefined;
      }, polledAt).catch(error => console.error(error));
    }
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
