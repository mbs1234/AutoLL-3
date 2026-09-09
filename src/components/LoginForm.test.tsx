import { act, cleanup, render, screen, waitFor } from '@/testing';

import LoginForm from './LoginForm';

const init = jest.fn(async () => {
  const wrapper = document.createElement('div');
  wrapper.id = 'oneid-wrapper';
  wrapper.setAttribute('data-testid', 'wrapper');
  document.body.appendChild(wrapper);
  const responder = document.createElement('iframe');
  responder.id = 'oneid-secure-responder';
  responder.setAttribute('data-testid', 'responder');
  document.body.appendChild(responder);
});
const launchLogin = jest.fn();
const callbacks: { [name: string]: (result: any) => void } = {};
const on = jest.fn(
  (name: keyof typeof callbacks, callback: (result: any) => void) => {
    callbacks[name] = callback;
  }
);
const off = jest.fn();
self.OneID = {
  get: jest.fn(() => ({ init, launchLogin, on, off })),
};
Object.defineProperty(navigator, 'userAgent', {
  get: () =>
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  set: () => null,
});

describe('LoginForm', () => {
  it('shows Disney login form', async () => {
    const onLogin = jest.fn();
    const wdw = { id: 'WDW' as const };
    render(<LoginForm onLogin={onLogin} resort={wdw} />);
    expect(self.OneID).toBeTruthy();
    if (!self.OneID) return;
    expect(self.OneID.get).toHaveBeenCalledWith({
      clientId: 'TPR-WDW-LBSDK.IOS',
      responderPage: 'https://mbs1234.github.io/AutoLL-3/responder.html',
    });
    await waitFor(() => expect(launchLogin).toHaveBeenCalled());

    const exp = new Date('2050-01-01T00:00:00Z').getTime();
    callbacks.login!({
      token: { swid: '{123}', access_token: 'XYZ', exp },
    });
    expect(onLogin).toHaveBeenCalledWith({
      swid: '{123}',
      accessToken: 'XYZ',
      expires: exp,
      resortId: 'WDW',
      version: 1,
      receivedAt: expect.any(Number),
    });

    act(() => callbacks.close!());
    expect(screen.getByRole('button', { name: 'Sign in with Disney' })).toBeInTheDocument();
    expect(launchLogin).toHaveBeenCalledTimes(1);

    screen.getByTestId('wrapper');
    screen.getByTestId('responder');
    cleanup();
    expect(screen.queryByTestId('wrapper')).not.toBeInTheDocument();
  });
});
