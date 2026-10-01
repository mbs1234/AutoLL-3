import { Guests } from '@/api/ll';

/**
 * Whether Disney has stopped reporting the Tier 1 limit for the selected party.
 *
 * Guests outside the saved party are explicitly marked NOT_IN_PARTY and must
 * not hold the group back. Any selected guest still reporting
 * TIER_LIMIT_REACHED means at least one person has not completed the required
 * redemption yet, including attractions with a second touch point.
 */
export function tierLimitLifted(guests: Guests): boolean {
  const party = [
    ...guests.eligible,
    ...guests.ineligible.filter(g => g.ineligibleReason !== 'NOT_IN_PARTY'),
  ];
  return (
    party.length > 0 &&
    party.every(g => g.ineligibleReason !== 'TIER_LIMIT_REACHED')
  );
}
