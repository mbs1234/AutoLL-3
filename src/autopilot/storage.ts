import { BookingLogEntry } from '@/contexts/AutopilotContext';
import { ParkTime, parkDate } from '@/datetime';
import kvdb from '@/kvdb';
import { storageKey } from '@/storageNamespace';

export const LOG_KEY = storageKey('autopilot.log');
export const SETTINGS_KEY = storageKey('autopilot.settings');
export const LOCKS_KEY = storageKey('autopilot.locks');
export const COMMITS_KEY = storageKey('autopilot.commits');
/** Newest first, capped: the log is a glance at recent activity, not history. */
export const LOG_LIMIT = 20;

interface StoredLogEntry {
  name: string;
  at: string;
  status: BookingLogEntry['status'];
  returnTime?: string;
  fromTime?: string;
  replacedName?: string;
  detail?: string;
  repeated?: number;
  reason?: string;
}

/** `ParkTime.from` throws on garbage; treat an unparseable time as absent. */
function parseTime(value?: string): ParkTime | undefined {
  if (!value) return undefined;
  try {
    return ParkTime.from(value);
  } catch {
    return undefined;
  }
}

const STATUSES = new Set<BookingLogEntry['status']>([
  'booked',
  'modified',
  'swapped',
  'failed',
  'skipped',
  'dry-run',
]);

/**
 * Today's activity log.
 *
 * Scoped to the park day via kvdb's daily helpers: what got booked yesterday
 * is not useful on a new park day, and the entry times would be ambiguous.
 * ParkTime serializes to "HH:MM:SS" via toJSON but does not revive from JSON,
 * hence the explicit parse. The entry time itself is required; an entry whose
 * time will not parse is dropped rather than shown with a bogus one.
 */
