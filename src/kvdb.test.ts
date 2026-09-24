import { modifyDate, parkDate } from '@/datetime';
import { setTime } from '@/testing';

import kvdb from './kvdb';
import { STORAGE_NAMESPACE, storageKey } from './storageNamespace';

jest.spyOn(self, 'setTimeout');

function getItem(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '');
  } catch {
    return undefined;
  }
}

function setItem(key: string, value: any) {
  localStorage.setItem(key, JSON.stringify(value));
}

describe('kvdb', () => {
  const K = storageKey('test.k');
  const AB = storageKey('test.a.b');
  const Z = storageKey('test.z');

  beforeEach(() => {
    localStorage.clear();
    setTime('12:00');
  });

  describe('get()', () => {
    it('gets value from localStorage', () => {
      setItem(K, 'v');
      expect(kvdb.get<string>(K)).toBe('v');
      setItem(AB, { v: 1 });
      expect(kvdb.get<{ v: number }>(AB)).toEqual({ v: 1 });
      expect(kvdb.get(Z)).toBe(undefined);
    });
  });

  describe('set()', () => {
    it('stores value in localStorage', () => {
      kvdb.set<string>(K, 'v');
      expect(getItem(K)).toBe('v');
      kvdb.set<{ v: number }>(AB, { v: 1 });
      expect(getItem(AB)).toEqual({ v: 1 });
    });
  });

  describe('delete', () => {
    it('deletes key from storage', () => {
      setItem(K, 'v');
      kvdb.delete(K);
      expect(getItem(K)).toBe(undefined);
    });
  });

  describe('clear', () => {
    it('clears storage', () => {
      setItem('k1', 'v1');
      setItem('k2', 'v2');
      kvdb.clear();
      expect(localStorage.length).toBe(0);
    });
  });

  describe('getDaily()', () => {
    it('gets daily value from localStorage', () => {
      setItem(AB, { date: parkDate(), value: { v: 1 } });
      expect(kvdb.getDaily<{ v: number }>(AB)).toEqual({ v: 1 });
    });

    it('returns undefined if value nonexistent or set before today', () => {
      expect(kvdb.getDaily(AB)).toBe(undefined);
      setItem(AB, { date: modifyDate(parkDate(), -1), value: { v: 1 } });
      expect(kvdb.getDaily<{ v: number }>(AB)).toBe(undefined);
    });
  });

  describe('setDaily()', () => {
    it('stores daily value', () => {
      kvdb.setDaily<{ v: number }>(AB, { v: 1 });
      expect(kvdb.getDaily(AB)).toEqual({ v: 1 });
      setTime('12:00', 24 * 60);
      expect(kvdb.getDaily(AB)).toBe(undefined);
    });
  });

  // The store is shared with Disney's own site and with any other AutoLL build
  // on the phone. Enumeration is the one operation that could reach their keys,
  // so the namespace filter is enforced here, at the boundary, not per caller.
  describe('entries()', () => {
    beforeEach(() => localStorage.clear());

    it('returns this build’s keys with their raw strings', () => {
      kvdb.set(storageKey('a'), { x: 1 });
      expect(kvdb.entries()).toEqual([[storageKey('a'), '{"x":1}']]);
    });

    it('never returns a key outside this build’s namespace', () => {
      localStorage.setItem('disney.guestSession', 'Disney’s own');
      localStorage.setItem(`not${STORAGE_NAMESPACE}lookalike`, 'x');
      kvdb.set(storageKey('mine'), true);
      expect(kvdb.entries().map(([key]) => key)).toEqual([storageKey('mine')]);
    });
  });
});
