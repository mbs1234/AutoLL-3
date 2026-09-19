import { APP_SLUG } from '@/appIdentity';
import { parkDate } from '@/datetime';
import kvdb from '@/kvdb';
import { storageKey } from '@/storageNamespace';

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

export const LEASE_KEY = storageKey('autopilot.leases');
export const QUARANTINE_KEY = storageKey('autopilot.unresolved');

/**
 * How long a lease stands without renewal.
 *
 * Longer than one ordinary network request, while active operations renew it.
 * Renewal is necessary because sensor/offer work and the mutation lifecycle
 * can outlast one TTL. Expiry is still short enough that a tab closed mid-move
 * does not hold a reservation for the rest of the day -- which is what the
 * retained `change:` attempt lock used to do.
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

/** Why a holder stopped being able to renew. */
export type LeaseLost =
  /** Somebody quarantined the reservation, or took the lease over. */
  'refused';

/** The name Web Locks serialises on. One critical section for the whole store. */
const MUTEX = storageKey('autopilot.leases.mutex');

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
 * Clearing it because enough time or contrary reads passed was the second
 * mistake. Those are not proof that Disney did not apply a request whose
 * response was lost. A doubt now clears only on the exact state requested, a
 * definitive late response, or an explicit confirmation from the person who
 * checked Disney's Plans.
 */
export interface Doubt {
  /** Stable identity of the mutation that raised this question. */
  id: string;
  /** `Date.now()` when the mutating HTTP request was dispatched. */
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
   * automatic evidence can settle it and a person must resolve it.
   */
  kind?: DoubtKind;
  /**
   * The return time the reservation was at before the change, where the offer
   * supplied one. Kept for the explanation shown to the user; it is not used
   * as automatic evidence because "different from before" cannot identify
   * which mutation caused the change.
   */
  from?: string;
  /**
   * The return time the request asked the reservation to move *to*.
   *
   * The exact time in the offer sent to `/book`. It is the only automatic
   * evidence accepted for a modify. If Disney chose a different time and the
   * response was lost, a person must resolve the doubt after checking Plans.
   */
  to?: string;
  /**
   * For a swap, the facility that must appear if the change landed.
   *
   * The only positive proof a swap went through. Its own reservation, on the
   * same park day as the one given up.
   */
  gaining?: string;
  /**
   * Booking/entitlement identities for the reservation the request changed.
   *
   * Attraction and return time are not an identity: split parties can hold
   * two reservations for the same ride on the same day. Without this, one
   * already at the requested time could falsely clear the other reservation's
   * unknown mutation. Optional only for stores written by an older build;
   * legacy doubts require a person to resolve them.
   */
  reservationIds?: string[];
}

/**
 * Every unsettled doubt about one reservation, not just the newest.
 *
 * A single slot per reservation silently discarded protection. Two unknown
 * requests against one reservation are reachable -- a lease that expired under
 * an operation the poller had abandoned is the acknowledged way in -- and the
 * second doubt simply overwrote the first, so evidence that settled one
 * unlocked the reservation for both. Each is its own question with its own
 * baseline, and the reservation is free only when every one of them has an
 * answer.
 */
type Quarantine = Record<string, Doubt[]>;

/**
 * Same-page fail-closed protection when the durable store cannot be written.
 *
 * It deliberately does not pretend to survive a reload or coordinate another
 * tab. Callers surface that limitation, while every actor in this page still
 * consults the same merged quarantine and therefore refuses a duplicate
 * mutation. This replaces the old fallback that kept a renewal interval alive
 * forever even though the same storage failure could permanently stop that
 * interval on its next tick.
 */
let volatileQuarantine: Quarantine = {};

export interface PlanEvidence {
  /** The active reservation's return time. */
  time: string;
  /** Every booking/entitlement identity that can name this reservation. */
  reservationIds: string[];
}

export interface QuarantinedMutation extends Doubt {
  key: string;
  date: string;
  facilityId: string;
  /** False when this page is the only place the doubt could be recorded. */
  durable: boolean;
}

export interface QuarantineResult {
  id: string;
  /** False means protected in this page only, not across reloads or tabs. */
  durable: boolean;
  error?: unknown;
}

