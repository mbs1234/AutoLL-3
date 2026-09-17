export type JsonOK<T = any> = { ok: true; status: number; data: T };

export type JsonResponse<T = any> =
  | JsonOK<T>
  | { ok: false; status: number; data: any };

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
      return {
        ok: response.ok,
        status: response.status,
        data: (response.headers.get('Content-Type') || '').startsWith(
          'application/json'
        )
          ? await response.json()
          : {},
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
