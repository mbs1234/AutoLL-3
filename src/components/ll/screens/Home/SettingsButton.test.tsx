import { AUTH_PERSISTENCE_KEY } from '@/api/auth';
import { APP_NAME, BUILD_REV } from '@/appIdentity';
import { recordBackup } from '@/autopilot/backup';
import kvdb from '@/kvdb';
import { act, fireEvent, nav, render, screen } from '@/testing';

import BackupRestore from '../BackupRestore';
import SettingsButton from './SettingsButton';

// Two builds can be installed on the same phone and they look identical.
// `document.title` and the favicon answer the question only where a tab strip
// exists -- not once the page is on the Home Screen, which is how this is
// used. The tab bar used to carry the name; five tabs left it no room.
describe('SettingsButton', () => {
  it('names the build in its menu', () => {
    render(<SettingsButton />);
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(
      screen.getByLabelText(`Build: ${APP_NAME} ${BUILD_REV}`)
    ).toHaveTextContent(APP_NAME);
  });

  // The name alone cannot answer "is this the build we tested?", which is the
  // question a phone gets asked on a park morning. The revision is what makes
  // the answer checkable against `sourceRevision` in the release manifest.
  it('says which revision it is, so the phone can be matched to a release', () => {
    render(<SettingsButton />);
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(
      screen.getByLabelText(`Build: ${APP_NAME} ${BUILD_REV}`)
    ).toHaveTextContent(BUILD_REV);
  });

  it('keeps the name out of the way of the actions', () => {
    render(<SettingsButton />);
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(
      screen.getByLabelText(`Build: ${APP_NAME} ${BUILD_REV}`).closest('button')
    ).toBe(null);
    expect(screen.getByText('Party Selection')).toBeInTheDocument();
    expect(screen.getByText('Log Out')).toBeInTheDocument();
  });

  it('offers session-only login as a privacy option', () => {
    jest.useFakeTimers();
    render(<SettingsButton />);
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(screen.getByText('Session-only login: Off')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Session-only login: Off'));
    act(() => jest.runAllTimers());
    expect(kvdb.get(AUTH_PERSISTENCE_KEY)).toBe('session');
    jest.useRealTimers();
  });

  // Backup is its own screen, not an action run from here: the menu runs its
  // items after it closes, and iOS opens the share sheet only from a tap.
  it('opens the backup screen', () => {
    jest.useFakeTimers();
    nav.goTo.mockClear();
    render(
      <nav.Provider>
        <SettingsButton />
      </nav.Provider>
    );
    fireEvent.click(screen.getByTitle('Settings Menu'));
    fireEvent.click(screen.getByText('Backup and Restore'));
    act(() => jest.runAllTimers());
    expect(nav.goTo).toHaveBeenCalledWith(<BackupRestore />);
    jest.useRealTimers();
  });

  // The failure a backup guards against is forgetting to make one, so the menu
  // says how long it has been every time it opens.
  it('says when the last backup was', () => {
    render(<SettingsButton />);
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(screen.getByLabelText('Last backup')).toHaveTextContent(
      'Last backup: never'
    );
    fireEvent.click(screen.getByTestId('shade'));
    recordBackup(new Date());
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(screen.getByLabelText('Last backup')).toHaveTextContent(
      'Last backup: today'
    );
  });
});
