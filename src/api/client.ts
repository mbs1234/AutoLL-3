import { JsonOK, fetchJson } from '@/fetch';
import { RateLimit } from '@/ratelimit';

import { authStore } from './auth';
import { Resort } from './resort';
import { getSensorData, resetSensorData } from './sensor-data';

export class InvalidOrigin extends Error {
  name = 'InvalidOrigin';
}

export class RequestError extends Error {
  name = 'RequestError';

  constructor(
    public response: Awaited<ReturnType<typeof fetchJson>>,
    message = 'Request failed',
    public path?: string
  ) {
    super(`${message}: ${JSON.stringify(response)}`);
  }
}

/** A controlled mutation was cancelled before any HTTP request was started. */
export class RequestNotSent extends Error {
  readonly name = 'RequestNotSent';
}

/**
 * Control supplied only for a mutating request.
 *
 * `start` is called after sensor generation, with a closure that starts the
 * actual fetch synchronously. A lease owner can therefore revalidate and invoke
 * that closure inside one Web Locks critical section; checking before `book()`
 * is too early because sensor generation is itself asynchronous.
 */
export interface RequestControl {
  /** Required so every controlled mutation has unique cancellation/identity. */
  signal: AbortSignal;
  start?: <T>(send: () => Promise<T>) => Promise<T>;
  /** The last instruction immediately before `fetchJson` is invoked. */
  onDispatch?: () => void;
}

/** Await work that cannot itself be cancelled without letting it delay us. */
async function abortable<T>(
  body: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return body;
  if (signal.aborted) throw new RequestNotSent('Request cancelled before send');
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new RequestNotSent('Request cancelled before send'));
    signal.addEventListener('abort', abort, { once: true });
    void body.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

export abstract class ApiClient {
  protected resort: Resort;
  protected origin: string;
  protected rateLimit = new RateLimit(5);

  protected static origins = {
    WDW: 'https://disneyworld.disney.go.com',
  };

  static originToResortId(origin: string): Resort['id'] {
    const entries = Object.entries(this.origins) as [Resort['id'], string][];
    const id = entries.find(([, o]) => o === origin)?.[0];
    if (id) return id;
    throw new InvalidOrigin(origin);
  }

  constructor(resort: Resort) {
    this.resort = resort;
    this.origin = (this.constructor as typeof ApiClient).origins[
      this.resort.id
    ];
  }

  protected async request<T = any>(request: {
    path: string;
    method?: 'GET' | 'POST' | 'DELETE';
    params?: { [key: string]: string };
    data?: unknown;
    key?: string;
    /**
     * Only itinerary refresh uses this. A transient 401 there should be
     * surfaced to its caller rather than logging out a healthy foreground
     * session; every booking-capable request must retain the default.
     */
    ignoreUnauth?: 'itinerary-refresh';
    sensorData?: boolean;
    control?: RequestControl;
  }): Promise<JsonOK<T>> {
    const { swid, accessToken } = authStore.getData();
    let sensorHeaders: Record<string, string> = {};
    if (request.sensorData) {
      const sd = getSensorData();
      sensorHeaders = {
        'x-acf-sensor-data':
          typeof sd === 'string'
            ? sd
            : await abortable(sd, request.control?.signal),
        'x-app-id': 'ANDROID',
      };
    }
    const url = this.origin + request.path;
    const send = () => {
      if (request.control?.signal?.aborted) {
        throw new RequestNotSent('Request cancelled before send');
      }
      // Admission belongs to the same boundary as the request itself. Sensor
      // generation can wait on a first-use module download, so charging the
      // limiter before it let cancelled work consume capacity and let calls
      // admitted in different seconds bunch into one burst when the sensor
      // finally became ready.
      this.rateLimit.enforce();
      request.control?.onDispatch?.();
      return fetchJson(url, {
        method: request.method,
        params: request.params,
        data: request.data,
        signal: request.control?.signal,
        headers: {
          'Accept-Language': 'en-US',
          Authorization: `BEARER ${accessToken}`,
          'x-user-id': swid,
          ...sensorHeaders,
        },
      });
    };
    const res = request.control?.start
      ? await request.control.start(send)
      : await send();
    if (request.sensorData && res.status === 403) {
      resetSensorData();
    } else if (res.status === 401 && !request.ignoreUnauth) {
      setTimeout(() => authStore.deleteData());
    } else {
      const { key } = request;
      if (res.ok && (!key || res.data[key])) {
        return { ...res, data: key ? res.data[key] : res.data };
      }
    }
    throw new RequestError(res, 'Request failed', request.path);
  }
}
