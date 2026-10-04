import { booking as dasBooking } from '@/__fixtures__/das';
import { booking, jc, modOffer, offer } from '@/__fixtures__/ll';
import {
  type RequestControl,
  RequestError,
  RequestNotSent,
  UnknownMutationOutcome,
} from '@/api/client';
import { TODAY, setTime } from '@/testing';

import {
  LEASE_KEY,
  QUARANTINE_KEY,
  acquire,
  dasLeaseKey,
  leaseKey,
  quarantinedMutations,
  resolveDoubt,
} from './lease';
import {
  bookingMutation,
  cancellationMutation,
  runManualMutation,
} from './manualMutation';
import { MAX_MUTATION_MS } from './mutation';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const dispatch = <T>(control: RequestControl, send: () => Promise<T>) =>
  control.start!(async () => {
    control.onDispatch!();
    return send();
  });
const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  localStorage.clear();
  setTime('10:00:00');
});
afterEach(async () => {
  jest.restoreAllMocks();
  for (const doubt of quarantinedMutations()) {
    await resolveDoubt(doubt.key, doubt.id);
  }
});

test('competing manual actions permit exactly one dispatch', async () => {
  const gate = deferred<void>();
  const sent = jest.fn(async () => booking);
  const first = runManualMutation(bookingMutation(modOffer), async control => {
    await gate.promise;
    return dispatch(control, sent);
  });
  await flush();
  const second = jest.fn(async () => booking);
  await expect(
    runManualMutation(bookingMutation(modOffer), second)
  ).rejects.toBeInstanceOf(RequestNotSent);
  expect(second).not.toHaveBeenCalled();
  gate.resolve();
  await expect(first).resolves.toEqual(booking);
  expect(sent).toHaveBeenCalledTimes(1);
});

test.each([
  bookingMutation(offer),
  bookingMutation(modOffer),
  bookingMutation({ ...modOffer, experience: jc }),
  cancellationMutation(booking),
])(
  '$evidence.kind quarantines every conflict key on an unreadable dispatched result',
  async mutation => {
    await expect(
      runManualMutation(mutation, control =>
        dispatch(control, async () => {
          throw new TypeError('bad body');
        })
      )
    ).rejects.toBeInstanceOf(UnknownMutationOutcome);
    expect(quarantinedMutations()).toEqual([
      expect.objectContaining({ kind: mutation.evidence.kind, durable: true }),
    ]);
    for (const key of mutation.keys) {
      expect(await acquire(key, 'other')).toBe(false);
    }
  }
);

test.each([400, 403, 410, 429])(
  'a definitive %i refusal releases protection',
  async status => {
    const error = new RequestError({ ok: false, status, data: {} });
    await expect(
      runManualMutation(bookingMutation(modOffer), control =>
        dispatch(control, async () => {
          throw error;
        })
      )
    ).rejects.toBe(error);
    expect(quarantinedMutations()).toEqual([]);
    expect(await acquire(leaseKey(booking.facilityId, TODAY), 'other')).toBe(
      true
    );
  }
);

test('local preparation failure does not manufacture uncertainty', async () => {
  const error = new Error('not prepared');
  await expect(
    runManualMutation(bookingMutation(modOffer), async () => {
      throw error;
    })
  ).rejects.toBe(error);
  expect(quarantinedMutations()).toEqual([]);
});

test.each(['success', 'rejected'] as const)(
  'a late %s resolves only its own timed-out operation',
  async outcome => {
    const response = deferred<typeof booking>();
    const result = runManualMutation(bookingMutation(modOffer), control =>
      dispatch(control, () => response.promise)
    );
    const failed = result.catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(MAX_MUTATION_MS);
    expect(await failed).toBeInstanceOf(UnknownMutationOutcome);
    expect(quarantinedMutations()).toHaveLength(1);
    if (outcome === 'success') response.resolve(booking);
    else {
      response.reject(new RequestError({ ok: false, status: 410, data: {} }));
    }
    await flush();
    expect(quarantinedMutations()).toEqual([]);
  }
);

