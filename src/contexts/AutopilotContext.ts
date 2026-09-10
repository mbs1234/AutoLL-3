import { createContext } from 'react';

import { AlertPermission } from '@/autopilot/alert';
import { DEFAULT_ACTIONS_PER_DAY } from '@/autopilot/autobook';
import { DropSummary } from '@/autopilot/observe';
import { NO_REFUSALS, RefusalState } from '@/autopilot/refusal';
import { PollerStatus } from '@/autopilot/usePoller';
import { WatchTarget } from '@/autopilot/watchlist';
import { ParkTime } from '@/datetime';

export interface AutopilotHit {
  experienceId: string;
  name: string;
  returnTime: ParkTime;
}

export interface BookingLogEntry {
  name: string;
  at: ParkTime;
  status: 'booked' | 'modified' | 'swapped' | 'failed' | 'skipped' | 'dry-run';
  /** Return time for a booking. */
  returnTime?: ParkTime;
  /** Previous return time, for a modification. */
  fromTime?: ParkTime;
  /** The reservation given up, for a swap. */
  replacedName?: string;
  /** Error message, skip reason, or for a dry run the action rehearsed. */
  detail?: string;
  /** Plain-language explanation of why a completed action was acceptable. */
  reason?: string;
}

/** A skip with the name and time the aggregate counts leave out. */
export interface Skip {
  name: string;
  reason: string;
  at: ParkTime;
}

export interface AutopilotState {
  enabled: boolean;
  /**
   * Must be called from a user gesture when turning on: unlocking audio and
   * prompting for notification permission both require one.
   */
  setEnabled: (on: boolean) => void;
  status: PollerStatus;
  targets: WatchTarget[];
  /**
   * The subset of `targets` the loaded tipboard covers -- what Autopilot can
   * actually act on right now. Falls back to the whole list while no
   * experiences have loaded, when the question cannot yet be answered.
   */
  targetsHere: WatchTarget[];
  isWatched: (experienceId: string) => boolean;
  addTarget: (target: WatchTarget) => void;
  removeTarget: (experienceId: string) => void;
  /**
   * Set the whole list at once, replacing whatever was there.
   *
   * For a screen that watches exactly one thing at a time. `addTarget` merges
   * by id, which is right for a watch list built up over a morning and wrong
   * for a single-goal search: a target left behind by an earlier search would
   * still be armed while the screen named only the newest one.
   */
  replaceTargets: (targets: WatchTarget[]) => void;
  /** Turn automatic booking on or off for one watched attraction. */
  toggleAutoBook: (experienceId: string) => void;
  /** Turn automatic re-timing of an existing reservation on or off. */
  toggleAutoModify: (experienceId: string) => void;
  /** Book any time first, then move toward the window. Implies both. */
  toggleBookThenMove: (experienceId: string) => void;
  /** Keep alerting but take no action for this attraction. */
  togglePaused: (experienceId: string) => void;
  /** When full, give up the worst held reservation for this attraction. */
  toggleAutoSwap: (experienceId: string) => void;
  /**
   * Set or clear one end of an attraction's acceptable return-time window.
   *
   * Takes the raw `<input type="time">` value; an empty or unparseable one
   * clears that bound. The window gates booking, moving and swapping, and
   * deliberately not alerting.
   */
  setTargetWindow: (
    experienceId: string,
    bound: 'after' | 'before',
    value: string
  ) => void;
  /** Set a user-defined priority for this target within its day plan. */
  setTargetRank: (experienceId: string, rank?: number) => void;
  /** Mark an easy early target as the day's optional passkey. */
  togglePasskey: (experienceId: string) => void;
  /** Whether Disney has confirmed that the selected party cleared the Tier 1 hold. */
  passkeyStatus: 'off' | 'waiting' | 'unlocked';
  notifications: AlertPermission;
  /** Ask for notification permission from a user-initiated control. */
  requestNotifications: () => void;
  /** The most recent alert, for showing what was found without a toast. */
  lastHit?: AutopilotHit;
  /** Newest first, capped. Skips are omitted -- they are the common case. */
  bookingLog: BookingLogEntry[];
  /**
   * Actions taken by this provider since its current run was started.
   *
   * Unlike `bookingLog`, this is not persisted or shared with another
   * AutopilotProvider. NextLL nests its own provider, so this is what lets its
   * activity section describe only the quick search in front of the user
   * rather than mixing in actions from the all-day Autopilot.
   */
  sessionLog: BookingLogEntry[];
  bookedCount: number;
  bookingsRemaining: number;
  /** Today's ceiling: the setting plus any refills granted. */
  actionBudget: number;
  /**
   * Grant a few more actions for today, without touching anything else.
   *
   * The old way to get more was to turn autopilot off and on, which also wiped
   * the drop-detection baseline -- so buying actions cost the next poll's
   * ability to see a drop.
   */
  refillBudget: () => void;
  /** The day's allowance as set by the user, before refills. Persisted. */
  maxActionsPerDay: number;
  setMaxActionsPerDay: (actions: number) => void;
  /** Act only when every party member is eligible. Persisted. */
  requireWholeParty: boolean;
  setRequireWholeParty: (on: boolean) => void;
  /** Rehearse every guard but commit nothing. Persisted. */
  dryRun: boolean;
  setDryRun: (on: boolean) => void;
  /** Refuse a time that lands on top of an existing plan. Persisted. */
  avoidOverlaps: boolean;
  setAvoidOverlaps: (on: boolean) => void;
  /**
   * How often each reason stopped an action this session. Skips are the
   * ordinary outcome and are kept out of the log, so this is where "why did
   * nothing get booked?" gets answered.
   */
  skipCounts: Record<string, number>;
  /**
   * The most recent skip, by name. Not persisted, and not in the log: skips
   * are the common case and would swamp it, but the newest one is the answer
   * to "what is it doing right now?" more often than anything in the log.
   */
  lastSkip?: Skip;
  /**
   * Which booking-path calls Disney is refusing outright, if any.
   *
   * Optional so the several places that stub this context need not change.
   * A refusal is invisible otherwise: it lands on eligibility, one step
   * before an offer exists, so autopilot keeps polling, alerting and
   * learning drops while never acting.
   */
  refusals?: RefusalState;
  /**
   * What the poller has learned about when drops really happen, per
   * attraction, checked against the hardcoded schedule. Accumulates across
   * visits; only meaningful while watching today's date.
   */
  dropSummaries: DropSummary[];
}

