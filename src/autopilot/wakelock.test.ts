import {
  holdScreenAwake,
  releaseScreenAwake,
  screenAwakeStatus,
  subscribeScreenAwakeStatus,
  wakeLockHeld,
  wakeLockOwnerCount,
  wakeLockSupported,
} from './wakelock';

/** Stand-in for a `WakeLockSentinel`, including the browser-initiated release. */
function fakeSentinel() {
  const listeners: (() => void)[] = [];
  return {
    released: false,
    release: jest.fn(async function (this: { released: boolean }) {
      this.released = true;
    }),
    addEventListener: jest.fn((type: string, listener: () => void) => {
      if (type === 'release') listeners.push(listener);
    }),
    /** What the browser does when the page is hidden or the battery is low. */
    dropFromBrowser() {
      this.released = true;
      for (const listener of listeners) listener();
    },
  };
}

function installWakeLock(request: (type: string) => Promise<unknown>): {
  request: jest.Mock;
} {
  const wakeLock = { request: jest.fn(request) };
  Object.defineProperty(navigator, 'wakeLock', {
    value: wakeLock,
    configurable: true,
  });
  return wakeLock;
}

function uninstallWakeLock() {
  Reflect.deleteProperty(navigator, 'wakeLock');
}

/** A request the test resolves by hand, to hold it open across a release. */
function deferredRequest() {
  let grant: (sentinel: unknown) => void = () => undefined;
  const request = () =>
    new Promise(resolve => {
      grant = resolve;
    });
  return { request, grant: (s: unknown) => grant(s) };
}

const becomeVisible = () =>
  document.dispatchEvent(new Event('visibilitychange'));

/** Two providers that can be mounted at the same time. */
const OUTER = Symbol('outer');
const INNER = Symbol('inner');

afterEach(async () => {
  // Module-level state: leave no lock, owner or listener behind for the next
  // test.
  await releaseScreenAwake(OUTER);
  await releaseScreenAwake(INNER);
  await releaseScreenAwake();
  uninstallWakeLock();
});

describe('wakeLockSupported()', () => {
  it('is false when the browser lacks the API', () => {
    expect(wakeLockSupported()).toBe(false);
  });

  it('is true once the API is present', () => {
    installWakeLock(async () => fakeSentinel());
    expect(wakeLockSupported()).toBe(true);
  });
});

describe('screenAwakeStatus()', () => {
  it('distinguishes unsupported, idle and held', async () => {
    expect(screenAwakeStatus()).toBe('unsupported');

    installWakeLock(async () => fakeSentinel());
    expect(screenAwakeStatus()).toBe('idle');

    await holdScreenAwake();
    expect(screenAwakeStatus()).toBe('held');

    await releaseScreenAwake();
    expect(screenAwakeStatus()).toBe('idle');
  });

  // The browser can revoke a lock without a call into this module. The status
  // store must hear that sentinel event or every screen keeps saying "held".
  it('publishes the browser release immediately', async () => {
    const sentinel = fakeSentinel();
    installWakeLock(async () => sentinel);
    const changed = jest.fn();
    const unsubscribe = subscribeScreenAwakeStatus(changed);

    await holdScreenAwake();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screenAwakeStatus()).toBe('held');

    sentinel.dropFromBrowser();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(screenAwakeStatus()).toBe('idle');
    unsubscribe();
  });
});

