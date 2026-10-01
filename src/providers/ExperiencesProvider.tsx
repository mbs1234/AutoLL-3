import {
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

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
  // A response belongs to the park/date it started under. Requests cannot be
  // aborted through these clients, so a generation prevents an older one
  // from repainting the newly selected scope when it eventually resolves.
  const scopeGeneration = useRef(0);
  const requestSequence = useRef(0);
  const publishedSequence = useRef(0);
  // Whether this park and date have a tip board on screen yet. Refreshing one
  // leaves the screen readable; the first load of a scope covers it. A ref,
  // read when a refresh starts: as state it would re-create the refresh, and
  // the effect below runs it whenever it changes.
  const loadedRef = useRef(false);

  // This layout effect must be registered before `useThrottleable` below.
  // That hook re-runs its callback when the park/date-bound fetch function
  // changes; advancing the scope first makes that newly triggered request a
  // member of the new generation rather than immediately making it stale.
  useLayoutEffect(() => {
    ++scopeGeneration.current;
    loadedRef.current = false;
    setExperiences([]);
    setUnknownExperienceIds([]);
    setLastUpdated(undefined);
  }, [park, bookingDate]);

  /**
   * The actual fetch, awaitable and free of UI side effects. Rejects if the
   * Lightning Lane request fails, so background callers can back off;
   * `refreshExperiences` wraps it in `loadData` for the visible path.
   */
  const fetchExperiences = useCallback(async () => {
    const generation = scopeGeneration.current;
    const request = ++requestSequence.current;
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
    const unknownIds = [...ll.unknownExperienceIds];
    // Lightning Lane data wins over live show data on key collisions.
    const merged = Object.values({ ...(await showsPromise), ...exps });
    if (
      generation === scopeGeneration.current &&
      request > publishedSequence.current
    ) {
      publishedSequence.current = request;
      loadedRef.current = true;
      setExperiences(merged);
      // Held in state rather than read from the client: the client mutates the
      // list in place, which would never re-render the warning that shows it.
      setUnknownExperienceIds(unknownIds);
      setLastUpdated(Date.now());
    }
    return merged;
  }, [park, bookingDate, ll, liveData]);

  const refreshExperiences = useThrottleable(
    useCallback(() => {
      // Discard the returned list: loadData's callback must resolve to void,
      // and the visible path reads the state this already set.
      loadData(async () => void (await fetchExperiences()), {
        quiet: loadedRef.current,
      });
    }, [fetchExperiences, loadData])
  );

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
