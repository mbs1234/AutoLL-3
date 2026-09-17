import { parkDate } from './datetime';
import type { StorageKey } from './storageNamespace';

interface DailyValue<T> {
  value: T;
  date: string;
}

export default {
  get<T = unknown>(key: StorageKey) {
    const json = localStorage.getItem(key);
    try {
      return JSON.parse(json ?? '') as T;
    } catch {
      return undefined;
    }
  },

  set<T = unknown>(key: StorageKey, value: T) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  delete(key: StorageKey) {
    localStorage.removeItem(key);
  },

  clear() {
    localStorage.clear();
  },

  getDaily<T = unknown>(key: StorageKey) {
    const { date, value } = this.get<DailyValue<T>>(key) ?? {};
    return date === parkDate() ? value : undefined;
  },

  setDaily<T = unknown>(key: StorageKey, value: T) {
    this.set<DailyValue<T>>(key, { date: parkDate(), value });
  },
};
