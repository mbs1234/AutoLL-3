import { AUTH_PERSISTENCE_KEY } from '@/api/auth';
import { APP_NAME } from '@/appIdentity';
import kvdb from '@/kvdb';
import { fireEvent, render, screen } from '@/testing';

import SettingsButton from './SettingsButton';

// Two builds can be installed on the same phone and they look identical.
// `document.title` and the favicon answer the question only where a tab strip
// exists -- not once the page is on the Home Screen, which is how this is
// used. The tab bar used to carry the name; five tabs left it no room.
describe('SettingsButton', () => {
  it('names the build in its menu', () => {
    render(<SettingsButton />);
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(screen.getByLabelText(`Build: ${APP_NAME}`)).toHaveTextContent(
      APP_NAME
    );
  });

  it('keeps the name out of the way of the actions', () => {
    render(<SettingsButton />);
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(screen.getByLabelText(`Build: ${APP_NAME}`).closest('button')).toBe(
      null
    );
    expect(screen.getByText('Party Selection')).toBeInTheDocument();
    expect(screen.getByText('Log Out')).toBeInTheDocument();
  });

  it('offers session-only login as a privacy option', () => {
    jest.useFakeTimers();
    render(<SettingsButton />);
    fireEvent.click(screen.getByTitle('Settings Menu'));
    expect(screen.getByText('Session-only login: Off')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Session-only login: Off'));
    jest.runAllTimers();
    expect(kvdb.get(AUTH_PERSISTENCE_KEY)).toBe('session');
    jest.useRealTimers();
  });
});
