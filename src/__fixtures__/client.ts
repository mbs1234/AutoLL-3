import { authStore } from '@/api/auth';
import { fetchJson } from '@/fetch';

jest.mock('@/fetch');
jest.mock('@/api/sensor-data');

export const accessToken = 'ACCESS_TOKEN';
export const swid = 'SWID';
jest.spyOn(authStore, 'getData').mockReturnValue({ accessToken, swid });

export function response(data: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, data: { ...data } };
}

export function respond(...responses: ReturnType<typeof response>[]) {
  for (const res of responses) {
    jest.mocked(fetchJson).mockResolvedValueOnce(res);
  }
}

export function expectFetch(
  path: string,
  { method, params, data }: Parameters<typeof fetchJson>[1] = {},
  appendUserId = false,
  nthCall = 1
) {
  if (appendUserId) params = { ...params, userId: swid };
  expect(fetchJson).toHaveBeenNthCalledWith(
    nthCall,
    expect.stringContaining(expectFetch.baseUrl + path),
    {
      method,
      params,
      data,
      // Individual clients may add request-specific headers (for example the
      // LL client adds its app id and sensor header). This shared helper owns
      // the authentication contract, while endpoint tests assert their own
      // additional request semantics.
      headers: expect.objectContaining({
        'Accept-Language': 'en-US',
        Authorization: `BEARER ${accessToken}`,
        'x-user-id': swid,
      }),
    }
  );
}

expectFetch.baseUrl = 'https://disneyworld.disney.go.com';
