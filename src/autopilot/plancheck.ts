import { Booking } from '@/api/itinerary';
import { Experience } from '@/api/ll';
import { findExistingLL } from '@/autopilot/automodify';
import { clashablePlans, windowClash } from '@/autopilot/overlap';
import { isTier1 } from '@/autopilot/priority';
import { WatchTarget, targetActs, targetApplies } from '@/autopilot/watchlist';
import { parkDate } from '@/datetime';

export type PlanCheckLevel = 'blocker' | 'review' | 'ready';
export type PlanCheckSubject =
  | { kind: 'target'; experienceId: string }
  | { kind: 'targets' }
  | { kind: 'setting'; setting: 'dryRun' | 'wholeParty' | 'overlaps' }
  | { kind: 'tipboard' };

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

export interface PlanReview {
  /** Stable identity of the park/date/configuration and verdict reviewed. */
  key: string;
  blockers: number;
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
        subject: { kind: 'targets' },
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

  const armedAtAll = active.filter(targetActs);
  if (armedAtAll.length === 0) {
    push(
      'review',
      'This plan watches and alerts only; no booking, move, or swap action is armed.'
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
    if (targetActs(target) && target.paused) {
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

/**
 * The exact review Today may acknowledge.
 *
 * A bare boolean outlived park, date and target changes. This key carries the
 * plan's scope and action settings plus the verdict the checker produced. A
 * changed plan that happens to render different findings therefore becomes
 * unreviewed automatically, while harmless live-data churn that leaves the
 * result unchanged does not nag the user to reopen the screen.
 */
export function planReview(
  input: PlanCheckInput,
  items: PlanCheckItem[] = checkPlan(input)
): PlanReview {
  const stable = (value: object) => JSON.stringify(value);
  const targets = input.targets
    .filter(target => targetApplies(target, input.parkId, input.date))
    .map(target => ({
      experienceId: target.experienceId,
      name: target.name,
      parkId: target.parkId,
      date: target.date,
      rank: target.rank,
      minImprovementMinutes: target.minImprovementMinutes,
      passkey: target.passkey === true,
      after: target.after ? String(target.after) : undefined,
      before: target.before ? String(target.before) : undefined,
      autoBook: target.autoBook === true,
      autoModify: target.autoModify === true,
      autoSwap: target.autoSwap === true,
      bookThenMove: target.bookThenMove === true,
      paused: target.paused === true,
    }))
    .sort((a, b) => stable(a).localeCompare(stable(b)));
  const verdict = [...items].sort((a, b) => stable(a).localeCompare(stable(b)));
  return {
    key: JSON.stringify({
      parkId: input.parkId,
      date: input.date,
      targets,
      requireWholeParty: input.requireWholeParty,
      avoidOverlaps: input.avoidOverlaps,
      dryRun: input.dryRun,
      tierLimitLifted: input.tierLimitLifted,
      items: verdict,
    }),
    blockers: items.filter(item => item.level === 'blocker').length,
  };
}
