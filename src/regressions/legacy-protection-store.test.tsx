/*
 * A protection recorded by 1.8.4 still protects after the upgrade.
 *
 * Codex's review of 1.8.5: 1.8.4 recorded every lost cancellation under the
 * ride's Lightning Lane key, with no version, DAS ones included. 1.8.5 gave
 * DAS selections a key of their own and read such a record as a Lightning Lane
 * cancellation, so it never guarded the DAS key, and it looked done on the
 * first read, which shows no Lightning Lane there. A record from before
 * versioning cannot say which kind it was, so it now guards both keys and
 * clears only on a read that could show either and shows neither.
 */
import { booking as dasBooking } from '@/__fixtures__/das';
import {
  complete,
  dasItem,
  readPlansOnce,
  unreadable,
} from '@/__fixtures__/itinerary';
import { wdw } from '@/__fixtures__/ll';
import { ItineraryClient } from '@/api/itinerary';
import {
  QUARANTINE_KEY,
  dasLeaseKey,
  leaseKey,
  quarantinedAt,
  settledMutations,
} from '@/autopilot/lease';
import { fetchJson } from '@/fetch';
import { TODAY, setTime } from '@/testing';

// The client fixture mocks this too, but the DAS fixture loads the real one
// first.
jest.mock('@/fetch');

/**
 * What AutoLL-3 1.8.4 (5eee070) stored, byte for byte, for a DAS cancellation
 * whose answer was lost: its own manual-cancel path, run on the DAS fixture
 * booking at 10:00 on the fixtures' day, with the request failing after it was
 * sent. Read back from storage under `QUARANTINE_KEY`.
 */
const STORED_BY_1_8_4 =
  '{"2021-10-01:80010208":[{"id":"manual-cancel-ku8fo3k0-1-niox9a2o","at":1633096800000,"kind":"cancel","reservationIds":["hm1030","ent1","ent2"],"blockingKeys":["2021-10-01:80010208"]}]}';
const RECORDED_AT = 1633096800000;

const lane = leaseKey(dasBooking.facilityId, TODAY);
const das = dasLeaseKey(dasBooking.facilityId, TODAY);

describe('a DAS cancellation recorded by 1.8.4', () => {
  let client: ItineraryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(QUARANTINE_KEY, STORED_BY_1_8_4);
    // After the record, so that a read can speak about it.
    setTime('10:05:00');
    client = new ItineraryClient(wdw);
    jest.mocked(fetchJson).mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  // Not restoreAllMocks: that would also undo the client fixture's sign-in.
  afterEach(() => jest.mocked(console.error).mockRestore());

  it('guards the DAS selection as well as the Lightning Lane', () => {
    expect(quarantinedAt(das)).toBe(RECORDED_AT);
    expect(quarantinedAt(lane)).toBe(RECORDED_AT);
  });

  it('stays while Plans still show the DAS selection', async () => {
    await readPlansOnce(client, complete([dasItem]));
    expect(quarantinedAt(das)).toBe(RECORDED_AT);
    expect(quarantinedAt(lane)).toBe(RECORDED_AT);
  });

  it('stays when the DAS selection is there but cannot be read', async () => {
    await readPlansOnce(client, unreadable());
    expect(quarantinedAt(das)).toBe(RECORDED_AT);
  });

  it('clears once a complete read shows neither', async () => {
    await readPlansOnce(client, complete([]));
    expect(quarantinedAt(das)).toBeUndefined();
    expect(quarantinedAt(lane)).toBeUndefined();
    expect(settledMutations()).toEqual([
      expect.objectContaining({ kind: 'cancel', how: 'confirmed' }),
    ]);
  });
});
