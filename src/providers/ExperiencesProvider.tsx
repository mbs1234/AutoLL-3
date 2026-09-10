import { use, useCallback, useEffect, useLayoutEffect, useState } from 'react';

import { Experience } from '@/api/ll';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import useDataLoader from '@/hooks/useDataLoader';
import useThrottleable from '@/hooks/useThrottleable';

export default function ExperiencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ll, liveData } = use(ClientsContext);
  const { park } = use(ParkContext);
  const { bookingDate } = use(BookingDateContext);
  const { loadData, loaderElem } = useDataLoader();
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [unknownExperienceIds, setUnknownExperienceIds] = useState<string[]>(
    []
  );
  const [lastUpdated, setLastUpdated] = useState<number>();

  /**
   * The actual fetch, awaitable and free of UI side effects. Rejects if the
   * Lightning Lane request fails, so background callers can back off;
   * `refreshExperiences` wraps it in `loadData` for the visible path.
   */
  const fetchExperiences = useCallback(async () => {
    // Live show times are supplementary, so a `shows` failure must not fail
    // the whole refresh. Attaching the handler at the call site, rather than
    // awaiting inside a try block further down, also avoids an unhandled
    // rejection when `ll.experiences()` rejects first and nothing ever awaits
    // this promise.
    const showsPromise = liveData.shows(park).catch(error => {
      console.error(error);
      return {} as { [id: string]: Experience };
    });
    const exps = Object.fromEntries(
      (await ll.experiences(park, bookingDate)).map(exp => [exp.id, exp])
    );
    // Lightning Lane data wins over live show data on key collisions.
    const merged = Object.values({ ...(await showsPromise), ...exps });
    setExperiences(merged);
    // Held in state rather than read from the client: the client mutates the
    // list in place, which would never re-render the warning that shows it.
    setUnknownExperienceIds(ll.unknownExperienceIds);
    setLastUpdated(Date.now());
    return merged;
  }, [park, bookingDate, ll, liveData]);

  const refreshExperiences = useThrottleable(
    useCallback(() => {
      // Discard the returned list: loadData's callback must resolve to void,
      // and the visible path reads the state this already set.
      loadData(async () => void (await fetchExperiences()));
    }, [fetchExperiences, loadData])
  );

  useLayoutEffect(() => setExperiences([]), [park, bookingDate]);

  useEffect(refreshExperiences, [refreshExperiences]);

  return (
    <ExperiencesContext
      value={{
        experiences,
        refreshExperiences,
        pollExperiences: fetchExperiences,
        unknownExperienceIds,
        lastUpdated,
        loaderElem,
      }}
    >
      {children}
    </ExperiencesContext>
  );
}
