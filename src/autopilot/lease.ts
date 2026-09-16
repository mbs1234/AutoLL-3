import { parkDate } from '@/datetime';
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
 *   `LEASE_TTL_MS` is therefore free to take. Holders renew while they work --
 *   see `keepAlive`, which is what makes "while they work" mean the length of
 *   the request rather than the length of the tick that started it.
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

/**
 * How often a holder renews while its request is still in the air.
 *
 * A third of the TTL, so two renewals can be missed -- a phone throttling
 * timers in a backgrounded tab, a long garbage-collection pause -- before the
 * lease lapses under a live request.
 */
export const RENEW_INTERVAL_MS = LEASE_TTL_MS / 3;

/** The name Web Locks serialises on. One critical section for the whole store. */
const MUTEX = 'autoll3.autopilot.leases.mutex';

interface Lease {
  owner: string;
  /** `Date.now()` at the last acquire or renew. */
  at: number;
}

type Leases = Record<string, Lease>;

/** Which action left the reservation in doubt, because the evidence differs. */
export type DoubtKind = 'modify' | 'swap';

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
   * What the change was, because the two actions leave different traces.
   *
   * A modify leaves the reservation in place at a new time, so seeing it move
   * is proof. A swap removes it and puts a different attraction in its slot, so
   * the proof is the *incoming* attraction turning up -- the victim's absence
   * is merely consistent with that, and equally consistent with one plans
   * response having omitted a reservation that is still there.
   *
   * Optional only so a store written by an older build parses; absent means no
   * positive test applies and the doubt settles the slow way.
   */
  kind?: DoubtKind;
  /**
   * The return time the reservation was at *before* the change, as
   * `ParkTime`'s "HH:MM:SS".
   *
   * The before, not the after, because the before is the value we reliably
   * have. Disney can answer a move with a different time than the one asked
   * for, so "it is at the time we wanted" is not a test that can be relied on
   * -- while "it is no longer where it was" settles a modify.
   *
   * Taken at the commit boundary from the offer's own itinerary, not from the
   * plans snapshot the tick started with: those can differ by one move, and a
   * stale `from` makes an unchanged reservation look like proof the change
   * landed.
   */
  from?: string;
  /**
   * For a swap, the facility that must appear if the change landed.
   *
   * The only positive proof a swap went through. Its own reservation, on the
   * same park day as the one given up.
   */
  gaining?: string;
  /** Consecutive reads that found no sign of the change. */
  contrary: number;
  /** When the read that last counted against this doubt *started*. */
  last?: number;
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

/**
 * The least time between two reads that both count against a doubt.
 *
 * `DOUBT_CONTRARY_READS` is meant to be two *independent* observations, and
 * without a spacing rule it is not: `fetchJson` hands concurrent identical
 * requests the same promise, so two `pollPlans()` calls in one tick can be one
 * HTTP response counted twice -- and during a drop burst plans are read far
 * more often than at idle, so even uncoalesced reads can arrive closer together
 * than Disney could possibly have changed its answer.
 *
 * Derived rather than picked: the reads that settle a doubt are spread over at
 * least as long again as the window the change was given to appear in.
 */
export const DOUBT_READ_SPACING_MS = DOUBT_SETTLE_MS / DOUBT_CONTRARY_READS;

/**
 * Doubts, with anything belonging to a park day already past dropped.
 *
 * Stored plainly rather than through `getDaily`, which scopes a whole value to
 * *today* -- so every doubt vanished at the 4am rollover whatever day its
 * reservation was on. That discarded a doubt raised minutes before rollover
 * before its settle window had run, and it discarded doubts about future-dated
 * reservations, which is most of what this app books. The keys already name the
 * day; pruning by that is both narrower and correct.
 *
 * Pruned on read rather than rewritten here: the next write persists it, and a
 * dead entry that is filtered on every read costs nothing until then.
 */
function loadQuarantine(): Quarantine {
  const today = parkDate();
  const stored = unwrapDaily(kvdb.get<unknown>(QUARANTINE_KEY), today);
  if (!stored) return {};
  const out: Quarantine = {};
  for (const [key, value] of Object.entries(stored)) {
    const doubt = value as Partial<Doubt>;
    if (typeof doubt?.at !== 'number') continue;
    // The day is over: there is no reservation left to protect.
    if (leaseParts(key).date < today) continue;
    out[key] = {
      at: doubt.at,
      ...(doubt.kind === 'modify' || doubt.kind === 'swap'
        ? { kind: doubt.kind }
        : {}),
      ...(typeof doubt.from === 'string' ? { from: doubt.from } : {}),
      ...(typeof doubt.gaining === 'string' ? { gaining: doubt.gaining } : {}),
      contrary: typeof doubt.contrary === 'number' ? doubt.contrary : 0,
      ...(typeof doubt.last === 'number' ? { last: doubt.last } : {}),
    };
  }
  return out;
}

/**
 * A store written by the build that scoped this value to a single day.
 *
 * Two lines rather than none because the upgrade lands as a page reload, and a
 * reload is exactly when a doubt matters most: the script that raised it is
 * gone and its request may still have reached Disney. Dropping the wrapper on
 * the floor would have the deploy itself unprotect a reservation. Honoured only
 * for today, which is all the old shape ever meant.
 */
