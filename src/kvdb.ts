import { parkDate } from './datetime';
import { STORAGE_NAMESPACE, type StorageKey } from './storageNamespace';

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

  /**
   * Every key under this build's namespace, with its raw stored string.
   *
   * For the backup, which is the one caller that needs to enumerate. The store
   * belongs to Disney's website, which keeps data of its own there, and another
   * AutoLL build on the same phone keeps its keys there too -- so this never
   * returns a key outside this build's namespace, and the filter lives here, at
   * the boundary, rather than in each caller.
   */
  entries(): [StorageKey, string][] {
    const out: [StorageKey, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(STORAGE_NAMESPACE)) continue;
      const raw = localStorage.getItem(key);
      if (raw !== null) out.push([key as StorageKey, raw]);
    }
    return out;
  },

  getDaily<T = unknown>(key: StorageKey) {
    const { date, value } = this.get<DailyValue<T>>(key) ?? {};
    return date === parkDate() ? value : undefined;
  },

  setDaily<T = unknown>(key: StorageKey, value: T) {
    this.set<DailyValue<T>>(key, { date: parkDate(), value });
  },
};
