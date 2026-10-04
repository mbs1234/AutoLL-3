/*
 * Disney's itinerary as it arrives, and one read of it through the real reader
 * and Plans provider, which reconciles protections against what it shows.
 */
import { respond, response } from '@/__fixtures__/client';
import { booking as dasBooking } from '@/__fixtures__/das';
import { mickey, minnie } from '@/__fixtures__/ll';
import { ItineraryClient } from '@/api/itinerary';
import * as lease from '@/autopilot/lease';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import PlansProvider from '@/providers/PlansProvider';
import { TODAY, act, render } from '@/testing';

const xid = (guest: { id: string }) => `${guest.id};type=xid`;
export const attraction = (id: string) => `${id};entityType=Attraction`;

/** The DAS fixture booking at Haunted Mansion, as the itinerary lists it. */
export const dasItem = {
  id: dasBooking.id,
  type: 'FASTPASS',
  kind: 'DAS',
  facility: attraction(dasBooking.facilityId),
  displayStartDate: TODAY,
  displayStartTime: '10:30:00',
  cancellable: true,
  modifiable: false,
  multipleExperiences: false,
  assets: [],
  guests: dasBooking.guests.map(guest => ({
    id: xid(guest),
    entitlementId: guest.entitlementId,
    bookingId: guest.entitlementId,
  })),
};

const profiles = Object.fromEntries(
  [mickey, minnie].map(guest => {
    const [firstName, lastName = ''] = guest.name.split(' ');
    return [xid(guest), { id: xid(guest), name: { firstName, lastName } }];
  })
);

export function itinerary(body: Record<string, unknown>) {
  return response({ loggedInGuestId: xid(mickey), assets: {}, ...body });
}

export const complete = (items: unknown[]) => itinerary({ items, profiles });
/** The DAS selection is there, but its guests' profiles are not. */
export const unreadable = () => itinerary({ items: [dasItem], profiles: {} });
/** No list of items at all. */
export const withoutItems = () => itinerary({ profiles });

/**
 * One read of Plans through the real provider, which reconciles it.
 *
 * Fails unless exactly one read happened, succeeded and was reconciled to the
 * end, so that a protection still standing afterwards is that read's doing.
 */
export async function readPlansOnce(
  client: ItineraryClient,
  body: ReturnType<typeof response>
) {
  const reads = jest.spyOn(client, 'plans');
  const reconciled = jest.spyOn(lease, 'reconcile');
  respond(body);
  const view = render(
    <ClientsContext value={{ itinerary: client } as unknown as Clients}>
      <PlansProvider>
        <></>
      </PlansProvider>
    </ClientsContext>
  );
  // The provider reads once on mount; let it and its reconciliation finish.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1_000);
  });
  view.unmount();
  expect(reads).toHaveBeenCalledTimes(1);
  await expect(reads.mock.results[0]!.value).resolves.toBeDefined();
  expect(reconciled).toHaveBeenCalledTimes(1);
  await reconciled.mock.results[0]!.value;
  reads.mockRestore();
  reconciled.mockRestore();
}
