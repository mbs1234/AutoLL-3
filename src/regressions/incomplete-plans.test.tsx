/*
 * A protection is settled by Plans only on what a read could have shown.
 *
 * Codex's review of 1.8.5: the itinerary reader drops a reservation it cannot
 * read, and reads a response with no list of items as an empty itinerary.
 * Both look exactly like passes that are gone, so a DAS selection whose guest
 * profile was missing settled its cancellation as done, and so did a response
 * with no items at all. These pass raw responses through the real reader, the
 * real Plans provider and the protection logic together.
 *
 * Codex's review of 1.9.0: a pass that could not be read was counted on its
 * calendar date, while protection is keyed by park day, which puts a return
 * time before 4am on the day before. A cancellation in doubt for 12:30am read
 * its own day as complete, and cleared.
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
import { DateTime, ParkTime } from '@/datetime';
import { fetchJson } from '@/fetch';
import { TODAY, TOMORROW, YESTERDAY, setTime } from '@/testing';

const HM = dasBooking.facilityId;

/** The DAS selection on another day, with its guests unreadable. */
function unreadableOn(date: string, time?: string) {
  const item: Record<string, unknown> = { ...dasItem, displayStartDate: date };
  if (time) item.displayStartTime = time;
  else delete item.displayStartTime;
  return itinerary({ items: [item], profiles: {} });
}

describe('the itinerary reader', () => {
  // A fresh reader each time: its rate limiter allows five reads a second.
  let client: ItineraryClient;

  beforeEach(() => {
    setTime('10:00:00');
    client = new ItineraryClient(wdw);
  });

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

  describe('places a pass it cannot read on its park day', () => {
    it.each([
      ['00:00:00', TODAY],
      ['00:30:00', TODAY],
      ['03:59:59', TODAY],
      ['04:00:00', TOMORROW],
    ])('at %s the next morning, on %s', async (time, day) => {
      respond(unreadableOn(TOMORROW, time));
      jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
      const plans = await client.plans();
      expect(plansGaps(plans)).toEqual([{ facilityId: HM, date: day }]);
      expect(plansCover(plans, HM, day)).toBe(false);
    });

    it('on both days it may be when its time cannot be read', async () => {
      respond(unreadableOn(TOMORROW));
      jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
      const plans = await client.plans();
      expect(plansCover(plans, HM, TOMORROW)).toBe(false);
      expect(plansCover(plans, HM, TODAY)).toBe(false);
      expect(plansCover(plans, HM, YESTERDAY)).toBe(true);
    });

    it('on the park day when its date is already past', async () => {
      respond(unreadableOn(YESTERDAY, '10:30:00'));
      jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
      const plans = await client.plans();
      expect(plansGaps(plans)).toEqual([{ facilityId: HM, date: TODAY }]);
    });
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

  describe('for a selection after midnight', () => {
    /** At 12:30am tomorrow, which is today's park day. */
    const late = {
      ...dasBooking,
      start: new DateTime(TOMORROW, new ParkTime(0, 30)),
    };

    async function lateInDoubt() {
      const { keys, evidence } = cancellationMutation(late);
      // Protected on today's park day, as the reader would place it.
      expect(keys[0]).toBe(key);
      await quarantine(
        keys[0]!,
        { ...evidence, blockingKeys: keys },
        Date.now() - 1_000
      );
    }

    it('stays when the selection cannot be read', async () => {
      await lateInDoubt();
      await readPlansOnce(client, unreadableOn(TOMORROW, '00:30:00'));
      expect(quarantinedAt(key)).toBeDefined();
    });

    it('clears once a complete read shows it gone', async () => {
      await lateInDoubt();
      await readPlansOnce(client, complete([]));
      expect(quarantinedAt(key)).toBeUndefined();
    });
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