export default createContext<AutopilotState>({
  enabled: false,
  setEnabled: () => undefined,
  status: { mode: 'off', consecutiveFailures: 0, polls: 0 },
  targets: [],
  targetsHere: [],
  isWatched: () => false,
  addTarget: () => undefined,
  removeTarget: () => undefined,
  replaceTargets: () => undefined,
  toggleAutoBook: () => undefined,
  toggleAutoModify: () => undefined,
  toggleBookThenMove: () => undefined,
  togglePaused: () => undefined,
  toggleAutoSwap: () => undefined,
  setTargetWindow: () => undefined,
  setTargetRank: () => undefined,
  togglePasskey: () => undefined,
  passkeyStatus: 'off',
  notifications: 'unsupported',
  requestNotifications: () => undefined,
  bookingLog: [],
  sessionLog: [],
  bookedCount: 0,
  bookingsRemaining: DEFAULT_ACTIONS_PER_DAY,
  actionBudget: DEFAULT_ACTIONS_PER_DAY,
  refillBudget: () => undefined,
  maxActionsPerDay: DEFAULT_ACTIONS_PER_DAY,
  setMaxActionsPerDay: () => undefined,
  requireWholeParty: false,
  setRequireWholeParty: () => undefined,
  dryRun: false,
  setDryRun: () => undefined,
  avoidOverlaps: true,
  setAvoidOverlaps: () => undefined,
  skipCounts: {},
  refusals: NO_REFUSALS,
  dropSummaries: [],
});
