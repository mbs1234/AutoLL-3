import { Experience } from '@/api/ll';
import { ParkTime } from '@/datetime';
import kvdb from '@/kvdb';

/**
 * Learning the real drop schedule from what the poller sees.
 *
 * The hardcoded drop times in src/api/data/wdw.ts are maintained by hand from
 * third-party reports, and the best of those sources bucket their observations
 * to five minutes. Autopilot, meanwhile, is already watching the tipboard at
 * up to one-second resolution whenever it runs. Recording the moments
 * availability actually appears -- and, crucially, *when the poller was
 * looking* -- lets the schedule be checked and corrected from first-hand
 * evidence rather than trusted.
 *
 * Two signals count as a drop:
 *  - an attraction goes from unavailable to available;
 *  - its earliest offered return time jumps *earlier* by a meaningful amount,
 *    which is what a release of new inventory does to the tipboard even when
 *    the attraction was already available.
 *
 * Coverage is recorded alongside events so that "never observed at 15:47" is
 * only ever claimed for days on which the poller was actually running at 15:47.
 */

export const EVENTS_KEY = 'autoll3.autopilot.dropEvents';
export const COVERAGE_KEY = 'autoll3.autopilot.coverage';
export const WATCHED_KEY = 'autoll3.autopilot.watched-days';

/** How much earlier the next available time must move to count as a drop. */
export const EARLIER_THRESHOLD_MIN = 15;
/** Bound on stored events; oldest are discarded first. */
export const MAX_EVENTS = 1000;
/** Coverage is tracked in buckets this many minutes wide. */
export const COVERAGE_BUCKET_MIN = 5;
/** Coverage is kept for this many distinct park days. */
export const MAX_COVERAGE_DAYS = 30;
/**
 * Observations this close together are one drop. Polling lands at or just
 * after the release, never before, so a cluster is labelled by its *earliest*
 * minute -- the one nearest the true release time.
 */
export const CLUSTER_TOLERANCE_MIN = 2;

export interface DropEvent {
  experienceId: string;
  /** Park date. */
  date: string;
  /** Park time, HH:MM. */
  time: string;
  kind: 'appeared' | 'earlier';
}

export type Snapshot = Map<
  string,
  {
    available: boolean;
    next?: ParkTime;
    temporarilyDown?: boolean;
    /** Whether the standby queue is open, which is what "reopened" means. */
    standbyOpen?: boolean;
    /**
     * The attraction's declared refill spans, carried so drop detection can
     * exclude them. See `detectDropEvents`.
     */
    refillWindows?: { start: ParkTime; end: ParkTime }[];
  }
>;

/** Minutes since the park day began (4am), which orders correctly across midnight. */
export function dayMinutes(time: ParkTime): number {
  return Math.floor(+time / 60);
}

/** Inverse of dayMinutes. */
export function fromDayMinutes(minutes: number): ParkTime {
  const hour = (ParkTime.dayStart.hour + Math.floor(minutes / 60)) % 24;
  return new ParkTime(hour, minutes % 60);
}

export function snapshotOf(experiences: Experience[]): Snapshot {
  const snap: Snapshot = new Map();
  for (const exp of experiences) {
    if (!exp.flex) continue;
    snap.set(exp.id, {
      available: !!exp.flex.available,
      next: exp.flex.nextAvailableTime,
      standbyOpen: !!exp.standby?.available,
      ...(exp.refillWindows ? { refillWindows: exp.refillWindows } : {}),
      ...(exp.standby?.unavailableReason === 'TEMPORARILY_DOWN'
        ? { temporarilyDown: true }
        : {}),
    });
  }
  return snap;
}

/**
 * Watched attractions that have just reopened after a temporary closure.
 *
 * This is deliberately an alert signal, not a new booking trigger. A
 * reopening often creates useful near-term inventory, but the ordinary watch
 * and booking rules remain the only authority for spending an entitlement.
 */
export function detectReopenings(
  prev: Snapshot,
  next: Snapshot,
  watchedIds: ReadonlySet<string>
): string[] {
  const reopened: string[] = [];
  for (const [id, current] of next) {
    const previous = prev.get(id);
    // Leaving TEMPORARILY_DOWN is not the same as coming back. The reason can
    // just as easily become CLOSED at the end of the night, or
    // NOT_STANDBY_ENABLED, or NO_MORE_SHOWS -- all of which cleared the flag
    // and fired a "back up" alert for a ride that had in fact shut. Requiring
    // standby to be open is the difference.
    if (
      watchedIds.has(id) &&
      previous?.temporarilyDown === true &&
      !current.temporarilyDown &&
      current.standbyOpen === true
    ) {
      reopened.push(id);
    }
  }
  return reopened;
}

