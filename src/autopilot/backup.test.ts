import { AUTH_KEY, AUTH_PERSISTENCE_KEY } from '@/api/auth';
import { APP_NAME, BUILD_REV } from '@/appIdentity';
import { PARTY_IDS_KEY } from '@/savedParty';
import {
  BOOKING_DATE_KEY,
  NEXTLL_WATCHLIST_KEY,
  PARK_KEY,
  PLAN_CHECK_REVIEW_KEY,
  STARRED_KEY,
  STORAGE_NAMESPACE,
  storageKey,
} from '@/storageNamespace';
import { TODAY, TOMORROW, YESTERDAY } from '@/testing';

import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA,
  type Backup,
  LAST_BACKUP_KEY,
  RESTORED_KEYS,
  backupFileName,
  createBackup,
  describeLastBackup,
  describeSummary,
  lastBackupAt,
  readBackup,
  readFileText,
  recordBackup,
  restoreBackup,
  shareBackup,
  summarize,
} from './backup';
import { LEASE_KEY, QUARANTINE_KEY } from './lease';
import { NEXTLL_PENDING_KEY } from './nextll';
import {
  COVERAGE_KEY,
  EVENTS_KEY,
  WATCHED_KEY,
  coverageKey,
  loadCoverage,
  loadDropEvents,
  loadWatchedDays,
} from './observe';
import { markRunning } from './running';
import { COMMITS_KEY, LOCKS_KEY, LOG_KEY, SETTINGS_KEY } from './storage';
import { WATCHLIST_KEY, loadWatchList } from './watchlist';

// Every key in this file comes from `storageKey` or `STORAGE_NAMESPACE`, never
// a spelled-out prefix, so the file passes unchanged in the sibling build that
// this code ports to by merge.
const suffix = (key: string) => key.slice(STORAGE_NAMESPACE.length);

const TOKEN = 'eyJ-a-live-disney-session-token';

function seedPhone() {
  localStorage.setItem(
    WATCHLIST_KEY,
    JSON.stringify([
      { experienceId: 'a', parkId: 'mk', date: TODAY },
      { experienceId: 'b', parkId: 'mk', date: TODAY },
      { experienceId: 'c', parkId: 'ep', date: TOMORROW },
    ])
  );
  localStorage.setItem(PARTY_IDS_KEY, JSON.stringify(['g1', 'g2', 'g3', 'g4']));
  localStorage.setItem(
    EVENTS_KEY,
    JSON.stringify([
      {
        experienceId: 'a',
        date: YESTERDAY,
        time: '09:47',
        kind: 'appeared',
      },
      {
        experienceId: 'a',
        date: TODAY,
        time: '09:44',
        kind: 'appeared',
      },
    ])
  );
  localStorage.setItem(
    WATCHED_KEY,
    JSON.stringify({ [YESTERDAY]: ['a'], [TODAY]: ['a'] })
  );
  localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: TOKEN }));
  localStorage.setItem(AUTH_PERSISTENCE_KEY, JSON.stringify('persistent'));
}

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

describe('createBackup()', () => {
  it('gathers every key under this build’s namespace, by its suffix', () => {
    seedPhone();
    const { data } = createBackup();
    expect(data[suffix(WATCHLIST_KEY)]).toHaveLength(3);
    expect(data[suffix(PARTY_IDS_KEY)]).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(data[suffix(EVENTS_KEY)]).toHaveLength(2);
    expect(data[suffix(WATCHED_KEY)]).toEqual({
      [YESTERDAY]: ['a'],
      [TODAY]: ['a'],
    });
  });

  // The one rule that must never break. The token is a live Disney session,
  // and a file on a share sheet can end up anywhere.
  it('never includes the sign-in', () => {
    seedPhone();
    const backup = createBackup();
    expect(Object.keys(backup.data)).not.toContain(suffix(AUTH_KEY));
    expect(Object.keys(backup.data)).not.toContain(
      suffix(AUTH_PERSISTENCE_KEY)
    );
    expect(JSON.stringify(backup)).not.toContain(TOKEN);
  });

  // A sign-in key added later must be kept out without anyone remembering to
  // come back here, which is why the rule is the whole family, not a list.
  it('keeps out a sign-in key it has never heard of', () => {
    localStorage.setItem(`${AUTH_KEY}.refresh`, JSON.stringify(TOKEN));
    expect(JSON.stringify(createBackup())).not.toContain(TOKEN);
  });

  // Disney's own site keeps data in this store, and so does any other AutoLL
  // build on the same phone. Neither is this build's to copy.
  it('copies nothing outside its own namespace', () => {
    localStorage.setItem('disney.session', 'Disney’s own data');
    localStorage.setItem('some-other-build.autopilot.watchlist', '[]');
    const { data } = createBackup();
    expect(Object.keys(data)).toEqual([]);
  });

  it('says what wrote it, so a restore can refuse another build’s file', () => {
    const now = new Date('2031-02-14T15:04:05Z');
    const backup = createBackup(now);
    expect(backup).toMatchObject({
      format: BACKUP_FORMAT,
      schema: BACKUP_SCHEMA,
      app: APP_NAME,
      rev: BUILD_REV,
      exportedAt: '2031-02-14T15:04:05.000Z',
    });
  });

  it('keeps a value that is not JSON rather than failing the whole backup', () => {
    localStorage.setItem(storageKey('odd'), 'not json at all');
    expect(createBackup().data.odd).toBe('not json at all');
  });
});