function unwrapDaily(
  stored: unknown,
  today: string
): Record<string, unknown> | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  const daily = stored as { date?: unknown; value?: unknown };
  if (typeof daily.date === 'string') {
    if (daily.date !== today) return undefined;
    return daily.value && typeof daily.value === 'object'
      ? (daily.value as Record<string, unknown>)
      : undefined;
  }
  return stored as Record<string, unknown>;
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
  was: { kind?: DoubtKind; from?: string; gaining?: string } = {},
  now = Date.now()
): Promise<void> {
  await exclusive(() => {
    kvdb.set<Quarantine>(QUARANTINE_KEY, {
      ...loadQuarantine(),
      [key]: {
        at: now,
        contrary: 0,
        ...(was.kind ? { kind: was.kind } : {}),
        ...(was.from ? { from: was.from } : {}),
        ...(was.gaining ? { gaining: was.gaining } : {}),
      },
    });
  });
}

/** Whether a reservation is in doubt, and since when. */
export function quarantinedAt(key: string): number | undefined {
  return loadQuarantine()[key]?.at;
}

/**
 * Whether one plans read proves the change this doubt is about actually landed.
 *
 * Deliberately narrow. Only a trace the change itself would have left counts;
 * everything else -- including the reservation being missing -- is "no sign of
 * it", which settles the doubt slowly and only by repetition.
 */
function landed(
  key: string,
  doubt: Doubt,
  seen: (key: string) => string | undefined
): boolean {
  if (doubt.kind === 'swap') {
    // The attraction the swap was for, in the slot the victim used to hold.
    // The victim's own absence is not proof: a swap that never happened looks
    // exactly the same as one plans response leaving the reservation out.
    if (!doubt.gaining) return false;
    return seen(leaseKey(doubt.gaining, leaseParts(key).date)) !== undefined;
  }
  if (doubt.kind === 'modify') {
    // Present, and no longer where it was. A modify leaves the reservation in
    // place, so a disappearance says the read is incomplete rather than that
    // the move went through.
    const at = seen(key);
    return doubt.from !== undefined && at !== undefined && at !== doubt.from;
  }
  return false;
}

/**
 * Offer one plans read as evidence about every reservation in doubt.
 *
 * `seen` reports the return time that read found for a key, or undefined if
 * there is no such reservation. Positive evidence settles at once. Anything
 * else is only evidence once the change has had time to appear, and then only
 * if separate reads keep saying the same thing -- the standard `resolveBook`
 * already applies to a doubtful booking, for the same reason.
 *
 * `polledAt` is when the read *started*, which is the only honest measure of
 * what it can speak about. A response already in flight when the doubt was
 * raised describes the world before the request went out: counting it either
 * way is reading evidence out of a photograph taken before the event.
 */
export async function reconcile(
  seen: (key: string) => string | undefined,
  now = Date.now(),
  polledAt = now
): Promise<void> {
  await exclusive(() => {
    const current = loadQuarantine();
    const next: Quarantine = {};
    let changed = false;
    for (const [key, doubt] of Object.entries(current)) {
      // Started before the doubt existed, so it saw nothing of it either way.
      if (polledAt <= doubt.at) {
        next[key] = doubt;
        continue;
      }
      if (landed(key, doubt, seen)) {
        changed = true;
        continue;
      }
      if (now - doubt.at < DOUBT_SETTLE_MS) {
        next[key] = doubt;
        continue;
      }
      // Too close to the read that last counted to be a separate observation.
      if (
        doubt.last !== undefined &&
        polledAt - doubt.last < DOUBT_READ_SPACING_MS
      ) {
        next[key] = doubt;
        continue;
      }
      const contrary = doubt.contrary + 1;
      if (contrary >= DOUBT_CONTRARY_READS) {
        changed = true;
        continue;
      }
      next[key] = { ...doubt, contrary, last: polledAt };
      changed = true;
    }
    if (changed) kvdb.set<Quarantine>(QUARANTINE_KEY, next);
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

/**
 * Hold a lease for as long as the request that took it is actually outstanding.
 *
 * Acquiring once and trusting the TTL was a hole: the poller abandons a tick at
 * `TICK_DEADLINE_MS` without cancelling it, and nothing bounds the read of a
 * response body, so an operation can still be in the air when its lease expires
 * at 120 seconds -- at which point another actor takes the reservation the
 * request is about to change.
 *
 * Renewal rather than a Web Lock held for the operation's lifetime, which was
 * the other way to close it: a Web Lock is released when the tab dies, and a
 * dead tab's request may still have reached Disney. Expiry is the only safe way
 * to reclaim that, and renewal keeps it while making "outstanding" mean the
 * request rather than the tick.
 *
 * Returns the canceller. Call it before releasing, or the timer re-takes the
 * lease the release just gave back.
 */
export function keepAlive(key: string, owner: string): () => void {
  const timer = setInterval(() => {
    void acquire(key, owner);
  }, RENEW_INTERVAL_MS);
  return () => clearInterval(timer);
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
