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
export const QUARANTINE_KEY = 'autoll3.autopilot.unresolved';

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

/**
 * Reservations whose last change may or may not have applied.
 *
 * A lease answers "is anybody changing this now" and expires, which is right
 * for work in progress and wrong for work whose outcome nobody learned. A
 * request that times out may have moved the reservation; until fresh plans say
 * otherwise, *nothing* may touch it -- and "until fresh plans say otherwise" is
 * not a duration, so it cannot be a TTL.
 *
 * Releasing the lease on a status-0 and trusting the ledger's attempt lock was
 * the first mistake here. That lock is keyed `<kind>:<attraction>`, a foreground
 * search does not consult it at all, and a swap for a *different* incoming
 * attraction can target the very reservation left in doubt.
 *
 * Clearing it on the next plans read was the second. This codebase already has a
 * standard for what settles a doubtful booking -- `CONFIRM_ABSENT_POLLS`, two
 * agreeing reads -- because Disney's itinerary lags, and a request that timed out
 * on the client can still land server-side after the next read has started. One
 * read is weaker evidence than the same codebase demands elsewhere for the same
 * question. So a doubt records what it *expected* to happen, and is settled by
 * seeing it, or by not seeing it repeatedly once enough time has passed for it to
 * have shown up.
 */
interface Doubt {
  /** `Date.now()` when the doubt was raised. */
  at: number;
  /**
   * The return time the reservation was at *before* the change, as
   * `ParkTime`'s "HH:MM:SS".
   *
   * The before, not the after, because the before is the value we reliably
   * have. Disney can answer a move with a different time than the one asked
   * for, so "it is at the time we wanted" is not a test that can be relied on
   * -- while "it is no longer where it was" settles a modify, and for a swap
   * the reservation being gone from plans altogether says the same thing.
   */
  from?: string;
  /** Consecutive reads still showing it exactly as it was. */
  contrary: number;
}

type Quarantine = Record<string, Doubt>;

/**
 * How long a doubt is given before absence starts counting against it.
 *
 * A request that has not surfaced in Disney's itinerary within two minutes is
 * not going to, and the same span is the lease's TTL for the same reason. Below
 * this, absence means the itinerary has not caught up -- which is the thing
 * `CONFIRM_ABSENT_POLLS` exists to survive.
 */
export const DOUBT_SETTLE_MS = LEASE_TTL_MS;

/** Reads showing no sign of the change before it is declared not to have happened. */
export const DOUBT_CONTRARY_READS = 2;

function loadQuarantine(): Quarantine {
  const stored = kvdb.getDaily<unknown>(QUARANTINE_KEY);
  if (!stored || typeof stored !== 'object') return {};
  return Object.fromEntries(
    Object.entries(stored as Record<string, unknown>).flatMap(
      ([key, value]) => {
        const doubt = value as Partial<Doubt>;
        if (typeof doubt?.at !== 'number') return [];
        return [
          [
            key,
            {
              at: doubt.at,
              ...(typeof doubt.from === 'string' ? { from: doubt.from } : {}),
              contrary: typeof doubt.contrary === 'number' ? doubt.contrary : 0,
            },
          ],
        ];
      }
    )
  );
}

/**
 * Mark a reservation as being in an unknown state. Nothing may touch it.
 *
 * Under the same mutex as the leases: two instances raising a doubt at once, or
 * a clear racing a new doubt, would otherwise lose one of them through a plain
 * read-modify-write -- and the entry lost would be the one protecting a
 * reservation.
 */
export async function quarantine(
  key: string,
  was: { from?: string } = {},
  now = Date.now()
): Promise<void> {
  await exclusive(() => {
    kvdb.setDaily<Quarantine>(QUARANTINE_KEY, {
      ...loadQuarantine(),
      [key]: {
        at: now,
        contrary: 0,
        ...(was.from ? { from: was.from } : {}),
      },
    });
  });
}

/** Whether a reservation is in doubt, and since when. */
export function quarantinedAt(key: string): number | undefined {
  return loadQuarantine()[key]?.at;
}

/**
 * Offer one plans read as evidence about every reservation in doubt.
 *
 * `seen` reports the return time that read found for a key, or undefined if the
 * reservation was not there. Positive evidence settles at once: the reservation
 * is no longer as it was, so the change happened. Anything else is only evidence
 * once the change has had time to appear, and then only if it keeps saying the
 * same thing -- the standard `resolveBook` already applies to a doubtful
 * booking, for the same reason.
 */
export async function reconcile(
  seen: (key: string) => string | undefined,
  now = Date.now()
): Promise<void> {
  await exclusive(() => {
    const current = loadQuarantine();
    const next: Quarantine = {};
    let changed = false;
    for (const [key, doubt] of Object.entries(current)) {
      const at = seen(key);
      if (doubt.from !== undefined && at !== doubt.from) {
        // It is no longer where it was, so the change landed -- whether that is
        // a different return time, or, for a swap, the reservation being gone.
        changed = true;
        continue;
      }
      if (now - doubt.at < DOUBT_SETTLE_MS) {
        next[key] = doubt;
        continue;
      }
      const contrary = doubt.contrary + 1;
      if (contrary >= DOUBT_CONTRARY_READS) {
        changed = true;
        continue;
      }
      next[key] = { ...doubt, contrary };
      changed = true;
    }
    if (changed) kvdb.setDaily<Quarantine>(QUARANTINE_KEY, next);
  });
}

/** Keyed by reservation and the day it belongs to, not by action. */
export function leaseKey(facilityId: string, date: string): string {
  return `${date}:${facilityId}`;
}

/** The reservation a key names. A park date carries no colon, so the first splits it. */
export function leaseParts(key: string): { date: string; facilityId: string } {
  const colon = key.indexOf(':');
  return { date: key.slice(0, colon), facilityId: key.slice(colon + 1) };
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
    // Doubt outranks everything, including the instance that raised it: until
    // plans settle what happened, a second request is exactly what must not
    // occur.
    if (quarantinedAt(key) !== undefined) return false;
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
