import { createContext } from 'react';

import { Experience } from '@/api/ll';
import useDataLoader from '@/hooks/useDataLoader';
import useThrottleable from '@/hooks/useThrottleable';

interface ExperiencesState {
  experiences: Experience[];
  refreshExperiences: ReturnType<typeof useThrottleable>;
  /**
   * Silent, awaitable refresh, for background polling.
   *
   * `refreshExperiences` cannot be driven by a scheduler: it returns
   * `undefined` rather than a promise, so polls cannot be sequenced or
   * prevented from overlapping; it swallows every error into a transient
   * toast, so failure is undetectable and backoff impossible; and it renders a
   * spinner on every call, which is wrong for silent polling.
   *
   * This resolves once the data has landed and rejects if the Lightning Lane
   * request fails. Live show times are still treated as supplementary -- a
   * `shows` failure is logged and ignored rather than failing the poll.
   *
   * Returns the fetched list rather than only setting state. A background
   * caller needs to act on what it just fetched, and reading `experiences`
   * from context immediately after awaiting would still see the previous
   * render's value.
   */
  pollExperiences: () => Promise<Experience[]>;
  /**
   * Tipboard ids the build does not recognise, from the last fetch.
   *
   * Surfaced rather than only logged: an unknown id is dropped silently, so
   * the attraction simply is not there -- unwatchable and unbookable, with
   * nothing on screen to explain it.
   *
   * Optional so the many places that stub this context need not be touched.
   */
  unknownExperienceIds?: string[];
  lastUpdated?: number;
  loaderElem: ReturnType<typeof useDataLoader>['loaderElem'];
}

export default createContext<ExperiencesState>({
  experiences: [],
  refreshExperiences: () => undefined,
  pollExperiences: () => Promise.resolve([]),
  unknownExperienceIds: [],
  lastUpdated: undefined,
  loaderElem: null,
});
