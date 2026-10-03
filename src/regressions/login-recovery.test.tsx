import { StrictMode } from 'react';

import LoginForm, { resetOneIdForTests } from '@/components/LoginForm';
import { act, cleanup, fireEvent, render, screen, setTime } from '@/testing';

beforeEach(async () => {
  cleanup();
  await act(async () => {
    await Promise.resolve();
  });
  // The SDK client is kept for the life of the page, whatever later happens
  // to `window.OneID`, so deleting that no longer starts a test afresh. Each
  // test here is a fresh page load.
  resetOneIdForTests();
  delete window.OneID;
  document.getElementById('oneid-script')?.remove();
  setTime('10:00:00');
});

function fakeClient(init: () => Promise<void> = async () => {}) {
  const listeners: { [type: string]: (result: any) => void } = {};
  return {
    init: jest.fn(init),
    launchLogin: jest.fn(),
    on: jest.fn((type: string, listener: (result: any) => void) => {
      listeners[type] = listener;
    }),
    off: jest.fn(),
    listeners,
  };
}

const token = {
  swid: '{GUEST}',
  access_token: 'ACCESS',
  exp: new Date('2050-01-01T00:00:00Z').getTime(),
};

test('Retry after a failed SDK download must replace the failed script', async () => {
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  const first = document.getElementById('oneid-script');
  expect(first).not.toBeNull();
  fireEvent.error(first!);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Disney' }));
  expect(document.getElementById('oneid-script')).not.toBe(first);
  const client = {
    init: jest.fn(async () => {}),
    launchLogin: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  };
  window.OneID = { get: jest.fn(() => client) };
  fireEvent.load(document.getElementById('oneid-script')!);
  await act(async () => {
    await Promise.resolve();
  });
  expect(client.init).toHaveBeenCalledTimes(1);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
});

test('StrictMode shares initialization and launches only the current attempt', async () => {
  const client = {
    init: jest.fn(async () => {}),
    launchLogin: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  };
  window.OneID = { get: jest.fn(() => client) };
  render(
    <StrictMode>
      <LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />
    </StrictMode>
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(window.OneID.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
});

// 1.8.3 answered Retry here with a second client and dropped the first when
// it finished. On slow data that made every attempt start from nothing, so
// none ever finished. Retry now waits for the same initialization again, and
// only the attempt still current when it lands opens the sheet.
test('Retry after a timed-out initialization waits for it rather than replacing it', async () => {
  let finishInit!: () => void;
  const client = fakeClient(
    () =>
      new Promise<void>(resolve => {
        finishInit = resolve;
      })
  );
  window.OneID = { get: jest.fn(() => client) };
  const onLogin = jest.fn();
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={onLogin} />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Disney' }));
  await act(async () => {
    finishInit();
  });
  expect(window.OneID.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  act(() => client.listeners.login!({ token }));
  expect(onLogin).toHaveBeenCalledTimes(1);
});

test('a hung SDK initialization must eventually expose Retry', async () => {
  window.OneID = {
    get: jest.fn(() => ({
      init: () => new Promise<void>(() => {}),
      launchLogin: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    })),
  };
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  expect(
    screen.getByRole('button', { name: 'Sign in with Disney' })
  ).toBeInTheDocument();
});

test('Retry after a failed initialization starts it again', async () => {
  const broken = fakeClient(async () => {
    throw new Error('OneID could not initialize');
  });
  const working = fakeClient();
  window.OneID = {
    get: jest.fn().mockReturnValueOnce(broken).mockReturnValue(working),
  };
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Disney sign-in could not start. Check your connection and try again.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Disney' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(window.OneID.get).toHaveBeenCalledTimes(2);
  expect(broken.launchLogin).not.toHaveBeenCalled();
  expect(working.launchLogin).toHaveBeenCalledTimes(1);
});

// Two copies of OneID.js running replaces `window.OneID`. 1.8.3 then built a
// second client on the next render, and the sheet already open reported to
// listeners nobody was current for: the user signed in and nothing happened.
test('keeps the first client when window.OneID is replaced', async () => {
  const client = fakeClient();
  window.OneID = { get: jest.fn(() => client) };
  const onLogin = jest.fn();
  const view = render(
    <LoginForm resort={{ id: 'WDW' }} onLogin={data => onLogin(data)} />
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  const replacement = {
    get: jest.fn(() => fakeClient(() => new Promise<void>(() => {}))),
  };
  window.OneID = replacement;
  // A parent re-render hands over a new onLogin, which starts a new attempt.
  view.rerender(
    <LoginForm resort={{ id: 'WDW' }} onLogin={data => onLogin(data)} />
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(replacement.get).not.toHaveBeenCalled();
  act(() => client.listeners.login!({ token }));
  expect(onLogin).toHaveBeenCalledWith(
    expect.objectContaining({ swid: '{GUEST}', accessToken: 'ACCESS' })
  );
});

test('closing the sheet offers Retry, which reopens it at once', async () => {
  const client = fakeClient();
  window.OneID = { get: jest.fn(() => client) };
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
  act(() => client.listeners.close!({}));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Disney' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(client.launchLogin).toHaveBeenCalledTimes(2);
  expect(window.OneID.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
});

test('an incomplete sign-in result says so and offers Retry', async () => {
  const client = fakeClient();
  window.OneID = { get: jest.fn(() => client) };
  const onLogin = jest.fn();
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={onLogin} />);
  await act(async () => {
    await Promise.resolve();
  });
  act(() => client.listeners.login!({}));
  expect(onLogin).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Disney returned an incomplete sign-in result. Try again.'
  );
  expect(
    screen.getByRole('button', { name: 'Sign in with Disney' })
  ).toBeInTheDocument();
});

test("removes Disney's guest record after initializing and after sign-in", async () => {
  const guestKey = 'TPR-WDW-LBSDK.IOS-PROD.guest';
  const client = fakeClient();
  window.OneID = { get: jest.fn(() => client) };
  localStorage.setItem(guestKey, '{}');
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(guestKey)).toBeNull();
  localStorage.setItem(guestKey, '{}');
  act(() => client.listeners.login!({ token }));
  expect(localStorage.getItem(guestKey)).toBeNull();
});
