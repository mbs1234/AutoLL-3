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
  }): Promise<JsonOK<T>> {
    this.rateLimit.enforce();
    const { swid, accessToken } = authStore.getData();
    let sensorHeaders: Record<string, string> = {};
    if (request.sensorData) {
      const sd = getSensorData();
      sensorHeaders = {
        'x-acf-sensor-data': typeof sd === 'string' ? sd : await sd,
        'x-app-id': 'ANDROID',
      };
    }
    const url = this.origin + request.path;
    const res = await fetchJson(url, {
      method: request.method,
      params: request.params,
      data: request.data,
      headers: {
        'Accept-Language': 'en-US',
        Authorization: `BEARER ${accessToken}`,
        'x-user-id': swid,
        ...sensorHeaders,
      },
    });
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
