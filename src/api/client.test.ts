import { MutationOperation } from '@/autopilot/mutation';
import { fetchJson } from '@/fetch';
import { RateLimit, RateLimitExceeded } from '@/ratelimit';

import { authStore } from './auth';
import { ApiClient, RequestControl, RequestNotSent } from './client';
import type { Resort } from './resort';
import { getSensorData } from './sensor-data';

jest.mock('@/fetch');
jest.mock('./sensor-data');
jest.mock('./auth', () => ({
  authStore: {
    getData: jest.fn(() => ({ swid: 'swid', accessToken: 'token' })),
    deleteData: jest.fn(),
  },
}));

class TestClient extends ApiClient {
  mutate(control?: RequestControl) {
    return this.request({
      path: '/mutation',
      method: 'POST',
      data: { value: 1 },
      sensorData: true,
      control,
    });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('controlled mutation requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(authStore.getData).mockReturnValue({
      swid: 'swid',
      accessToken: 'token',
    } as never);
    jest.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('can abandon the first sensor-module load before any HTTP request starts', async () => {
    const sensor = deferred<string>();
    jest.mocked(getSensorData).mockReturnValue(sensor.promise);
    const enforce = jest.spyOn(RateLimit.prototype, 'enforce');
    const controller = new AbortController();
    const dispatched = jest.fn();
    const client = new TestClient({ id: 'WDW' } as Resort);

    const request = client.mutate({
      signal: controller.signal,
      onDispatch: dispatched,
    });
    controller.abort();

    await expect(request).rejects.toBeInstanceOf(RequestNotSent);
    sensor.resolve('late-sensor');
    await Promise.resolve();
    expect(enforce).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('revalidates and marks dispatch only after sensor generation', async () => {
    const sensor = deferred<string>();
    const order: string[] = [];
    jest.mocked(getSensorData).mockReturnValue(sensor.promise);
    jest.spyOn(RateLimit.prototype, 'enforce').mockImplementation(() => {
      order.push('rate-limit');
    });
    jest.mocked(fetchJson).mockImplementation(async () => {
      order.push('fetch');
      return { ok: true, status: 200, data: { ok: true } };
    });
    const client = new TestClient({ id: 'WDW' } as Resort);
    const request = client.mutate({
      signal: new AbortController().signal,
      start: async send => {
        order.push('revalidate');
        return send();
      },
      onDispatch: () => order.push('dispatch'),
    });
    expect(order).toEqual([]);
    sensor.resolve('sensor');
    await request;
    expect(order).toEqual(['revalidate', 'rate-limit', 'dispatch', 'fetch']);
  });

  it('does not mark an attempt when final revalidation refuses the send', async () => {
    jest.mocked(getSensorData).mockReturnValue('sensor');
    const dispatched = jest.fn();
    const client = new TestClient({ id: 'WDW' } as Resort);

    await expect(
      client.mutate({
        signal: new AbortController().signal,
        start: async () => {
          throw new RequestNotSent('lease lost');
        },
        onDispatch: dispatched,
      })
    ).rejects.toBeInstanceOf(RequestNotSent);
    expect(dispatched).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('does not mark dispatch when the shared limiter refuses the send', async () => {
    jest.mocked(getSensorData).mockReturnValue('sensor');
    jest.spyOn(RateLimit.prototype, 'enforce').mockImplementation(() => {
      throw new RateLimitExceeded();
    });
    const dispatched = jest.fn();
    const client = new TestClient({ id: 'WDW' } as Resort);

    await expect(
      client.mutate({
        signal: new AbortController().signal,
        onDispatch: dispatched,
      })
    ).rejects.toBeInstanceOf(RateLimitExceeded);
    expect(dispatched).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('keeps the transport alive when an operation is abandoned after dispatch', async () => {
    jest.mocked(getSensorData).mockReturnValue('sensor');
    const response = deferred<{
      ok: true;
      status: 200;
      data: { ok: boolean };
    }>();
    jest.mocked(fetchJson).mockReturnValue(response.promise);
    const operation = new MutationOperation({
      id: 'in-flight',
      kind: 'modify',
      abandonAt: Date.now() + 60_000,
    });
    const client = new TestClient({ id: 'WDW' } as Resort);
    const request = client.mutate({
      signal: operation.signal,
      onDispatch: () => operation.markDispatched(),
    });
    await Promise.resolve();
    expect(fetchJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: operation.signal })
    );

    operation.abandon('stopped');

    expect(operation.signal.aborted).toBe(false);
    response.resolve({ ok: true, status: 200, data: { ok: true } });
    await expect(request).resolves.toMatchObject({ data: { ok: true } });
    operation.settle();
  });
});
