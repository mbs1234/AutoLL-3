export type JsonOK<T = any> = { ok: true; status: number; data: T };

export type JsonResponse<T = any> =
  | JsonOK<T>
  | {
      ok: false;
      status: number;
      data: any;
      /**
       * How long the server asked for before the next request, from its
       * `Retry-After` header. Present only when a failed response sent one we
       * could read: a 429 is Disney asking to slow down, and this is by how
       * much. See `pushback.ts`.
       */
      retryAfterMs?: number;
    };

/**
 * A `Retry-After` header as milliseconds from `now`.
 *
 * The header is either a number of seconds or an HTTP date. Anything else,
 * including no header at all, is undefined rather than a guess: a wait the
 * server never asked for is a policy choice, and belongs with the caller.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now()
): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  // Not seconds, so it has to be an HTTP date, which always names its day and
  // month. Without that test `Date.parse` reads "-5" as a year long past, and
  // a malformed header would mean "ask again at once".
  if (!/[a-z]/i.test(text)) return undefined;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchJson<T = any>(
  url: string,
  init: RequestInit & {
    params?: { [key: string]: string | number };
    data?: unknown;
    timeout?: number;
  } = {}
): Promise<JsonResponse<T>> {
  const { params, data, timeout = DEFAULT_TIMEOUT_MS, ...fetchInit } = init;
  init = fetchInit;
  init.referrer ||= '';
  init.credentials ||= 'omit';
  init.cache ||= 'no-store';
  init.headers = {
    ...(init.headers || {}),
  };
  if (params && Object.keys(params).length > 0) {
    url +=
      (url.includes('?') ? '&' : '?') +
      Object.entries(params)
        .filter(([, v]) => v !== '')
        .map(kv => kv.map(encodeURIComponent).join('='))
        .join('&');
  }
  if (data) {
    init.method ||= 'POST';
    init.headers = {
      ...init.headers,
      'Content-Type': 'application/json',
    };
    init.body = JSON.stringify(data);
  }
  init.method ||= 'GET';

  return checkCache(url, init, async () => {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const externalAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
      externalAbort();
    } else {
      externalSignal?.addEventListener('abort', externalAbort, { once: true });
    }
    init.signal = controller.signal;
    const abort = () => controller.abort();
    // Covers reading the body as well as getting the headers. It used to be
    // cleared the moment `fetch` resolved, which left `response.json()` with no
    // bound at all -- a response whose body stops arriving mid-stream hung the
    // caller indefinitely. That is how an autopilot tick outlived the 90-second
    // deadline that abandons it and then the 120-second lease protecting the
    // reservation it was changing.
    const timeoutId = setTimeout(abort, timeout);

    try {
      const response = await fetch(url, init);
      const retryAfterMs = response.ok
        ? undefined
        : parseRetryAfter(response.headers.get('Retry-After'));
      return {
        ok: response.ok,
        status: response.status,
        data: (response.headers.get('Content-Type') || '').startsWith(
          'application/json'
        )
          ? await response.json()
          : {},
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    } catch (error) {
      // Status 0 for a body that never finished arriving as well as for a
      // request that never got out, and deliberately: both mean the same thing
      // to everything upstream -- the request may have been acted on and the
      // outcome is unknown. `actionWasRejected` reads 0 as "not proven
      // harmless", which is the conservative half of the pair.
      console.error(error);
      return { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', externalAbort);
    }
  });
}

// This cache is only for preventing duplicate requests in React StrictMode
const cache: { [key: string]: Promise<JsonResponse> } = {};

function checkCache(
  url: string,
  init: RequestInit,
  requester: () => Promise<JsonResponse>
) {
  // A controlled mutation owns its cancellation and dispatch identity. Sharing
  // another caller's promise would let one operation abort another and would
  // report two dispatches for one HTTP request, so those requests never use the
  // StrictMode read cache.
  if (init.signal) return requester();
  // StrictMode can issue the same data request twice in immediate succession.
  // The old key was just method + URL, so two POSTs to one endpoint with
  // different bodies could receive each other's response.  Only cache bodies
  // we can represent exactly, and include the headers because callers may use
  // the same endpoint under different request contexts.
  if (init.body !== undefined && typeof init.body !== 'string') {
    return requester();
  }
  const headers = [...new Headers(init.headers).entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const key = JSON.stringify([init.method, url, init.body ?? null, headers]);
  const entry = cache[key];
  if (entry) return entry;
  const response = requester();
  cache[key] = response;
  setTimeout(() => {
    delete cache[key];
  }, 10);
  return response;
}
