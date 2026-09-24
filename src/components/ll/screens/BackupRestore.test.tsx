import { AUTH_KEY } from '@/api/auth';
import { APP_NAME } from '@/appIdentity';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA,
  LAST_BACKUP_KEY,
  lastBackupAt,
} from '@/autopilot/backup';
import { markRunning } from '@/autopilot/running';
import { WATCHLIST_KEY, loadWatchList } from '@/autopilot/watchlist';
import { PARTY_IDS_KEY } from '@/savedParty';
import { STORAGE_NAMESPACE } from '@/storageNamespace';
import {
  TODAY,
  TOMORROW,
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@/testing';

import BackupRestore from './BackupRestore';

const TOKEN = 'eyJ-a-live-disney-session-token';

type ShareNavigator = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};
const nav = navigator as ShareNavigator;

function installShare(
  share: (data: ShareData) => Promise<void> = async () => undefined
) {
  const shareMock = jest.fn(share);
  Object.defineProperty(nav, 'canShare', {
    value: jest.fn(() => true),
    configurable: true,
  });
  Object.defineProperty(nav, 'share', { value: shareMock, configurable: true });
  return shareMock;
}

const fileText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    WATCHLIST_KEY,
    JSON.stringify([
      { experienceId: 'a', parkId: 'mk', date: TODAY },
      { experienceId: 'b', parkId: 'ep', date: TOMORROW },
    ])
  );
  localStorage.setItem(PARTY_IDS_KEY, JSON.stringify(['g1', 'g2', 'g3']));
  localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: TOKEN }));
});
afterEach(() => {
  Reflect.deleteProperty(nav, 'share');
  Reflect.deleteProperty(nav, 'canShare');
  jest.restoreAllMocks();
});

const backUp = () => screen.getByRole('button', { name: 'Back up now' });

