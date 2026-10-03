import { StrictMode } from 'react';

import LoginForm from '@/components/LoginForm';
import { act, cleanup, fireEvent, render, screen, setTime } from '@/testing';

beforeEach(async () => {
  cleanup();
  await act(async () => {
    await Promise.resolve();
  });
  delete window.OneID;
  document.getElementById('oneid-script')?.remove();
  setTime('10:00:00');
});

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

test('a timed-out initialization cannot replace a successful retry', async () => {
  let finishOld!: () => void;
  const old = {
    init: jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishOld = resolve;
        })
    ),
    launchLogin: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  };
  const fresh = {
    ...old,
    init: jest.fn(async () => {}),
    launchLogin: jest.fn(),
  };
  window.OneID = {
    get: jest.fn().mockReturnValueOnce(old).mockReturnValue(fresh),
  };
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(15_000);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Disney' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(fresh.launchLogin).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishOld();
  });
  expect(old.launchLogin).not.toHaveBeenCalled();
  expect(fresh.launchLogin).toHaveBeenCalledTimes(1);
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
