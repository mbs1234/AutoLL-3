import kvdb from '@/kvdb';

export const NEXTLL_PENDING_KEY = 'autoll3.nextll.pending';

/**
 * What a search was looking for when its screen went away.
 *
 * NextLL's engine is its tab: leaving the tab unmounts the provider and stops
 * the poller. That is the honest behaviour -- a bookmarklet cannot keep a
 * 600ms loop alive behind a backgrounded page anyway -- but it used to happen
 * silently, leaving an armed target in storage and nothing on screen to say a
 * search had been interrupted. Recording the goal instead turns the stop into
 * something the screen can offer to undo in one tap.
 *
 * `before` is the goal read back off the armed target -- `ParkTime`'s own
 * `"HH:MM:SS"` -- rather than the text in the form, because the form is state
 * that a running search no longer displays. It is parsed by `parseBound` on
 * the way back in, exactly like a fresh search.
 */
export interface PendingSearch {
  experienceId: string;
  after?: string;
  before?: string;
  /**
   * The park day the search was aimed at.
   *
   * `setDaily` scopes by the park day at *write* time, which is not the same
   * thing. A search set up on one park day for the next one -- which is what
   * prebooking is -- was filed under the day it was written, so resuming it the
   * same evening applied yesterday's goal to today's availability and could
   * spend an action on the wrong park day, while on the day it was actually
   * aimed at `getDaily` returned nothing and it was silently forgotten.
   *
   * Optional so an entry written before this field existed still parses; such an
   * entry is treated as belonging to no particular day and is not offered.
   */
  bookingDate?: string;
}

/**
 * The interrupted search, if it was aimed at the day being looked at now.
 *
 * Kept per park day *and* matched on the booking date it targeted. A goal is a
 * statement about one day's availability, so offering to resume it against a
 * different day would be worse than offering nothing -- and acting on it would
 * spend an action on a day the user never asked about.
 *
 * `bookingDate` is required to match when given. Pass it; the parameterless form
 * exists only for callers with no date in hand, and returns nothing rather than
 * guessing.
 */
export function loadPendingSearch(
  bookingDate?: string
): PendingSearch | undefined {
  const pending = kvdb.getDaily<PendingSearch>(NEXTLL_PENDING_KEY);
  if (!pending?.experienceId) return undefined;
  if (!bookingDate || pending.bookingDate !== bookingDate) return undefined;
  return pending;
}

export function savePendingSearch(pending: PendingSearch): void {
  kvdb.setDaily<PendingSearch>(NEXTLL_PENDING_KEY, pending);
}

export function clearPendingSearch(): void {
  kvdb.delete(NEXTLL_PENDING_KEY);
}
