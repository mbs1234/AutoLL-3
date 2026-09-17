/** Shared origin namespace for every durable or session-scoped AutoLL-3 key. */
export const STORAGE_NAMESPACE = 'autoll3.' as const;

export function storageKey<const Suffix extends string>(
  suffix: Suffix
): `${typeof STORAGE_NAMESPACE}${Suffix}` {
  return `${STORAGE_NAMESPACE}${suffix}`;
}

// Keys shared with tests or the harness live here rather than in React module
// files. A computed export beside a component disables Fast Refresh, while a
// central catalogue also makes these cross-module contracts easy to find.
export const HOME_TAB_KEY = storageKey('tab');
export const STARRED_KEY = storageKey('genie.tipBoard.starred');
export const NEXTLL_WATCHLIST_KEY = storageKey('nextll.watchlist');
export const FULL_AVAILABILITY_KEY = storageKey('ll.fullAvailability');
export const BOOKING_DATE_KEY = storageKey('date');
export const PARK_KEY = storageKey('park');
