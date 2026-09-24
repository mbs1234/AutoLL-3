import { AUTH_KEY } from '@/api/auth';
import { APP_NAME, BUILD_REV } from '@/appIdentity';
import kvdb from '@/kvdb';
import { PARTY_IDS_KEY } from '@/savedParty';
import {
  NEXTLL_WATCHLIST_KEY,
  STARRED_KEY,
  STORAGE_NAMESPACE,
  type StorageKey,
  storageKey,
} from '@/storageNamespace';

import {
  COVERAGE_KEY,
  EVENTS_KEY,
  WATCHED_KEY,
  loadCoverage,
  loadDropEvents,
  loadWatchedDays,
  mergeCoverage,
  mergeDropEvents,
  mergeWatchedDays,
  parseCoverage,
  parseDropEvents,
  parseWatchedDays,
  saveCoverage,
  saveWatchedDays,
} from './observe';
import { anyRunning } from './running';
import { WATCHLIST_KEY, parseWatchList, saveWatchList } from './watchlist';

/**
 * A backup of everything this build keeps on the phone, except the sign-in.
 *
 * Everything this build knows lives in `localStorage` on Disney's origin, and
 * Safari deletes a site's script-writable storage after seven days of Safari
 * use without a visit. Nothing else gets any of it off the phone. The learned
 * drop times a park trip produces are the ones the next trip uses, weeks later,
 * so a phone that goes a week without opening this app loses them -- and the
 * plan with them -- and nothing says so. ROADMAP item 12.
 *
 * Export is deliberately generous and restore deliberately narrow: a backup
 * holds every key, and a restore writes seven of them. See `restoreBackup`.
 */

/** Recognises a file as one of these, before anything else in it is trusted. */
export const BACKUP_FORMAT = 'autoll-backup';

/**
 * Bumped whenever the shape of a backup changes, so a restore can refuse a file
 * written by a newer build instead of guessing at it.
 */
export const BACKUP_SCHEMA = 1;

/**
 * When this phone last completed a backup. This phone's own record: it is
 * exported with everything else, and never restored.
 */
export const LAST_BACKUP_KEY = storageKey('backup.lastAt');

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schema: number;
  /** The build that wrote it. A restore refuses another build's file. */
  app: string;
  rev: string;
  exportedAt: string;
  /**
   * Keyed by the part of each key after the namespace, so a restore maps it
   * into its own build's namespace rather than writing another build's keys.
   */
  data: Record<string, unknown>;
}

/**
 * Never in a backup: the sign-in, and anything else in its family.
 *
 * `auth` holds a live Disney OneID token. `SECURITY.md` already says not to
 * share "browser storage exports" for exactly this reason, and a file on a share
 * sheet can end up in iCloud, Mail or Messages. The whole `auth.` family is
 * excluded rather than a list of known keys, so a sign-in key added later is
 * kept out without anyone remembering to add it here.
 */
function isSignIn(key: string): boolean {
  return key === AUTH_KEY || key.startsWith(`${AUTH_KEY}.`);
}

/** Parsed where it is JSON, which is everything written through `kvdb`. */
function readValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Gather this build's keys into a backup: everything under its own namespace,
 * except the sign-in.
 */
export function createBackup(now: Date = new Date()): Backup {
  const data: Record<string, unknown> = {};
  // `kvdb.entries` returns only this build's namespace; see its comment.
  for (const [key, raw] of kvdb.entries()) {
    if (isSignIn(key)) continue;
    data[key.slice(STORAGE_NAMESPACE.length)] = readValue(raw);
  }
  return {
    format: BACKUP_FORMAT,
    schema: BACKUP_SCHEMA,
    app: APP_NAME,
    rev: BUILD_REV,
    exportedAt: now.toISOString(),
    data,
  };
}

/** What a backup holds, in the terms a person checks it by. */
export interface BackupSummary {
  targets: number;
  dates: number;
  parks: number;
  party: number;
  drops: number;
  daysWatched: number;
}

const suffix = (key: string) => key.slice(STORAGE_NAMESPACE.length);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/**
 * Count what a backup's data holds.
 *
 * Tolerant of anything, because the same function will describe a file someone
 * picked for a restore before a single field of it has been validated.
 */
