import { fetchJson } from './fetch';

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

  it('adds params to URL', async () => {
    await fetchJson(url, { params: { start: 5, end: 15 } });
    expect(fetch).toHaveBeenLastCalledWith(url + '?start=5&end=15', {
      ...init,
      method: 'GET',
    });
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
