import onVisible from '@/onVisible';

/**
 * Keeps the screen awake while autopilot runs.
 *
 * The single largest cause of a missed drop is not throttling but the phone
 * simply locking: once the screen sleeps the page is backgrounded, timers are
 * clamped to minutes, and the poller stops being a poller. `Screen Wake Lock`
 * removes that failure without any of the background-execution machinery a
 * service worker would need -- and which, on this origin, is unavailable
 * anyway.
 *
 * Every part of this degrades on its own. Support arrived in iOS Safari 16.4
 * (and was broken inside installed PWAs until 18.4), the request rejects
 * outright on a hidden document or a non-secure context, and the browser may
 * drop the lock whenever it likes. Nothing here is load-bearing: failing to
 * hold the screen awake leaves exactly the behaviour that existed before.
 */

let sentinel: WakeLockSentinel | undefined;
/** Detaches the visibility listener that re-acquires after a release. */
let stopWatching: (() => void) | undefined;
/**
 * Bumped on every release, so a request still in flight can tell that its
 * result is no longer wanted.
 *
 * `navigator.wakeLock.request` is asynchronous, and turning autopilot off is
 * the gesture most likely to land while one is outstanding -- `setEnabled`
 * fires the acquire without awaiting it. Without this, the lock granted after
 * the release would be stored and held with nothing polling.
 */
let generation = 0;
/** The outstanding request, shared so concurrent callers do not each make one. */
let pending: Promise<void> | undefined;
type StatusListener = () => void;
const statusListeners = new Set<StatusListener>();
let lastStatus: ScreenAwakeStatus | undefined;

/**
 * Who currently wants the screen held.
 *
 * This module is a singleton, and more than one AutopilotProvider can be
 * mounted at once: the NextLL tab nests a second one inside the app's own.
 * Without owners, unmounting the nested provider released the lock the outer
 * one was still holding -- and since `holdScreenAwake` is only ever called
 * from the gesture that starts a run, nothing re-acquired it. Merely opening
 * NextLL and leaving cost a running Autopilot its wake lock for the rest of
 * the day, which is the one failure the lock exists to prevent.
 *
 * A set of owners rather than a count, so a double release from one owner
 * cannot drop another owner's hold.
 */
const owners = new Set<unknown>();

/**
 * Stands in for a caller that does not identify itself.
 *
 * Callers that pass nothing all share this one, which is exactly the old
 * behaviour: any release drops the hold. Only callers that can be mounted
 * more than once need to say who they are.
 */
const DEFAULT_OWNER = Symbol('screen-awake');

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/** Whether a lock is held right now. Exposed for display and tests. */
export function wakeLockHeld(): boolean {
  return !!sentinel;
}

export type ScreenAwakeStatus = 'unsupported' | 'held' | 'idle';

/** What the best-effort screen-awake channel can currently do. */
export function screenAwakeStatus(): ScreenAwakeStatus {
  if (!wakeLockSupported()) return 'unsupported';
  return wakeLockHeld() ? 'held' : 'idle';
}

function publishStatus(): void {
  const next = screenAwakeStatus();
  if (next === lastStatus) return;
  lastStatus = next;
  for (const listener of statusListeners) listener();
}

/**
 * Subscribe to the bare status string used by `useSyncExternalStore`.
 *
 * It stays a primitive on purpose: returning a fresh object from a snapshot
 * getter makes React see a change on every read and render forever.
 */
export function subscribeScreenAwakeStatus(
  listener: StatusListener
): () => void {
  statusListeners.add(listener);
  lastStatus = screenAwakeStatus();
  return () => statusListeners.delete(listener);
}

/** How many owners are currently holding. Exposed for tests. */
export function wakeLockOwnerCount(): number {
  return owners.size;
}

async function acquire(): Promise<void> {
  if (!wakeLockSupported() || sentinel) return;
  // Share one request rather than starting a second: a visibility event
  // arriving while the first is outstanding would otherwise strand a lock,
  // since only one of the two can be stored in `sentinel`.
  if (pending) return pending;
  const wanted = generation;
  pending = (async () => {
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (wanted !== generation) {
        // Released while this was in flight. Give the lock straight back --
        // storing it would keep the screen on with autopilot off.
        try {
          await lock.release();
        } catch {
          // Nothing held either way.
        }
        return;
      }
      // The browser releases the lock on its own when the page is hidden, on
      // low battery, and in other cases it does not have to explain. Clearing
      // the handle here is what lets `onVisible` re-acquire rather than seeing
      // a stale sentinel and assuming the screen is still held.
      lock.addEventListener('release', () => {
        if (sentinel === lock) {
          sentinel = undefined;
          publishStatus();
        }
      });
      sentinel = lock;
      publishStatus();
    } catch {
      // Rejected -- hidden document, insecure context, or unsupported. The
      // caller has no better option than continuing without it.
      if (wanted === generation) sentinel = undefined;
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

/**
 * Hold the screen awake until `releaseScreenAwake`.
 *
 * Safe to call repeatedly. Re-acquires whenever the page becomes visible
 * again, since returning to the tab is exactly when the previous lock has
 * been dropped and the user has just signalled they want it running.
 */
export async function holdScreenAwake(
  owner: unknown = DEFAULT_OWNER
): Promise<void> {
  // Recorded even where the lock is unsupported, so that a release from one
  // owner is never mistaken for the last one on a platform that grants
  // nothing. Cheap, and it keeps the two calls symmetrical.
  owners.add(owner);
  if (!wakeLockSupported()) return;
  stopWatching ??= onVisible(() => void acquire());
  await acquire();
}

/**
 * Release this owner's hold, and the lock itself once nobody is left holding.
 *
 * Safe to call when none is held, and safe to call twice.
 */
export async function releaseScreenAwake(
  owner: unknown = DEFAULT_OWNER
): Promise<void> {
  owners.delete(owner);
  // Somebody else still wants the screen. Leaving `generation` alone matters
  // as much as leaving the sentinel alone: bumping it would make an acquire
  // still in flight for the remaining owner discard the lock it was granted.
  if (owners.size > 0) return;
  // Before anything else: a request already in flight must not store its
  // result once this returns.
  ++generation;
  stopWatching?.();
  stopWatching = undefined;
  const lock = sentinel;
  sentinel = undefined;
  publishStatus();
  try {
    await lock?.release();
  } catch {
    // Already released, or the page is gone. Either way there is nothing held.
  }
}
