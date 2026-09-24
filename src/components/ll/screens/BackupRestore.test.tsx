import { AUTH_KEY } from '@/api/auth';
import { LAST_BACKUP_KEY, lastBackupAt } from '@/autopilot/backup';
import { WATCHLIST_KEY } from '@/autopilot/watchlist';
import { PARTY_IDS_KEY } from '@/savedParty';
import { TODAY, TOMORROW, act, fireEvent, render, screen } from '@/testing';

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
