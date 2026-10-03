/*
 * A Time Search when the party changes under it.
 *
 * 1.8.3 stopped such a search without saying so: it still showed as running,
 * Start did nothing, and it kept renewing its lease, so Autopilot went on
 * skipping that reservation until someone tapped Stop.
 */
import { act, renderHook, waitFor } from '@testing-library/react';

import type { RequestControl } from '@/api/client';
import { Booking } from '@/api/itinerary';
import { LLMP, Offer } from '@/api/ll';
import { findSameReservation } from '@/autopilot/automodify';
import useTimeSearch, {
  CYCLE_MS,
  TimeSearchDeps,
} from '@/autopilot/useTimeSearch';
import { DateTime, ParkTime } from '@/datetime';
import { saveSavedPartyIds } from '@/savedParty';
import { TODAY } from '@/testing';

jest.useFakeTimers();

const BZ = '80010114';
const at = (h: number, m = 0) => new ParkTime(h, m);

function booking(time: ParkTime): LLMP {
  return {
    type: 'LL',
    subtype: 'MP',
    id: 'ent-1',
    facilityId: BZ,
    name: 'Ride',
    start: new DateTime(TODAY, time),
    end: new DateTime(TODAY, time.add({ hours: 1 })),
    modifiable: true,
    guests: [],
  } as unknown as LLMP;
}

function offerAt(time: ParkTime, heldAt?: ParkTime): Offer<LLMP> {
  return {
    id: 'offer-1',
    offerSetId: 'set-1',
    start: new DateTime(TODAY, time),
    end: new DateTime(TODAY, time.add({ hours: 1 })),
    guests: { eligible: [], ineligible: [] },
    itinerary: heldAt
      ? [{ facilityId: BZ, startTime: heldAt, overlap: 'NONE' }]
      : [],
    booking: booking(time),
  } as unknown as Offer<LLMP>;
}

async function runCycles(n = 3) {
  for (let i = 0; i < n; ++i) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CYCLE_MS);
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  saveSavedPartyIds(['a']);
});

test('a party change stops the search visibly and gives up its lease', async () => {
  let current = at(15);
  const stopRenewal = jest.fn();
  const keepCommitAlive = jest.fn(() => stopRenewal);
  const commit = jest.fn(async (o: Offer<LLMP>, control?: RequestControl) => {
    const send = async () => {
      control?.onDispatch?.();
      current = o.start.time;
      return booking(current);
    };
    return control?.start ? control.start(send) : send();
  });
  const createOffer = jest.fn(async (b: LLMP) =>
    offerAt(current, b.start.time)
  );
  const deps: TimeSearchDeps = {
    booking: booking(current),
    goal: { kind: 'soonest' },
    createOffer,
    getTimes: jest.fn(async () => [[at(11)]]),
    changeTime: jest.fn(async (_o, t: ParkTime) => offerAt(t)),
    commit,
    pollPlans: jest.fn(async () => [booking(current)]) as () => Promise<
      Booking[]
    >,
    findHeld: findSameReservation,
    claimCommit: jest.fn(async () => true),
    releaseCommit: jest.fn(async () => undefined),
    keepCommitAlive,
  };
  const { result } = renderHook(() => useTimeSearch(deps));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.moves).toBe(1));
  await runCycles(2);
  const offersBefore = createOffer.mock.calls.length;
  act(() => saveSavedPartyIds(['a', 'b']));
  await runCycles(10);
  expect(result.current.running).toBe(false);
  expect(result.current.stop).toBe('failed');
  expect(result.current.lastError).toMatch(/party changed/);
  // No offers for the wrong people, and the lease is let go.
  expect(createOffer.mock.calls.length).toBeLessThanOrEqual(offersBefore + 1);
  expect(stopRenewal).toHaveBeenCalled();
});