/**
 * Drops that happened between two consecutive polls.
 *
 * An attraction with no entry in the previous snapshot has no baseline and is
 * skipped: the first poll of a session sees everything as "new", which is not
 * a drop.
 */
/**
 * Availability flips worth learning from, restricted to what is being watched.
 *
 * `watchedIds` is the bound that keeps this honest. Recording every attraction
 * on the tipboard sounds strictly better -- more evidence -- but the events
 * feed `learnedDropTimes`, which promotes any minute seen on two distinct days
 * into a burst target. Away from a scheduled drop, an availability flip is
 * somebody cancelling, and cancellations happen all day across a whole park.
 * With refill-window polling sampling every six seconds for hours, two park
 * days is enough to promote that noise into burst bands that tile the middle
 * of the day -- the thing the refill window was introduced to avoid.
 *
 * Watched attractions are also the only ones the schedule is ever consulted
 * for, so nothing actionable is lost.
 *
 * `watchedIds` cannot be the whole bound, though, and the comment above quietly
 * assumed it was. A refill window is only declared for an attraction somebody
 * watches, so the very churn this describes -- six-second sampling across a
 * multi-hour span -- happens inside the bound rather than outside it. Jungle
 * Cruise and Haunted Mansion both declare 11:00-14:30, which is around 2,100
 * polls of ordinary refill jitter, and two park days of it was enough to promote
 * that into permanent midday burst bands: the API hammered and the action budget
 * spent, for minutes that were never drops.
 *
 * So a flip inside a declared refill window is not learned from. That is what
 * the window means: inventory returns across this span by design, and a span is
 * not a series of drop instants. The cadence already polls it faster on its own
 * account, so nothing is lost there either.
 */
/**
 * How old the previous availability snapshot may be and still be diffed against.
 *
 * Generous on purpose: it has to clear the slowest legitimate cadence plus the
 * backoff a few failures introduce, or an ordinary rough patch would keep
 * discarding usable baselines and learning would never accumulate. Anything
 * beyond it is a gap rather than an interval.
 */
export const SNAPSHOT_STALE_MS = 5 * 60_000;

/**
 * Whether the previous snapshot is recent enough to diff against.
 *
 * Drop detection is a diff between consecutive polls, so it only means anything
 * if the two are about one interval apart. The baseline used to be cleared only
 * when autopilot was switched on, so any gap -- a booking-date switch, a phone
 * that backgrounded and clamped its timers, a failure streak riding the backoff
 * up to a minute -- left it stale, and the first poll afterwards reported every
 * change accumulated across the whole gap as drops at that one minute. All of it
 * then fed the learned times, which is how one interruption could invent a drop
 * schedule.
 */
export function baselineUsable(takenAt: number | undefined, now: number) {
  return takenAt !== undefined && now - takenAt <= SNAPSHOT_STALE_MS;
}

/** Whether this moment falls inside one of the attraction's refill spans. */
export function inRefillWindow(
  windows: { start: ParkTime; end: ParkTime }[] | undefined,
  now: ParkTime
): boolean {
  return (windows ?? []).some(w => +now >= +w.start && +now <= +w.end);
}

export function detectDropEvents(
  prev: Snapshot,
  next: Snapshot,
  now: ParkTime,
  date: string,
  watchedIds?: ReadonlySet<string>
): DropEvent[] {
  const time = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;
  const events: DropEvent[] = [];
  for (const [experienceId, n] of next) {
    if (watchedIds && !watchedIds.has(experienceId)) continue;
    if (inRefillWindow(n.refillWindows, now)) continue;
    const p = prev.get(experienceId);
    if (!p) continue;
    if (!p.available && n.available) {
      events.push({ experienceId, date, time, kind: 'appeared' });
    } else if (p.available && n.available && p.next && n.next) {
      const earlierBy = (+p.next - +n.next) / 60;
      if (earlierBy >= EARLIER_THRESHOLD_MIN) {
        events.push({ experienceId, date, time, kind: 'earlier' });
      }
    }
  }
  return events;
}

/** Which 5-minute buckets of which scoped park days the poller was running for. */
export type Coverage = Record<string, number[]>;

/** A coverage key is scoped to a park so one park's quiet day never demotes another's schedule. */
export function coverageKey(parkId: string, date: string): string {
  return `${parkId}:${date}`;
}

/** The date half of a coverage key, for pruning and for reading one back. */
export function coverageDate(key: string): string {
  const colon = key.indexOf(':');
  return colon === -1 ? key : key.slice(colon + 1);
}

