import { createContext } from 'react';

import { Booking } from '@/api/itinerary';
import useDataLoader from '@/hooks/useDataLoader';
import useThrottleable from '@/hooks/useThrottleable';

interface PlansState {
  plans: Booking[];
  refreshPlans: ReturnType<typeof useThrottleable>;
  /**
   * Silent, awaitable refresh, for background polling. See the note on
   * `pollExperiences` in ExperiencesContext for why `refreshPlans` cannot
   * serve this purpose.
   *
   * Resolves with what it fetched. `plans` on this context reflects the last
   * *render*, so a caller that polls and then reads state within the same tick
   * sees the previous fetch; the return value is the only view of what just
   * came back.
   */
  pollPlans: () => Promise<Booking[]>;
  loaderElem: ReturnType<typeof useDataLoader>['loaderElem'];
  plansLoaded?: boolean;
  lastUpdated?: number;
}

export default createContext<PlansState>({
  plans: [],
  refreshPlans: () => undefined,
  pollPlans: () => Promise.resolve([]),
  loaderElem: null,
  lastUpdated: undefined,
});