export function summarize(data: Record<string, unknown>): BackupSummary {
  const targets = asArray(data[suffix(WATCHLIST_KEY)]).filter(isRecord);
  const distinct = (field: string) =>
    new Set(targets.map(t => t[field]).filter(v => typeof v === 'string')).size;
  const watched = data[suffix(WATCHED_KEY)];
  return {
    targets: targets.length,
    dates: distinct('date'),
    parks: distinct('parkId'),
    party: asArray(data[suffix(PARTY_IDS_KEY)]).length,
    drops: asArray(data[suffix(EVENTS_KEY)]).length,
    daysWatched: isRecord(watched) ? Object.keys(watched).length : 0,
  };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** One line for a screen. Parts with nothing in them are left out. */
export function describeSummary(s: BackupSummary): string {
  const parts: string[] = [];
  if (s.targets > 0) {
    const where = [
      s.dates > 0 ? plural(s.dates, 'date') : '',
      s.parks > 0 ? plural(s.parks, 'park') : '',
    ]
      .filter(Boolean)
      .join(' at ');
    parts.push(
      `${plural(s.targets, 'attraction')}${where ? ` for ${where}` : ''}`
    );
  }
  if (s.party > 0) parts.push(`a party of ${s.party}`);
  if (s.drops > 0 || s.daysWatched > 0) {
    // Watched days got their own store after drops were already being kept, so
    // an older phone can hold drops and no watched days -- say only what is known.
    parts.push(
      s.daysWatched > 0
        ? `${plural(s.drops, 'drop')} seen over ${plural(s.daysWatched, 'day')} watched`
        : `${plural(s.drops, 'drop')} seen`
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nothing saved yet.';
}

/** `{APP_NAME} backup 2031-02-14.json`, in the phone's own calendar. */
export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${APP_NAME} backup ${day}.json`;
}

export function lastBackupAt(): Date | undefined {
  const stamp = kvdb.get<unknown>(LAST_BACKUP_KEY);
  if (typeof stamp !== 'string') return undefined;
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

export function recordBackup(now: Date = new Date()): void {
  kvdb.set<string>(LAST_BACKUP_KEY, now.toISOString());
}

const DAY_MS = 86_400_000;

/** Reads after "Last backup: " -- never, today, yesterday, 12 days ago. */
export function describeLastBackup(
  at: Date | undefined,
  now: Date = new Date()
): string {
  if (!at) return 'never';
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded';

/**
 * Hand a backup to the share sheet, or download it where sharing a file is not
 * available.
 *
 * **Call this directly from a tap.** iOS opens the share sheet only as the
 * direct result of a user gesture, so nothing may be awaited before
 * `navigator.share` is reached -- which is why everything up to that call is
 * synchronous, and why this runs from its own screen rather than from the
 * Settings menu, whose items run fifty milliseconds after the menu closes.
 */
export async function shareBackup(
  backup: Backup,
  now: Date = new Date()
): Promise<ShareOutcome> {
  const name = backupFileName(now);
  const file = new File([JSON.stringify(backup, null, 2)], name, {
    type: 'application/json',
  });
  if (
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (error) {
      // Closing the sheet is a choice, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
      throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a delay: revoking straight after click() can cancel a download
  // the browser has not started reading yet.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

// ---------------------------------------------------------------------------
// Restore.

/**
 * The plan: what a restore **replaces**. The owner chose replace over merge, so
 * after a restore this phone has the file's plan -- not a blend of two -- and a
 * part the file does not have is cleared rather than kept.
 */
export const RESTORED_PLAN_KEYS: readonly StorageKey[] = [
  WATCHLIST_KEY,
  NEXTLL_WATCHLIST_KEY,
  PARTY_IDS_KEY,
  STARRED_KEY,
];

/**
 * What the learner has seen: what a restore **merges**. Both are evidence, so
 * the union is kept, under the learner's own caps.
 */
export const MERGED_LEARNING_KEYS: readonly StorageKey[] = [
  EVENTS_KEY,
  COVERAGE_KEY,
  WATCHED_KEY,
];

/**
 * Every key a restore may write. An allowlist, deliberately: the sign-in, the
 * engine's state (leases, locks, doubts, commits, a pending search), dry run and
 * the other settings, the day's park and date, and this phone's own record of
 * its last backup are all never written -- and a key added later is never
 * written either, until someone decides it should be.
 */
export const RESTORED_KEYS: readonly StorageKey[] = [
  ...RESTORED_PLAN_KEYS,
  ...MERGED_LEARNING_KEYS,
];

export type BackupReading =
  | { ok: true; backup: Backup }
  | { ok: false; reason: string };

/**
 * Check a picked file before anything in it is trusted. Refuses anything that
 * is not one of these backups, a backup from a newer schema (rather than guess
 * at it), and another build's backup (its keys would be the wrong namespace's).
 */
export function readBackup(text: string): BackupReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: `That file isn't an ${APP_NAME} backup.` };
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT) {
    return { ok: false, reason: `That file isn't an ${APP_NAME} backup.` };
  }
  const { schema, app, rev, exportedAt, data } = parsed;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return { ok: false, reason: 'That backup is damaged: it has no version.' };
  }
  if (schema > BACKUP_SCHEMA) {
    return {
      ok: false,
      reason: `That backup was made by a newer version of ${APP_NAME}. Update this one first.`,
    };
  }
  if (app !== APP_NAME) {
    return {
      ok: false,
      reason: `That backup is from ${typeof app === 'string' ? app : 'another build'}, not ${APP_NAME}.`,
    };
  }
  if (!isRecord(data)) {
    return { ok: false, reason: 'That backup is damaged: it holds no data.' };
  }
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      schema,
      app,
      rev: typeof rev === 'string' ? rev : '',
      exportedAt: typeof exportedAt === 'string' ? exportedAt : '',
      data,
    },
  };
}