export function coverageBucket(time: ParkTime): number {
  return Math.floor(dayMinutes(time) / COVERAGE_BUCKET_MIN);
}

/**
 * Note that the poller was active at `now` for one scoped park day.
 *
 * Returns the new coverage and whether anything changed, so callers can skip
 * a save (and a summary recompute) on the overwhelmingly common no-change
 * tick. Prunes to the most recent MAX_COVERAGE_DAYS park days.
 */
export function recordCoverage(
  coverage: Coverage,
  key: string,
  now: ParkTime
): { coverage: Coverage; changed: boolean } {
  const bucket = coverageBucket(now);
  const existing = coverage[key] ?? [];
  if (existing.includes(bucket)) return { coverage, changed: false };
  // Numeric comparator on purpose: the default sort is lexicographic and would
  // order [132, 60] as-is.
  const next: Coverage = {
    ...coverage,
    [key]: [...existing, bucket].sort((a, b) => a - b),
  };
  // Prune by date, not by key. The key gained a park prefix when coverage
  // became park-scoped, and `Object.keys().sort()` then ordered by park id
  // first -- so the cap stopped meaning "the last 30 park days" and became a
  // global budget that always evicted the lexicographically smallest park.
  // At Walt Disney World that is Animal Kingdom (80007823), whose coverage was
  // therefore discarded first, feeding `coveredDays >= 3 && observedDays === 0`
  // with days it had no evidence for.
  //
  // Keeping the newest MAX_COVERAGE_DAYS *dates* keeps every park's history
  // for the same span, which is what demotion compares across.
  const keep = new Set(
    [...new Set(Object.keys(next).map(coverageDate))]
      .sort()
      .slice(-MAX_COVERAGE_DAYS)
  );
  for (const key of Object.keys(next)) {
    if (!keep.has(coverageDate(key))) delete next[key];
  }
  return { coverage: next, changed: true };
}

export interface ObservedDrop {
  /** Earliest minute in the cluster: the one nearest the true release. */
  time: ParkTime;
  /** Distinct park days on which this drop was seen. */
  days: number;
  /** Total events in the cluster. */
  count: number;
}

export interface ScheduledDropCheck {
  time: ParkTime;
  /** Days a drop was observed at (or just after) this scheduled time. */
  observedDays: number;
  /** Days the poller was actually watching at this time. */
  coveredDays: number;
}

export interface DropSummary {
  experienceId: string;
  observed: ObservedDrop[];
  scheduled: ScheduledDropCheck[];
}

function parseEventMinutes(event: DropEvent): number | undefined {
  try {
    return dayMinutes(ParkTime.from(event.time));
  } catch {
    return undefined;
  }
}

/**
 * Cluster observations per attraction and check them against the schedule.
 *
 * Pure. Attractions with events but no schedule entry are still reported, so a
 * ride that drops on a schedule nobody wrote down becomes visible; scheduled
 * attractions with no events report every scheduled time with zero observed
 * days, which is only meaningful alongside its coveredDays.
 */
export function summarizeDrops(
  events: DropEvent[],
  coverage: Coverage,
  schedule: ReadonlyMap<string, ParkTime[]>,
  coverageParkId?: string,
  watchedByDay: WatchedByDay = {}
): DropSummary[] {
  const byExp = new Map<string, { minutes: number; date: string }[]>();
  for (const event of events) {
    const minutes = parseEventMinutes(event);
    if (minutes === undefined) continue;
    const list = byExp.get(event.experienceId) ?? [];
    list.push({ minutes, date: event.date });
    byExp.set(event.experienceId, list);
  }

  const ids = new Set([...byExp.keys(), ...schedule.keys()]);
  const summaries: DropSummary[] = [];

  for (const experienceId of ids) {
    const obs = (byExp.get(experienceId) ?? []).sort(
      (a, b) => a.minutes - b.minutes
    );

    // Greedy clustering on sorted minutes.
    const observed: ObservedDrop[] = [];
    let cluster: { start: number; dates: Set<string>; count: number } | null =
      null;
    for (const o of obs) {
      if (cluster && o.minutes - cluster.start <= CLUSTER_TOLERANCE_MIN) {
        cluster.dates.add(o.date);
        cluster.count += 1;
      } else {
        if (cluster) {
          observed.push({
            time: fromDayMinutes(cluster.start),
            days: cluster.dates.size,
            count: cluster.count,
          });
        }
        cluster = { start: o.minutes, dates: new Set([o.date]), count: 1 };
      }
    }
    if (cluster) {
      observed.push({
        time: fromDayMinutes(cluster.start),
        days: cluster.dates.size,
        count: cluster.count,
      });
    }

    const scheduled: ScheduledDropCheck[] = (
      schedule.get(experienceId) ?? []
    ).map(time => {
      const m = dayMinutes(time);
      // A drop scheduled for :47 is typically observed at :47 or :48, and
      // occasionally a minute early when the clock offset is slightly off.
      const lo = m - 1;
      const hi = m + CLUSTER_TOLERANCE_MIN + 1;
      const observedDates = new Set(
        obs.filter(o => o.minutes >= lo && o.minutes <= hi).map(o => o.date)
      );
      const bucket = coverageBucket(time);
      const coveredDates = Object.entries(coverage).filter(
        ([key, buckets]) =>
          (!coverageParkId || key.startsWith(`${coverageParkId}:`)) &&
          (buckets.includes(bucket) || buckets.includes(bucket + 1)) &&
          // Only a day this attraction was actually armed on counts. Otherwise
          // the silence that `detectDropEvents` guarantees for an unwatched
          // attraction was read as evidence that its built-in drop time is
          // wrong.
          (watchedByDay[key] ?? []).includes(experienceId)
      );
      return {
        time,
        observedDays: observedDates.size,
        coveredDays: coveredDates.length,
      };
    });

    summaries.push({ experienceId, observed, scheduled });
  }
  return summaries;
}