test('navigation before dispatch prevents a delayed send', async () => {
  const gate = deferred<void>();
  const controller = new AbortController();
  const sent = jest.fn(async () => booking);
  const result = runManualMutation(
    bookingMutation(modOffer),
    async control => {
      await gate.promise;
      return dispatch(control, sent);
    },
    { signal: controller.signal }
  );
  const failed = result.catch((error: unknown) => error);
  await flush();
  controller.abort();
  expect(await failed).toBeInstanceOf(RequestNotSent);
  gate.resolve();
  await flush();
  expect(sent).not.toHaveBeenCalled();
  expect(quarantinedMutations()).toEqual([]);
});

test('a lease-release storage failure cannot turn known success into retryable failure', async () => {
  const realSet = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key,
    value
  ) {
    if (key === LEASE_KEY && value === '{}') {
      throw new Error('storage unavailable');
    }
    realSet.call(this, key, value);
  });
  await expect(
    runManualMutation(bookingMutation(modOffer), control =>
      dispatch(control, async () => booking)
    )
  ).resolves.toEqual(booking);
});

test('failed durable quarantine still blocks this page and reports its limits', async () => {
  const realSet = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key,
    value
  ) {
    if (key === QUARANTINE_KEY) throw new Error('quota');
    realSet.call(this, key, value);
  });
  await expect(
    runManualMutation(cancellationMutation(booking), control =>
      dispatch(control, async () => {
        throw new TypeError('body');
      })
    )
  ).rejects.toThrow('only available in this page');
  expect(quarantinedMutations()[0]?.durable).toBe(false);
  expect(await acquire(leaseKey(booking.facilityId, TODAY), 'other')).toBe(
    false
  );
});

describe('1.8.4: what a refusal says, and what a doubt can be settled by', () => {
  test('a lease someone else holds is "busy", with nothing to resolve', async () => {
    const mutation = bookingMutation(modOffer);
    await acquire(mutation.keys, 'autopilot');
    const send = jest.fn();
    await expect(runManualMutation(mutation, send)).rejects.toThrow(
      /another AutoLL action is changing this reservation/
    );
    expect(send).not.toHaveBeenCalled();
  });

  test('an unresolved change says so, and points to resolving it', async () => {
    const mutation = bookingMutation(modOffer);
    await expect(
      runManualMutation(mutation, control =>
        dispatch(control, async () => {
          throw new RequestError({ ok: false, status: 0, data: {} });
        })
      )
    ).rejects.toBeInstanceOf(UnknownMutationOutcome);
    await expect(runManualMutation(mutation, jest.fn())).rejects.toThrow(
      /has an unresolved change/
    );
  });

  test('a lease that cannot be written says so instead of "unknown error"', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const send = jest.fn();
    const result = runManualMutation(bookingMutation(modOffer), send);
    await expect(result).rejects.toBeInstanceOf(RequestNotSent);
    await expect(result).rejects.toThrow(/storage for AutoLL is full/);
    expect(send).not.toHaveBeenCalled();
  });

  test('a new booking is settled by its guests', () => {
    expect(bookingMutation(offer).evidence).toMatchObject({
      kind: 'book',
      guestIds: offer.guests.eligible.map(g => g.id),
    });
  });

  test('removing some guests names only their passes', () => {
    const [first] = booking.guests;
    expect(cancellationMutation(booking, [first!]).evidence).toMatchObject({
      kind: 'cancel',
      reservationIds: [first!.entitlementId],
    });
    expect(cancellationMutation(booking).evidence.reservationIds).toEqual([
      booking.id,
      ...booking.guests.map(g => g.entitlementId),
    ]);
  });

  // Its own key: sharing the Lightning Lanes' let a DAS cancellation in doubt
  // pause them, and be settled by a read of them.
  test("a DAS cancellation is protected apart from the ride's Lightning Lanes", () => {
    const { keys } = cancellationMutation(dasBooking);
    expect(keys).toEqual([dasLeaseKey(dasBooking.facilityId, TODAY)]);
    expect(keys).not.toContain(leaseKey(dasBooking.facilityId, TODAY));
  });
});
