import { Booking } from '@/api/itinerary';
import { Experience } from '@/api/ll';
import { findExistingLL } from '@/autopilot/automodify';
import { clashablePlans, windowClash } from '@/autopilot/overlap';
import { isTier1 } from '@/autopilot/priority';
import { WatchTarget, targetApplies } from '@/autopilot/watchlist';
import { parkDate } from '@/datetime';

export type PlanCheckLevel = 'blocker' | 'review' | 'ready';
export type PlanCheckSubject =
  | { kind: 'target'; experienceId: string }
  | { kind: 'setting'; setting: 'dryRun' | 'wholeParty' | 'overlaps' }
  | { kind: 'tipboard' }
  | { kind: 'budget' };

export interface PlanCheckItem {
  level: PlanCheckLevel;
  text: string;
  subject?: PlanCheckSubject;
}

export interface PlanCheckInput {
  targets: WatchTarget[];
  parkId: string;
  date: string;
  experiences: Experience[];
  plans: Booking[];
  bookingsRemaining: number;
  requireWholeParty: boolean;
  avoidOverlaps: boolean;
  /**
   * Rehearsal mode, and the most decisive configuration fact there is.
   *
   * `stillPermitted` in the provider opens with `!dryRun`, so it suppresses
   * every booking, move and swap. A preflight blind to it certified "no
   * configuration conflicts" for a plan that could not act at all.
   */
  dryRun: boolean;
  /** Whether the day's Tier 1 restriction is already established as lifted. */
  tierLimitLifted: boolean;
}

/**
 * Whether Autopilot would consider this target for a *booking*.
 *
 * Deliberately the provider's own admission rule rather than "any action
 * flag": `AutopilotProvider`'s armed set drops a paused target, requires
 * `autoBook || bookThenMove`, and drops one already held. Plan Check used to
 * test all four flags with no notion of paused or held, which made its Tier 1
 * advice fire in configurations where no hold is possible -- including the
 * one the advice tells you to adopt.
 */
function armedToBook(target: WatchTarget, input: PlanCheckInput) {
  if (target.paused) return false;
  if (!target.autoBook && !target.bookThenMove) return false;
  return !findExistingLL(input.plans, target.experienceId, input.date);
}

/** Whether any action at all is armed, for the watch-only advisory. */
const acts = (target: WatchTarget) =>
  !!(
    target.autoBook ||
    target.autoModify ||
    target.bookThenMove ||
    target.autoSwap
  );

const displayName = (target: WatchTarget, experiences: Experience[]) =>
  experiences.find(exp => exp.id === target.experienceId)?.name ??
  target.name ??
  target.experienceId;

/**
 * A configuration-only preflight for Autopilot.
 *
 * It intentionally receives all of its facts as arguments: opening Plan
 * Check does not ask Disney for an offer, eligibility, or a booking. Those
 * facts are deliberately re-read immediately before every real action by the
 * provider. A preflight that looked authoritative while making one more
 * request would be less safe, not more.
 *
 * The rule it must not break is that it never contradicts the engine. Where
 * a question already has an answer in `overlap.ts` or `AutopilotProvider`,
 * this calls it rather than re-deriving it -- every re-derivation here has
 * drifted at least once.
 */