/**
 * The `window` event a quarantine change is announced on within this page.
 *
 * Namespaced by `APP_SLUG` for the same reason the storage keys are: a sibling
 * build can be running in this very page, and an unprefixed name would have
 * each of them re-reading a store the other wrote and their own did not.
 * Notification across tabs is the `storage` listener in `subscribeQuarantine`,
 * which keys on `QUARANTINE_KEY` and is therefore already build-specific.
 */
const QUARANTINE_EVENT = `${APP_SLUG}:quarantine-change`;
let generatedId = 0;

/** An id that stays with one mutation through abandonment and any late result. */
export function mutationId(prefix = 'mutation'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${++generatedId}-${random}`;
}

/**
 * Doubts, with anything belonging to a park day already past dropped.
 *
 * Stored plainly rather than through `getDaily`, which scopes a whole value to
 * *today* -- so every doubt vanished at the 4am rollover whatever day its
 * reservation was on. That discarded a doubt raised minutes before rollover
 * before anyone could inspect it, and it discarded doubts about future-dated
 * reservations, which is most of what this app books. The keys already name the
 * day; pruning by that is both narrower and correct.
 *
 * Pruned on read rather than rewritten here: the next write persists it, and a
 * dead entry that is filtered on every read costs nothing until then.
 */
function loadPersistedQuarantine(): Quarantine {
  const today = parkDate();
  const stored = unwrapDaily(kvdb.get<unknown>(QUARANTINE_KEY));
  if (!stored) return {};
  const out: Quarantine = {};
  for (const [key, value] of Object.entries(stored)) {
    const { date, facilityId } = leaseParts(key);
    if (
      !facilityId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(`${date}T00:00:00`))
    ) {
      continue;
    }
    // The day is over: there is no reservation left to protect.
    if (date < today) continue;
    const doubts = parseDoubts(value);
    if (doubts.length) out[key] = doubts;
  }
  return out;
}

function mergeQuarantines(...stores: Quarantine[]): Quarantine {
  const merged: Quarantine = {};
  for (const store of stores) {
    for (const [key, doubts] of Object.entries(store)) {
      const byId = new Map((merged[key] ?? []).map(doubt => [doubt.id, doubt]));
      for (const doubt of doubts) byId.set(doubt.id, doubt);
      if (byId.size) merged[key] = [...byId.values()];
    }
  }
  return merged;
}

function activeVolatileQuarantine(): Quarantine {
  const today = parkDate();
  const active: Quarantine = {};
  for (const [key, doubts] of Object.entries(volatileQuarantine)) {
    const { date, facilityId } = leaseParts(key);
    if (
      facilityId &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(`${date}T00:00:00`)) &&
      date >= today &&
      doubts.length
    ) {
      active[key] = doubts;
    }
  }
  volatileQuarantine = active;
  return active;
}

/** Read-only callers must still see page-local protection if storage is down. */
function loadQuarantine(): Quarantine {
  let persisted: Quarantine = {};
  try {
    persisted = loadPersistedQuarantine();
  } catch {
    // A storage read failure is itself a reason not to discard the only
    // protection this page can still establish.
  }
  return mergeQuarantines(persisted, activeVolatileQuarantine());
}

/** Safety gates must refuse rather than infer "no doubt" from a failed read. */
function loadBlockingQuarantine(): Quarantine {
  return mergeQuarantines(
    loadPersistedQuarantine(),
    activeVolatileQuarantine()
  );
}

function rememberVolatile(key: string, doubt: Doubt): void {
  volatileQuarantine = mergeQuarantines(volatileQuarantine, {
    [key]: [doubt],
  });
}

function forgetVolatile(key: string, id: string): boolean {
  const doubts = volatileQuarantine[key];
  if (!doubts?.some(doubt => doubt.id === id)) return false;
  const rest = doubts.filter(doubt => doubt.id !== id);
  const next = { ...volatileQuarantine };
  if (rest.length) next[key] = rest;
  else delete next[key];
  volatileQuarantine = next;
  return true;
}

/** Drop page-local copies that were included in a successful durable write. */
function forgetPersistedVolatile(persisted: Quarantine): boolean {
  let changed = false;
  for (const [key, doubts] of Object.entries(persisted)) {
    for (const doubt of doubts) {
      changed = forgetVolatile(key, doubt.id) || changed;
    }
  }
  return changed;
}

function reservationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    ),
  ];
}

/** One stored entry, which is a list but may be a single doubt from an older build. */
function parseDoubts(value: unknown): Doubt[] {
  const out: Doubt[] = [];
  for (const [index, entry] of (Array.isArray(value)
    ? value
    : [value]
  ).entries()) {
    const doubt = entry as Partial<Doubt>;
    if (typeof doubt?.at !== 'number') continue;
    const ids = reservationIds(doubt.reservationIds);
    out.push({
      id:
        typeof doubt.id === 'string' ? doubt.id : `legacy-${doubt.at}-${index}`,
      at: doubt.at,
      ...(doubt.kind === 'modify' || doubt.kind === 'swap'
        ? { kind: doubt.kind }
        : {}),
      ...(typeof doubt.from === 'string' ? { from: doubt.from } : {}),
      ...(typeof doubt.to === 'string' ? { to: doubt.to } : {}),
      ...(typeof doubt.gaining === 'string' ? { gaining: doubt.gaining } : {}),
      ...(ids.length ? { reservationIds: ids } : {}),
    });
  }
  return out;
}

/**
 * A store written by the build that scoped this value to a single day.
 *
 * Unwrapped rather than dropped because the upgrade lands as a page reload, and
 * a reload is exactly when a doubt matters most: the script that raised it is
 * gone and its request may still have reached Disney. Dropping the wrapper on
 * the floor would have the deploy itself unprotect a reservation.
 *
 * Unwrapped whatever day the wrapper names, which is the correction to the
 * first attempt at this. The wrapper's date says when the store was *written*;
 * it says nothing about which reservations are inside, and most of what this app
 * books is dated weeks out. Yesterday's wrapper can hold a doubt about a
 * December reservation, and honouring only today's threw exactly those away.
 * Pruning is the key's job, and the key names the reservation's own day.
 */
function unwrapDaily(stored: unknown): Record<string, unknown> | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  const daily = stored as { date?: unknown; value?: unknown };
  // A real store's keys are `<date>:<facilityId>`, so neither `date` nor
  // `value` can be one of them.
  if (
    typeof daily.date === 'string' &&
    daily.value &&
    typeof daily.value === 'object'
  ) {
    return daily.value as Record<string, unknown>;
  }
  return stored as Record<string, unknown>;
}

function publishQuarantineChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(QUARANTINE_EVENT));
  }
}

/**
 * Mark a reservation as being in an unknown state. Nothing may touch it.
 *
 * Added to whatever is already unsettled rather than replacing it: two unknown
 * requests against one reservation are two questions, and answering one does
 * not answer the other.
 *
 * Under the same mutex as the leases: two instances raising a doubt at once, or
 * a clear racing a new doubt, would otherwise lose one of them through a plain
 * read-modify-write -- and the entry lost would be the one protecting a
 * reservation.
 */
export async function quarantine(
  key: string,
  was: {
    id?: string;
    kind?: DoubtKind;
    from?: string;
    to?: string;
    gaining?: string;
    reservationIds?: string[];
  } = {},
  now = Date.now()
): Promise<QuarantineResult> {
  const id = was.id ?? mutationId('doubt');
  const ids = reservationIds(was.reservationIds);
  const raised: Doubt = {
    id,
    at: now,
    ...(was.kind ? { kind: was.kind } : {}),
    ...(was.from ? { from: was.from } : {}),
    ...(was.to ? { to: was.to } : {}),
    ...(was.gaining ? { gaining: was.gaining } : {}),
    ...(ids.length ? { reservationIds: ids } : {}),
  };
  let persisted = false;
  let written: Quarantine | undefined;
  try {
    await exclusive(() => {
      // Include any earlier page-local doubts. If storage has recovered, this
      // write promotes all of them to durable protection at once.
      const current = mergeQuarantines(
        loadPersistedQuarantine(),
        activeVolatileQuarantine()
      );
      // The same operation may reach this path twice -- first its deadline,
      // then a late status-0. Identity, not similar evidence, says those are
      // one question. Two distinct requests for the same move remain two
      // questions.
      const rest = (current[key] ?? []).filter(d => d.id !== id);
      written = {
        ...current,
        [key]: [...rest, raised],
      };
      kvdb.set<Quarantine>(QUARANTINE_KEY, written);
      persisted = true;
      // Quarantine outranks work already holding the lease as well as new
      // acquisition. Evicting it here means clearing this doubt later cannot
      // accidentally revive a pre-quarantine holder that has not reached its
      // next renewal yet. A request it already sent is beyond recall; its own
      // mutation id will account for that outcome separately.
      const leases = load(Date.now());
      if (leases[key]) {
        const next = { ...leases };
        delete next[key];
        kvdb.set<Leases>(LEASE_KEY, next);
      }
    });
  } catch (error) {
    if (!persisted) rememberVolatile(key, raised);
    if (persisted && written) forgetPersistedVolatile(written);
    if (!persisted) publishQuarantineChange();
    return { id, durable: persisted, error };
  } finally {
    // The quarantine write intentionally precedes lease eviction. If the
    // second write fails, the durable protection still changed and every
    // mounted screen must hear about it even though the result also reports
    // the lease-cleanup error.
    if (persisted) {
      if (written) forgetPersistedVolatile(written);
      publishQuarantineChange();
    }
  }
  return { id, durable: true };
}

/** Remove only the question whose outcome is now known. */
export async function resolveDoubt(key: string, id: string): Promise<void> {
  let changed = false;
  // The page-local copy goes first, and in a `finally`, because the durable
  // read is one of the two things that can be broken here -- and if it throws,
  // the volatile doubt it was raised alongside would otherwise have no terminus
  // but a reload, which is the one thing the panel warns destroys protection.
  // `reconcile()` already clears the volatile store outside its `exclusive()`
  // for the same reason; this was the asymmetry.
  let volatileChanged = false;
  try {
    await exclusive(() => {
      const current = loadPersistedQuarantine();
      const doubts = current[key];
      if (!doubts?.some(d => d.id === id)) return;
      const rest = doubts.filter(d => d.id !== id);
      const next = { ...current };
      if (rest.length) next[key] = rest;
      else delete next[key];
      kvdb.set<Quarantine>(QUARANTINE_KEY, next);
      changed = true;
    });
  } finally {
    volatileChanged = forgetVolatile(key, id);
    if (changed || volatileChanged) publishQuarantineChange();
  }
}

/** Every unresolved mutation, for Today, Plan Check and Activity. */
export function quarantinedMutations(): QuarantinedMutation[] {
  const local = activeVolatileQuarantine();
  return Object.entries(loadQuarantine())
    .flatMap(([key, doubts]) => {
      const { date, facilityId } = leaseParts(key);
      const localIds = new Set((local[key] ?? []).map(doubt => doubt.id));
      return doubts.map(doubt => ({
        ...doubt,
        key,
        date,
        facilityId,
        durable: !localIds.has(doubt.id),
      }));
    })
    .sort((a, b) => a.at - b.at);
}

/** Observe writes from this tab and from other tabs on Disney's origin. */
export function subscribeQuarantine(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const storage = (event: StorageEvent) => {
    if (event.key === QUARANTINE_KEY) listener();
  };
  window.addEventListener(QUARANTINE_EVENT, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(QUARANTINE_EVENT, listener);
    window.removeEventListener('storage', storage);
  };
}

/** Whether a reservation is in doubt, and since the oldest unsettled one. */
export function quarantinedAt(key: string): number | undefined {
  const doubts = loadQuarantine()[key];
  if (!doubts?.length) return undefined;
  return Math.min(...doubts.map(d => d.at));
}

/**
 * Whether one plans read proves the change this doubt is about actually landed.
 *
 * Deliberately narrow. Only the exact requested state counts; everything else,
 * including absence and a different time, leaves the doubt for a person.
 */
function landed(
  key: string,
  doubt: Doubt,
  seen: (
    key: string,
    reservationIds: readonly string[],
    requestedTime: string
  ) => PlanEvidence | undefined
): boolean {
  const expected = doubt.reservationIds;
  // A legacy record names a ride and a time, not a reservation. That is not
  // enough to distinguish split-party bookings, so it needs manual review.
  if (!expected?.length) return false;
  const matchesReservation = (evidence: PlanEvidence | undefined) =>
    !!evidence && evidence.reservationIds.some(id => expected.includes(id));
  if (doubt.kind === 'swap') {
    // The attraction the swap was for, in the slot the victim used to hold.
    // The victim's own absence is not proof: a swap that never happened looks
    // exactly the same as one plans response leaving the reservation out.
    if (!doubt.gaining || !doubt.to) return false;
    const evidence = seen(
      leaseKey(doubt.gaining, leaseParts(key).date),
      expected,
      doubt.to
    );
    return matchesReservation(evidence) && evidence?.time === doubt.to;
  }
  if (doubt.kind === 'modify') {
    // `to` is the actual offer time sent to `/book`, not the earlier tipboard
    // candidate. Anything else may be a manual move or another generation and
    // cannot answer this operation's question.
    if (doubt.to === undefined) return false;
    const evidence = seen(key, expected, doubt.to);
    return matchesReservation(evidence) && evidence?.time === doubt.to;
  }
  return false;
}

/**
 * Offer one plans read as evidence about every reservation in doubt.
 *
 * `seen` reports the active Lightning Lane that read found for a key, or
 * undefined. Positive evidence settles at once. Absence, elapsed time and
 * contrary reads never do.
 *
 * `polledAt` is when the read *started*, which is the only honest measure of
 * what it can speak about, and it is the only clock this function has. A
 * response already in flight when the doubt was raised describes the world
 * before the request went out: counting it either way is reading evidence out
 * of a photograph taken before the event.
 */
export async function reconcile(
  seen: (
    key: string,
    reservationIds: readonly string[],
    requestedTime: string
  ) => PlanEvidence | undefined,
  polledAt = Date.now()
): Promise<void> {
  let volatileChanged = false;
  const nextVolatile: Quarantine = {};
  for (const [key, doubts] of Object.entries(volatileQuarantine)) {
    const kept = doubts.filter(doubt => {
      const resolved = polledAt > doubt.at && landed(key, doubt, seen);
      volatileChanged ||= resolved;
      return !resolved;
    });
    if (kept.length) nextVolatile[key] = kept;
  }
  volatileQuarantine = nextVolatile;

  let changed = false;
  try {
    await exclusive(() => {
      const current = loadPersistedQuarantine();
      const next: Quarantine = {};
      for (const [key, doubts] of Object.entries(current)) {
        const kept: Doubt[] = [];
        for (const doubt of doubts) {
          // A response already in flight when the mutation was dispatched
          // cannot speak about it. After that, only the exact requested state
          // clears; absence and elapsed time are deliberately not proof.
          if (polledAt > doubt.at && landed(key, doubt, seen)) changed = true;
          else kept.push(doubt);
        }
        if (kept.length) next[key] = kept;
      }
      if (changed) kvdb.set<Quarantine>(QUARANTINE_KEY, next);
    });
  } finally {
    if (changed || volatileChanged) publishQuarantineChange();
  }
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
  now?: number
): Promise<boolean> {
  return exclusive(() => {
    const at = now ?? Date.now();
    // Doubt outranks everything, including the instance that raised it: until
    // plans settle what happened, a second request is exactly what must not
    // occur.
    if (loadBlockingQuarantine()[key]?.length) return false;
    const leases = load(at);
    const held = leases[key];
    if (held && held.owner !== owner) return false;
    kvdb.set<Leases>(LEASE_KEY, { ...leases, [key]: { owner, at } });
    return true;
  });
}

/** Renew only a lease that remained continuously live for this owner. */
async function renew(
  key: string,
  owner: string,
  now?: number
): Promise<boolean> {
  return exclusive(() => {
    const at = now ?? Date.now();
    if (loadBlockingQuarantine()[key]?.length) return false;
    const leases = load(at);
    if (leases[key]?.owner !== owner) return false;
    kvdb.set<Leases>(LEASE_KEY, { ...leases, [key]: { owner, at } });
    return true;
  });
}

export type LeaseStart<T> = { started: false } | { started: true; value: T };

/**
 * Revalidate ownership and start the HTTP request inside the same critical
 * section.
 *
 * `start()` must synchronously return the request promise. It is wrapped in a
 * plain object before the Web Lock callback returns, so the mutex is released
 * as soon as `fetch` has started rather than being held for the network round
 * trip.
 */
export async function startWhileHeld<T>(
  key: string,
  owner: string,
  authorize: () => boolean,
  start: () => Promise<T>,
  now?: number
): Promise<LeaseStart<T>> {
  const begun = await exclusive(() => {
    const at = now ?? Date.now();
    if (loadBlockingQuarantine()[key]?.length) {
      return { started: false } as const;
    }
    const leases = load(at);
    if (leases[key]?.owner !== owner || !authorize()) {
      return { started: false } as const;
    }
    kvdb.set<Leases>(LEASE_KEY, { ...leases, [key]: { owner, at } });
    return { started: true, promise: start() } as const;
  });
  if (!begun.started) return begun;
  return { started: true, value: await begun.promise };
}

/**
 * Resolve one known outcome and retain the lease without an unlocked gap.
 *
 * A foreground search can learn a definitive late success after its deadline
 * already quarantined and released the reservation. Removing that doubt and
 * acquiring in separate calls would briefly let another engine take the
 * reservation before the search starts settling the successful move in Plans.
 */
export async function resolveDoubtAndAcquire(
  key: string,
  id: string,
  owner: string,
  now?: number
): Promise<boolean> {
  let changed = false;
  let written: Quarantine | undefined;
  const acquired = await exclusive(() => {
    const at = now ?? Date.now();
    const current = mergeQuarantines(
      loadPersistedQuarantine(),
      activeVolatileQuarantine()
    );
    const doubts = current[key] ?? [];
    const rest = doubts.filter(doubt => doubt.id !== id);
    const found = rest.length !== doubts.length;

    // A different unresolved mutation still blocks this reservation.
    if (rest.length) {
      if (found) {
        const next = { ...current, [key]: rest };
        kvdb.set<Quarantine>(QUARANTINE_KEY, next);
        written = next;
        changed = true;
      }
      return false;
    }
    const leases = load(at);
    const held = leases[key];
    // If somebody else already has live work, leave this operation's
    // quarantine in place. Clearing first created an unprotected gap whenever
    // reacquisition was refused or its storage write failed.
    if (held && held.owner !== owner) return false;
    kvdb.set<Leases>(LEASE_KEY, { ...leases, [key]: { owner, at } });
    if (found) {
      const next = { ...current };
      delete next[key];
      kvdb.set<Quarantine>(QUARANTINE_KEY, next);
      written = next;
      changed = true;
    }
    return true;
  });
  if (written) {
    forgetPersistedVolatile(written);
    forgetVolatile(key, id);
  } else if (changed) {
    forgetVolatile(key, id);
  }
  if (changed) publishQuarantineChange();
  return acquired;
}

/**
 * Hold a lease for as long as its owner is actively working.
 *
 * Acquiring once and trusting the TTL was a hole: the poller can abandon a tick
 * while sensor generation or a request is still outstanding, and the mutation
 * lifecycle deliberately extends one renewal interval beyond that handoff.
 * An operation can therefore still be live when its original 120-second lease
 * expires -- at which point another actor could take the reservation it is
 * about to change. A foreground search also uses one loop for its whole run so
 * definite rejections do not reopen a between-cycles window.
 *
 * Renewal rather than a Web Lock held for the operation's lifetime, which was
 * the other way to close it: a Web Lock is released when the tab dies, and a
 * dead tab's request may still have reached Disney. Expiry is the only safe way
 * to reclaim that, and renewal keeps it while making "outstanding" mean the
 * request rather than the tick.
 *
 * Refusal means somebody quarantined the reservation, or this owner allowed its
 * claim to expire. The mutation lifecycle owns its absolute deadline; keeping
 * that timer here previously made the lease, ledger and transport each infer a
 * different commit boundary.
 *
 * Returns the canceller. Call it before releasing, or the timer re-takes the
 * lease the release just gave back. The canceller is the caller saying it is
 * done, so it does not report a loss.
 */
export function keepAlive(
  key: string,
  owner: string,
  onLost?: (reason: LeaseLost) => void
): () => void {
  let live = true;
  let pending = false;
  const renewal = setInterval(() => {
    if (pending) return;
    pending = true;
    void renew(key, owner)
      .then(got => {
        if (!got) end('refused');
      })
      .catch(error => {
        // A rejected Web Locks/storage operation means ownership can no
        // longer be established. Treat it as lost instead of leaving an
        // unhandled promise while the caller continues toward dispatch.
        console.error(error);
        end('refused');
      })
      .finally(() => {
        pending = false;
      });
  }, RENEW_INTERVAL_MS);
  function stop() {
    if (!live) return false;
    live = false;
    clearInterval(renewal);
    return true;
  }
  function end(reason: LeaseLost) {
    if (stop()) onLost?.(reason);
  }
  return () => void stop();
}

/** Give it back. Only the holder can, so nobody withdraws another's cover. */
export async function release(
  key: string,
  owner: string,
  now?: number
): Promise<void> {
  await exclusive(() => {
    const leases = load(now ?? Date.now());
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