describe('holdScreenAwake()', () => {
  it('requests a screen lock', async () => {
    const wakeLock = installWakeLock(async () => fakeSentinel());
    await holdScreenAwake();
    expect(wakeLock.request).toHaveBeenCalledWith('screen');
    expect(wakeLockHeld()).toBe(true);
  });

  it('does nothing when unsupported', async () => {
    await expect(holdScreenAwake()).resolves.toBeUndefined();
    expect(wakeLockHeld()).toBe(false);
  });

  it('holds only one lock at a time', async () => {
    const wakeLock = installWakeLock(async () => fakeSentinel());
    await holdScreenAwake();
    await holdScreenAwake();
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  // Rejected on a hidden document, an insecure context, or a refusal the
  // browser owes no explanation for. None of them should surface.
  it('swallows a rejected request', async () => {
    installWakeLock(async () => {
      throw new Error('not allowed');
    });
    await expect(holdScreenAwake()).resolves.toBeUndefined();
    expect(wakeLockHeld()).toBe(false);
  });

  // The case that makes this worth having: iOS drops the lock whenever the
  // page is hidden, so returning to the tab has to take it again.
  it('re-acquires after the browser drops the lock', async () => {
    const sentinel = fakeSentinel();
    const wakeLock = installWakeLock(async () => sentinel);
    await holdScreenAwake();

    sentinel.dropFromBrowser();
    expect(wakeLockHeld()).toBe(false);

    becomeVisible();
    await Promise.resolve();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('does not re-acquire while the lock is still held', async () => {
    const wakeLock = installWakeLock(async () => fakeSentinel());
    await holdScreenAwake();
    becomeVisible();
    await Promise.resolve();
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });
});

// `setEnabled` fires holdScreenAwake without awaiting it, so turning autopilot
// straight back off can land while the request is still outstanding.
describe('acquire/release races', () => {
  it('gives back a lock granted after the release', async () => {
    const sentinel = fakeSentinel();
    const { request, grant } = deferredRequest();
    installWakeLock(request as (t: string) => Promise<unknown>);

    const held = holdScreenAwake();
    await releaseScreenAwake();
    grant(sentinel);
    await held;

    expect(wakeLockHeld()).toBe(false);
    expect(sentinel.release).toHaveBeenCalled();
  });

  it('makes one request when two acquires overlap', async () => {
    const sentinel = fakeSentinel();
    const { request, grant } = deferredRequest();
    const wakeLock = installWakeLock(
      request as (t: string) => Promise<unknown>
    );

    const first = holdScreenAwake();
    const second = holdScreenAwake();
    grant(sentinel);
    await Promise.all([first, second]);

    expect(wakeLock.request).toHaveBeenCalledTimes(1);
    expect(wakeLockHeld()).toBe(true);
  });

  it('can acquire again after a release interrupted a request', async () => {
    const stranded = fakeSentinel();
    const { request, grant } = deferredRequest();
    installWakeLock(request as (t: string) => Promise<unknown>);
    const held = holdScreenAwake();
    await releaseScreenAwake();
    grant(stranded);
    await held;

    // A fresh, ordinary request must still work afterwards.
    const wanted = fakeSentinel();
    installWakeLock(async () => wanted);
    await holdScreenAwake();
    expect(wakeLockHeld()).toBe(true);
  });
});

describe('releaseScreenAwake()', () => {
  it('releases a held lock', async () => {
    const sentinel = fakeSentinel();
    installWakeLock(async () => sentinel);
    await holdScreenAwake();
    await releaseScreenAwake();
    expect(sentinel.release).toHaveBeenCalled();
    expect(wakeLockHeld()).toBe(false);
  });

  it('is safe when nothing is held', async () => {
    await expect(releaseScreenAwake()).resolves.toBeUndefined();
  });

  it('stops re-acquiring once released', async () => {
    const wakeLock = installWakeLock(async () => fakeSentinel());
    await holdScreenAwake();
    await releaseScreenAwake();
    becomeVisible();
    await Promise.resolve();
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('survives a sentinel that refuses to release', async () => {
    const sentinel = fakeSentinel();
    sentinel.release = jest.fn(async () => {
      throw new Error('already released');
    });
    installWakeLock(async () => sentinel);
    await holdScreenAwake();
    await expect(releaseScreenAwake()).resolves.toBeUndefined();
    expect(wakeLockHeld()).toBe(false);
  });
});

// The NextLL tab nests a second AutopilotProvider inside the app's own, so
// two of them are mounted whenever that tab is open. This module is a
// singleton, and before owners existed the inner one's unmount released the
// lock the outer one was still holding -- permanently, because the lock is
// only ever requested from the gesture that starts a run.
describe('with more than one owner', () => {
  it('keeps the lock while anyone still wants it', async () => {
    const sentinel = fakeSentinel();
    installWakeLock(async () => sentinel);
    await holdScreenAwake(OUTER);
    await holdScreenAwake(INNER);

    await releaseScreenAwake(INNER);
    expect(wakeLockHeld()).toBe(true);
    expect(sentinel.release).not.toHaveBeenCalled();

    await releaseScreenAwake(OUTER);
    expect(wakeLockHeld()).toBe(false);
    expect(sentinel.release).toHaveBeenCalled();
  });

  it('keeps re-acquiring for the owner that is left', async () => {
    const sentinel = fakeSentinel();
    const wakeLock = installWakeLock(async () => sentinel);
    await holdScreenAwake(OUTER);
    await holdScreenAwake(INNER);
    await releaseScreenAwake(INNER);

    // The browser drops locks on its own -- a dimming screen, a low battery.
    // Returning to the page is when the listener puts one back, and detaching
    // that listener with an owner still holding would leave the screen
    // sleeping for a running poller.
    //
    // The drop is the whole test: without it `acquire` short-circuits on the
    // sentinel it still holds, so no second request could happen either way
    // and the assertion would be satisfied by the first one.
    sentinel.dropFromBrowser();
    becomeVisible();
    await Promise.resolve();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('ignores a second release from the same owner', async () => {
    const sentinel = fakeSentinel();
    installWakeLock(async () => sentinel);
    await holdScreenAwake(OUTER);
    await holdScreenAwake(INNER);

    await releaseScreenAwake(INNER);
    await releaseScreenAwake(INNER);
    expect(wakeLockHeld()).toBe(true);
  });

  // Bumping the generation on a release that is not the last one would make
  // an acquire still in flight for the remaining owner hand back the lock it
  // had just been granted -- the surviving owner would end up holding nothing.
  it('does not cancel an acquire in flight for another owner', async () => {
    const sentinel = fakeSentinel();
    const { request, grant } = deferredRequest();
    installWakeLock(request as (t: string) => Promise<unknown>);

    // One shared request serves both owners, so this is the same in-flight
    // acquire that INNER's release could cancel.
    const held = holdScreenAwake(OUTER);
    void holdScreenAwake(INNER);
    await releaseScreenAwake(INNER);
    grant(sentinel);
    await held;

    expect(wakeLockHeld()).toBe(true);
    expect(sentinel.release).not.toHaveBeenCalled();
  });

  // An unsupported platform grants nothing, but the bookkeeping must still
  // pair up -- otherwise a release from one owner looks like the last one.
  it('tracks owners even where the API is missing', async () => {
    await holdScreenAwake(OUTER);
    await holdScreenAwake(INNER);
    expect(wakeLockOwnerCount()).toBe(2);
    await releaseScreenAwake(INNER);
    expect(wakeLockOwnerCount()).toBe(1);
  });
});