export function loadBookingLog(): BookingLogEntry[] {
  const stored = kvdb.getDaily<StoredLogEntry[]>(LOG_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.flatMap(e => {
    if (typeof e?.name !== 'string' || !STATUSES.has(e.status)) return [];
    const at = parseTime(e.at);
    if (!at) return [];
    const returnTime = parseTime(e.returnTime);
    const fromTime = parseTime(e.fromTime);
    return [
      {
        name: e.name,
        at,
        status: e.status,
        ...(returnTime ? { returnTime } : {}),
        ...(fromTime ? { fromTime } : {}),
        ...(typeof e.replacedName === 'string'
          ? { replacedName: e.replacedName }
          : {}),
        ...(typeof e.detail === 'string' ? { detail: e.detail } : {}),
        ...(typeof e.repeated === 'number' && e.repeated > 1
          ? { repeated: Math.floor(e.repeated) }
          : {}),
        // Rendered on the Activity screen but never written down, so every
        // explanation of why an action was acceptable vanished on reload --
        // leaving the row that says what happened without the half that says
        // why.
        ...(typeof e.reason === 'string' ? { reason: e.reason } : {}),
      },
    ];
  });
}

/**
 * A key that identifies one logged event, for merging two instances' copies.
 *
 * Entries carry no id. Name, time to the second, status and the two times are
 * specific enough in practice: two distinct events for the same attraction in
 * the same second with the same outcome would be one event reported twice.
 *
 * A *failure* is keyed differently, and has to be: `addLogEntry` collapses a
 * repeat of the failure already at the top into one row carrying a count and
 * **the time of the most recent occurrence**. With the time in the key, every
 * rewrite of that row looked like a new event, so the merge below kept the
 * stored copy as well and appended it back. In burst cadence that turned the
 * twenty stored rows into twenty copies of one error inside half a minute, and
 * the day's real bookings were gone.
 *
 * So a failure is keyed by exactly what `addLogEntry` collapses on -- name,
 * status and detail, with no time -- which keeps the two rules in agreement:
 * whatever the log would fold into one row, the merge treats as one row. Two
 * genuine failures are still told apart by attraction and by detail, which is
 * the same resolution the on-screen log offers.
 *
 * The cost is that when both providers have hit the same failure on the same
 * attraction, the two rows become one. Summing the counts is not available: a
 * provider rewrites its own row as the count climbs, so adding the stored value
 * would compound its own earlier writes. What the merge does instead is keep
 * the *larger* count and the *later* time of the two, so a slower writer can
 * neither wind a count backwards nor make a burst look older than it is. That
 * understates two concurrent bursts rather than misreporting one, which is the
 * right direction to be wrong in.
 */
function logKey(e: BookingLogEntry): string {
  if (e.status === 'failed') return ['failed', e.name, e.detail].join('|');
  return [e.name, String(e.at), e.status, e.returnTime, e.fromTime].join('|');
}

/**
 * Today's activity, merged with whatever is already stored.
 *
 * It used to be written wholesale from state loaded at mount, and there are
 * routinely two instances -- NextLL nests an AutopilotProvider inside the app's
 * own. So the outer provider's next write erased every booking the nested one
 * had recorded, and vice versa: the day's record of what autopilot actually did
 * depended on which screen wrote last.
 *
 * The result is ordered newest first, which is the order the provider builds in
 * anyway -- `addLogEntry` prepends. It used to keep the caller's order and slice
 * afterwards, and that let a stale writer holding twenty older rows discard
 * newer ones another instance had already recorded: the cap decided by who
 * wrote last rather than by what happened last.
 */
export function saveBookingLog(entries: BookingLogEntry[]): void {
  const stored = loadBookingLog();
  const storedByKey = new Map(stored.map(e => [logKey(e), e]));
  // Reconciled rather than simply preferred. The caller's copy wins on order
  // and content, but a stale writer must not be able to publish a lower count
  // or an earlier time over a row another instance has already advanced.
  const merged = [
    ...entries.map(entry => {
      const other = storedByKey.get(logKey(entry));
      if (!other) return entry;
      const repeated = Math.max(entry.repeated ?? 1, other.repeated ?? 1);
      const at = +other.at > +entry.at ? other.at : entry.at;
      return {
        ...entry,
        at,
        ...(repeated > 1 ? { repeated } : {}),
      };
    }),
    ...stored.filter(e => !entries.some(x => logKey(x) === logKey(e))),
  ];
  // Newest first before the cap, not after. Preserving the caller's order and
  // then slicing let a stale writer holding twenty older rows push out newer
  // ones another instance had already recorded -- the cap deciding by who wrote
  // last rather than by what happened last.
  const ordered = [...merged].sort((a, b) => +b.at - +a.at);
  kvdb.setDaily<StoredLogEntry[]>(
    LOG_KEY,
    ordered.slice(0, LOG_LIMIT).map(e => ({
      name: e.name,
      at: String(e.at),
      status: e.status,
      ...(e.returnTime ? { returnTime: String(e.returnTime) } : {}),
      ...(e.fromTime ? { fromTime: String(e.fromTime) } : {}),
      ...(e.replacedName ? { replacedName: e.replacedName } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
      ...(e.repeated && e.repeated > 1 ? { repeated: e.repeated } : {}),
      ...(e.reason ? { reason: e.reason } : {}),
    }))
  );
}

export interface AutopilotSettings {
  /**
   * Act only when every party member is eligible.
   *
   * Off by default to match how bg1 and Disney's own app behave when booking
   * by hand: they book for whoever is eligible. Turning this on trades some
   * bookings for the guarantee that the group is never split.
   */
  requireWholeParty: boolean;
  /**
   * Rehearse without acting.
   *
   * Every guard runs -- eligibility, whole-party, Tier 1 hold, windows -- and
   * the log records what *would* have been booked, moved or swapped, but no
   * offer is generated and nothing is committed. For a first park day with a
   * tool that spends real entitlements, watching it be right before letting it
   * act is worth a day of not acting. Persisted, and shown prominently while
   * on, so it cannot be quietly forgotten.
   */
  dryRun: boolean;
  /**
   * Refuse a return time that lands on top of something already planned.
   *
   * The manual booking screen shows an "Overlapping Plans" warning and lets
   * you book anyway; autopilot has nobody to warn, so it skips instead. That
   * is stricter than the warning it models, which is why it can be turned off
   * -- but a December day with a Candlelight Processional dining package is
   * exactly the case where a slot spent on top of dinner is a slot wasted, so
   * it defaults on.
   */
  avoidOverlaps: boolean;
}

export const DEFAULT_SETTINGS: AutopilotSettings = {
  requireWholeParty: false,
  dryRun: false,
  avoidOverlaps: true,
};

/** Not day-scoped: a preference about the party, not about a visit. */
export function loadSettings(): AutopilotSettings {
  const stored = kvdb.get<Partial<AutopilotSettings>>(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    // Only a literal true enables it; anything else stored reads as off.
    requireWholeParty: stored?.requireWholeParty === true,
    dryRun: stored?.dryRun === true,
    // Defaults on, so only a literal false turns it off. The asymmetry is
    // deliberate: the two above cost bookings when wrongly on, this one costs
    // a wasted slot when wrongly off.
    avoidOverlaps: stored?.avoidOverlaps !== false,
  };
}

export function saveSettings(settings: AutopilotSettings): void {
  kvdb.set<AutopilotSettings>(SETTINGS_KEY, settings);
}

/**
 * Per-attraction action locks (`AutoBookLedger.publishableKeys()`), shared so a
 * second tab or a nested provider (NextLL nests one inside the app's own) can
 * see what another instance has already attempted today.
 *
 * Keys are opaque strings here, and deliberately so: they are
 * `${bookingDate}:${kind}:${experienceId}`, and the date inside one is the
 * ledger's business rather than this file's. That is what let the key gain a
 * date without a storage migration -- the stored string is the identity, and
 * rewriting one on the way in would desync the owner-scoped removal below.
 *
 * Note the two dates are different dates. This store is scoped to the *park*
 * day, as the commits are; the date inside a key is the day the reservation
 * would be *for*. On a booking morning one day's bucket holds keys for every
 * park day being booked, which is the point.
 *
 * Day-scoped, like the commits. Written as the union of what is already stored
 * and what this instance holds, so a lock another instance took is never lost
 * to a slower write from this one.
 *
 * `remove` is what makes that union releasable. Adding is safe to infer -- a
 * key present in either copy is a lock somebody holds -- but a release cannot
 * be, because absence from `keys` is indistinguishable from an instance that
 * simply never held it. Without an explicit list the write was add-only, so
 * every release was undone by the next mount reading the day's locks back:
 * cancel a Lightning Lane by hand and autopilot would refuse to rebook that
 * attraction for the rest of the park day. Only the instance that took a lock
 * passes it here -- see `AutoBookLedger.ownedKeys`.
 *
 * Each key carries the id of the instance holding it, and **a release only
 * takes effect for the holder**. Without that, one instance could withdraw a
 * lock another instance was relying on: a foreground search that adopted a
 * lock from the day's copy and later gave it back was removing somebody else's
 * protection, not its own.
 *
 * Not atomic, and localStorage offers no way to make it so -- two instances can
 * still interleave a read and a write and lose one update. It is instead
 * self-healing: every holder republishes what it owns on each poll, so a lost
 * key is back within a tick rather than gone for the day. The separate
 * Web-Lock-backed operation lease closes the live dispatch race; this store is
 * the longer-lived record that prevents retries and survives after that lease
 * is released.
 */

/** What is stored: lock key to the id of the instance that holds it. */
type LockRecord = Record<string, string>;

/**
 * The owner recorded for a lock written before owners existed.
 *
 * Never equal to a real owner id, so a legacy entry is nobody's to release --
 * which is the safe reading. They age out with the day.
 */
const LEGACY_OWNER = '';

function loadLockRecord(): LockRecord {
  const stored = kvdb.getDaily<unknown>(LOCKS_KEY);
  // The shape before owners: a bare array of keys.
  if (Array.isArray(stored)) {
    return Object.fromEntries(
      stored.filter(k => typeof k === 'string').map(k => [k, LEGACY_OWNER])
    );
  }
  if (!stored || typeof stored !== 'object') return {};
  return Object.fromEntries(
    Object.entries(stored as Record<string, unknown>).filter(
      ([, owner]) => typeof owner === 'string'
    ) as [string, string][]
  );
}

export function loadLocks(): string[] {
  return Object.keys(loadLockRecord());
}

/** Whether `owner` is the instance recorded as holding `key`. */
export function holdsLock(key: string, owner: string): boolean {
  return loadLockRecord()[key] === owner;
}

export function saveLocks(
  owner: string,
  keys: readonly string[],
  remove: readonly string[] = []
): void {
  const record = loadLockRecord();
  // Only keys this instance owns are written, so re-publishing never steals a
  // lock from the instance actually holding it. Republished every poll, which
  // is what heals a write two instances interleaved and lost.
  for (const key of keys) record[key] = owner;
  // Removals last, so a release still wins over a re-lock in the same write --
  // the order the write has always had.
  //
  // A release is scoped to the holder. Dropping a key somebody else owns was
  // the bug: an instance that had adopted a lock from the day's copy and later
  // gave it back removed the protection its owner was relying on. A key we
  // just published is ours by definition, so this never blocks our own release.
  for (const key of remove) {
    if (record[key] === owner) delete record[key];
  }
  kvdb.setDaily<LockRecord>(LOCKS_KEY, record);
}

/**
 * Return times this party has committed today, shared across instances.
 *
 * `avoidOverlaps` is checked against the plans each instance last polled, plus
 * the offer's own itinerary. Neither sees a booking another instance made
 * moments ago: plans are refetched every tenth tick, around seven and a half
 * minutes apart at the idle cadence, and there are routinely two instances
 * because NextLL nests an AutopilotProvider inside the app's own. So both could
 * pass the overlap check against their own snapshot and commit return times that
 * clash -- the exact outcome the setting exists to prevent.
 *
 * This is the same reasoning the clash check already applies to the offer's
 * itinerary, which it unions in "since a booking made a minute ago may be in
 * plans and not yet in the offer", extended across instances.
 *
 * Day-scoped, like the locks. Only the start time is recorded,
 * so the span derived from it is the wider open-ended one -- the conservative
 * direction for something we know less about than a parsed plan.
 *
 * Each record also carries when it was written, because the gap it covers is
 * minutes long and the record is not. A commit written for a move or a swap
 * used to sit in this list for the rest of the park day: the only sweep was
 * over `book:` locks, so nothing cleared it, and a reservation that was
 * ridden or cancelled by hand went on blocking a 100-minute band of return
 * times for every attraction. Past `COMMIT_TTL_MS` the plans poll has had
 * every chance to see it, and plans are the better witness.
 */
export interface CommittedReturn {
  facilityId: string;
  /** `ParkTime`'s own "HH:MM:SS". */
  time: string;
  /** `Date.now()` when it was written. Absent in records an older build wrote. */
  at?: number;
  /**
   * The park day the reservation is for, not the day the record was written.
   *
   * They differ whenever a future date is being worked on, and conflating them
   * did two wrong things at once: the commit was filed under today, where it
   * warned about a clash on a day the reservation is not on, and it was absent
   * from the day it actually belongs to. Absent in records an older build wrote,
   * which are then read as belonging to the day they are stored under.
   */
  date?: string;
  /** Whether this known success added a slot or only changed an existing one. */
  kind?: 'book' | 'modify' | 'swap';
  /** Booking/entitlement identities for distinguishing split-party records. */
  reservationIds?: string[];
}

/**
 * How long a committed return time speaks for the party.
 *
 * Plans are refetched every tenth tick -- about seven and a half minutes at
 * the idle cadence, twelve seconds in a burst -- so this outlives a missed
 * poll comfortably while keeping a stale record's reach to a quarter hour
 * rather than a day.
 */
export const COMMIT_TTL_MS = 15 * 60 * 1000;

export function loadCommits(): CommittedReturn[] {
  const stored = kvdb.getDaily<CommittedReturn[]>(COMMITS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (c): c is CommittedReturn =>
      typeof c?.facilityId === 'string' && typeof c?.time === 'string'
  );
}

function validReservationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    ),
  ];
}