describe('summarize()', () => {
  it('counts what a person checks a backup by', () => {
    seedPhone();
    expect(summarize(createBackup().data)).toEqual({
      targets: 3,
      dates: 2,
      parks: 2,
      party: 4,
      drops: 2,
      daysWatched: 2,
    });
  });

  // The same function will describe a file someone picked for a restore before
  // any of it has been validated.
  it('never throws on data it does not recognise', () => {
    const garbage = {
      [suffix(WATCHLIST_KEY)]: 'not a list',
      [suffix(PARTY_IDS_KEY)]: { not: 'a list' },
      [suffix(EVENTS_KEY)]: null,
      [suffix(WATCHED_KEY)]: ['not', 'a', 'record'],
    };
    expect(summarize(garbage)).toEqual({
      targets: 0,
      dates: 0,
      parks: 0,
      party: 0,
      drops: 0,
      daysWatched: 0,
    });
  });
});

describe('describeSummary()', () => {
  it('reads as one line', () => {
    expect(
      describeSummary({
        targets: 14,
        dates: 3,
        parks: 2,
        party: 4,
        drops: 247,
        daysWatched: 9,
      })
    ).toBe(
      '14 attractions for 3 dates at 2 parks · a party of 4 · 247 drops seen over 9 days watched'
    );
  });

  it('leaves out what is not there, and gets one of anything right', () => {
    expect(
      describeSummary({
        targets: 1,
        dates: 1,
        parks: 1,
        party: 0,
        drops: 0,
        daysWatched: 0,
      })
    ).toBe('1 attraction for 1 date at 1 park');
  });

  // Watched days arrived after drops did, so an older phone has drops and no
  // watched days. "Over 0 days watched" would claim something never recorded.
  it('does not claim zero days watched for drops recorded before days were', () => {
    expect(
      describeSummary({
        targets: 0,
        dates: 0,
        parks: 0,
        party: 0,
        drops: 5,
        daysWatched: 0,
      })
    ).toBe('5 drops seen');
  });

  it('says so when there is nothing to back up', () => {
    expect(
      describeSummary({
        targets: 0,
        dates: 0,
        parks: 0,
        party: 0,
        drops: 0,
        daysWatched: 0,
      })
    ).toBe('Nothing saved yet.');
  });
});

describe('backupFileName()', () => {
  it('names the build and the phone’s own date', () => {
    expect(backupFileName(new Date(2031, 1, 14, 23, 30))).toBe(
      `${APP_NAME} backup 2031-02-14.json`
    );
  });
});

describe('the last-backup record', () => {
  it('round-trips', () => {
    expect(lastBackupAt()).toBeUndefined();
    const at = new Date('2031-02-14T15:00:00Z');
    recordBackup(at);
    expect(lastBackupAt()).toEqual(at);
  });

  it('treats a mangled record as no backup rather than a date in 1970', () => {
    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify('not a date'));
    expect(lastBackupAt()).toBeUndefined();
    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(12345));
    expect(lastBackupAt()).toBeUndefined();
  });
});

