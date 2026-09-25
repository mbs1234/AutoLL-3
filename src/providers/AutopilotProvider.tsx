import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RequestNotSent } from '@/api/client';
import type { RequestControl } from '@/api/client';
import { Booking, isLLMP } from '@/api/itinerary';
import { Guests } from '@/api/ll';
import { APP_NAME } from '@/appIdentity';
import {
  AlertPermission,
  alertPermission,
  fireAlert,
  primeAudio,
  rearmAudio,
  requestAlertPermission,
} from '@/autopilot/alert';
import {
  ActionKind,
  AutoBookLedger,
  AutoBookOutcome,
  BookLedger,
  ClashCheck,
  attemptAutoBook,
  lockKey,
  shouldAttempt,
} from '@/autopilot/autobook';
import {
  ModifyOutcome,
  attemptAutoModify,
  findExistingLL,
  findPartyLL,
  shouldModify,
} from '@/autopilot/automodify';
import {
  MAX_HELD_MP,
  SwapOutcome,
  attemptAutoSwap,
  chooseSwapVictim,
  heldMPToday,
  shouldSwap,
} from '@/autopilot/autoswap';
import { addLogEntry, describeFailure } from '@/autopilot/bookinglog';
import {
  activeScheduledDropTimes,
  learnedDropTimes,
  mergeDropTimes,
} from '@/autopilot/learned';
import {
  acquire as acquireLease,
  keepAlive as keepLeaseAlive,
  leaseKey,
  mutationId,
  quarantine,
  quarantinedAt,
  quarantinedMutations,
  release as releaseLease,
  resolveDoubt,
  startWhileHeld,
} from '@/autopilot/lease';
import { MAX_MUTATION_MS, MutationOperation } from '@/autopilot/mutation';
import type { MutationEvidence } from '@/autopilot/mutation';
import {
  Coverage,
  DropSummary,
  Snapshot,
  WatchedByDay,
  appendDropEvents,
  baselineUsable,
  coverageKey,
  detectDropEvents,
  detectReopenings,
  loadCoverage,
  loadDropEvents,
  loadWatchedDays,
  recordCoverage,
  recordWatched,
  saveCoverage,
  saveWatchedDays,
  snapshotOf,
  summarizeDrops,
} from '@/autopilot/observe';
import { overlappingPlans } from '@/autopilot/overlap';
import { wholePartyEligible } from '@/autopilot/party';
import { tierLimitLifted } from '@/autopilot/passkey';
import {
  GuestCache,
  entitlementsChanged,
  heldEntitlements,
  prewarmGuests,
} from '@/autopilot/prewarm';
import {
  isTier1,
  orderByPriority,
  shouldHoldTierSlot,
} from '@/autopilot/priority';
import {
  ActionCall,
  NO_REFUSALS,
  RefusalState,
  observeAction,
} from '@/autopilot/refusal';
import { markRunning } from '@/autopilot/running';
import { syncedParkTime } from '@/autopilot/schedule';
import {
  COMMIT_TTL_MS,
  CommittedReturn,
  activeCommits,
  clearCommit,
  commitDate,
  holdsLock,
  loadBookingLog,
  loadCommits,
  loadLocks,
  loadSettings,
  saveBookingLog,
  saveCommit,
  saveLocks,
  saveSettings,
} from '@/autopilot/storage';
import usePoller from '@/autopilot/usePoller';
import { holdScreenAwake, releaseScreenAwake } from '@/autopilot/wakelock';
import {
  WATCHLIST_KEY,
  WatchListKey,
  WatchTarget,
  inWindow,
  loadWatchList,
  matchWatchList,
  parseBound,
  saveWatchList,
  selectNewAlerts,
  targetActs,
  targetApplies,
} from '@/autopilot/watchlist';
import AutopilotContext, {
  AutopilotHit,
  BookingLogEntry,
  Skip,
} from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import {
  ParkTime,
  formatDate,
  formatTime,
  modifyDate,
  parkDate,
} from '@/datetime';
import { loadSavedPartyIds } from '@/savedParty';
import { NOTIFICATION_TAG_NAMESPACE } from '@/storageNamespace';
import { now as syncedNow } from '@/timesync';

/**
 * Refresh plans every Nth tick rather than every tick.
 *
 * Plans cost a request and change only when something is booked or cancelled,
 * while experiences carry the availability the poller exists to watch. In
 * burst mode this still refreshes plans roughly every 12 seconds.
 */
export const PLANS_EVERY_N_TICKS = 10;

/**
 * How often to check whether the park day has turned under a mounted provider.
 *
 * A minute is far finer than the once-a-day event it watches for, and the
 * callback is a string comparison that almost always changes nothing.
 */
export const PARK_DAY_CHECK_MS = 60_000;

/**
 * How long a rejected action waits before it may be tried again.
 *
 * Only `repeatMoves` retries at all, and the wait is what makes retrying safe
 * rather than merely legal. A rejection changes none of the inputs to the
 * decision that produced it: the reservation did not move, plans are only
 * re-polled after a *success*, and the tipboard is served through a CDN that
 * may well hand back the same bytes. So the next tick would re-run the same
 * three requests against the same evidence, 600ms later, indefinitely -- and
 * `RateLimit(5)` is shared with the other provider and with the user's own
 * taps, where tripping it costs every call in the app a five-second cooldown
 * at the worst possible moment.
 *
 * Twenty seconds is long enough that a stuck search costs a request every
 * thirty-odd ticks instead of every one, and short enough that a lost race
 * during a drop is retried while the drop is still running.
 */
export const RETRY_AFTER_MS = 20_000;

/**
 * Wires the poller, watch list, alerting, prewarming and auto-booking
 * together.
 *
 * Must sit below ExperiencesProvider, since it consumes both experiences and
 * plans, and PlansProvider is mounted above ExperiencesProvider in Merlock.
 */
