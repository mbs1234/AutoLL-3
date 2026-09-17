import { RequestError } from '@/api/client';
import type { RequestControl } from '@/api/client';
import type { Offer } from '@/api/ll';
import { DateTime, ParkTime, parkDate } from '@/datetime';

import { FakeLLClient } from './clients';
import { DEFAULT_SCRIPT, IDS, World, party, wdw } from './world';

describe('FakeLLClient mutation control', () => {
  afterEach(() => jest.useRealTimers());

  it('reproduces a dispatched unknown outcome in the harness', async () => {
    jest.useFakeTimers();
    const world = new World({ ...DEFAULT_SCRIPT, book: 'timeout' }, []);
    const client = new FakeLLClient(wdw, world);
    const start = new DateTime(parkDate(), new ParkTime(11));
    const offer = {
      id: 'offer-1',
      offerSetId: 'set-1',
      experience: wdw.experience(IDS.hauntedMansion),
      start,
      end: new DateTime(start.date, start.time.add({ hours: 1 })),
      guests: { eligible: party, ineligible: [] },
      itinerary: [],
      booking: undefined,
    } as unknown as Offer<undefined>;
    const started = jest.fn();
    const dispatched = jest.fn();
    const control: RequestControl = {
      signal: new AbortController().signal,
      start: async send => {
        started();
        return send();
      },
      onDispatch: dispatched,
    };

    const request = client
      .book(offer, undefined, control)
      .catch(error => error);
    await jest.advanceTimersByTimeAsync(300);
    await expect(request).resolves.toBeInstanceOf(RequestError);

    expect(started).toHaveBeenCalledTimes(1);
    expect(dispatched).toHaveBeenCalledTimes(1);
  });
});
