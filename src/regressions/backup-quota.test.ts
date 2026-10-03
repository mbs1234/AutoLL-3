import { APP_NAME } from '@/appIdentity';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA,
  RESTORED_KEYS,
  RestoreRecoveryError,
  createBackup,
  getRestoreRecovery,
  recoverOriginalPlan,
  restoreBackup,
} from '@/autopilot/backup';
import { WATCHLIST_KEY } from '@/autopilot/watchlist';
import { PARTY_IDS_KEY } from '@/savedParty';
import { NEXTLL_WATCHLIST_KEY, STORAGE_NAMESPACE } from '@/storageNamespace';

test('a failed restore must restore the original data under a persistent quota limit', () => {
  localStorage.clear();
  const suffix = (key: string) => key.slice(STORAGE_NAMESPACE.length);
  const original = JSON.stringify([
    { experienceId: 'old', name: 'x'.repeat(1000), autoBook: true },
  ]);
  localStorage.setItem(WATCHLIST_KEY, original);
  const limit = 1200;
  const realSet = Storage.prototype.setItem;
  const write = jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key: string, value: string) {
      let size = key.length + value.length;
      for (let i = 0; i < this.length; i++) {
        const existing = this.key(i)!;
        if (existing !== key) {
          size += existing.length + this.getItem(existing)!.length;
        }
      }
      if (size > limit) {
        throw new DOMException('quota full', 'QuotaExceededError');
      }
      realSet.call(this, key, value);
    });
  try {
    expect(() =>
      restoreBackup({
        format: BACKUP_FORMAT,
        schema: BACKUP_SCHEMA,
        app: APP_NAME,
        rev: 'audit',
        exportedAt: '',
        data: {
          [suffix(WATCHLIST_KEY)]: [],
          [suffix(NEXTLL_WATCHLIST_KEY)]: [
            { experienceId: 'new', name: 'y'.repeat(1000) },
          ],
          [suffix(PARTY_IDS_KEY)]: ['z'.repeat(2000)],
        },
      })
    ).toThrow('quota full');
    expect(localStorage.getItem(WATCHLIST_KEY)).toBe(original);
    expect(localStorage.getItem(NEXTLL_WATCHLIST_KEY)).toBeNull();
  } finally {
    write.mockRestore();
  }
});

test.each(RESTORED_KEYS)(
  'a persistent failure at %s recovers every exact original',
  failingKey => {
    localStorage.clear();
    for (const key of RESTORED_KEYS) localStorage.setItem(key, '  null  ');
    localStorage.removeItem(NEXTLL_WATCHLIST_KEY);
    localStorage.setItem('disney.session', 'untouched');
    localStorage.setItem('autoll2.watchlist', 'sibling');
    const originals = Object.fromEntries(
      RESTORED_KEYS.map(key => [key, localStorage.getItem(key)])
    );
    const incoming = createBackup();
    incoming.data[WATCHLIST_KEY.slice(STORAGE_NAMESPACE.length)] = [
      { experienceId: 'new' },
    ];
    incoming.data[NEXTLL_WATCHLIST_KEY.slice(STORAGE_NAMESPACE.length)] = [];
    const realSet = Storage.prototype.setItem;
    const write = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key, value) {
        if (key === failingKey && value !== originals[key]) {
          throw new DOMException('persistent quota', 'QuotaExceededError');
        }
        realSet.call(this, key, value);
      });
    try {
      expect(() => restoreBackup(incoming)).toThrow('persistent quota');
      expect(
        Object.fromEntries(
          RESTORED_KEYS.map(key => [key, localStorage.getItem(key)])
        )
      ).toEqual(originals);
      expect(localStorage.getItem('disney.session')).toBe('untouched');
      expect(localStorage.getItem('autoll2.watchlist')).toBe('sibling');
    } finally {
      write.mockRestore();
    }
  }
);

test('rollback failure retains an export and continues recovering later keys', () => {
  localStorage.clear();
  for (const key of RESTORED_KEYS) localStorage.setItem(key, '  null  ');
  const incoming = createBackup();
  const originals = Object.fromEntries(
    RESTORED_KEYS.map(key => [key, localStorage.getItem(key)])
  );
  const realSet = Storage.prototype.setItem;
  let failing = false;
  const write = jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PARTY_IDS_KEY) failing = true;
      if (
        failing &&
        (key === WATCHLIST_KEY ||
          (key === PARTY_IDS_KEY && value !== originals[key]))
      ) {
        throw new Error('persistent storage failure');
      }
      realSet.call(this, key, value);
    });
  try {
    expect(() => restoreBackup(incoming)).toThrow(RestoreRecoveryError);
    expect(
      getRestoreRecovery()?.backup.originalStorage?.[
        WATCHLIST_KEY.slice(STORAGE_NAMESPACE.length)
      ]
    ).toBe('  null  ');
    expect(localStorage.getItem(NEXTLL_WATCHLIST_KEY)).toBe(
      originals[NEXTLL_WATCHLIST_KEY]
    );
    expect(() => restoreBackup(incoming)).toThrow('recovery is incomplete');
  } finally {
    write.mockRestore();
    recoverOriginalPlan();
  }
  expect(getRestoreRecovery()).toBeUndefined();
  expect(
    Object.fromEntries(
      RESTORED_KEYS.map(key => [key, localStorage.getItem(key)])
    )
  ).toEqual(originals);
});