describe('BackupRestore', () => {
  it('says what is on this phone before anything is shared', () => {
    render(<BackupRestore />);
    expect(
      screen.getByText('2 attractions for 2 dates at 2 parks · a party of 3')
    ).toBeInTheDocument();
    expect(screen.getByText(/Last backup: never/)).toBeInTheDocument();
  });

  // The regression this screen exists to prevent. iOS opens the share sheet only
  // as the direct result of a tap; if anything between the tap and the call ever
  // awaits, the button silently does nothing on a phone while every test that
  // awaits still passes. So this asserts inside the click, before any microtask.
  it('opens the share sheet from inside the tap itself', () => {
    const share = installShare();
    render(<BackupRestore />);
    fireEvent.click(backUp());
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('records the backup and says so once the sheet completes', async () => {
    installShare();
    render(<BackupRestore />);
    await act(async () => {
      backUp().click();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Backed up.');
    expect(screen.getByText(/Last backup: today/)).toBeInTheDocument();
    expect(lastBackupAt()).toBeDefined();
  });

  // Closing the sheet is a choice. Recording it as a backup would say a copy
  // exists when none does -- the one thing this screen must never claim.
  it('does not count a closed share sheet as a backup', async () => {
    installShare(async () => {
      throw new DOMException('Share canceled', 'AbortError');
    });
    render(<BackupRestore />);
    await act(async () => {
      backUp().click();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem(LAST_BACKUP_KEY)).toBeNull();
    expect(screen.getByText(/Last backup: never/)).toBeInTheDocument();
  });

  it('says so when the share fails, and records nothing', async () => {
    installShare(async () => {
      throw new DOMException('Not allowed', 'NotAllowedError');
    });
    render(<BackupRestore />);
    await act(async () => {
      backUp().click();
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't back up: Not allowed"
    );
    expect(localStorage.getItem(LAST_BACKUP_KEY)).toBeNull();
  });

  it('falls back to a download where the phone cannot share a file', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: jest.fn(() => 'blob:backup'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true,
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<BackupRestore />);
    await act(async () => {
      backUp().click();
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Backed up to your downloads.'
    );
  });

  // The whole rule, end to end, through the screen: what actually leaves.
  it('never puts the Disney sign-in in the file', async () => {
    const share = installShare();
    render(<BackupRestore />);
    await act(async () => {
      backUp().click();
    });
    const file = share.mock.calls[0]![0].files![0]!;
    expect(await fileText(file)).not.toContain(TOKEN);
  });
});

describe('BackupRestore, restoring', () => {
  const suffix = (key: string) => key.slice(STORAGE_NAMESPACE.length);
  const backupFile = (
    data: Record<string, unknown>,
    fields: Record<string, unknown> = {}
  ) =>
    new File(
      [
        JSON.stringify({
          format: BACKUP_FORMAT,
          schema: BACKUP_SCHEMA,
          app: APP_NAME,
          rev: 'abc1234def',
          exportedAt: '2031-02-14T15:04:05.000Z',
          data,
          ...fields,
        }),
      ],
      'my backup.json',
      { type: 'application/json' }
    );
  const pick = (file: File) =>
    fireEvent.change(screen.getByLabelText('Backup file'), {
      target: { files: [file] },
    });
  const replaceButton = () =>
    screen.findByRole('button', { name: 'Replace this phone’s plan' });

  // Like the share sheet, a file picker opens only as the direct result of a tap.
  it('opens the file picker from inside the tap', () => {
    const click = jest
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<BackupRestore />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose a backup file' })
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Backup file')).toHaveAttribute(
      'accept',
      expect.stringContaining('application/json')
    );
  });

  it('shows what a picked backup holds, and writes nothing yet', async () => {
    render(<BackupRestore />);
    pick(
      backupFile({
        [suffix(WATCHLIST_KEY)]: [
          { experienceId: 'z', parkId: 'ak', date: TODAY },
        ],
        [suffix(PARTY_IDS_KEY)]: ['g9'],
      })
    );
    expect(
      await screen.findByText(
        '1 attraction for 1 date at 1 park · a party of 1'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('my backup.json')).toBeInTheDocument();
    expect(screen.getByText(/build abc1234$/)).toBeInTheDocument();
    expect(loadWatchList()).toHaveLength(2);
  });

  it('replaces the plan, then holds the screen until a reload', async () => {
    const reload = jest.fn();
    render(<BackupRestore reload={reload} />);
    pick(backupFile({ [suffix(WATCHLIST_KEY)]: [{ experienceId: 'z' }] }));
    fireEvent.click(await replaceButton());
    const dialog = screen.getByRole('alertdialog', { name: 'Restored' });
    expect(loadWatchList()).toEqual([{ experienceId: 'z' }]);
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload now' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says why a file is refused, and offers nothing to restore', async () => {
    render(<BackupRestore />);
    pick(backupFile({}, { app: 'AutoLL-9' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `That backup is from AutoLL-9, not ${APP_NAME}.`
    );
    expect(
      screen.queryByRole('button', { name: 'Replace this phone’s plan' })
    ).not.toBeInTheDocument();
  });

  // Each engine holds its plan in memory and would write it back over a
  // restore -- including a Time Search this screen cannot otherwise see.
  it('will not restore while any engine runs', async () => {
    render(<BackupRestore />);
    pick(backupFile({ [suffix(PARTY_IDS_KEY)]: ['g9'] }));
    const replace = await replaceButton();
    let release = () => {};
    act(() => {
      release = markRunning();
    });
    expect(replace).toBeDisabled();
    expect(
      screen.getByText(
        'Turn off Autopilot, and stop any Time Search, to restore.'
      )
    ).toBeInTheDocument();
    fireEvent.click(replace);
    expect(localStorage.getItem(PARTY_IDS_KEY)).toBe(
      JSON.stringify(['g1', 'g2', 'g3'])
    );
    act(() => release());
    expect(replace).toBeEnabled();
  });

  it('cannot even start a restore while an engine runs', () => {
    const release = markRunning();
    try {
      render(<BackupRestore />);
      expect(
        screen.getByRole('button', { name: 'Choose a backup file' })
      ).toBeDisabled();
    } finally {
      release();
    }
  });

  it('leaves the phone as it was when cancelled', async () => {
    render(<BackupRestore />);
    pick(backupFile({ [suffix(PARTY_IDS_KEY)]: ['g9'] }));
    await replaceButton();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Choose a backup file' })
    ).toBeInTheDocument();
    expect(localStorage.getItem(PARTY_IDS_KEY)).toBe(
      JSON.stringify(['g1', 'g2', 'g3'])
    );
  });
});