describe('describeLastBackup()', () => {
  const now = new Date(2031, 1, 14, 9, 0);
  it('says never, today, yesterday, then days', () => {
    expect(describeLastBackup(undefined, now)).toBe('never');
    expect(describeLastBackup(new Date(2031, 1, 14, 0, 5), now)).toBe('today');
    expect(describeLastBackup(new Date(2031, 1, 13, 8, 0), now)).toBe(
      'yesterday'
    );
    expect(describeLastBackup(new Date(2031, 1, 2, 9, 0), now)).toBe(
      '12 days ago'
    );
  });

  // Calendar days, not elapsed hours: a backup at 11pm is "yesterday" at 1am.
  it('counts calendar days, not hours', () => {
    expect(
      describeLastBackup(
        new Date(2031, 1, 13, 23, 0),
        new Date(2031, 1, 14, 1, 0)
      )
    ).toBe('yesterday');
  });
});

describe('shareBackup()', () => {
  type ShareNavigator = Navigator & {
    share?: (data: ShareData) => Promise<void>;
    canShare?: (data: ShareData) => boolean;
  };
  const nav = navigator as ShareNavigator;

  function installShare(share: (data: ShareData) => Promise<void>) {
    const shareMock = jest.fn(share);
    Object.defineProperty(nav, 'canShare', {
      value: jest.fn(() => true),
      configurable: true,
    });
    Object.defineProperty(nav, 'share', {
      value: shareMock,
      configurable: true,
    });
    return shareMock;
  }

  afterEach(() => {
    Reflect.deleteProperty(nav, 'share');
    Reflect.deleteProperty(nav, 'canShare');
  });

  const fileText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

  it('hands a named JSON file to the share sheet', async () => {
    seedPhone();
    const share = installShare(async () => undefined);
    const now = new Date(2031, 1, 14, 10, 0);
    await expect(shareBackup(createBackup(now), now)).resolves.toBe('shared');
    const { files } = share.mock.calls[0]![0];
    const file = files![0]!;
    expect(file.name).toBe(`${APP_NAME} backup 2031-02-14.json`);
    expect(file.type).toBe('application/json');
    const parsed = JSON.parse(await fileText(file));
    expect(parsed.format).toBe(BACKUP_FORMAT);
    expect(parsed.data[suffix(PARTY_IDS_KEY)]).toHaveLength(4);
  });

  // The end-to-end version of the rule: what actually leaves the page.
  it('never puts the sign-in in the file it shares', async () => {
    seedPhone();
    const share = installShare(async () => undefined);
    await shareBackup(createBackup());
    const file = share.mock.calls[0]![0].files![0]!;
    expect(await fileText(file)).not.toContain(TOKEN);
  });

  // iOS opens the sheet only as the direct result of a tap, so nothing may be
  // awaited before the call. If this ever regresses, the button does nothing
  // on a phone and every test that awaits would still pass.
  it('reaches navigator.share without awaiting anything first', () => {
    const share = installShare(async () => undefined);
    void shareBackup(createBackup());
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('treats closing the sheet as a choice, not a failure', async () => {
    installShare(async () => {
      throw new DOMException('Share canceled', 'AbortError');
    });
    await expect(shareBackup(createBackup())).resolves.toBe('cancelled');
  });

  it('lets a real failure through', async () => {
    installShare(async () => {
      throw new DOMException('Not allowed', 'NotAllowedError');
    });
    await expect(shareBackup(createBackup())).rejects.toThrow('Not allowed');
  });

  it('downloads the file where sharing one is not available', async () => {
    const createURL = jest.fn(() => 'blob:backup');
    Object.defineProperty(URL, 'createObjectURL', {
      value: createURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true,
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const now = new Date(2031, 1, 14, 10, 0);
    await expect(shareBackup(createBackup(now), now)).resolves.toBe(
      'downloaded'
    );
    expect(createURL).toHaveBeenCalled();
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(`${APP_NAME} backup 2031-02-14.json`);
  });
});

const backupOf = (data: Record<string, unknown>): Backup => ({
  format: BACKUP_FORMAT,
  schema: BACKUP_SCHEMA,
  app: APP_NAME,
  rev: 'abc1234',
  exportedAt: '2031-02-14T15:04:05.000Z',
  data,
});

describe('readBackup()', () => {
  it('reads back what createBackup wrote', () => {
    seedPhone();
    const written = createBackup();
    const reading = readBackup(JSON.stringify(written, null, 2));
    expect(reading).toEqual({ ok: true, backup: written });
  });

  it('refuses a file that is not a backup at all', () => {
    for (const text of ['not json', '[]', '{"format":"something-else"}']) {
      expect(readBackup(text)).toEqual({
        ok: false,
        reason: `That file isn't an ${APP_NAME} backup.`,
      });
    }
  });

  // Guessing at a newer shape is how a restore writes something this build
  // then misreads.
  it('refuses a backup from a newer version', () => {
    const newer = { ...backupOf({}), schema: BACKUP_SCHEMA + 1 };
    expect(readBackup(JSON.stringify(newer))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('newer version'),
    });
  });

  // The other build keeps its own plan, and its keys belong to its namespace.
  it('refuses another build’s backup', () => {
    const other = { ...backupOf({}), app: 'AutoLL-9' };
    expect(readBackup(JSON.stringify(other))).toEqual({
      ok: false,
      reason: `That backup is from AutoLL-9, not ${APP_NAME}.`,
    });
  });

  it('refuses a backup with no version or no data', () => {
    const unversioned: Record<string, unknown> = { ...backupOf({}) };
    delete unversioned.schema;
    expect(readBackup(JSON.stringify(unversioned))).toMatchObject({
      ok: false,
    });
    expect(
      readBackup(JSON.stringify({ ...backupOf({}), data: [] }))
    ).toMatchObject({ ok: false });
  });
});

describe('restoreBackup()', () => {
  const event = (experienceId: string, date: string) => ({
    experienceId,
    date,
    time: '09:47',
    kind: 'appeared' as const,
  });

  // The owner chose replace: afterwards the phone has the file's plan, not a
  // blend of two.
  it('replaces the plan', () => {
    localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify([{ experienceId: 'x' }])
    );
    localStorage.setItem(PARTY_IDS_KEY, JSON.stringify(['old']));
    localStorage.setItem(STARRED_KEY, JSON.stringify(['old-star']));
    localStorage.setItem(
      NEXTLL_WATCHLIST_KEY,
      JSON.stringify([{ experienceId: 'n-old' }])
    );
    restoreBackup(
      backupOf({
        [suffix(WATCHLIST_KEY)]: [
          { experienceId: 'a', parkId: 'mk', date: TODAY, autoBook: true },
        ],
        [suffix(PARTY_IDS_KEY)]: ['g1', 'g2'],
        [suffix(STARRED_KEY)]: ['star'],
        [suffix(NEXTLL_WATCHLIST_KEY)]: [{ experienceId: 'n' }],
      })
    );
    expect(loadWatchList()).toEqual([
      { experienceId: 'a', parkId: 'mk', date: TODAY, autoBook: true },
    ]);
    expect(JSON.parse(localStorage.getItem(PARTY_IDS_KEY)!)).toEqual([
      'g1',
      'g2',
    ]);
    expect(JSON.parse(localStorage.getItem(STARRED_KEY)!)).toEqual(['star']);
    expect(loadWatchList(NEXTLL_WATCHLIST_KEY)).toEqual([
      { experienceId: 'n' },
    ]);
  });

  it('clears a part of the plan the file does not have', () => {
    localStorage.setItem(STARRED_KEY, JSON.stringify(['old-star']));
    restoreBackup(backupOf({ [suffix(PARTY_IDS_KEY)]: ['g1'] }));
    expect(localStorage.getItem(STARRED_KEY)).toBeNull();
  });

  // Hand-edited or damaged values go through the loaders' own rules.
  it('keeps only what the loaders would accept', () => {
    restoreBackup(
      backupOf({
        [suffix(WATCHLIST_KEY)]: [{ experienceId: 'a', autoBook: 'yes' }, 7],
        [suffix(PARTY_IDS_KEY)]: ['g1', 2, null],
      })
    );
    expect(loadWatchList()).toEqual([{ experienceId: 'a' }]);
    expect(JSON.parse(localStorage.getItem(PARTY_IDS_KEY)!)).toEqual(['g1']);
  });

  it('merges what the learner has seen instead of replacing it', () => {
    const mk = coverageKey('mk', YESTERDAY);
    const ep = coverageKey('ep', TODAY);
    localStorage.setItem(
      EVENTS_KEY,
      JSON.stringify([event('phone', TODAY), event('both', TODAY)])
    );
    localStorage.setItem(COVERAGE_KEY, JSON.stringify({ [ep]: [100] }));
    localStorage.setItem(WATCHED_KEY, JSON.stringify({ [ep]: ['phone'] }));
    restoreBackup(
      backupOf({
        [suffix(EVENTS_KEY)]: [event('file', YESTERDAY), event('both', TODAY)],
        [suffix(COVERAGE_KEY)]: { [mk]: [90], [ep]: [101] },
        [suffix(WATCHED_KEY)]: { [mk]: ['file'] },
      })
    );
    expect(loadDropEvents()).toEqual([
      event('file', YESTERDAY),
      event('phone', TODAY),
      event('both', TODAY),
    ]);
    expect(loadCoverage()).toEqual({ [mk]: [90], [ep]: [100, 101] });
    expect(loadWatchedDays()).toEqual({ [ep]: ['phone'], [mk]: ['file'] });
  });

  // The rule that matters most. The file names every key it holds -- a
  // hand-edited one could name a sign-in or a dry-run setting -- and the
  // restore writes only its seven.
  it('writes nothing outside its seven keys, whatever the file holds', () => {
    const untouched = [
      AUTH_KEY,
      AUTH_PERSISTENCE_KEY,
      SETTINGS_KEY,
      LOG_KEY,
      LOCKS_KEY,
      COMMITS_KEY,
      LEASE_KEY,
      QUARANTINE_KEY,
      NEXTLL_PENDING_KEY,
      PLAN_CHECK_REVIEW_KEY,
      BOOKING_DATE_KEY,
      PARK_KEY,
      LAST_BACKUP_KEY,
      storageKey('some.key.added.later'),
    ];
    for (const key of untouched) localStorage.setItem(key, '"phone"');
    localStorage.setItem('disney.session', 'Disney’s own data');
    const data = Object.fromEntries(
      untouched.map(key => [suffix(key), 'from the file'])
    );
    const others = () =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter(key => !(RESTORED_KEYS as string[]).includes(key))
          .map(key => [key, localStorage.getItem(key)])
      );
    const before = others();
    restoreBackup(backupOf(data));
    expect(others()).toEqual(before);
  });

  // The store belongs to Disney's website.
  it('never clears the store', () => {
    const clear = jest.spyOn(Storage.prototype, 'clear');
    seedPhone();
    restoreBackup(createBackup());
    expect(clear).not.toHaveBeenCalled();
  });

  it('refuses while any engine runs, and writes nothing', () => {
    localStorage.setItem(PARTY_IDS_KEY, JSON.stringify(['old']));
    const release = markRunning();
    try {
      expect(() =>
        restoreBackup(backupOf({ [suffix(PARTY_IDS_KEY)]: ['new'] }))
      ).toThrow('Turn off Autopilot');
    } finally {
      release();
    }
    expect(JSON.parse(localStorage.getItem(PARTY_IDS_KEY)!)).toEqual(['old']);
  });

  // A restore half-applied is a plan nobody chose: the file's party with the
  // phone's watch list. So a failed write puts every touched key back.
  it('lands whole or not at all', () => {
    seedPhone();
    const before = Object.fromEntries(
      RESTORED_KEYS.map(key => [key, localStorage.getItem(key)])
    );
    const setItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === COVERAGE_KEY) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    });
    expect(() =>
      restoreBackup(
        backupOf({
          [suffix(WATCHLIST_KEY)]: [{ experienceId: 'z' }],
          [suffix(PARTY_IDS_KEY)]: ['z'],
        })
      )
    ).toThrow('Quota exceeded');
    jest.restoreAllMocks();
    expect(
      Object.fromEntries(
        RESTORED_KEYS.map(key => [key, localStorage.getItem(key)])
      )
    ).toEqual(before);
  });

  // The roadmap's done-means, in miniature: back up, lose the site's data the
  // way Safari loses it, restore, and see the plan and the drops come back.
  it('brings back a phone that lost everything', () => {
    seedPhone();
    const file = JSON.stringify(createBackup());
    const plan = loadWatchList();
    const drops = loadDropEvents();
    localStorage.clear();
    const reading = readBackup(file);
    if (!reading.ok) throw new Error(reading.reason);
    restoreBackup(reading.backup);
    expect(loadWatchList()).toEqual(plan);
    expect(loadDropEvents()).toEqual(drops);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });
});

describe('readFileText()', () => {
  it('reads a picked file', async () => {
    const file = new File(['{"a":1}'], 'x.json', { type: 'application/json' });
    await expect(readFileText(file)).resolves.toBe('{"a":1}');
  });
});
