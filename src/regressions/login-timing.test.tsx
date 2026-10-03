import { StrictMode } from 'react';

import LoginForm, { resetOneIdForTests } from '@/components/LoginForm';
import { TODAY, act, fireEvent, render, screen } from '@/testing';

// How sign-in behaves on slow park data, scenario by scenario. Two deadlines,
// each bounding only how long one attempt waits: 15 s for OneID.js to
// download, then 30 s for the SDK to initialize. Neither cancels what it
// waits for. A download still under way is waited for again, never repeated,
// and there is only ever one `get()` and `init()` in flight, which a Retry
// joins and which keeps its client however late it lands.

beforeEach(() => {
  // The client is kept for the life of the page; each case is a fresh page.
  resetOneIdForTests();
  delete window.OneID;
  document.getElementById('oneid-script')?.remove();
  // An exact clock: these cases turn on which side of a deadline something
  // lands, and the suite's default fake clock also creeps with real time.
  jest.useFakeTimers({
    now: new Date(`${TODAY}T10:00:00-0400`),
    advanceTimers: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * A OneID client whose `init()` takes `initMs` of fake time, or never settles.
 * It keeps the listeners LoginForm registers, so a case can play Disney's
 * part once the sheet is open.
 */
function fakeClient(initMs: number | 'never') {
  const listeners: { [type: string]: (result: any) => void } = {};
  return {
    init: jest.fn(
      () =>
        new Promise<void>(resolve => {
          if (initMs !== 'never') setTimeout(resolve, initMs);
        })
    ),
    launchLogin: jest.fn(),
    on: jest.fn((type: string, listener: (result: any) => void) => {
      listeners[type] = listener;
    }),
    off: jest.fn((type: string, listener: (result: any) => void) => {
      if (listeners[type] === listener) delete listeners[type];
    }),
    listeners,
  };
}

type FakeClient = ReturnType<typeof fakeClient>;

/** What OneID.js defines as `window.OneID`. */
function fakeSdk(client: FakeClient) {
  return { get: jest.fn(() => client) };
}

/** OneID.js finishes downloading: it runs, defining OneID, and then loads. */
function arrive(script: HTMLElement, sdk: ReturnType<typeof fakeSdk>) {
  window.OneID = sdk;
  fireEvent.load(script);
}

/** Disney reports a completed sign-in through the open sheet. */
function signIn(client: FakeClient) {
  act(() =>
    client.listeners.login!({
      token: {
        swid: '{GUEST}',
        access_token: 'ACCESS',
        exp: new Date('2050-01-01T00:00:00Z').getTime(),
      },
    })
  );
}

/** Lets every promise chain already started run to its end. */
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

/** Moves the clock on by `ms`, running whatever falls due on the way. */
async function elapse(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const script = () =>
  document.getElementById('oneid-script') as HTMLScriptElement | null;
const retryButton = () =>
  screen.queryByRole('button', { name: 'Sign in with Disney' });
const COULD_NOT_START =
  'Disney sign-in could not start. Check your connection and try again.';

const signedIn = expect.objectContaining({
  swid: '{GUEST}',
  accessToken: 'ACCESS',
  resortId: 'WDW',
});

test('(a) a 5 s download and a 12 s initialization sign in without a tap', async () => {
  const client = fakeClient(12_000);
  const sdk = fakeSdk(client);
  const onLogin = jest.fn();
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={onLogin} />);
  await settle();
  await elapse(5_000);
  arrive(script()!, sdk);
  await settle();
  // 15 s in, where one deadline across both used to give up.
  await elapse(10_000);
  expect(retryButton()).not.toBeInTheDocument();
  expect(client.launchLogin).not.toHaveBeenCalled();
  await elapse(2_000);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  signIn(client);
  expect(onLogin).toHaveBeenCalledWith(signedIn);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('(b) a 20 s initialization signs in with one get() and one init()', async () => {
  const client = fakeClient(20_000);
  const sdk = fakeSdk(client);
  const onLogin = jest.fn();
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={onLogin} />);
  await settle();
  await elapse(5_000);
  arrive(script()!, sdk);
  await settle();
  await elapse(19_000);
  expect(retryButton()).not.toBeInTheDocument();
  expect(client.launchLogin).not.toHaveBeenCalled();
  await elapse(1_000);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  signIn(client);
  expect(onLogin).toHaveBeenCalledWith(signedIn);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
});

test('(b) a Retry while initialization still runs joins it, and signs in when it lands', async () => {
  const client = fakeClient(40_000);
  const sdk = fakeSdk(client);
  window.OneID = sdk;
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await settle();
  await elapse(30_000);
  fireEvent.click(retryButton()!);
  await settle();
  expect(screen.getByText('Opening Disney sign-in…')).toBeInTheDocument();
  await elapse(10_000);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
});

test('(c) an initialization that never settles offers Retry 30 s after the download, and Retry joins it', async () => {
  const client = fakeClient('never');
  const sdk = fakeSdk(client);
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await settle();
  await elapse(3_000);
  arrive(script()!, sdk);
  await settle();
  await elapse(29_000);
  expect(retryButton()).not.toBeInTheDocument();
  await elapse(1_000);
  expect(screen.getByRole('alert')).toHaveTextContent(COULD_NOT_START);
  fireEvent.click(retryButton()!);
  await settle();
  expect(retryButton()).not.toBeInTheDocument();
  // The Retry gets a deadline of its own, and still no second client.
  await elapse(30_000);
  expect(screen.getByRole('alert')).toHaveTextContent(COULD_NOT_START);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
  expect(client.launchLogin).not.toHaveBeenCalled();
});

test('(c) an initialization that lands after the deadline is kept for the next Retry', async () => {
  const client = fakeClient(45_000);
  const sdk = fakeSdk(client);
  window.OneID = sdk;
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await settle();
  await elapse(30_000);
  expect(retryButton()).toBeInTheDocument();
  // It lands with nobody waiting, and opens nothing by itself.
  await elapse(15_000);
  expect(client.launchLogin).not.toHaveBeenCalled();
  fireEvent.click(retryButton()!);
  await settle();
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
});

test.each([
  ['fails', (failed: HTMLElement) => fireEvent.error(failed)],
  [
    'runs without defining OneID',
    (failed: HTMLElement) => fireEvent.load(failed),
  ],
])(
  '(d) Retry after a download that %s downloads again, into a new element',
  async (_, fail) => {
    const client = fakeClient(0);
    const sdk = fakeSdk(client);
    render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
    await settle();
    const failed = script()!;
    fail(failed);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(COULD_NOT_START);
    expect(failed).not.toBeInTheDocument();
    fireEvent.click(retryButton()!);
    const fresh = script();
    expect(fresh).toBeInTheDocument();
    expect(fresh).not.toBe(failed);
    arrive(fresh!, sdk);
    await settle();
    expect(client.launchLogin).toHaveBeenCalledTimes(1);
    expect(sdk.get).toHaveBeenCalledTimes(1);
  }
);

test('(d) a download that fails while nobody waits is replaced by the next attempt', async () => {
  const client = fakeClient(0);
  const sdk = fakeSdk(client);
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await settle();
  const failed = script()!;
  await elapse(15_000);
  fireEvent.error(failed);
  expect(failed).not.toBeInTheDocument();
  fireEvent.click(retryButton()!);
  const fresh = script();
  expect(fresh).not.toBe(failed);
  arrive(fresh!, sdk);
  await settle();
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
});

test('(e) a download that lands while nobody waits serves the next attempt', async () => {
  const client = fakeClient(0);
  const sdk = fakeSdk(client);
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await settle();
  const slow = script()!;
  await elapse(15_000);
  arrive(slow, sdk);
  await settle();
  expect(client.launchLogin).not.toHaveBeenCalled();
  fireEvent.click(retryButton()!);
  await settle();
  expect(script()).toBe(slow);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  expect(sdk.get).toHaveBeenCalledTimes(1);
});

test('(e) Retry during a download that is merely slow waits for that same download', async () => {
  const appended = jest.spyOn(document.head, 'appendChild');
  const client = fakeClient(1_000);
  const sdk = fakeSdk(client);
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await settle();
  const slow = script()!;
  await elapse(15_000);
  expect(screen.getByRole('alert')).toHaveTextContent(COULD_NOT_START);
  expect(slow).toBeInTheDocument();
  fireEvent.click(retryButton()!);
  await settle();
  expect(script()).toBe(slow);
  await elapse(5_000);
  arrive(slow, sdk);
  await elapse(1_000);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('script')).toHaveLength(1);
  const scripts = appended.mock.calls.filter(
    ([node]) => node instanceof HTMLScriptElement
  );
  expect(scripts).toHaveLength(1);
});

test('(e) an attempt that stops waiting for a slow download leaves no listeners on it', async () => {
  const added = jest.spyOn(EventTarget.prototype, 'addEventListener');
  const removed = jest.spyOn(EventTarget.prototype, 'removeEventListener');
  /**
   * How many listeners `target` has now: every one added to it, less those
   * removed since, either directly or by aborting the signal they came with.
   */
  const listenersOn = (target: EventTarget) => {
    const attached: [unknown, unknown][] = [];
    added.mock.calls.forEach(([type, listener, options], call) => {
      if (added.mock.contexts[call] !== target) return;
      if (typeof options === 'object' && options.signal?.aborted) return;
      attached.push([type, listener]);
    });
    removed.mock.calls.forEach(([type, listener], call) => {
      if (removed.mock.contexts[call] !== target) return;
      const at = attached.findIndex(([t, l]) => t === type && l === listener);
      if (at >= 0) attached.splice(at, 1);
    });
    return attached.length;
  };
  const client = fakeClient(0);
  const sdk = fakeSdk(client);
  const { unmount } = render(
    <LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />
  );
  await settle();
  const slow = script()!;
  const whileWaiting = listenersOn(slow);
  // Leaving abandons the attempt but not the download.
  await elapse(5_000);
  unmount();
  expect(slow).toBeInTheDocument();
  const idle = listenersOn(slow);
  expect(idle).toBeLessThan(whileWaiting);
  // The next mount waits on the same element, and giving up on time leaves
  // it as clean as leaving did, however often that happens.
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />);
  await settle();
  expect(script()).toBe(slow);
  expect(listenersOn(slow)).toBe(whileWaiting);
  await elapse(15_000);
  expect(listenersOn(slow)).toBe(idle);
  fireEvent.click(retryButton()!);
  await elapse(15_000);
  expect(listenersOn(slow)).toBe(idle);
  // And the download, when it does arrive, is still the one waited for.
  fireEvent.click(retryButton()!);
  await settle();
  arrive(slow, sdk);
  await settle();
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  expect(listenersOn(slow)).toBe(idle);
});

test('(f) StrictMode starts once: one get(), one init(), one sheet', async () => {
  const client = fakeClient(0);
  const sdk = fakeSdk(client);
  window.OneID = sdk;
  render(
    <StrictMode>
      <LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />
    </StrictMode>
  );
  await settle();
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
});

test('(f) StrictMode with OneID.js still to download: one element, one get(), one init(), one sheet', async () => {
  const client = fakeClient(0);
  const sdk = fakeSdk(client);
  render(
    <StrictMode>
      <LoginForm resort={{ id: 'WDW' }} onLogin={() => {}} />
    </StrictMode>
  );
  await settle();
  expect(document.querySelectorAll('script')).toHaveLength(1);
  arrive(script()!, sdk);
  await settle();
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
});

test('(g) an attempt replaced mid-initialization cannot open the sheet', async () => {
  const client = fakeClient(10_000);
  const sdk = fakeSdk(client);
  window.OneID = sdk;
  const replaced = jest.fn();
  const current = jest.fn();
  const view = render(<LoginForm resort={{ id: 'WDW' }} onLogin={replaced} />);
  await settle();
  await elapse(5_000);
  // A parent re-render hands over a new onLogin, which starts a new attempt.
  view.rerender(<LoginForm resort={{ id: 'WDW' }} onLogin={current} />);
  await settle();
  await elapse(5_000);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  expect(client.init).toHaveBeenCalledTimes(1);
  signIn(client);
  expect(current).toHaveBeenCalledWith(signedIn);
  expect(replaced).not.toHaveBeenCalled();
});

test('(g) of two sign-in forms waiting together, only the newer opens the sheet', async () => {
  const client = fakeClient(10_000);
  const sdk = fakeSdk(client);
  window.OneID = sdk;
  const older = jest.fn();
  const newer = jest.fn();
  render(
    <>
      <LoginForm resort={{ id: 'WDW' }} onLogin={older} />
      <LoginForm resort={{ id: 'WDW' }} onLogin={newer} />
    </>
  );
  await settle();
  await elapse(10_000);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  expect(sdk.get).toHaveBeenCalledTimes(1);
  signIn(client);
  expect(newer).toHaveBeenCalledWith(signedIn);
  expect(older).not.toHaveBeenCalled();
});

test('the time spent in Disney’s sheet is never timed', async () => {
  const client = fakeClient(0);
  window.OneID = fakeSdk(client);
  const onLogin = jest.fn();
  render(<LoginForm resort={{ id: 'WDW' }} onLogin={onLogin} />);
  await settle();
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
  await elapse(10 * 60_000);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(retryButton()).not.toBeInTheDocument();
  signIn(client);
  expect(onLogin).toHaveBeenCalledWith(signedIn);
  expect(client.launchLogin).toHaveBeenCalledTimes(1);
});
