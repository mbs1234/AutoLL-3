import { findHeldByEntitlement } from '@/autopilot/swap';
import { LLMP } from '@/api/itinerary';
import { DateTime, ParkTime } from '@/datetime';
import { TODAY } from '@/testing';

function held(facilityId: string, entitlementId: string): LLMP {
  return {
    type: 'LL',
    subtype: 'MP',
    id: entitlementId,
    facilityId,
    start: new DateTime(TODAY, new ParkTime(10)),
    end: new DateTime(TODAY, new ParkTime(11)),
    guests: [{ id: 'guest', name: 'Guest', entitlementId }],
  } as unknown as LLMP;
}

describe('findHeldByEntitlement', () => {
  it('follows the selected entitlement after its attraction changes', () => {
    const original = held('old-attraction', 'ent-1');
    const replacement = held('new-attraction', 'ent-1');
    expect(findHeldByEntitlement([replacement], original)).toBe(replacement);
  });

  it('does not confuse another reservation with the selected one', () => {
    const original = held('old-attraction', 'ent-1');
    expect(
      findHeldByEntitlement([held('other-attraction', 'ent-2')], original)
    ).toBeUndefined();
  });
});