// ---------------------------------------------------------------------------
// Storage. Not day-scoped: the whole point is accumulating evidence across
// visits.

export function loadDropEvents(): DropEvent[] {
  const stored = kvdb.get<DropEvent[]>(EVENTS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    e =>
      typeof e?.experienceId === 'string' &&
      typeof e.date === 'string' &&
      typeof e.time === 'string' &&
      (e.kind === 'appeared' || e.kind === 'earlier')
  );
}

/** Append and cap, keeping the newest. */
export function appendDropEvents(events: DropEvent[]): DropEvent[] {
  if (events.length === 0) return loadDropEvents();
  const all = [...loadDropEvents(), ...events].slice(-MAX_EVENTS);
  kvdb.set<DropEvent[]>(EVENTS_KEY, all);
  return all;
}

export function loadCoverage(): Coverage {
  const stored = kvdb.get<Coverage>(COVERAGE_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const out: Coverage = {};
  for (const [date, buckets] of Object.entries(stored)) {
    if (Array.isArray(buckets)) {
      out[date] = buckets.filter(b => Number.isInteger(b));
    }
  }
  return out;
}

export function saveCoverage(coverage: Coverage): void {
  kvdb.set<Coverage>(COVERAGE_KEY, coverage);
}

/**
 * Which attractions were armed while the poller was running, per scoped park day.
 *
 * Coverage alone says the poller was *looking*; it says nothing about what it was
 * looking at. `detectDropEvents` only records events for watched attractions, so
 * an attraction that was never armed has no observations by construction -- and
 * `summarizeDrops` was reading that silence as evidence against its built-in drop
 * times, printing "never seen in N watched days" in red for a ride nobody was
 * watching. The screen's own copy promises absence is only reported for times it
 * was actually watching, so the display was contradicting itself.
 *
 * Stored under its own key, so existing coverage data needs no migration. A day
 * with no entry here degrades to "not watched yet" for that attraction, which
 * understates rather than misleads.
 */
export type WatchedByDay = Record<string, string[]>;

export function loadWatchedDays(): WatchedByDay {
  const stored = kvdb.get<WatchedByDay>(WATCHED_KEY);
  if (!stored || typeof stored !== 'object') return {};
  return Object.fromEntries(
    Object.entries(stored).flatMap(([key, ids]) =>
      Array.isArray(ids)
        ? [[key, ids.filter(id => typeof id === 'string')]]
        : []
    )
  );
}

export function saveWatchedDays(watched: WatchedByDay): void {
  kvdb.set<WatchedByDay>(WATCHED_KEY, watched);
}

/** Add these ids to the day's record, pruned to the same span as coverage. */
export function recordWatched(
  watched: WatchedByDay,
  key: string,
  ids: Iterable<string>
): { watched: WatchedByDay; changed: boolean } {
  const existing = watched[key] ?? [];
  const merged = [...new Set([...existing, ...ids])].sort();
  if (merged.length === existing.length) return { watched, changed: false };
  const next: WatchedByDay = { ...watched, [key]: merged };
  const keep = new Set(
    [...new Set(Object.keys(next).map(coverageDate))]
      .sort()
      .slice(-MAX_COVERAGE_DAYS)
  );
  for (const k of Object.keys(next)) {
    if (!keep.has(coverageDate(k))) delete next[k];
  }
  return { watched: next, changed: true };
}
