import kvdb from '@/kvdb';
import { TODAY, setTime } from '@/testing';

import {
  AUTH_KEY,
  AUTH_PERSISTENCE_KEY,
  AuthStore,
  ReauthNeeded,
} from './auth';

setTime('12:30');

const store = new AuthStore();

let tokenId = 0;
function makeData(timestamp: number) {
  return {
    swid: '{SWID}',
    accessToken: `token-${++tokenId}`,
    expires: new Date(timestamp).getTime(),
    resortId: 'WDW' as const,
    version: 1 as const,
    receivedAt: Date.now(),
  };
}

function setData(timestamp: number) {
  const data = makeData(timestamp);
  store.setData(data);
  return data;
}

describe('AuthStore', () => {
  beforeEach(() => {
    store.deleteData();
    kvdb.delete(AUTH_PERSISTENCE_KEY);
    store.setExpectedResort(undefined);
  });

  describe('getData()', () => {
    it('returns unexpired auth data', () => {
      const { swid, accessToken } = setData(Date.now() + 86400_000);
      expect(store.getData()).toEqual({ swid, accessToken });
    });

    it('throws ReauthNeeded when expired', () => {
      setData(Date.now() - 1);
      expect(() => store.getData()).toThrow(ReauthNeeded);
    });

    it('throws ReauthNeeded when expires today before 5 PM', () => {
      setData(new Date(`${TODAY}T16:59:59-0400`).getTime());
      expect(() => store.getData()).toThrow(ReauthNeeded);
    });

    it('rejects malformed data', () => {
      kvdb.set(AUTH_KEY, { accessToken: 'token' });
      expect(() => store.getData()).toThrow(ReauthNeeded);
    });
  });

  describe('setData()', () => {
    it('stores auth data', () => {
      const data = makeData(Date.now() + 86400_000);
      store.setData(data);
      expect(kvdb.get(AUTH_KEY)).toEqual(data);
    });
  });

  /**
   * A failed write must not throw the token away.
   *
   * This bundle runs injected into a Disney page and shares that origin's
   * localStorage quota with Disney's own app, so a QuotaExceededError on sign-in
   * is a live possibility. `setData` cleared the in-memory copy and then wrote,
   * so a throw left the token held nowhere at all: a sign-in that had just
   * succeeded behaved exactly like one that never happened.
   */
  describe('setData() when storage refuses the write', () => {
    /** Make persistent writes fail the way a full quota does. */
    function breakWrites() {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new DOMException('quota', 'QuotaExceededError');
      };
      return () => {
        Storage.prototype.setItem = original;
      };
    }

    it('does not throw', () => {
      const restore = breakWrites();
      try {
        expect(() =>
          store.setData(makeData(Date.now() + 86400_000))
        ).not.toThrow();
      } finally {
        restore();
      }
    });

    it('keeps the session usable from memory', () => {
      const restore = breakWrites();
      try {
        const data = makeData(Date.now() + 86400_000);
        store.setData(data);
        expect(store.getData().accessToken).toBe(data.accessToken);
      } finally {
        restore();
      }
    });

    // The normal path is unchanged: once written, the persistent copy is
    // authoritative, so an in-memory copy cannot shadow a newer token another
    // tab wrote.
    it('leaves nothing in memory when the write succeeds', () => {
      const data = setData(Date.now() + 86400_000);
      expect(kvdb.get(AUTH_KEY)).toEqual(data);
      kvdb.delete(AUTH_KEY);
      expect(() => store.getData()).toThrow(ReauthNeeded);
    });
  });

  describe('deleteData()', () => {
    it('deletes auth data', () => {
      setData(Date.now() + 86400_000);
      store.deleteData();
      expect(() => store.getData()).toThrow(ReauthNeeded);
    });
  });

  it('keeps a session-only result out of localStorage', () => {
    store.setPersistence('session');
    const data = setData(Date.now() + 86400_000);
    expect(kvdb.get(AUTH_KEY)).toBeUndefined();
    expect(store.getData()).toEqual({
      swid: data.swid,
      accessToken: data.accessToken,
    });
  });

  it('notifies once when several calls invalidate the same session', () => {
    jest.useFakeTimers();
    const onUnauthorized = jest.fn();
    store.onUnauthorized = onUnauthorized;
    setData(Date.now() + 86400_000);
    store.deleteData();
    store.deleteData();
    jest.runAllTimers();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
