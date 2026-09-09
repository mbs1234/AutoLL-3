import { DateTime, ParkTime } from '@/datetime';
import kvdb from '@/kvdb';

import { Resort } from './resort';

export const AUTH_KEY = 'autoll3.auth';
export const AUTH_PERSISTENCE_KEY = 'autoll3.auth.persistence';
const AUTH_VERSION = 1;

export type AuthPersistence = 'persistent' | 'session';

export interface AuthData {
  swid: string;
  accessToken: string;
  expires: number;
  /** Identifies the OneID client that issued this result. */
  resortId: Resort['id'];
  /** Lets a future format change fail closed instead of guessing. */
  version: typeof AUTH_VERSION;
  receivedAt: number;
}

export type AuthStatus =
  | 'valid'
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'expires-before-park-close'
  | 'wrong-resort';

export class ReauthNeeded extends Error {
  name = 'ReauthNeeded';
  readonly status: AuthStatus;

  constructor(status: AuthStatus = 'missing') {
    super(`Auth data ${status}`);
    this.status = status;
  }
}

function isResortId(value: unknown): value is Resort['id'] {
  return value === 'WDW';
}

function isAuthData(value: unknown): value is AuthData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AuthData>;
  return (
    typeof data.swid === 'string' &&
    data.swid.length > 0 &&
    typeof data.accessToken === 'string' &&
    data.accessToken.length > 0 &&
    typeof data.expires === 'number' &&
    Number.isFinite(data.expires) &&
    typeof data.receivedAt === 'number' &&
    Number.isFinite(data.receivedAt) &&
    data.version === AUTH_VERSION &&
    isResortId(data.resortId)
  );
}

/** Stores only the OneID result needed by Disney's authenticated APIs. */
export class AuthStore {
  onUnauthorized: () => void = () => undefined;
  private sessionData: AuthData | undefined;
  private expectedResort: Resort['id'] | undefined;
  private reauthNotified = false;

  setExpectedResort(resortId: Resort['id'] | undefined): void {
    this.expectedResort = resortId;
  }

  getPersistence(): AuthPersistence {
    return kvdb.get<AuthPersistence>(AUTH_PERSISTENCE_KEY) === 'session'
      ? 'session'
      : 'persistent';
  }

  /**
   * Session-only mode keeps the current result in memory and removes the
   * durable copy. It is a privacy choice, not a defence against a script
   * already executing on this origin.
   */
  setPersistence(persistence: AuthPersistence): void {
    kvdb.set(AUTH_PERSISTENCE_KEY, persistence);
    if (persistence === 'session') {
      this.sessionData = this.readPersistent();
      kvdb.delete(AUTH_KEY);
    } else if (this.sessionData) {
      kvdb.set(AUTH_KEY, this.sessionData);
      this.sessionData = undefined;
    }
  }

  getStatus(): AuthStatus {
    const data = this.readData();
    if (!data) return 'missing';
    if (!isAuthData(data)) return 'invalid';
    if (this.expectedResort && data.resortId !== this.expectedResort) {
      return 'wrong-resort';
    }
    const exp = DateTime.from(data.expires);
    const now = DateTime.now();
    if (exp <= now) return 'expired';
    if (exp.date === now.date && exp.time < new ParkTime(17)) {
      return 'expires-before-park-close';
    }
    return 'valid';
  }

  getData(): Pick<AuthData, 'swid' | 'accessToken'> {
    const status = this.getStatus();
    const data = this.readData();
    if (status === 'valid' && data && isAuthData(data)) {
      return { swid: data.swid, accessToken: data.accessToken };
    }
    this.invalidate();
    throw new ReauthNeeded(status);
  }

  setData(data: AuthData): void {
    if (!isAuthData(data)) throw new ReauthNeeded('invalid');
    this.reauthNotified = false;
    if (this.getPersistence() === 'session') {
      this.sessionData = data;
      kvdb.delete(AUTH_KEY);
    } else {
      this.sessionData = undefined;
      kvdb.set(AUTH_KEY, data);
    }
  }

  deleteData(): void {
    this.invalidate();
  }

  private readPersistent(): AuthData | undefined {
    return kvdb.get<AuthData>(AUTH_KEY);
  }

  private readData(): AuthData | undefined {
    return this.sessionData ?? this.readPersistent();
  }

  /** Coalesces a burst of 401s into one transition back to login. */
  private invalidate(): void {
    this.sessionData = undefined;
    kvdb.delete(AUTH_KEY);
    if (!this.reauthNotified) {
      this.reauthNotified = true;
      setTimeout(this.onUnauthorized);
    }
  }
}

export const authStore = new AuthStore();
