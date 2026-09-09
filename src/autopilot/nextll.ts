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
}

/**
 * Kept per park day. A goal is a statement about one day's availability, and
 * offering to resume yesterday's search would be worse than offering nothing.
 */
export function loadPendingSearch(): PendingSearch | undefined {
  const pending = kvdb.getDaily<PendingSearch>(NEXTLL_PENDING_KEY);
  return pending?.experienceId ? pending : undefined;
}

export function savePendingSearch(pending: PendingSearch): void {
  kvdb.setDaily<PendingSearch>(NEXTLL_PENDING_KEY, pending);
}

export function clearPendingSearch(): void {
  kvdb.delete(NEXTLL_PENDING_KEY);
}
