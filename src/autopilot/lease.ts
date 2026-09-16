import kvdb from '@/kvdb';

/**
 * Exclusive, expiring leases on one *reservation*.
 *
 * Separate from the ledger's attempt locks, and the separation is the point.
 * An attempt lock answers "has this instance already done action K to
 * attraction X today" -- anti-thrash, session-scoped, shared as a union, and
 * never given back for a modify. A lease answers a different question: "is
 * anybody changing this reservation *right now*". Conflating the two is what
 * made a foreground search defer to a marker for something that finished at
 * 9am, and then, once that was narrowed, made one provider able to take over
 * another's live operation.
 *
 * Three properties the attempt locks cannot offer:
 *
 * - **Exclusive.** Acquisition is serialised through the Web Locks API where
 *   the browser has it, so two instances cannot both believe they won. Read
 *   `available()` before relying on that; where it is missing this degrades to
 *   an unsynchronised read-modify-write, which is the old behaviour and is
 *   reported rather than hidden.
 * - **Expiring.** A tab that is closed mid-request leaves its lease behind, and
 *   nothing will ever come back to release it. A lease older than
 *   `LEASE_TTL_MS` is therefore free to take. Holders renew while they work.
 * - **Owned by an instance, not a tab.** Two providers live in one tab -- NextLL
 *   nests one inside the app's own -- so a tab-scoped identity would let them
 *   take over each other. A reload is not a safe inheritance either: the old
 *   script is gone, but its request may have reached Disney and merely lost the
 *   response. Expiry is the only safe way to reclaim a dead instance's work.
 */

export const LEASE_KEY = 'autoll3.autopilot.leases';

/**
 * How long a lease stands without renewal.
 *
 * Above the poller's 90-second request deadline, so a lease can never expire
 * under a request that is still legitimately outstanding, and short enough that
 * a tab closed mid-move does not hold a reservation for the rest of the day --
 * which is what the retained `change:` attempt lock used to do.
 */
export const LEASE_TTL_MS = 120_000;

/** The name Web Locks serialises on. One critical section for the whole store. */
const MUTEX = 'autoll3.autopilot.leases.mutex';

interface Lease {
  owner: string;
  /** `Date.now()` at the last acquire or renew. */
  at: number;
}

type Leases = Record<string, Lease>;

/** Keyed by reservation and the day it belongs to, not by action. */
export function leaseKey(facilityId: string, date: string): string {
  return `${date}:${facilityId}`;
}

/** Whether acquisition can actually be made exclusive in this browser. */
export function available(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks?.request;
}

function load(now: number): Leases {
  const stored = kvdb.get<unknown>(LEASE_KEY);
  if (!stored || typeof stored !== 'object') return {};
  const out: Leases = {};
  for (const [key, value] of Object.entries(
    stored as Record<string, unknown>
  )) {
    const lease = value as Partial<Lease>;
    if (typeof lease?.owner !== 'string') continue;
    if (typeof lease?.at !== 'number') continue;
    // Pruned on read as well as on write: a store nobody has written to since
    // the holder died would otherwise keep reporting a live lease.
    if (now - lease.at >= LEASE_TTL_MS) continue;
    out[key] = { owner: lease.owner, at: lease.at };
  }
  return out;
}

/**
 * Run a read-modify-write with nothing else in it.
 *
 * `navigator.locks` is the only cross-tab mutex a page has. Without it the body
 * still runs -- refusing to act at all would be worse than the exposure -- and
 * `available()` is what lets a caller say so.
 */
async function exclusive<T>(body: () => T): Promise<T> {
  if (!available()) return body();
  return navigator.locks.request(MUTEX, body) as Promise<T>;
}

/**
 * Take the lease, or refuse because somebody else holds a live one.
 *
 * Re-entrant for the holder: asking again renews it, which is how a foreground
 * search keeps one for the length of a run without it expiring underneath.
 */
export async function acquire(
  key: string,
  owner: string,
  now = Date.now()
): Promise<boolean> {
  return exclusive(() => {
    const leases = load(now);
    const held = leases[key];
    if (held && held.owner !== owner) return false;
    kvdb.set<Leases>(LEASE_KEY, { ...leases, [key]: { owner, at: now } });
    return true;
  });
}

/** Give it back. Only the holder can, so nobody withdraws another's cover. */
export async function release(
  key: string,
  owner: string,
  now = Date.now()
): Promise<void> {
  await exclusive(() => {
    const leases = load(now);
    if (leases[key]?.owner !== owner) return;
    const rest = { ...leases };
    delete rest[key];
    kvdb.set<Leases>(LEASE_KEY, rest);
  });
}

/**
 * Who holds a live lease, if anyone.
 *
 * A synchronous read, for guards that only need to know whether to skip this
 * tick. Acquisition must still go through `acquire`: reading and then acting is
 * exactly the race the mutex exists to close.
 */
export function holder(key: string, now = Date.now()): string | undefined {
  return load(now)[key]?.owner;
}

/** Release everything one instance holds, for an unmount or a park-day roll. */
export async function releaseAll(owner: string, now = Date.now()) {
  await exclusive(() => {
    const leases = load(now);
    const rest = Object.fromEntries(
      Object.entries(leases).filter(([, lease]) => lease.owner !== owner)
    );
    kvdb.set<Leases>(LEASE_KEY, rest);
  });
}
