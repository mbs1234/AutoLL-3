/*
 * A protection is settled by Plans only on what a read could have shown.
 *
 * Codex's review of 1.8.5: the itinerary reader drops a reservation it cannot
 * read, and reads a response with no list of items as an empty itinerary.
 * Both look exactly like passes that are gone, so a DAS selection whose guest
 * profile was missing settled its cancellation as done, and so did a response
 * with no items at all. These pass raw responses through the real reader, the
 * real Plans provider and the protection logic together.
 */
import { respond } from '@/__fixtures__/client';
import { booking as dasBooking } from '@/__fixtures__/das';
import {
  attraction,
  complete,
  dasItem,
  itinerary,
  readPlansOnce,
  unreadable,
  withoutItems,
} from '@/__fixtures__/itinerary';
import { wdw } from '@/__fixtures__/ll';
import { ItineraryClient, plansCover, plansGaps } from '@/api/itinerary';
import { dasLeaseKey, quarantine, quarantinedAt } from '@/autopilot/lease';
import { cancellationMutation } from '@/autopilot/manualMutation';
import { fetchJson } from '@/fetch';
import { TODAY, setTime } from '@/testing';

const HM = dasBooking.facilityId;

describe('the itinerary reader', () => {
  const client = new ItineraryClient(wdw);

  beforeEach(() => setTime('10:00:00'));

  it('reads a complete response as complete', async () => {
    respond(complete([dasItem]));
    const plans = await client.plans();
    expect(plans.map(plan => plan.id)).toEqual([dasBooking.id]);
    expect(plansGaps(plans)).toEqual([]);
    expect(plansCover(plans, HM, TODAY)).toBe(true);
  });

  it('places a pass it cannot read at its attraction and day', async () => {
    respond(unreadable());
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    const plans = await client.plans();
    expect(plans).toEqual([]);
    expect(plansGaps(plans)).toEqual([{ facilityId: HM, date: TODAY }]);
    expect(plansCover(plans, HM, TODAY)).toBe(false);
    // Another attraction, or another day, can still be read as complete.
    expect(plansCover(plans, '80010114', TODAY)).toBe(true);
    expect(plansCover(plans, HM, '2099-01-01')).toBe(true);
  });

  it('reads a response without its list as covering nothing', async () => {
    respond(withoutItems());
    const plans = await client.plans();
    expect(plans).toEqual([]);
    expect(plansCover(plans, HM, TODAY)).toBe(false);
    expect(plansCover(plans, '80010114', TODAY)).toBe(false);
  });
});

describe('a DAS cancellation in doubt, against what Plans could read', () => {
  const key = dasLeaseKey(HM, TODAY);
  let client: ItineraryClient;

  beforeEach(() => {
    localStorage.clear();
    setTime('10:00:00');
    client = new ItineraryClient(wdw);
    // No response left queued by one test for the next to read.
    jest.mocked(fetchJson).mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  // Not restoreAllMocks: that would also undo the client fixture's sign-in,
  // and every read after the first would fail before reaching Plans.
  afterEach(() => jest.mocked(console.error).mockRestore());

  async function inDoubt() {
    const { keys, evidence } = cancellationMutation(dasBooking);
    // Raised before the read starts, as every real one is.
    await quarantine(
      keys[0]!,
      { ...evidence, blockingKeys: keys },
      Date.now() - 1_000
    );
    expect(quarantinedAt(key)).toBeDefined();
  }

  it('stays when the selection is there but cannot be read', async () => {
    await inDoubt();
    await readPlansOnce(client, unreadable());
    expect(quarantinedAt(key)).toBeDefined();
  });

  it('stays when the response has no list of items', async () => {
    await inDoubt();
    await readPlansOnce(client, withoutItems());
    expect(quarantinedAt(key)).toBeDefined();
  });

  it('stays while a complete read still shows the selection', async () => {
    await inDoubt();
    await readPlansOnce(client, complete([dasItem]));
    expect(quarantinedAt(key)).toBeDefined();
  });

  it('clears once a complete read shows it gone', async () => {
    await inDoubt();
    await readPlansOnce(client, complete([]));
    expect(quarantinedAt(key)).toBeUndefined();
  });

  it('clears even when something at another attraction could not be read', async () => {
    await inDoubt();
    const elsewhere = {
      ...dasItem,
      id: 'elsewhere',
      facility: attraction('80010114'),
    };
    await readPlansOnce(
      client,
      itinerary({ items: [elsewhere], profiles: {} })
    );
    expect(quarantinedAt(key)).toBeUndefined();
  });
});