const strings = (value: unknown): string[] =>
  asArray(value).filter((v): v is string => typeof v === 'string');

/**
 * Put a checked backup back on this phone: replace the plan, merge what the
 * learner has seen, and write nothing else. Nothing is ever cleared wholesale --
 * the store belongs to Disney's website -- and if any write fails, every key
 * this touched is put back as it was, so a restore lands whole or not at all.
 *
 * Refuses while any engine runs: each holds its plan in memory and would write
 * it back over this. The page must reload afterwards for the same reason --
 * every screen already open still holds the plan it loaded.
 */
export function restoreBackup({ data }: Backup): void {
  if (anyRunning()) {
    throw new Error('Turn off Autopilot, and stop any Time Search, first.');
  }
  const has = (key: StorageKey) => Object.hasOwn(data, suffix(key));
  const from = (key: StorageKey) => data[suffix(key)];
  const before = RESTORED_KEYS.map(key => [key, kvdb.get(key)] as const);
  try {
    for (const key of [WATCHLIST_KEY, NEXTLL_WATCHLIST_KEY]) {
      if (has(key)) saveWatchList(parseWatchList(from(key)), key);
      else kvdb.delete(key);
    }
    for (const key of [PARTY_IDS_KEY, STARRED_KEY]) {
      if (has(key)) kvdb.set<string[]>(key, strings(from(key)));
      else kvdb.delete(key);
    }
    kvdb.set(
      EVENTS_KEY,
      mergeDropEvents(loadDropEvents(), parseDropEvents(from(EVENTS_KEY)))
    );
    saveCoverage(
      mergeCoverage(loadCoverage(), parseCoverage(from(COVERAGE_KEY)))
    );
    saveWatchedDays(
      mergeWatchedDays(loadWatchedDays(), parseWatchedDays(from(WATCHED_KEY)))
    );
  } catch (error) {
    for (const [key, value] of before) {
      if (value === undefined) kvdb.delete(key);
      else kvdb.set(key, value);
    }
    throw error;
  }
}

/** A picked file's text. `FileReader` rather than `Blob.text()`, which older Safari lacks. */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unreadable file'));
    reader.readAsText(file);
  });
}