export function checkPlan(input: PlanCheckInput): PlanCheckItem[] {
  const active = input.targets.filter(target =>
    targetApplies(target, input.parkId, input.date)
  );
  const items: PlanCheckItem[] = [];
  const push = (
    level: PlanCheckLevel,
    text: string,
    subject?: PlanCheckSubject
  ) => items.push({ level, text, subject });

  if (active.length === 0) {
    return [
      {
        level: 'blocker',
        text: 'No saved targets apply to this park and date.',
        subject: { kind: 'target', experienceId: '' },
      },
    ];
  }

  // Reported rather than assumed away. The tipboard is empty on first paint,
  // after every park or date change, and after a failed refresh -- and while
  // it is, every per-attraction check below is skipped. Falling through to
  // "no configuration conflicts" made the most reassuring verdict the one
  // produced from the least information.
  const tipboardLoaded = input.experiences.length > 0;
  if (!tipboardLoaded) {
    push(
      'review',
      'The tipboard for this park and date has not loaded, so per-attraction checks were skipped. Refresh the LL list and check again.',
      { kind: 'tipboard' }
    );
  }

  if (input.dryRun) {
    push(
      'review',
      'Dry run is on. Autopilot will evaluate and log every action but book, move, and swap nothing.',
      { kind: 'setting', setting: 'dryRun' }
    );
  }

  const armedAtAll = active.filter(acts);
  if (armedAtAll.length === 0) {
    push(
      'review',
      'This plan watches and alerts only; no booking, move, or swap action is armed.'
    );
  }

  if (armedAtAll.length > 0 && input.bookingsRemaining <= 0) {
    push(
      'blocker',
      'Today’s Autopilot action budget is exhausted. Add more actions before enabling it.',
      { kind: 'budget' }
    );
  }

  const missing = new Set<string>();
  for (const target of active) {
    const name = displayName(target, input.experiences);
    if (
      tipboardLoaded &&
      !input.experiences.some(exp => exp.id === target.experienceId)
    ) {
      missing.add(target.experienceId);
      push(
        'blocker',
        `${name} is not on the loaded tipboard, so it cannot be watched or acted on.`,
        { kind: 'target', experienceId: target.experienceId }
      );
    }
    if (acts(target) && target.paused) {
      push(
        'review',
        `${name} has an action armed but is paused; it will alert only until resumed.`,
        { kind: 'target', experienceId: target.experienceId }
      );
    }
    if (target.after && target.before && +target.after > +target.before) {
      push(
        'blocker',
        `${name} has an impossible return window: its earliest time is after its latest time.`,
        { kind: 'target', experienceId: target.experienceId }
      );
    }
  }

  // Only when the setting that acts on it is on: with Avoid clashes off the
  // provider short-circuits before looking at plans at all, so warning about
  // an overlap here contradicted the item printed two rows below.
  if (input.avoidOverlaps) {
    for (const target of armedAtAll) {
      const { after, before } = target;
      if (!after || !before || +after > +before) continue;
      if (missing.has(target.experienceId)) continue;
      // The target's own reservation is excluded the way the provider excludes
      // it: moving a booking necessarily clashes with itself.
      const own = findExistingLL(input.plans, target.experienceId, input.date);
      const candidates = clashablePlans(input.plans, {
        date: input.date,
        ...(own ? { ignoreIds: [own.id] } : {}),
      });
      const name = displayName(target, input.experiences);
      const covered = candidates.find(
        plan => windowClash({ after, before }, plan).covers
      );
      if (covered) {
        push(
          'blocker',
          `${name}’s entire return window falls inside the protected time around ${covered.name}, so every time it allows would be refused. Widen the window or turn off Avoid clashes.`,
          { kind: 'target', experienceId: target.experienceId }
        );
        continue;
      }
      const overlapping = candidates.find(
        plan => windowClash({ after, before }, plan).overlaps
      );
      if (overlapping) {
        push(
          'review',
          `${name}’s return window overlaps the protected time around ${overlapping.name}. Part of the window is still usable.`,
          { kind: 'target', experienceId: target.experienceId }
        );
      }
    }
  }

  // Gated the way the provider gates the hold itself: it applies only to a
  // booking, only on the current park day, and only while the Tier 1 limit is
  // still in force. A configured passkey does not lift it -- only a spent
  // entitlement does, which is what `tierLimitLifted` reports.
  if (input.date === parkDate() && !input.tierLimitLifted) {
    const tierOneArmed = active.filter(target => {
      if (!armedToBook(target, input)) return false;
      const exp = input.experiences.find(e => e.id === target.experienceId);
      return !!exp && isTier1(exp);
    });
    if (tierOneArmed.length > 1) {
      push(
        'review',
        'More than one Tier 1 target is armed for booking. Autopilot may hold a lower-priority one back for a better imminent drop. Pausing the one you want less removes the hold.'
      );
    }
  }

  if (!input.requireWholeParty && armedAtAll.length > 0) {
    push(
      'review',
      'Whole party only is off. An eligible subset of the saved party may receive a Lightning Lane.',
      { kind: 'setting', setting: 'wholeParty' }
    );
  }
  if (!input.avoidOverlaps && armedAtAll.length > 0) {
    push(
      'review',
      'Avoid clashes is off. Autopilot may take a return time that overlaps an existing plan.',
      { kind: 'setting', setting: 'overlaps' }
    );
  }

  if (items.length === 0) {
    return [
      {
        level: 'ready',
        text: 'This plan has no configuration conflicts. Eligibility, inventory, and the offer’s real return time will still be checked before every action.',
      },
    ];
  }

  // Blockers first, so the heading's count matches the rows under it. Stable
  // within a level, so the per-target order stays the order they were checked.
  const rank: Record<PlanCheckLevel, number> = {
    blocker: 0,
    review: 1,
    ready: 2,
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) => rank[a.item.level] - rank[b.item.level] || a.index - b.index
    )
    .map(({ item }) => item);
}