export default function AutopilotProvider({
  children,
  watchListKey = WATCHLIST_KEY,
  rapid = false,
  repeatMoves = false,
}: {
  children: React.ReactNode;
  /**
   * Where this build's watch list lives. Both bookmarklets run on Disney's
   * origin and share one `localStorage`, so a build with a different purpose
   * needs a different key or it overwrites the other's list.
   */
  watchListKey?: WatchListKey;
  /** Poll flat-out rather than pacing to the drop schedule. */
  rapid?: boolean;
  /** Allow the same reservation to be moved more than once. */
  repeatMoves?: boolean;
}) {
  const { park } = use(ParkContext);
  const { ll } = use(ClientsContext);
  const { bookingDate } = use(BookingDateContext);
  const { experiences, pollExperiences } = use(ExperiencesContext);
  const { plans, pollPlans } = use(PlansContext);

  // Deliberately not persisted. A poller that resumes on page load has no
  // user gesture behind it, so it could not play sound, and silently issuing
  // requests -- let alone bookings -- on load is a surprising default. This is
  // also what makes persisting per-target autoBook safe.
  const [enabled, setEnabledState] = useState(false);
  const [targets, setTargets] = useState<WatchTarget[]>(() =>
    loadWatchList(watchListKey)
  );
  const [notifications, setNotifications] =
    useState<AlertPermission>(alertPermission);
  const [lastHit, setLastHit] = useState<AutopilotHit>();
  // The day's log survives a reload; the on/off state deliberately does not.
  const [bookingLog, setBookingLog] =
    useState<BookingLogEntry[]>(loadBookingLog);
  // Not persisted: each mounted provider owns its own run. This is especially
  // important for NextLL, whose nested provider shares the day's persistent
  // booking log with Autopilot but needs to explain only its own quick search.
  const [sessionLog, setSessionLog] = useState<BookingLogEntry[]>([]);
  const [settings, setSettings] = useState(loadSettings);
  const [skipCounts, setSkipCounts] = useState<Record<string, number>>({});
  const [lastSkip, setLastSkip] = useState<Skip>();
  const [passkeyStatus, setPasskeyStatus] = useState<
    'off' | 'waiting' | 'unlocked'
  >('off');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Which booking-path calls Disney is refusing, and for how long. Held in
  // a ref as well as state because the tick reads and writes it between
  // renders; the state copy exists only so the screen can show it.
  const refusalRef = useRef<RefusalState>(NO_REFUSALS);
  const [refusals, setRefusals] = useState<RefusalState>(NO_REFUSALS);
  // The only two ways `refusalRef` may change. Routing every write through
  // one of these keeps the ref and the state copy that drives the banner from
  // drifting apart -- a future call site that mutated `refusalRef` directly
  // and forgot the matching `setRefusals` would leave the banner stale.
  const recordRefusal = (
    call: ActionCall,
    status: number | undefined,
    at: ParkTime
  ) => {
    refusalRef.current = observeAction(refusalRef.current, call, status, at);
    setRefusals(refusalRef.current);
  };
  const clearRefusals = () => {
    refusalRef.current = NO_REFUSALS;
    setRefusals(NO_REFUSALS);
  };

  // Identifies this provider to the wake-lock module, which is a singleton
  // shared with any other provider mounted at the same time -- NextLL nests a
  // second one inside the app's own. Without it, this component's unmount
  // released the lock a different, still-running provider was holding.
  const wakeLockOwner = useRef({}).current;

  /** Every transition to disabled gives this provider's wake-lock hold back. */
  const disable = useCallback(() => {
    void releaseScreenAwake(wakeLockOwner);
    setEnabledState(false);
  }, [wakeLockOwner]);

  // When each rejected action may be tried again, keyed `kind:experienceId`.
  // Session state like the ledger's own locks, and cleared with them.
  const retryAtRef = useRef(new Map<string, number>());

  const alertedRef = useRef<ReadonlySet<string>>(new Set());
  const tickCountRef = useRef(0);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  // The park day the passkey unlock was established for, or undefined while
  // locked. Keyed rather than boolean: the old flag was cleared only by
  // turning autopilot off and on, so a tab left open across a booking-date
  // change or the 4am rollover carried yesterday's unlock -- and an unlock
  // silently disables the Tier 1 hold.
  const passkeyUnlockedForRef = useRef<string | undefined>(undefined);
  const bookingDateRef = useRef(bookingDate);
  bookingDateRef.current = bookingDate;
  // Read at tick time for the same reason as the date: `onTick` closes over
  // `park`, so a tick already running still holds the park it started in.
  const parkIdRef = useRef(park.id);
  parkIdRef.current = park.id;
  // Read at tick time: setState from a plans poll has not re-rendered yet
  // when the booking loop runs immediately afterwards.
  const plansRef = useRef(plans);
  plansRef.current = plans;

  // The park day this instance believes it is on, read once on mount. `kvdb`'s
  // daily helpers give a fresh bucket on a new park day -- but only to a fresh
  // mount, and this provider does not remount: a phone tab that backgrounds
  // overnight is still holding yesterday at 7am. `setDaily` stamps the date at
  // *write* time, so a write from that tab would republish yesterday's state
  // under today. Every day-scoped write is guarded against this ref.
  const parkDayRef = useRef(parkDate());

  const cacheRef = useRef(new GuestCache());
  // What the party held as of the last plans poll. Undefined until the first
  // poll of a run establishes the baseline rather than firing on it.
  const entitlementsRef = useRef<ReadonlySet<string> | undefined>(undefined);

  /**
   * This instance's id in the day's shared lock record.
   *
   * Every lock is stored against its holder so that a release only takes
   * effect for the holder.
   *
   * Per *instance*, and that matters twice. Two providers live in one tab --
   * NextLL nests one inside the app's own -- so a tab-scoped id would let them
   * take over each other's live work, which is the thing ownership exists to
   * stop. And a reload is not a safe inheritance: the script is gone, but its
   * last request may have reached Disney and merely lost the response, so
   * reclaiming its lease would be reclaiming an unknown outcome. A dead
   * instance's leases are reclaimed by *expiry*, which is the only evidence
   * here that is actually evidence.
   */
  const lockOwnerRef = useRef(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
  // Filled on the first render and never again. `useRef(new AutoBookLedger())`
  // constructs on *every* render and discards all but the first, which is
  // ordinarily only waste -- but this constructor refuses a date it cannot
  // read. `undefined!` rather than a `| undefined` type so that the ~25 readers
  // below do not each have to assert.
  const ledgerRef = useRef<AutoBookLedger>(undefined!);
  ledgerRef.current ??= new AutoBookLedger(
    // The park day, deliberately, and not the date the picker is on.
    //
    // `??=` stopped the constructor running on every render; it still runs on
    // the *first* one, and a date it cannot read would throw out of render,
    // where this provider sits behind no error boundary and the whole screen
    // goes down rather than the one tick that can name the problem on it.
    // `parkDate()` is derived from the clock and is a park date by
    // construction, so the refusal cannot happen here at all. The picker's date
    // reaches the ledger a few lines into the first tick, through
    // `setBookingDate`, which is inside the poller: there a refusal stops the
    // run and says why, which is what the owner needs to see.
    //
    // Nothing asks this ledger a date-sensitive question before that
    // assignment -- the only calls outside a tick are `reset`, `startNewDay`,
    // `bookedCount` and `publishableKeys`, none of which depend on the date --
    // and 'AutopilotProvider ledger calls in a tick' is the test that keeps it
    // that way.
    parkDayRef.current,
    // Shares this instance's action locks with any other tab or nested
    // provider (e.g. NextLL) watching the same park day, so the two do not
    // independently book, modify or swap the same attraction. See
    // `AutoBookLedger.adoptAttempted` and `storage.ts`'s `saveLocks`. Guarded
    // against `parkDayRef`: a backgrounded tab settling something after the
    // real day has turned must not write yesterday's locks into today's
    // bucket.
    released => {
      // A retry token describes the exact lock that was taken for a rejected
      // request. If plans, a manual release, or reset gives that lock back by
      // another path, the token must die with it; otherwise the same key can be
      // reused by a later unknown-outcome request and the expired token will
      // release the new doubt-hold.
      for (const key of released ?? []) retryAtRef.current.delete(key);
      if (parkDate() === parkDayRef.current) {
        // `publishableKeys`, not `attemptedKeys`: the latter includes locks
        // adopted from other instances, and re-publishing those under this
        // instance's id would transfer ownership of them.
        saveLocks(
          lockOwnerRef.current,
          ledgerRef.current.publishableKeys(),
          released
        );
      }
    }
  );

  // Drop learning: the previous tipboard state, plus what the poller has seen
  // and when it was looking. Events and coverage accumulate across visits.
  const snapshotRef = useRef<Snapshot>(new Map());
  /**
   * When the baseline in `snapshotRef` was taken, on the drift-corrected clock.
   *
   * Drop detection is a diff against the previous poll, which is only meaningful
   * if the two polls are one interval apart. The baseline used to be cleared
   * solely on enable, so any gap in polling -- a booking-date switch, a phone
   * that backgrounded and clamped its timers, a failure streak riding the
   * backoff up to a minute -- left it stale, and the first poll afterwards
   * reported every change accumulated across the whole gap as drops at that one
   * minute. All of it then fed the learned times.
   */
  const snapshotAtRef = useRef<number | undefined>(undefined);
  /**
   * Which attractions were armed while the poller ran, per scoped park day.
   *
   * Coverage says the poller was looking; this says what it was looking at.
   * Without it, the silence `detectDropEvents` guarantees for an unwatched
   * attraction was read as evidence against its built-in drop times.
   */
  const watchedDaysRef = useRef<WatchedByDay>(loadWatchedDays());
  const coverageRef = useRef<Coverage>(loadCoverage());
  const [dropSummaries, setDropSummaries] = useState<DropSummary[]>(() => {
    // Whatever was learned on earlier visits, before today's first poll.
    //
    // `watchedByDay` is passed here as well as at the poll site below, and
    // leaving it off was not a harmless default: without it every scheduled
    // drop time reports no covered days, so the Activity screen said
    // "(not watched yet)" about times it had been watching for days, until
    // something new arrived to trigger a re-summary. That screen is the only
    // place a built-in drop time's record is visible, and the same numbers are
    // the evidence the demotion switch would act on.
    return summarizeDrops(
      loadDropEvents(),
      coverageRef.current,
      park.dropSchedule,
      park.id,
      watchedDaysRef.current
    );
  });
  const [bookedCount, setBookedCount] = useState(0);

  // Block body on purpose: an expression body would return saveWatchList's
  // value, which React would treat as a cleanup function.
  useEffect(() => {
    saveWatchList(targets, watchListKey);
  }, [targets, watchListKey]);
  useEffect(() => {
    // `setDaily` stamps the date at write time, so a tab that crossed 4am
    // republished yesterday's entries under today -- and a reload then showed
    // last night's bookings as this morning's. The rollover effect below is
    // what clears them properly.
    if (parkDate() !== parkDayRef.current) return;
    saveBookingLog(bookingLog);
  }, [bookingLog]);
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  /**
   * Roll this provider onto a new park day without a remount.
   *
   * Everything day-scoped here was read once at mount, and this provider does
   * not remount: a phone tab that backgrounds overnight was still holding
   * yesterday at 7am. The log write above refuses to write in that state, which
   * stops the staleness being recorded as fact but leaves the tab acting on it
   * -- its locks and its activity log both belonged to yesterday.
   *
   * The run is stopped rather than carried across. Yesterday's assumptions do
   * not hold on a new park day, and `enabled` is deliberately not persisted
   * anywhere else either, so a deliberate tap to start the new day is the
   * consistent thing to require. Nobody is booking Lightning Lanes at 4am;
   * booking windows open at 7.
   */
  useEffect(() => {
    const follow = () => {
      const today = parkDate();
      if (today === parkDayRef.current) return;
      parkDayRef.current = today;
      ledgerRef.current.startNewDay();
      setBookedCount(ledgerRef.current.bookedCount);
      setBookingLog(loadBookingLog());
      setSkipCounts({});
      setLastSkip(undefined);
      disable();
    };
    const timer = setInterval(follow, PARK_DAY_CHECK_MS);
    document.addEventListener('visibilitychange', follow);
    window.addEventListener('focus', follow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', follow);
      window.removeEventListener('focus', follow);
    };
  }, [disable]);

  /**
   * Take the audio context back whenever the page returns to the foreground.
   *
   * iOS moves an AudioContext to `interrupted` when the screen locks, a call
   * arrives, or another app takes audio, and never leaves that state by
   * itself. `primeAudio` runs once, inside the gesture that started the run;
   * later foreground events use the bounded, background-safe `rearmAudio`.
   * Before this recovery path, the first interruption made the run silent.
   *
   * That is worse here than it sounds. On iOS Safari the chime is not one
   * channel of three: `Notification` is undefined outside an installed web
   * app and vibration is unimplemented, so losing sound leaves a run with no
   * way to reach anybody -- including the alert saying it has stopped.
   *
   * Best-effort by design. Where the resume needs a gesture it will be
   * refused, which is no worse than the silence it is trying to undo, and the
   * Today screen shows the state either way.
   */
  useEffect(() => {
    if (!enabled) return;
    const rearm = () => {
      if (document.visibilityState === 'visible') rearmAudio();
    };
    document.addEventListener('visibilitychange', rearm);
    window.addEventListener('focus', rearm);
    return () => {
      document.removeEventListener('visibilitychange', rearm);
      window.removeEventListener('focus', rearm);
    };
  }, [enabled]);

  // A restore rewrites the plan this engine holds in memory, and its next save
  // would undo it; so while any engine runs, restore stays unavailable. This
  // instance may be a Time Search under a pushed screen, where the restore
  // screen cannot read its context. See `src/autopilot/running.ts`.
  useEffect(() => {
    if (!enabled) return;
    return markRunning();
  }, [enabled]);

  // Unmount is the one path that bypasses `setEnabled(false)`, and a wake lock
  // outliving the screen that requested it would keep the phone awake with
  // nothing running.
  useEffect(
    // Deliberately *not* releasing this instance's leases in bulk. An unmount
    // can land while a request is still in the air -- NextLL's provider goes
    // when its tab does -- and a bulk release would then hand the reservation
    // to another engine while Disney is still acting on the first request. Each
    // attempt gives its own lease back in its own `finally`, and anything that
    // outlives that is covered by expiry, which is slower but safe.
    () => () => void releaseScreenAwake(wakeLockOwner),
    [wakeLockOwner]
  );

  /**
   * Take the operation lease on one reservation, for a foreground search.
   *
   * The lease is what mutual exclusion actually rests on: exclusive where the
   * browser has Web Locks, expiring so a closed tab cannot hold a reservation
   * for the rest of the day, and owned by an instance rather than a tab. The
   * ledger's attempt locks are deliberately left out of it -- those answer
   * "already done today", which is a different question, and answering the
   * first with the second is what made a search defer to work finished hours
   * earlier and then let one provider take over another's live operation.
   *
   * Re-entrant for the holder, so a search renews rather than fighting itself.
   */
  const bumpSkip = useCallback((reason: string, name?: string) => {
    setSkipCounts(prev => ({ ...prev, [reason]: (prev[reason] ?? 0) + 1 }));
    // The newest skip is kept singly, by name. The counts say why nothing was
    // booked over a morning; this says what just happened.
    if (name) setLastSkip({ name, reason, at: syncedParkTime() });
  }, []);

  const clock = useCallback(
    () => ({ ms: syncedNow(), time: syncedParkTime() }),
    []
  );

  /**
   * Cached eligibility if warm, otherwise fetched and cached.
   *
   * Takes the date rather than reading the ref. This is called from inside the
   * acting loop, after several awaits, and it supplies the guest list the
   * offer is built from -- so a date change landing mid-tick would fetch
   * eligibility for one day and spend it booking another.
   */
  const guestsFor = useCallback(
    async (experienceId: string, date: string): Promise<Guests> => {
      const cached = cacheRef.current.get(experienceId, date, clock());
      if (cached) return cached;
      const fetched = await ll.guests({ id: experienceId }, date);
      cacheRef.current.set(experienceId, date, fetched, clock().ms);
      return fetched;
    },
    [ll, clock]
  );

  type DryRunOutcome = {
    status: 'dry-run';
    kind: ActionKind;
    returnTime: ParkTime;
  };

  const logOutcome = useCallback(
    (
      name: string,
      outcome: AutoBookOutcome | ModifyOutcome | SwapOutcome | DryRunOutcome
    ) => {
      const entry: BookingLogEntry = {
        name,
        at: syncedParkTime(),
        ...(outcome.status === 'booked'
          ? {
              status: 'booked' as const,
              returnTime: outcome.returnTime,
              reason: 'eligible guests and an acceptable return time',
            }
          : outcome.status === 'modified'
            ? {
                status: 'modified' as const,
                fromTime: outcome.from,
                returnTime: outcome.to,
                reason: 'a meaningfully earlier acceptable return time',
              }
            : outcome.status === 'swapped'
              ? {
                  status: 'swapped' as const,
                  replacedName: outcome.replaced.name,
                  fromTime: outcome.replaced.time,
                  returnTime: outcome.to,
                  // Not "the lowest-ranked": chooseSwapVictim sorts
                  // non-Tier-1 candidates first and only then by rank,
                  // preferring to give up something easier to claim again.
                  reason: `a higher-priority target replaced ${outcome.replaced.name}`,
                }
              : outcome.status === 'dry-run'
                ? {
                    status: 'dry-run' as const,
                    detail: outcome.kind,
                    returnTime: outcome.returnTime,
                  }
                : outcome.status === 'failed'
                  ? outcome.unknown
                    ? { status: 'unknown' as const }
                    : {
                        status: 'failed' as const,
                        detail: describeFailure(outcome),
                      }
                  : {
                      status: 'skipped' as const,
                      detail: outcome.reason,
                    }),
      };
      setBookingLog(prev => addLogEntry(prev, entry));
      setSessionLog(prev => addLogEntry(prev, entry));
    },
    []
  );

  const onTick = useCallback(
    async (cancelled: () => boolean) => {
      // Every mutation in this tick shares the poller's absolute horizon. A
      // late action therefore gets less time, not a fresh window that can run
      // beyond the tick which authorised it.
      const tickStartedAt = Date.now();
      // Pick up locks any other tab or nested provider has taken since this
      // instance last looked, so the two do not act on the same attraction in
      // the same drop. Bounded by the poll interval rather than instantaneous,
      // which is the same latency every other cross-instance signal in this
      // provider (plans, budget) already accepts.
      ledgerRef.current.adoptAttempted(loadLocks());
      // Re-publish what this instance owns, every poll. The shared record is a
      // read-modify-write on localStorage and cannot be made atomic there, so
      // two instances can interleave and lose one update. Writing our own keys
      // back each tick makes that self-healing -- a lost lock is restored
      // within a tick rather than gone for the day, which is the difference
      // between a moment's exposure and an afternoon of two engines acting on
      // the same reservation.
      if (parkDate() === parkDayRef.current) {
        saveLocks(lockOwnerRef.current, ledgerRef.current.publishableKeys());
      }

      // One date for the whole tick, read once. The ref is assigned during
      // render and this function awaits repeatedly, so re-reading it lets a date
      // change land between two decisions -- eligibility fetched for one day and
      // spent booking another. Same reasoning as `currentPlans` below.
      const date = bookingDateRef.current;
      // And the ledger is moved onto it here, once, from that same captured
      // value. Every lock it takes or settles below is therefore asked about
      // the same day `findExistingLL` is asked about a few lines further on --
      // which is the whole of the defect this closes, since no ledger method
      // takes a date and so none of them can be given a different one.
      ledgerRef.current.setBookingDate(date);
      /**
       * Run one *synchronous* ledger call on the date this tick captured.
       *
       * The ledger holds one booking date at a time, and ticks overlap by
       * design: at `TICK_DEADLINE_MS` the poller stops waiting on a tick,
       * rejects its promise and starts the next one, while the abandoned tick
       * runs on to completion. That next tick sets the ledger onto whatever
       * date the picker is on now -- so everything below here in an abandoned
       * tick would otherwise read a different date's records than the one it
       * fetched plans for, sent its offer against, and took its lock on. A
       * rejection belonging to the 18th would withdraw the 19th's doubt-hold,
       * and the 19th would then be booked twice.
       *
       * Restoring rather than skipping, because the abandoned tick's work is
       * still true about *its* date and dropping it silently leaves a lock or a
       * doubt-hold nothing will ever clear. Synchronous is what makes it safe:
       * no other tick can run between the two assignments.
       */
      const onBookingDate = <T,>(call: () => T): T => {
        const moved = ledgerRef.current.bookingDate;
        if (moved === date) return call();
        ledgerRef.current.setBookingDate(date);
        try {
          return call();
        } finally {
          ledgerRef.current.setBookingDate(moved);
        }
      };
      /**
       * The same ledger, pinned to this tick's date, for the action helpers.
       *
       * They take a structural `BookLedger` rather than the instance precisely
       * so this can be handed in. Their calls are the ones the wrapper above
       * cannot reach from here: `markAttempted` runs inside the dispatch
       * boundary and `markBooked` runs *after* the booking round trip, where
       * the tick may long since have been abandoned. `markBooked` is the one
       * that costs something -- it clears the doubt-hold for a lost response,
       * and on the wrong date that is the only thing stopping a second
       * entitlement being spent there.
       */
      const datedLedger: BookLedger = {
        hasAttempted: (id, kind) =>
          onBookingDate(() => ledgerRef.current.hasAttempted(id, kind)),
        markAttempted: (id, kind, rehearsal) => {
          const rollback = onBookingDate(() =>
            ledgerRef.current.markAttempted(id, kind, rehearsal)
          );
          // The undo runs if the dispatch marker refuses the send, and has to
          // undo it on the date it was taken on.
          return () => onBookingDate(rollback);
        },
        markBooked: id => onBookingDate(() => ledgerRef.current.markBooked(id)),
        // Read-through, not a snapshot: the count moves while a helper runs.
        get bookedCount() {
          return ledgerRef.current.bookedCount;
        },
      };
      const forToday = date === parkDate();
      const activeTargets = targetsRef.current.filter(target =>
        targetApplies(target, park.id, date)
      );

      /**
       * Whether this tick is still acting on the plan it started from.
       *
       * `cancelled` is the poller's own signal and covers only turning
       * autopilot off and unmounting -- the polling effect depends on
       * `enabled` alone, deliberately, so that a park or date change does not
       * tear the loop down and fire an extra immediate poll. The cost of that
       * choice is that a tick already in flight keeps the park and date it
       * captured, and would happily spend an entitlement against a day the
       * user has since moved off. So the tick asks about all three.
       */
      const stale = () =>
        cancelled() ||
        bookingDateRef.current !== date ||
        parkIdRef.current !== park.id;

      // Let this reject: the poller needs the failure to drive backoff.
      const experiences = await pollExperiences();
      // A park/date switch or Stop can happen during that request. Nothing
      // from the old scope should update learning, alerts, or diagnostics;
      // the next tick will use the current provider callback and scope.
      if (stale()) return;

      // Learn from what just came back. Only on the current park day: a future
      // date's tipboard changes with cancellations, which are not drops, and its
      // times would be filed under the wrong day.
      if (forToday) {
        const observedAt = syncedParkTime();
        const observedMs = syncedNow();
        const obsDate = date;
        const next = snapshotOf(experiences);
        const watchedIds = new Set(
          activeTargets.map(target => target.experienceId)
        );
        // A diff is only meaningful between two consecutive polls. Past the
        // staleness bound the previous snapshot describes a different moment, so
        // this poll becomes the new baseline and nothing is inferred from the
        // gap -- rather than reporting everything that changed across it as a
        // drop at this one minute.
        const baseline = baselineUsable(snapshotAtRef.current, observedMs)
          ? snapshotRef.current
          : new Map();
        const reopened = detectReopenings(baseline, next, watchedIds);
        const events = detectDropEvents(
          baseline,
          next,
          observedAt,
          obsDate,
          watchedIds
        );
        snapshotRef.current = next;
        snapshotAtRef.current = observedMs;
        for (const id of reopened) {
          const experience = experiences.find(exp => exp.id === id);
          if (!experience) continue;
          fireAlert({
            title: `${experience.name} reopened`,
            body: 'Availability can return quickly after a reopening.',
            tag: `${NOTIFICATION_TAG_NAMESPACE}reopened-${obsDate}-${id}`,
          });
        }
        const cov = recordCoverage(
          coverageRef.current,
          coverageKey(park.id, obsDate),
          observedAt
        );
        if (cov.changed) {
          coverageRef.current = cov.coverage;
          saveCoverage(cov.coverage);
        }
        const seen = recordWatched(
          watchedDaysRef.current,
          coverageKey(park.id, obsDate),
          watchedIds
        );
        if (seen.changed) {
          watchedDaysRef.current = seen.watched;
          saveWatchedDays(seen.watched);
        }
        // Recompute only when something is new -- a drop, a first look at a
        // 5-minute window, or a newly armed attraction -- never on the ordinary
        // tick.
        if (events.length > 0 || cov.changed || seen.changed) {
          const all = appendDropEvents(events);
          setDropSummaries(
            summarizeDrops(
              all,
              coverageRef.current,
              park.dropSchedule,
              park.id,
              watchedDaysRef.current
            )
          );
        }
      }

      // Held only when the poll actually succeeded this tick. `plansRef` lags a
      // render behind, so it cannot distinguish "never booked" from "booked
      // moments ago" -- and settling booking doubt needs exactly that.
      let freshPlans: Booking[] | undefined;
      if (tickCountRef.current++ % PLANS_EVERY_N_TICKS === 0) {
        try {
          freshPlans = await pollPlans();
        } catch (error) {
          // Supplementary. A plans failure must not stall availability polling
          // or count against the poller's failure budget.
          console.error(error);
        }
      }

      // One view of plans for the whole tick. `plansRef` is assigned during
      // render, so on a tick that polled plans it still holds the pre-poll
      // snapshot -- React cannot have re-rendered between the await above and
      // here. Reading it while the settle loop below reads `freshPlans` would
      // let autopilot believe two things about the same party in the same tick:
      // that a slot has just come free, and that all three are still taken.
      //
      // `let`, not `const`: the action loop below re-polls plans after a
      // booking, move or swap commits, and updates these three so a second
      // attraction dropping in the same tick is judged against what the party
      // actually holds now, not the snapshot from before the first action.
      let currentPlans = freshPlans ?? plansRef.current;
      // The saved party's reservation, not merely the first one for the
      // attraction: when two people hold it at different times, the saved
      // party says whose to move, and `'several'` means it does not. Truthy,
      // so the book-then-move and tier-hold checks read it as held. See
      // `findPartyLL`.
      const partyIds = loadSavedPartyIds();
      const heldToday = (experienceId: string) =>
        findPartyLL(currentPlans, experienceId, date, partyIds);
      let allHeldToday = heldMPToday(currentPlans, date);
      const planCarriesCommit = (commit: CommittedReturn, plan: Booking) => {
        if (
          !isLLMP(plan) ||
          plan.facilityId !== commit.facilityId ||
          parkDate(plan.start) !== commitDate(commit) ||
          String(plan.start.time) !== commit.time
        ) {
          return false;
        }
        const expected = commit.reservationIds;
        if (!expected?.length) return true;
        return [plan.id, ...plan.guests.map(guest => guest.entitlementId)].some(
          id => expected.includes(id)
        );
      };
      const slotsAreFull = () => {
        const heldFacilities = new Set(
          allHeldToday.map(booking => booking.facilityId)
        );
        const pendingBookings = new Set(
          activeCommits(Date.now(), date)
            .filter(
              commit =>
                commit.kind === 'book' && !heldFacilities.has(commit.facilityId)
            )
            .map(commit => commit.facilityId)
        );
        return allHeldToday.length + pendingBookings.size >= MAX_HELD_MP;
      };
      let partyIsFull = slotsAreFull();

      /**
       * Whether a return time lands on top of something already planned.
       *
       * Called twice per action: once on the advertised time before an offer is
       * requested, which is what keeps a doomed round trip out of a drop and
       * makes the guard rehearsable in dry run, and once on the offer's real
       * time, which is usually later and is the one actually booked. The
       * offer's own itinerary is unioned in rather than trusted alone, since a
       * booking made a minute ago may be in plans and not yet in the offer.
       */
      const clashes: ClashCheck = (time, itinerary, release) => {
        if (!settingsRef.current.avoidOverlaps) return false;
        const inPlans = overlappingPlans(time, currentPlans, {
          date,
          ...(release ? { ignoreIds: [release.id] } : {}),
        });
        if (inPlans.length > 0) return true;
        // Return times another instance has committed today but that this one's
        // plans have not caught up with yet. Same reasoning as the offer's own
        // itinerary below, across instances rather than across one round trip.
        // Anything already in plans is skipped, since a parsed plan carries an
        // end time and gives the narrower, more accurate span; these carry only
        // a start, so they get the wider open-ended one.
        {
          // Scoped to the date this check is about, not to today. A commit now
          // records the park day its reservation is for, and gating this on
          // `forToday` meant a future date -- the one case where plans lag most,
          // because the poller runs at its slow rate -- got no cross-instance
          // cover at all.
          const unseen = activeCommits(Date.now(), date)
            .filter(
              c =>
                // Ignore only the exact reservation being replaced. A split
                // party can hold another reservation for this same ride, and
                // its pending committed time still constrains the replacement.
                !(release && c.reservationIds?.includes(release.id)) &&
                // Plans supersede the wider commit span only once they carry
                // the exact committed reservation at the committed time. A
                // stale old-time entry for the same ride is precisely the lag
                // this record exists to bridge.
                !currentPlans.some(p => planCarriesCommit(c, p))
            )
            .map(c => ({
              id: `commit:${c.facilityId}`,
              facilityId: c.facilityId,
              start: { date, time: ParkTime.from(c.time) },
            })) as unknown as Booking[];
          if (overlappingPlans(time, unseen, { date }).length > 0) return true;
        }
        return !!itinerary?.some(
          item =>
            item.facilityId !== release?.facilityId &&
            item.overlap.contains(time)
        );
      };

      // Settle any booking whose fate was unknown. Disney allows booking,
      // cancelling and rebooking the same attraction, so a permanent attempt
      // lock would forfeit a better time that appears after a manual cancel.
      // Only plans fetched during this tick count as evidence.
      if (freshPlans) {
        const settled = freshPlans;
        // Every kind, not `book` alone. A move or a swap takes a lock on the
        // same evidence a booking does and is released by the same evidence,
        // and sweeping only `book` left the other two with no release path at
        // all: a move made for one date blocked that action on every other date
        // for the rest of the session, with nothing able to clear it.
        onBookingDate(() => {
          for (const id of ledgerRef.current.settleableIds) {
            const stillHeld = !!findExistingLL(settled, id, date);
            ledgerRef.current.resolveHeld(
              id,
              stillHeld,
              // A redeemed or lapsed pass leaves plans looking exactly like a
              // cancelled one, and only the tracker can tell the two apart.
              forToday && ll.experienced({ id })
            );
          }
        });
        // Committed return times are a separate record with its own lifetime,
        // and nothing above touches them. A return time committed by a move or
        // a swap -- or by an instance that has since gone away -- had nothing
        // to clear it and blocked a 100-minute band of return times for the
        // rest of the park day. Two things end a commit's job:
        // plans carrying the reservation, which is the better witness because
        // a parsed plan has an end time and gives the narrower span; and the
        // record outliving the window between committing and plans catching
        // up, after which a reservation nobody can see is not one to protect.
        {
          const now = Date.now();
          for (const commit of loadCommits()) {
            // Only the date this tick actually read plans for can witness a
            // commit. Another date's record is left alone rather than expired
            // on evidence that says nothing about it.
            if (commitDate(commit) !== date) continue;
            const inPlans = settled.some(plan =>
              planCarriesCommit(commit, plan)
            );
            const expired =
              commit.at === undefined || now - commit.at >= COMMIT_TTL_MS;
            if (inPlans || expired) {
              clearCommit(commit.facilityId, date, commit.reservationIds);
            }
          }
        }

        // Settling can confirm a booking whose request never returned, so the
        // on-screen count has to follow the ledger rather than only successful
        // actions.
        setBookedCount(ledgerRef.current.bookedCount);

        // Eligibility moves for reasons no clock predicts. A tap-in, an expiry,
        // a reservation cancelled by hand, or one booked in Disney's own app all
        // change what the party may book, and the cache was cleared only for
        // actions autopilot took itself -- so a party that tapped in mid-drop sat
        // out the rest of it, skipping on `no-eligible-guests` for up to the full
        // three-minute TTL while the slot it had just freed went unbooked.
        //
        // Cleared wholesale rather than by ineligibility reason. At the moment of
        // a first redemption nothing in the party is fully eligible, so a
        // reason-based predicate would drop every entry anyway; and in the other
        // direction a booking made by hand is exactly what makes the *eligible*
        // entries the wrong ones. The cost is one sequential re-prewarm at the end
        // of this tick, which is the honest price of eligibility having changed.
        const held = heldEntitlements(settled, date);
        if (entitlementsChanged(entitlementsRef.current, held)) {
          cacheRef.current.clear();
        }
        entitlementsRef.current = held;
      }

      // Book-then-move: while nothing is held, the window is stripped so any
      // offered time matches and gets booked -- holding *something* beats
      // holding nothing. Once a reservation exists, the original target (with
      // its window) governs the modify step. The effective target is what
      // matching and booking see; the real one is looked up for moving.
      const effectiveTargets = activeTargets.map(target =>
        target.bookThenMove && !heldToday(target.experienceId)
          ? { ...target, after: undefined, before: undefined }
          : target
      );
      const realTarget = (experienceId: string) =>
        activeTargets.find(t => t.experienceId === experienceId);

      const hits = matchWatchList(experiences, effectiveTargets);
      const { toAlert, alerted } = selectNewAlerts(hits, alertedRef.current);
      alertedRef.current = alerted;

      for (const hit of toAlert) {
        fireAlert({
          title: `${hit.experience.name} is available`,
          // The date, when it is not today. An alert reading only "Return time
          // 11:05 AM", arriving at two in the morning, is read as this morning --
          // and looking like a booking for today is the one thing a future-date
          // find must never do.
          body: forToday
            ? `Return time ${formatTime(hit.returnTime)}`
            : `Return time ${formatTime(hit.returnTime)} on ${formatDate(date, 'short')}`,
          // Same tag per ride, so a repeat alert replaces rather than stacks.
          tag: `${NOTIFICATION_TAG_NAMESPACE}autopilot-${date}-${hit.experience.id}`,
        });
      }

      const first = toAlert[0];
      if (first) {
        setLastHit({
          experienceId: first.experience.id,
          name: first.experience.name,
          returnTime: first.returnTime,
        });
      }

      const expsById = new Map(experiences.map(exp => [exp.id, exp]));
      const nowTime = syncedParkTime();

      // The one-Tier-1-at-a-time rule lifts after the party's first redemption
      // of the day. LLTracker marks a redeemed attraction `experienced` (its
      // booking turns cancellable-but-not-modifiable, or it disappears with
      // EXPERIENCE_LIMIT_REACHED), and the tipboard carries that flag, so this
      // is readable right here without another request.
      // `forToday` as well as the flag: the tipboard's `experienced` is a fact
      // about the current park day, so riding something this morning must not
      // lift the Tier 1 hold on a booking for next Tuesday.
      const redeemedToday =
        forToday &&
        (passkeyUnlockedForRef.current === date ||
          experiences.some(exp => exp.experienced));

      // Targets that could still consume a Tier 1 slot: armed for booking, and
      // not already held. The tier hold has to reason about attractions that
      // have *not* become available yet, so it cannot work from `hits` alone,
      // and an attraction already booked is no reason to hold anything back.
      const armed = activeTargets.flatMap(target => {
        // Pausing an attraction says "not now", so it must not hold a slot back
        // for itself either.
        if (target.paused) return [];
        if (!target.autoBook && !target.bookThenMove) return [];
        if (heldToday(target.experienceId)) return [];
        const experience = expsById.get(target.experienceId);
        return experience ? [{ target, experience }] : [];
      });

      // Acting comes before prewarming: when a drop lands, the good return
      // times are gone within a minute, so nothing may sit ahead of it.
      //
      // Ordered by priority rather than tipboard order. The first booking
      // constrains what the next can be, so when two attractions drop in the
      // same tick the order is the decision, not an implementation detail.
      const passkeyActive = activeTargets.some(target => target.passkey);
      for (const hit of orderByPriority(
        hits,
        forToday && passkeyActive && !redeemedToday
      )) {
        const { experience } = hit;
        // hit.target may carry a stripped window; the real one governs moving.
        const target = realTarget(experience.id) ?? hit.target;
        /**
         * Whether the current watch list still authorises this exact action.
         *
         * Re-runs the admission test the loop ran, against the live list,
         * rather than trusting the copy captured before the awaits. Every
         * input can change while a request is in flight: the toggles, the
         * window, pausing, unstarring.
         */
        const stillWantsAction = (
          experienceId: string,
          actionKind: 'book' | 'modify' | 'swap',
          returnTime: ParkTime
        ) => {
          // `targetsRef`, not `activeTargets`: the latter is this tick's
          // opening snapshot, which is precisely the thing that has gone
          // stale by the time this is asked.
          const now = targetsRef.current.find(
            t =>
              t.experienceId === experienceId && targetApplies(t, park.id, date)
          );
          if (!now || now.paused) return false;
          if (actionKind === 'modify') {
            // Moving respects the window against the *real* target: that is
            // exactly what the window is for once something is held, and
            // book-then-move strips it only for the initial booking.
            return (
              !!(now.autoModify || now.bookThenMove) &&
              inWindow(returnTime, now)
            );
          }
          if (actionKind === 'swap') {
            return !!now.autoSwap && inWindow(returnTime, now);
          }
          if (!(now.autoBook || now.bookThenMove || now.autoSwap)) return false;
          // Book-then-move takes any time while nothing is held, which is what
          // strips the window in the first place; every other book respects it.
          return now.bookThenMove ? true : inWindow(returnTime, now);
        };
        if (target.paused) continue;
        const wantsBook = !!(
          target.autoBook ||
          target.bookThenMove ||
          target.autoSwap
        );
        const wantsModify = !!(target.autoModify || target.bookThenMove);
        const wantsSwap = !!target.autoSwap;
        if (!wantsBook && !wantsModify && !wantsSwap) continue;
        // Holding a reservation already makes booking a second one pointless --
        // Disney would reject it -- so the only useful action is re-timing. With
        // nothing held and every slot full, the only way in is to swap.
        const heldForParty = heldToday(experience.id);
        // More than one reservation for it, and the saved party does not say
        // which is to move. Not a booking either: one is already held.
        if (heldForParty === 'several') {
          bumpSkip('several-held', experience.name);
          continue;
        }
        const existing = heldForParty;
        const kind = existing
          ? 'modify'
          : partyIsFull && wantsSwap
            ? 'swap'
            : 'book';
        if (!existing && partyIsFull && !wantsSwap) {
          bumpSkip('slots-full', experience.name);
          continue;
        }
        // On this tick's date, not whatever date a newer overlapping tick has
        // since moved the ledger onto: the lock this asks about, the retry
        // token paired with it and the release it may perform all belong to
        // `date`.
        const attemptBlocker = () =>
          onBookingDate(() => {
            if (!ledgerRef.current.hasAttempted(experience.id, kind)) {
              return undefined;
            }
            const unresolved = quarantinedMutations().some(
              doubt =>
                doubt.date === date &&
                ((kind === 'modify' &&
                  doubt.kind === 'modify' &&
                  doubt.facilityId === experience.id) ||
                  (kind === 'swap' &&
                    doubt.kind === 'swap' &&
                    doubt.gaining === experience.id))
            );
            if (unresolved) return 'unresolved-change';
            // Held for good, unless this is a rejection whose wait has run out.
            // The token is keyed by date as well, because it is paired one to one
            // with a ledger lock and is the thing that gives one back: keyed by
            // action alone, a token minted for a rejection on one date would
            // expire and release a live doubt-hold on another, re-sending a
            // booking whose outcome was never learned. That is exactly the
            // inversion the comment further down warns about.
            const token = lockKey(date, kind, experience.id);
            const retryAt = retryAtRef.current.get(token);
            // A rejected attempt is kept locally while its retry waits, but it
            // is deliberately withdrawn from the shared store so another
            // provider can win the attraction. If one did, this token must not
            // release the same-shaped lock now owned by that provider. Keep
            // waiting until its key leaves the shared store; plans evidence may
            // settle this local copy in the meantime.
            if (
              retryAt !== undefined &&
              loadLocks().includes(token) &&
              !holdsLock(token, lockOwnerRef.current)
            ) {
              return 'already-attempted';
            }
            if (retryAt === undefined || Date.now() < retryAt) {
              // Every case is reported. A lock with no retry token used to
              // `continue` in silence, which is the worst way for this to fail:
              // a lock adopted from the day's shared copy on a fresh mount looks
              // exactly like nothing being available, and the screen sits on
              // "checking" for the rest of the day naming no reason.
              //
              // A lock left by an older build is called out separately. It blocks
              // like any other, but it is the one case where this build is
              // refusing to act against a key it cannot interpret rather than
              // deferring to a live action, and it is the only way the date fix
              // can still cost a booking -- so it must not be reported in the
              // words that mean somebody else is working on it.
              //
              // Only when it is the *only* thing blocking, though. A date-less
              // key and a current-build tab's dated key can both be present, and
              // then the live action is what to report: "reload the other tabs"
              // is the wrong instruction while a request for this date is in
              // flight somewhere, and following it would not unblock anything.
              if (retryAt !== undefined) return 'waiting-to-retry';
              return ledgerRef.current.hasUndatedLock(experience.id, kind) &&
                !ledgerRef.current.hasDatedLock(experience.id, kind)
                ? 'stale-lock'
                : 'already-attempted';
            }
            retryAtRef.current.delete(token);
            ledgerRef.current.releaseAttempt(experience.id, kind);
            return undefined;
          });
        const blockedBy = attemptBlocker();
        if (blockedBy) {
          bumpSkip(blockedBy, experience.name);
          continue;
        }
        if (kind === 'modify' && !wantsModify) continue;
        if (kind === 'book' && !wantsBook) continue;

        // The window gates acting, not alerting: `matchWatchList` reports every
        // available match and flags it, so an out-of-window time is still worth
        // a notification. Modifying re-checks the window itself, against the
        // real target rather than the one book-then-move strips.
        if (kind !== 'modify' && !hit.inWindow) {
          bumpSkip('outside-window', experience.name);
          continue;
        }

        // Not for a swap: which reservation would be released is decided inside
        // `attemptAutoSwap`, so the pre-offer check cannot exclude it and would
        // refuse every swap into the slot the victim occupies. The post-offer
        // check knows the victim and does the work.
        if (kind !== 'swap' && clashes(hit.returnTime, undefined, existing)) {
          bumpSkip('overlaps-plans', experience.name);
          continue;
        }

        // Immediately before the three-request booking path, after every
        // other guard has passed. Without this the tick already running would
        // carry on and book after the user had stopped it, which is the one
        // thing a stop button cannot do.
        if (stale()) break;

        let outcome: AutoBookOutcome | ModifyOutcome | SwapOutcome | undefined;
        // Which call the failure below came from, so a refused eligibility
        // fetch is not also reported against a `book` that never went out.
        let eligibilityFailed = false;
        let operation: MutationOperation | undefined;
        let acting:
          | {
              key: string;
              keys: readonly string[];
              owner: string;
              stopRenewal: () => void;
            }
          | undefined;
        let changesExistingReservation = false;
        let pageOnlyProtection = false;
        try {
          const guests = await guestsFor(experience.id, date);
          // A success clears this call's run. `observeAction` does the clearing,
          // but only for a call it is told about, and eligibility was reported
          // solely from the catch below -- so once the panel appeared it stayed
          // for the rest of the session, over the top of every booking the run
          // went on to make. That is the one signal for deciding whether
          // booking still works, so it lying in the reassuring direction is the
          // expensive way for it to be wrong.
          recordRefusal('eligibility', undefined, nowTime);

          // Asked again, because eligibility is a round trip and the check
          // above is only as fresh as the moment it ran. Stopping autopilot,
          // or changing the day, while that request is outstanding used to
          // land in the offer and booking calls regardless.
          if (stale()) break;
          // And the plan itself, re-read rather than remembered. Checking only
          // that the target still exists and is unpaused was too weak: turning
          // Auto-book off, or narrowing the return-time window, leaves it
          // present and unpaused while the action it authorised is gone.
          if (!stillWantsAction(experience.id, kind, hit.returnTime)) continue;
          // A Lightning Lane for part of the group is often worse than none: it
          // splits the party and spends the slot. Opt-in, since booking by hand
          // in bg1 or Disney's app books for whoever is eligible.
          if (
            settingsRef.current.requireWholeParty &&
            !wholePartyEligible(guests)
          ) {
            bumpSkip('partial-party', experience.name);
            continue;
          }

          /**
           * Whether the day's own settings still permit committing.
           *
           * The three global controls are all read once, before the offer is
           * requested -- and each of them exists to *prevent* an action, so
           * turning one on while a request is in flight and having the
           * booking go through anyway is the wrong way round. Re-read at the
           * gate, from the same refs the guards above use.
           */
          const stillPermitted = () =>
            // A rehearsal that commits is not a rehearsal.
            !settingsRef.current.dryRun &&
            !(
              settingsRef.current.requireWholeParty &&
              !wholePartyEligible(guests)
            );

          // A fresh booking or a swap can both spend the party's Tier 1 slot on
          // `experience`, since neither is already held; re-timing one already
          // held (`modify`) does not. Checked here, ahead of the branches, so a
          // dry run rehearses it as well.
          if (
            (kind === 'book' || kind === 'swap') &&
            forToday &&
            shouldHoldTierSlot(hit, armed, nowTime, redeemedToday)
          ) {
            bumpSkip('tier-hold', experience.name);
            continue;
          }

          // Dry run: rehearse the same pre-offer guards the real action applies
          // -- not-modifiable, the improvement threshold, no worse reservation to
          // give up -- so the log only claims what the live run would actually
          // have attempted. The one thing that cannot be rehearsed is the re-check
          // of the offer's real time, since that needs the offer. Marked attempted
          // so it logs once per attraction per action rather than on every tick.
          if (settingsRef.current.dryRun) {
            // Both the guard and the mark on this tick's date, for the reason
            // `onBookingDate` gives: a rehearsal filed against a date this tick
            // never worked would keep a real attempt on that date out of the
            // settle sweep for the rest of the session.
            const pre = onBookingDate(() =>
              kind === 'swap'
                ? shouldSwap(
                    target,
                    experience,
                    allHeldToday,
                    ledgerRef.current
                  )
                : kind === 'modify'
                  ? shouldModify(
                      target,
                      existing,
                      hit.returnTime,
                      ledgerRef.current
                    )
                  : shouldAttempt(hit.target, ledgerRef.current)
            );
            if (!pre.ok) {
              bumpSkip(pre.reason, experience.name);
              continue;
            }
            // Rehearsal: marks only so this logs once, and stays out of the
            // allowance and the settle loop -- nothing was requested.
            onBookingDate(() =>
              ledgerRef.current.markAttempted(experience.id, kind, true)
            );
            logOutcome(experience.name, {
              status: 'dry-run',
              kind,
              returnTime: hit.returnTime,
            });
            continue;
          }

          // Re-checked against the offer's own party, whichever action this
          // is. The guards above ran on the eligibility prediction, and Disney
          // can return an offer covering fewer guests than that -- so "whole
          // party only" could commit the split party it exists to prevent. It
          // used to be passed to booking alone, while the setting's own
          // wording promises autopilot "will not book, move, or swap unless
          // everyone in your party is eligible". Read at call time, so
          // switching the setting on while an offer is in flight counts.
          const partyIsAcceptable = (offerGuests: Guests) =>
            !settingsRef.current.requireWholeParty ||
            wholePartyEligible(offerGuests);

          // Choose a swap victim before leasing. `chooseSwapVictim` is pure and
          // the helper receives the same held array in this turn, so both
          // decisions are identical; leasing every held pass made unrelated
          // searches contend and still did not make the group acquisition
          // atomic.
          const victim =
            kind === 'swap'
              ? chooseSwapVictim(allHeldToday, experience)
              : undefined;
          const changing = kind === 'swap' ? victim : existing;
          changesExistingReservation = !!changing;
          // Every mutation needs an exclusive dispatch lane. Without it, the
          // two providers routinely mounted in one app can both pass the
          // shared-ledger check, generate offers, and publish the same action
          // lock immediately before sending two requests. Book and modify
          // claim their target; swap claims both its victim and its target.
          const leaseFacility = changing?.facilityId ?? experience.id;
          const changingReservationIds = changing
            ? [
                ...new Set([
                  changing.id,
                  ...changing.guests.map(guest => guest.entitlementId),
                ]),
              ]
            : undefined;
          const owner = mutationId(`${kind}-${experience.id}`);
          operation = new MutationOperation({
            id: owner,
            kind,
            // Absolute from the beginning of the tick. Starting an action late
            // cannot grant it a fresh window beyond the poller that authorised
            // it.
            abandonAt: tickStartedAt + MAX_MUTATION_MS,
            onAbandon: async abandoned => {
              const lease = acting;
              if (lease && changesExistingReservation && abandoned.dispatched) {
                try {
                  const protection = await quarantine(
                    lease.key,
                    {
                      id: abandoned.id,
                      ...(abandoned.evidence ?? {}),
                      blockingKeys: lease.keys,
                    },
                    abandoned.dispatchedAt
                  );
                  pageOnlyProtection = !protection.durable;
                  if (!protection.durable) {
                    console.error(
                      protection.error ??
                        new Error(
                          'Unresolved change is protected only in this page'
                        )
                    );
                  }
                } catch (error) {
                  // `quarantine` normally converts persistence failures into a
                  // page-local fail-closed entry. Keep this guard for a future
                  // implementation error, but never leave an invisible
                  // renewal interval alive after the operation is abandoned.
                  pageOnlyProtection = true;
                  console.error(error);
                }
              }
              if (lease) {
                lease.stopRenewal();
                if (!pageOnlyProtection) {
                  try {
                    await releaseLease(lease.keys, lease.owner);
                  } catch (error) {
                    // A quarantine, when one was needed, is already durable.
                    // Otherwise expiry remains a conservative fallback.
                    console.error(error);
                  }
                }
              }
            },
          });

          const actionLeaseKey = leaseKey(leaseFacility, date);
          // A swap changes Y and may create X, so both are one conflict set.
          // Book and modify collapse to the single target key. Taking exactly
          // these keys avoids the old over-broad approach that leased every held
          // reservation and made unrelated searches contend.
          const actionLeaseKeys = [
            ...new Set([actionLeaseKey, leaseKey(experience.id, date)]),
          ];
          const leaseBlockReason = () =>
            actionLeaseKeys.some(key => quarantinedAt(key) !== undefined)
              ? ('unresolved-change' as const)
              : ('already-attempted' as const);
          const got = await acquireLease(actionLeaseKeys, owner);
          if (!got || operation.abandoned) {
            operation.settle();
            if (got) await releaseLease(actionLeaseKeys, owner);
            await operation.waitForAbandonment();
            bumpSkip(leaseBlockReason(), experience.name);
            continue;
          }
          acting = {
            key: actionLeaseKey,
            keys: actionLeaseKeys,
            owner,
            stopRenewal: () => undefined,
          };
          acting.stopRenewal = keepLeaseAlive(actionLeaseKeys, owner, () =>
            operation?.abandon('lease-refused')
          );

          // Eligibility can be a round trip. Another provider may finish the
          // same action after this tick's first shared-lock read but before
          // this one enters the exclusive lease. Serialising the offers is not
          // enough on its own: re-read the durable action locks while holding
          // the lease, so a waiter cannot act on the stale decision it made
          // before the winner published its result.
          onBookingDate(() => ledgerRef.current.adoptAttempted(loadLocks()));
          const leaseBlockedBy = attemptBlocker();
          if (leaseBlockedBy) {
            bumpSkip(leaseBlockedBy, experience.name);
            continue;
          }

          const stillAuthorized = (action: ActionKind, offerTime: ParkTime) =>
            !operation!.abandoned &&
            !stale() &&
            stillPermitted() &&
            stillWantsAction(experience.id, action, offerTime);

          const requestControl = (
            offerTime: ParkTime,
            evidence?: Omit<MutationEvidence, 'reservationIds'>
          ): RequestControl => {
            const current = operation!;
            const dispatchEvidence =
              evidence && changingReservationIds
                ? { ...evidence, reservationIds: changingReservationIds }
                : undefined;
            return {
              signal: current.signal,
              start: async send => {
                const authorize = () =>
                  stillAuthorized(kind, offerTime) && !current.signal.aborted;
                if (!acting) {
                  if (!authorize()) {
                    throw new RequestNotSent(
                      'Action no longer authorised before send'
                    );
                  }
                  return send();
                }
                const begun = await startWhileHeld(
                  acting.keys,
                  acting.owner,
                  authorize,
                  send
                );
                if (!begun.started) {
                  throw new RequestNotSent(
                    'Reservation lease was lost before send'
                  );
                }
                return begun.value;
              },
              onDispatch: () => {
                if (!current.markDispatched(dispatchEvidence)) {
                  throw new RequestNotSent(
                    'Action was abandoned before the request could be sent'
                  );
                }
              },
            };
          };

          if (!acting) {
            // Somebody else is changing one of these right now -- a foreground
            // search, or another tab. Skipping costs one tick; acting would
            // cost an entitlement.
            bumpSkip(leaseBlockReason(), experience.name);
            continue;
          }
          if (kind === 'swap') {
            // Atomic on Disney's side: the mod endpoint takes both the new
            // experience and the one being given up, so the old reservation is
            // released only if the new one is secured.
            outcome = await attemptAutoSwap(target, experience, allHeldToday, {
              createSwapOffer: (exp, g, victim) =>
                ll.offer(exp, g, { booking: victim }),
              book: (offer, control) => ll.book(offer, undefined, control),
              guests,
              ledger: datedLedger,
              clashes,
              partyIsAcceptable,
              requestControl: ({ from, to }) =>
                requestControl(to, {
                  kind: 'swap',
                  ...(from ? { from: String(from) } : {}),
                  to: String(to),
                  gaining: experience.id,
                }),
              // Last gate before the entitlement is spent: generating the
              // offer is another round trip, and every guard above it ran
              // before that.
              stillWanted: offerTime => stillAuthorized('swap', offerTime),
            });
          } else if (existing) {
            outcome = await attemptAutoModify(
              target,
              experience,
              existing,
              hit.returnTime,
              {
                createModifyOffer: (exp, g, booking) =>
                  ll.offer(exp, g, { booking }),
                book: (offer, control) => ll.book(offer, undefined, control),
                guests,
                ledger: datedLedger,
                clashes,
                partyIsAcceptable,
                requestControl: ({ from, to }) =>
                  requestControl(to, {
                    kind: 'modify',
                    ...(from ? { from: String(from) } : {}),
                    to: String(to),
                  }),
                // Last gate before the entitlement is spent: generating the
                // offer is another round trip, and every guard above it ran
                // before that.
                stillWanted: offerTime => stillAuthorized('modify', offerTime),
              }
            );
          } else {
            // The effective target: window stripped under book-then-move.
            outcome = await attemptAutoBook(hit.target, experience, {
              createOffer: (exp, g) => ll.offer(exp, g, { date }),
              book: (offer, control) => ll.book(offer, undefined, control),
              guests,
              ledger: datedLedger,
              clashes,
              partyIsAcceptable,
              requestControl: offerTime => requestControl(offerTime),
              // Last gate before the entitlement is spent: generating the
              // offer is another round trip, and every guard above it ran
              // before that.
              stillWanted: offerTime => stillAuthorized('book', offerTime),
            });
          }
        } catch (error) {
          // The helpers classify their own offer/commit failures. Before an
          // operation exists this can only be eligibility; after that it is a
          // local lifecycle/storage failure and must not be reported as a
          // Disney eligibility refusal.
          const httpStatus = (error as { response?: { status?: number } })
            ?.response?.status;
          eligibilityFailed = !operation;
          if (eligibilityFailed) {
            recordRefusal('eligibility', httpStatus, nowTime);
          }
          console.error(error);
          outcome = {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            httpStatus,
          };
        } finally {
          const current = operation;
          const lease = acting;
          if (current) {
            current.settle();
            // If a deadline or refused renewal already began the quarantine,
            // let that atomic write finish before a definitive late result
            // removes this operation's exact id.
            try {
              await current.waitForAbandonment();
            } catch (error) {
              // The abandonment callback is defensive today; keep this guard
              // so a future callback cannot skip classification and release.
              console.error(error);
            }
            // Computed before the quarantine branch because the log needs it
            // too, including for a fresh booking that is not quarantined.
            // Dispatched and not provably refused is the definition the
            // quarantine already used; the screen was the only place still
            // calling it a failure.
            const unknown =
              current.dispatched &&
              outcome?.status === 'failed' &&
              !outcome.rejected;
            if (unknown && outcome?.status === 'failed') {
              outcome = { ...outcome, unknown: true };
            }
            if (lease) {
              try {
                if (unknown && changesExistingReservation) {
                  const protection = await quarantine(
                    lease.key,
                    {
                      id: current.id,
                      ...(current.evidence ?? {}),
                      blockingKeys: lease.keys,
                    },
                    current.dispatchedAt
                  );
                  pageOnlyProtection = !protection.durable;
                  if (!protection.durable && outcome?.status === 'failed') {
                    outcome = {
                      ...outcome,
                      error: `${outcome.error}; unresolved-change protection is available only while this page remains open`,
                    };
                  }
                } else if (current.dispatched && changesExistingReservation) {
                  pageOnlyProtection = false;
                  // Success and a definite rejection both answer this exact
                  // request, including when they arrive after abandonment.
                  await resolveDoubt(lease.key, current.id);
                }
              } catch (error) {
                console.error(error);
                // A future unexpected failure must not create an immortal,
                // invisible renewal loop. The lease record remains until its
                // TTL, and the failure is made visible in the activity log.
                if (unknown) pageOnlyProtection = true;
                if (outcome?.status === 'failed') {
                  outcome = {
                    ...outcome,
                    error: `${outcome.error}; ${APP_NAME} could not save unresolved-change protection`,
                  };
                }
              }
              lease.stopRenewal();
              if (!pageOnlyProtection) {
                try {
                  await releaseLease(lease.keys, lease.owner);
                } catch (error) {
                  console.error(error);
                }
              }
            }
          }
        }

        if (!outcome) continue;

        // Anything the helpers returned settles their own call. A success clears
        // that call's run; only an unbroken run of refusals reads as "this is not
        // working" rather than "this went wrong a few times today".
        // Not when eligibility is what failed: the offer and booking calls were
        // never made, so recording their status here put a refusal against
        // `book` on the strength of a request that never went out, and the
        // banner named the wrong call.
        if (outcome.status !== 'skipped' && !eligibilityFailed) {
          recordRefusal(
            kind === 'book' ? 'book' : 'offer',
            outcome.status === 'failed' ? outcome.httpStatus : undefined,
            nowTime
          );
        }

        // Skips are the common case mid-drop and would swamp the log, so they
        // are tallied instead.
        if (outcome.status === 'skipped') {
          bumpSkip(outcome.reason, experience.name);
        } else logOutcome(experience.name, outcome);

        // After every attempt, not only a successful one: a booking request
        // that errored is still held in doubt until plans settle it. Harmless
        // on a skip, where nothing moved and React bails out.
        setBookedCount(ledgerRef.current.bookedCount);

        // Both legs take their ledger lock before committing, so a failure
        // leaves it held -- and `repeatMoves` gave it back only on success. One
        // lost race therefore retired the attraction for the rest of the
        // session while the screen went on saying it was still looking, which
        // for a search whose entire promise is "keep trying" is the whole
        // feature failing silently. Where the request provably changed nothing,
        // schedule a retry rather than releasing on the spot: see
        // RETRY_AFTER_MS for why the wait is the part that makes it safe.
        //
        // Autopilot keeps one action per attraction per session either way.
        //
        // Gated on the lock existing, because "rejected" alone does not mean
        // one was taken. All three helpers take theirs *after* the offer round
        // trip, so a 4xx on the offer call -- a 410 is the ordinary outcome of
        // a contested drop -- returns `rejected` with nothing locked. Minting a
        // token for it left an entry keyed to an action that never happened,
        // and the consumer above reads a token only once `hasAttempted` is
        // true: a later attempt whose own outcome was never learned would find
        // that stale token already expired, release its lock, and give back the
        // doubt-hold on a booking that may well exist. That inverts the rule
        // the ledger is built on -- mark before the request goes out, because a
        // timed-out request may have succeeded.
        // A request that provably changed nothing must not leave its action lock
        // in the shared store. Keeping it locally is Autopilot's anti-thrash
        // rule; sharing it would make every other provider skip an action that
        // is known not to have happened. For a booking this also clears the
        // doubt-hold that charges the day's allowance.
        //
        // Both asked on this tick's date. This is the tail of a tick that may
        // have been abandoned mid-request, so the ledger can already be on the
        // date a newer tick moved it to -- and a rejection belonging to the
        // 18th withdrawing the 19th's doubt-hold is how the 19th gets booked
        // twice.
        if (
          outcome.status === 'failed' &&
          outcome.rejected &&
          onBookingDate(() =>
            ledgerRef.current.hasAttempted(experience.id, kind)
          )
        ) {
          onBookingDate(() =>
            ledgerRef.current.resolveRejected(experience.id, kind)
          );
        }

        if (
          repeatMoves &&
          outcome.status === 'failed' &&
          outcome.rejected &&
          onBookingDate(() =>
            ledgerRef.current.hasAttempted(experience.id, kind)
          )
        ) {
          retryAtRef.current.set(
            lockKey(date, kind, experience.id),
            Date.now() + RETRY_AFTER_MS
          );
        }

        if (
          outcome.status === 'booked' ||
          outcome.status === 'modified' ||
          outcome.status === 'swapped'
        ) {
          // Let a move be made again, where the product wants that. Autopilot
          // does not: one move per attraction per session is what stops it
          // thrashing a reservation as availability shifts. A hand-started
          // search is the opposite -- "keep moving it earlier" is the whole
          // request -- and each move still has to clear the 30-minute
          // improvement bar, so it walks toward the earliest time rather than
          // oscillating. Released only on success: a move that failed should not
          // be retried all afternoon.
          if (repeatMoves && outcome.status === 'modified') {
            // This tick's date again: the move that succeeded was this date's.
            onBookingDate(() =>
              ledgerRef.current.releaseAttempt(experience.id, 'modify')
            );
          }
          // Publish the committed return time for any other instance to see.
          // Plans are refetched every tenth tick, so without this a second tab
          // or the provider NextLL nests inside this one could pass its own
          // overlap check against a snapshot taken before this booking existed,
          // and commit a return time that clashes with it.
          saveCommit({
            facilityId: experience.id,
            time: String(
              outcome.status === 'booked' ? outcome.returnTime : outcome.to
            ),
            // The date the reservation is for. Published for every date, not
            // only today: a second instance working the same future date needs
            // this exactly as much.
            date,
            kind:
              outcome.status === 'booked'
                ? 'book'
                : outcome.status === 'modified'
                  ? 'modify'
                  : 'swap',
            reservationIds: [
              ...new Set([
                outcome.booking.id,
                ...outcome.booking.guests.map(guest => guest.entitlementId),
              ]),
            ],
          });
          // A successful fresh booking occupies a slot immediately, even when
          // the confirmation read below still returns its pre-booking snapshot.
          // The short-lived commit record is the bridge until Plans catches up.
          partyIsFull = slotsAreFull();
          // Any change shifts eligibility across every experience at once via
          // party, tier and overlap limits, so the whole cache is invalid.
          cacheRef.current.clear();
          fireAlert(
            outcome.status === 'booked'
              ? {
                  title: `Booked ${experience.name}`,
                  body: `Return time ${formatTime(outcome.returnTime)}`,
                  tag: `${NOTIFICATION_TAG_NAMESPACE}autopilot-booked-${date}-${experience.id}`,
                }
              : outcome.status === 'modified'
                ? {
                    title: `Moved ${experience.name} earlier`,
                    body: `${formatTime(outcome.from)} to ${formatTime(outcome.to)}`,
                    tag: `${NOTIFICATION_TAG_NAMESPACE}autopilot-booked-${date}-${experience.id}`,
                  }
                : {
                    title: `Swapped in ${experience.name}`,
                    body: `Gave up ${outcome.replaced.name}; return ${formatTime(outcome.to)}`,
                    tag: `${NOTIFICATION_TAG_NAMESPACE}autopilot-booked-${date}-${experience.id}`,
                  }
          );
          try {
            // Captured and applied, not just awaited: the loop below still has
            // to judge later hits in this same tick against what the party
            // actually holds after this action, not the snapshot taken before
            // it -- see the `let currentPlans` above.
            currentPlans = await pollPlans();
            allHeldToday = heldMPToday(currentPlans, date);
            partyIsFull = slotsAreFull();
          } catch (error) {
            console.error(error);
          }
        }
      }

      // Prewarm only auto-book targets. Eligibility is the one request in the
      // three-request booking path that does not change second to second, so
      // having it cached removes a third of the round trips from the moment a
      // drop lands. Limiting it to auto-book targets bounds the extra requests,
      // and prewarmGuests skips anything already warm.
      const toWarm = activeTargets
        .filter(t => !t.paused && targetActs(t))
        .map(t => ({ id: t.experienceId }));
      if (toWarm.length > 0) {
        await prewarmGuests(toWarm, date, {
          fetchGuests: (experience, date) => ll.guests(experience, date),
          cache: cacheRef.current,
          now: clock,
        });
      }

      // A passkey unlocks the strategy only once it has actually been redeemed,
      // and Disney's own eligibility response then agrees.
      //
      // Redemption is `LLTracker.experienced`, and nothing more. Requiring the
      // reservation to still be in plans as well looks safer and is not: the
      // tracker's whole reason for existing is the case where a redeemed pass
      // *leaves* the itinerary, which it settles by asking Disney whether the
      // party now reports EXPERIENCE_LIMIT_REACHED (see LLTracker.update). A
      // passkey redeemed early enough to disappear is the ordinary case for a
      // strategy whose point is to redeem early, and demanding both left it
      // stuck on "waiting" for the rest of the day.
      //
      // What it cannot tell you is *how* the pass was spent. `experienced`
      // is true for a redeemed pass and equally for one whose window lapsed
      // unused, because Disney counts both as ridden and the tracker follows
      // Disney. That is the right input for this decision -- the tier limit
      // turns on the entitlement being gone, not on how -- but it is why
      // nothing here claims a tap-in was observed.
      //
      // The redemption half is what makes the eligibility half mean anything.
      // `TIER_LIMIT_REACHED` is only reported to a party that already holds a
      // Tier 1, so on a party holding none -- which is the state the hold exists
      // to protect -- `tierLimitLifted` is trivially true. Probing on a merely
      // *held* passkey therefore unlocked at the moment the passkey was booked,
      // switched `redeemedToday` on, and disabled the Tier 1 hold for the rest
      // of the session. Both this function's own comment and the README already
      // said a reservation is not evidence of a redemption; only the code
      // disagreed.
      const redeemedPasskey =
        forToday &&
        activeTargets.some(
          target =>
            target.passkey && ll.experienced({ id: target.experienceId })
        );
      const tierOne = experiences.find(
        exp =>
          isTier1(exp) &&
          activeTargets.some(target => target.experienceId === exp.id)
      );
      if (!passkeyActive) {
        passkeyUnlockedForRef.current = undefined;
        setPasskeyStatus('off');
      } else if (passkeyUnlockedForRef.current === date) {
        setPasskeyStatus('unlocked');
      } else if (redeemedPasskey && tierOne) {
        // Shielded exactly as the plans poll above is, and for the same reason.
        // This probe only lifts a display hold, so it has no business spending
        // the poller's failure budget -- and it was the one bare `await` left in
        // the tick. A `guests` endpoint refusing persistently made `onTick`
        // reject every tick until `MAX_CONSECUTIVE_FAILURES`, at which point the
        // poller stopped and scheduled nothing; the effect keys on `enabled`
        // alone, so nothing restarted it. Watching, alerting and drop learning
        // died with it -- precisely what a refusal is supposed to leave working.
        //
        // A failure reads as "not lifted", so the Tier 1 hold fails closed:
        // lifting it requires Disney's own agreement, which we did not get.
        let guests: Guests | undefined;
        try {
          guests = await guestsFor(tierOne.id, date);
          recordRefusal('eligibility', undefined, syncedParkTime());
        } catch (error) {
          const httpStatus = (error as { response?: { status?: number } })
            ?.response?.status;
          recordRefusal('eligibility', httpStatus, syncedParkTime());
          console.error(error);
        }
        if (guests && tierLimitLifted(guests)) {
          passkeyUnlockedForRef.current = date;
          cacheRef.current.clear();
          setPasskeyStatus('unlocked');
          fireAlert({
            title: 'Tier 1 hold unlocked',
            body: 'Your passkey is spent and Disney is no longer holding the Tier 1 limit for your party.',
            tag: `${NOTIFICATION_TAG_NAMESPACE}passkey-${date}`,
          });
        } else {
          setPasskeyStatus('waiting');
        }
      } else {
        setPasskeyStatus('waiting');
      }
    },
    [
      pollExperiences,
      pollPlans,
      ll,
      guestsFor,
      clock,
      logOutcome,
      bumpSkip,
      repeatMoves,
      park,
    ]
  );

  // The schedule the poller actually times itself to: the hardcoded drop
  // times plus any learned from observation on enough distinct days, for the
  // attractions in this park. This is what makes learning actionable -- a
  // drop the built-in table lacks gets burst for once it has been seen twice.
  const parkExperienceIds = useMemo(
    () => new Set(experiences.map(exp => exp.id)),
    [experiences]
  );
  const effectiveDropTimes = useMemo(
    () =>
      mergeDropTimes(
        activeScheduledDropTimes(park.dropSchedule, dropSummaries),
        learnedDropTimes(dropSummaries, parkExperienceIds)
      ),
    [park, dropSummaries, parkExperienceIds]
  );

  // Refill periods are deliberately target-scoped. A broad window is useful
  // when it can help one of the attractions the user chose, but would waste
  // battery and requests if merely being in the same park enabled it.
  const refillWindows = useMemo(() => {
    const watched = new Set(
      targets
        .filter(target => targetApplies(target, park.id, bookingDate))
        .map(target => target.experienceId)
    );
    return experiences.flatMap(exp =>
      watched.has(exp.id) ? (exp.refillWindows ?? []) : []
    );
  }, [experiences, targets, park.id, bookingDate]);

  // Drops and the next-booking window are day-of phenomena. When the user is
  // watching a future date -- improving pre-booked selections before the trip
  // -- bursting at 09:47 for a day next week is pure waste, so the cadence
  // policy sees no targets and stays at its slow, steady rate. Availability
  // on future dates comes from cancellations, which have no schedule.
  const watchingToday = bookingDate === parkDate();
  const watchingTomorrow = bookingDate === modifyDate(parkDate(), 1);
  const status = usePoller({
    enabled,
    onTick,
    dropTimes: watchingToday ? effectiveDropTimes : undefined,
    refillWindows: watchingToday ? refillWindows : undefined,
    // Set as a side effect of ll.experiences(), so it is current as of the
    // last poll. Read fresh each tick by usePoller.
    nextBookTimes: watchingToday ? ll.nextBookTimes : undefined,
    tomorrow: watchingTomorrow,
    rapid,
  });

  // The poller gives up after repeated failures without touching `enabled`, so
  // the release in `setEnabled` never runs. Holding the screen awake for a loop
  // that has stopped drains the battery for nothing.
  //
  // Stopping is also the one status change that has to reach somebody who is
  // not looking. Every other alert here announces something gained; this one
  // announces that nothing more will be. Until it existed the engine could give
  // up in a pocket and say so only on a screen nobody was reading, which is the
  // failure this project rates worst -- and the wake lock released on the same
  // line, so the screen it was saying it on went dark too.
  //
  // Once per transition, which the dependency array already gives: the effect
  // re-runs only when the mode changes, and the poller does not leave
  // `stopped` without a new run. A guarding ref was written for this and then
  // removed -- mutating it out changed nothing, and a repeat carries the same
  // `tag`, which collapses into the tray entry already there.
  useEffect(() => {
    if (status.mode !== 'stopped') return;
    void releaseScreenAwake(wakeLockOwner);
    fireAlert({
      title: `${APP_NAME} has stopped`,
      body: 'Repeated errors, so it is no longer checking for Lightning Lanes. Open it and start it again.',
      tag: `${NOTIFICATION_TAG_NAMESPACE}stopped-${parkDate()}`,
    });
  }, [status.mode, wakeLockOwner]);

  // Kept in the provider so every permission entry point updates the one
  // context value the rest of the UI reads. Calling this callback from a click
  // still initiates Notification.requestPermission inside that user gesture.
  const requestNotifications = useCallback(() => {
    void requestAlertPermission().then(setNotifications);
  }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      if (!on) {
        disable();
      } else {
        // Both of these must be initiated inside the user gesture that turned
        // autopilot on -- primeAudio synchronously, and the permission request
        // at least called from here.
        primeAudio();
        requestNotifications();
        // A locking screen backgrounds the page and clamps its timers, which
        // stops the poller as surely as closing it would. Requested from the
        // gesture for the same reason as the two above. Best-effort throughout:
        // where it is unsupported or refused, behaviour is unchanged.
        void holdScreenAwake(wakeLockOwner);
        // Forget past alerts so turning it back on re-alerts anything already
        // available, rather than staying silent about it.
        alertedRef.current = new Set();
        tickCountRef.current = 0;
        // Fresh locks and a clear cache per run, so a stale eligibility result
        // from an earlier session cannot drive a booking. The day's spend is
        // deliberately *not* fresh: turning autopilot off and on used to be the
        // only way to get more actions, and it came bundled with a wipe of the
        // drop-detection baseline, so buying actions cost the first poll's
        // ability to see a drop. Use the refill button instead.
        ledgerRef.current.reset();
        // With the locks, not merely alongside them: a token outliving the
        // lock it was minted for is the orphan case guarded against above.
        retryAtRef.current.clear();
        cacheRef.current.clear();
        // Re-baseline: a run comparing against the previous run's plans would
        // clear the cache on its own first poll.
        entitlementsRef.current = undefined;
        setBookedCount(0);
        setSessionLog([]);
        setSkipCounts({});
        setLastSkip(undefined);
        clearRefusals();
        // Fresh baseline: the first poll of a run sees everything as "new", and
        // that must read as a baseline rather than a drop.
        snapshotRef.current = new Map();
        snapshotAtRef.current = undefined;
        passkeyUnlockedForRef.current = undefined;
        setPasskeyStatus('off');
      }
      if (on) setEnabledState(true);
    },
    [disable, wakeLockOwner, requestNotifications]
  );

  /**
   * The watched attractions the loaded tipboard actually covers.
   *
   * A watch list outlives the park it was built for: switch to Epcot and the
   * four Magic Kingdom targets are still stored, still listed by
   * `loadWatchList`, and completely inert -- matching runs against the
   * experiences on screen. Counting all of them told the user Autopilot was
   * watching four things while the list underneath showed one, which is the
   * count being wrong in the only sense that matters.
   *
   * While the tipboard has not loaded there is nothing to filter against, and
   * answering "none" would be a worse guess than answering "all of them" --
   * so an empty experience list means the question cannot be answered yet.
   */
  const targetsHere = useMemo(() => {
    const active = targets.filter(target =>
      targetApplies(target, park.id, bookingDate)
    );
    if (experiences.length === 0) return active;
    const here = new Set(experiences.map(exp => exp.id));
    return active.filter(t => here.has(t.experienceId));
  }, [targets, experiences, park.id, bookingDate]);

  // Reads `targets` rather than the ref: a stable identity over a ref would
  // never re-render a watch toggle when the list changed.
  const isWatched = useCallback(
    (experienceId: string) =>
      targets.some(
        t =>
          t.experienceId === experienceId &&
          targetApplies(t, park.id, bookingDate)
      ),
    [targets, park.id, bookingDate]
  );

  const addTarget = useCallback(
    (target: WatchTarget) => {
      const scoped = {
        ...target,
        parkId: target.parkId ?? park.id,
        date: target.date ?? bookingDate,
        // Recorded when the target is armed, because that is the last moment
        // the name is guaranteed to be known. It exists so a target Disney
        // stops listing can still be named on screen -- and nothing set it, so
        // the "not on today's list" panel could only ever show facility ids.
        name:
          target.name ??
          experiences.find(exp => exp.id === target.experienceId)?.name,
      };
      setTargets(prev => [
        ...prev.filter(
          t =>
            t.experienceId !== scoped.experienceId ||
            !targetApplies(t, park.id, bookingDate)
        ),
        scoped,
      ]);
    },
    [park.id, bookingDate, experiences]
  );

  const removeTarget = useCallback(
    (experienceId: string) => {
      setTargets(prev =>
        prev.filter(
          t =>
            t.experienceId !== experienceId ||
            !targetApplies(t, park.id, bookingDate)
        )
      );
    },
    [park.id, bookingDate]
  );

  const replaceTargets = useCallback((next: WatchTarget[]) => {
    setTargets(next);
  }, []);

  const toggleAutoBook = useCallback(
    (experienceId: string) => {
      setTargets(prev =>
        prev.map(t =>
          t.experienceId === experienceId &&
          targetApplies(t, park.id, bookingDate)
            ? { ...t, autoBook: !t.autoBook }
            : t
        )
      );
    },
    [park.id, bookingDate]
  );

  const toggleFlag = useCallback(
    (experienceId: string, flag: 'bookThenMove' | 'paused' | 'autoSwap') => {
      setTargets(prev =>
        prev.map(t =>
          t.experienceId === experienceId &&
          targetApplies(t, park.id, bookingDate)
            ? { ...t, [flag]: !t[flag] }
            : t
        )
      );
    },
    [park.id, bookingDate]
  );

  /**
   * Set or clear one end of a target's return-time window.
   *
   * Kept separate from `toggleFlag`: the bounds are values rather than flags,
   * and an empty or unparseable input has to *remove* the bound rather than
   * store a falsy one, since `inWindow` treats an absent bound as unbounded.
   */
  const setTargetWindow = useCallback(
    (experienceId: string, bound: 'after' | 'before', value: string) => {
      const time = parseBound(value);
      setTargets(prev =>
        prev.map(t => {
          if (
            t.experienceId !== experienceId ||
            !targetApplies(t, park.id, bookingDate)
          ) {
            return t;
          }
          const next = { ...t };
          if (time) next[bound] = time;
          else delete next[bound];
          return next;
        })
      );
    },
    [park.id, bookingDate]
  );

  const setTargetRank = useCallback(
    (experienceId: string, rank?: number) => {
      setTargets(prev =>
        prev.map(target => {
          if (
            target.experienceId !== experienceId ||
            !targetApplies(target, park.id, bookingDate)
          ) {
            return target;
          }
          const next = { ...target };
          if (typeof rank === 'number' && Number.isFinite(rank)) {
            next.rank = rank;
          } else delete next.rank;
          return next;
        })
      );
    },
    [park.id, bookingDate]
  );

  const toggleAutoModify = useCallback(
    (experienceId: string) => {
      setTargets(prev =>
        prev.map(t =>
          t.experienceId === experienceId &&
          targetApplies(t, park.id, bookingDate)
            ? { ...t, autoModify: !t.autoModify }
            : t
        )
      );
    },
    [park.id, bookingDate]
  );

  const togglePasskey = useCallback(
    (experienceId: string) => {
      setTargets(prev =>
        prev.map(target =>
          target.experienceId === experienceId &&
          targetApplies(target, park.id, bookingDate)
            ? { ...target, passkey: !target.passkey }
            : target
        )
      );
    },
    [park.id, bookingDate]
  );

  return (
    <AutopilotContext
      value={{
        enabled,
        setEnabled,
        status,
        targets,
        isWatched,
        targetsHere,
        addTarget,
        removeTarget,
        replaceTargets,
        toggleAutoBook,
        toggleAutoModify,
        toggleBookThenMove: id => toggleFlag(id, 'bookThenMove'),
        togglePaused: id => toggleFlag(id, 'paused'),
        toggleAutoSwap: id => toggleFlag(id, 'autoSwap'),
        setTargetWindow,
        setTargetRank,
        togglePasskey,
        passkeyStatus,
        notifications,
        requestNotifications,
        lastHit,
        bookingLog,
        sessionLog,
        bookedCount,
        requireWholeParty: settings.requireWholeParty,
        setRequireWholeParty: on =>
          setSettings(prev => ({ ...prev, requireWholeParty: on })),
        dryRun: settings.dryRun,
        setDryRun: on => setSettings(prev => ({ ...prev, dryRun: on })),
        avoidOverlaps: settings.avoidOverlaps,
        setAvoidOverlaps: on =>
          setSettings(prev => ({ ...prev, avoidOverlaps: on })),
        skipCounts,
        lastSkip,
        refusals,
        dropSummaries,
      }}
    >
      {children}
    </AutopilotContext>
  );
}
