import { APP_SLUG } from './appIdentity';

/**
 * Shared origin namespace for every durable or session-scoped key this build
 * owns.
 *
 * Derived from `APP_SLUG` because that is the one value a sibling build
 * changes: spelling the prefix out here as well would mean two places had to
 * be kept in step for two builds to stay out of each other's stored state.
 *
 * The `as const` on this and on the notification namespace is load-bearing.
 * Both feed the template literal types below and `storageKey`'s return type,
 * and a template literal expression without it widens to `string` -- which
 * would quietly turn `StorageKey`, `NotificationTag` and every namespaced key
 * in the repo into plain `string` with nothing failing to say so.
 */
export const STORAGE_NAMESPACE = `${APP_SLUG}.` as const;
export type StorageKey = `${typeof STORAGE_NAMESPACE}${string}`;

/** Shared-origin notification tags use a separate browser namespace. */
export const NOTIFICATION_TAG_NAMESPACE = `${APP_SLUG}-` as const;
export type NotificationTag = `${typeof NOTIFICATION_TAG_NAMESPACE}${string}`;

export function storageKey<const Suffix extends string>(
  suffix: Suffix
): `${typeof STORAGE_NAMESPACE}${Suffix}` {
  return `${STORAGE_NAMESPACE}${suffix}` as `${typeof STORAGE_NAMESPACE}${Suffix}`;
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
