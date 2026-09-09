import { Booking, isLLMP, LLMP } from '@/api/itinerary';

/** Finds the same entitlement even after its attraction has changed. */
export function findHeldByEntitlement(
  plans: Booking[],
  original: LLMP
): LLMP | undefined {
  const entitlements = new Set(original.guests.map(g => g.entitlementId));
  return plans.find(
    (plan): plan is LLMP =>
      isLLMP(plan) && plan.guests.some(g => entitlements.has(g.entitlementId))
  );
}