/**
 * The commits still worth believing.
 *
 * A record with no `at` was written by a build that did not stamp them, and
 * its age is unknowable; it is treated as expired rather than trusted for the
 * rest of the day.
 */
/** The day a record belongs to, defaulting to the day it is stored under. */
export function commitDate(c: CommittedReturn): string {
  return c.date ?? parkDate();
}

export function activeCommits(
  now = Date.now(),
  date = parkDate()
): CommittedReturn[] {
  return loadCommits().filter(
    c =>
      c.at !== undefined && now - c.at < COMMIT_TTL_MS && commitDate(c) === date
  );
}

/** Record one committed return time, replacing only that reservation's record. */
export function saveCommit(entry: CommittedReturn): void {
  const ids = validReservationIds(entry.reservationIds);
  const entryIds = new Set(ids);
  const rest = loadCommits().filter(current => {
    if (
      current.facilityId !== entry.facilityId ||
      commitDate(current) !== commitDate(entry)
    ) {
      return true;
    }
    const currentIds = validReservationIds(current.reservationIds);
    // A legacy record has no finer identity than ride and date. New records
    // replace it conservatively; two identified split-party reservations are
    // distinct only when their entitlement sets do not overlap.
    return (
      currentIds.length > 0 &&
      entryIds.size > 0 &&
      !currentIds.some(id => entryIds.has(id))
    );
  });
  kvdb.setDaily<CommittedReturn[]>(COMMITS_KEY, [
    ...rest,
    {
      at: Date.now(),
      facilityId: entry.facilityId,
      time: entry.time,
      ...(entry.date ? { date: entry.date } : {}),
      ...(entry.kind ? { kind: entry.kind } : {}),
      ...(ids.length ? { reservationIds: ids } : {}),
    },
  ]);
}

/** Forget a committed return once Plans supersedes it or its bridge expires. */
export function clearCommit(
  facilityId: string,
  date = parkDate(),
  reservationIds?: readonly string[]
): void {
  const expected = new Set(validReservationIds(reservationIds));
  const rest = loadCommits().filter(current => {
    if (current.facilityId !== facilityId || commitDate(current) !== date) {
      return true;
    }
    const currentIds = validReservationIds(current.reservationIds);
    return (
      expected.size > 0 &&
      currentIds.length > 0 &&
      !currentIds.some(id => expected.has(id))
    );
  });
  kvdb.setDaily<CommittedReturn[]>(COMMITS_KEY, rest);
}
