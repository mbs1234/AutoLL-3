import { fetchJson, parseRetryAfter } from './fetch';

jest.useFakeTimers();
self.fetch = jest.fn();

function mockFetch(body: any, headers: { [name: string]: string } = {}) {
  headers = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: () => body,
  } as Response);
}

const url = 'https://example.com/';
const signal = expect.any(AbortSignal);
const init = {
  headers: {},
  cache: 'no-store',
  credentials: 'omit',
  referrer: '',
  signal,
};

describe('fetchJson()', () => {
  beforeEach(() => {
    jest.advanceTimersByTime(10);
  });

  it('returns response', async () => {
    mockFetch({ a: 1 }, { 'content-type': 'application/json' });
    expect(await fetchJson(url)).toEqual({
      ok: true,
      status: 200,
      data: { a: 1 },
    });
  });

  it('returns empty data object for non-JSON response', async () => {
    mockFetch(null);
    expect(await fetchJson(url)).toEqual({ ok: true, status: 200, data: {} });
  });

  it('uses POST if method not specified and data included', async () => {
    const data = { name: 'Mickey' };
    await fetchJson(url, { data });
    expect(fetch).toHaveBeenLastCalledWith(url, {
      method: 'POST',
      body: JSON.stringify(data),
      ...init,
      headers: { ...init.headers, 'Content-Type': 'application/json' },
    });
  });

  it('does not share cached POST responses with a different body', async () => {
    jest.mocked(fetch).mockClear();
    mockFetch({ ok: true }, { 'content-type': 'application/json' });
    await Promise.all([
      fetchJson(url, { data: { name: 'Mickey' } }),
      fetchJson(url, { data: { name: 'Minnie' } }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not share a controlled mutation response between abort signals', async () => {
    jest.mocked(fetch).mockClear();
    mockFetch({ ok: true }, { 'content-type': 'application/json' });
    const first = new AbortController();
    const second = new AbortController();
    await Promise.all([
      fetchJson(url, { data: { name: 'Mickey' }, signal: first.signal }),
      fetchJson(url, { data: { name: 'Mickey' }, signal: second.signal }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('adds params to URL', async () => {
    await fetchJson(url, { params: { start: 5, end: 15 } });
    expect(fetch).toHaveBeenLastCalledWith(url + '?start=5&end=15', {
      ...init,
      method: 'GET',
    });
  });

  // A 429 is Disney asking to slow down, and Retry-After is by how much.
  // Dropped, the app could only guess at a wait Disney had already stated.
  function mockFailure(status: number, headers: { [name: string]: string }) {
    const lower = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    jest.mocked(fetch).mockResolvedValue({
      ok: false,
      status,
      headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
      json: () => ({}),
    } as unknown as Response);
  }

  it('carries a failed response’s Retry-After, in milliseconds', async () => {
    mockFailure(429, { 'Retry-After': '120' });
    expect(await fetchJson(url)).toEqual({
      ok: false,
      status: 429,
      data: {},
      retryAfterMs: 120_000,
    });
  });

  it('leaves Retry-After out when the header cannot be read', async () => {
    mockFailure(429, { 'Retry-After': 'soon' });
    expect(await fetchJson(url)).toEqual({ ok: false, status: 429, data: {} });
  });

  it('ignores Retry-After on a response that succeeded', async () => {
    mockFetch({}, { 'Retry-After': '120' });
    expect(await fetchJson(url)).toEqual({ ok: true, status: 200, data: {} });
  });

  it('returns status=0 response on timeout', async () => {
    jest.spyOn(console, 'error').mockImplementationOnce(() => null);
    const timeout = 5000;
    jest.mocked(fetch).mockImplementationOnce(((
      url: string,
      init: RequestInit
    ) => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (init.signal?.aborted) {
            reject('aborted');
          } else {
            resolve({ ok: true, status: 200 } as Response);
          }
        }, timeout);
      });
    }) as typeof fetch);
    const promise = fetchJson(url, { timeout });
    jest.advanceTimersByTime(timeout);
    expect(await promise).toEqual({ ok: false, status: 0, data: null });
  });

  it('returns status=0 when its caller aborts after dispatch', async () => {
    jest.spyOn(console, 'error').mockImplementationOnce(() => null);
    jest.mocked(fetch).mockImplementationOnce(
      ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject('aborted'));
        })) as typeof fetch
    );
    const controller = new AbortController();
    const promise = fetchJson(url, { signal: controller.signal });
    controller.abort('stopped');
    expect(await promise).toEqual({ ok: false, status: 0, data: null });
  });

  /*
   * The timeout has to cover reading the body, not just getting the headers.
   *
   * It used to be cleared the moment `fetch` resolved, so a response whose body
   * stopped arriving mid-stream hung the caller with no bound at all. That is
   * how an autopilot tick outlived the 90-second deadline that abandons it and
   * then the 120-second lease protecting the reservation it was changing -- at
   * which point another actor could take a reservation with a request still in
   * the air against it.
   *
   * Status 0 rather than a throw, and deliberately: it means the same thing to
   * everything upstream as a request that never got out -- this may have been
   * acted on and the outcome is unknown -- and `actionWasRejected` reads 0 as
   * "not proven harmless", which is the conservative half of that pair.
   */
  it('returns status=0 when the body never finishes arriving', async () => {
    jest.spyOn(console, 'error').mockImplementationOnce(() => null);
    const timeout = 5000;
    jest.mocked(fetch).mockImplementationOnce(((
      _url: string,
      init: RequestInit
    ) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject('aborted'));
          }),
      } as unknown as Response)) as typeof fetch);
    const promise = fetchJson(url, { timeout });
    await Promise.resolve();
    jest.advanceTimersByTime(timeout);
    expect(await promise).toEqual({ ok: false, status: 0, data: null });
  });
});

describe('parseRetryAfter()', () => {
  const now = Date.UTC(2031, 1, 17, 15, 0, 0);

  it('reads a number of seconds', () => {
    expect(parseRetryAfter('90', now)).toBe(90_000);
  });

  it('reads an HTTP date as the time until it', () => {
    expect(parseRetryAfter('Mon, 17 Feb 2031 15:02:30 GMT', now)).toBe(150_000);
  });

  it('never waits a negative time for a date already past', () => {
    expect(parseRetryAfter('Mon, 17 Feb 2031 14:00:00 GMT', now)).toBe(0);
  });

  it.each([null, undefined, '', '  ', 'soon', '-5'])(
    'reads %p as no instruction at all',
    value => {
      expect(parseRetryAfter(value, now)).toBeUndefined();
    }
  );
});
