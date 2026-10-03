import { Guests } from '@/api/ll';

/**
 * Whether everyone the user actually means to ride with is eligible.
 *
 * bg1 lets the user save a party. Guests outside it still come back from the
 * eligibility call, but marked ineligible with NOT_IN_PARTY -- they are not
 * part of "the whole party" and must not block an action. Anyone else who is
 * ineligible (TOO_EARLY, TIER_LIMIT_REACHED, missing admission, and so on) is a
 * party member who would be left out, which is exactly what this guard exists
 * to prevent: a Lightning Lane for two of five is often worse than none, since
 * it splits the group and spends the slot.
 */
export function wholePartyEligible(
  guests: Guests,
  selectedIds: readonly string[] = []
): boolean {
  if (guests.eligible.length === 0) return false;
  if (selectedIds.length) {
    return selectedIds.every(id => guests.eligible.some(g => g.id === id));
  }
  return guests.ineligible.every(g => g.ineligibleReason === 'NOT_IN_PARTY');
}
