import { useCallback, useEffect, useRef, useState } from 'react';

import { AuthData, AuthStatus } from '@/api/auth';
import { Resort } from '@/api/resort';
import { PAGES_BASE } from '@/appIdentity';

type EventListener = (result: any) => void;

interface OneIdClient {
  init: () => Promise<void>;
  launchLogin: () => void;
  on: (type: string, listener: EventListener) => void;
  off: (type: string, listener: EventListener) => void;
}

declare global {
  interface Window {
    OneID?: {
      get: (config: any) => OneIdClient;
    };
  }
}

const SCRIPT_URL = 'https://cdn.registerdisney.go.com/v4/OneID.js';
const SCRIPT_ID = 'oneid-script';
const WRAPPER_ID = 'oneid-wrapper';
/** How long one attempt waits for OneID.js to download. */
const SCRIPT_TIMEOUT_MS = 15_000;
/**
 * How long one attempt waits for the SDK to initialize, from the moment it
 * starts waiting -- after the download, which has its own deadline. On slow
 * park data the two together have taken 17-20 s, so one deadline across both
 * gave up on sign-ins that were about to work. Giving up never restarts the
 * initialization, so this only decides when Retry appears.
 */
const INIT_TIMEOUT_MS = 30_000;
const ABANDONED = 'Sign-in attempt abandoned';

/**
 * Waits on behalf of one sign-in attempt: for at most `ms`, and only while the
 * attempt is current. Giving up, on time or because the attempt was abandoned,
 * detaches every listener `listen` attached with the `waiting` signal but
 * cancels nothing. A slow download or initialization carries on, and the next
 * attempt waits for it again instead of starting over.
 */
function waitAtMost<T>(
  ms: number,
  attempt: AbortSignal,
  timeoutMessage: string,
  listen: (
    resolve: (value: T) => void,
    reject: (error: unknown) => void,
    waiting: AbortSignal
  ) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (attempt.aborted) {
      reject(new Error(ABANDONED));
      return;
    }
    const waiting = new AbortController();
    const finish = (settle: () => void) => {
      if (waiting.signal.aborted) return;
      waiting.abort();
      clearTimeout(timer);
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(timeoutMessage))),
      ms
    );
    attempt.addEventListener(
      'abort',
      () => finish(() => reject(new Error(ABANDONED))),
      { signal: waiting.signal }
    );
    listen(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
      waiting.signal
    );
  });
}

interface OneIdEventListeners {
  login: (data: any) => void;
  close: () => void;
}

class OneId {
  protected static client: OneIdClient | undefined;
  protected static clientId: string;
  protected static listeners: Partial<OneIdEventListeners> = {};
  /**
   * `get()` and `init()` while they run: at most one at a time, shared by
   * every attempt, and never cut short when one stops waiting for it.
   */
  protected static initialization?: Promise<OneIdClient>;
  protected static launchGeneration = 0;

  static async launchLogin(
    resortId: string,
    onLogin: (data: any) => void,
    onClose: () => void,
    signal: AbortSignal
  ) {
    const launch = ++this.launchGeneration;
    const client = await this.loadClient(resortId, signal);
    if (signal.aborted || launch !== this.launchGeneration) return;
    this.on(client, 'login', data => {
      if (signal.aborted) return;
      onLogin(data);
      this.deleteGuestData();
    });
    // Closing Disney's sheet is an intentional user action. Re-opening it in
    // a loop made the only escape route closing the whole bookmarklet.
    this.on(client, 'close', () => {
      if (!signal.aborted) onClose();
    });
    // Nothing is timed from here on: the sheet takes as long as the user's
    // typing and two-factor code do.
    client.launchLogin();
  }

  static resetForTests() {
    this.client = undefined;
    this.listeners = {};
    this.initialization = undefined;
  }

  protected static async loadClient(resortId: string, signal: AbortSignal) {
    // Whenever there is one, even if `window.OneID` has since been replaced:
    // a second client would leave an open sheet reporting to the first.
    if (this.client) return this.client;
    if (!this.initialization) {
      await this.loadOneIdScript(signal);
      // Another attempt may have started initializing, or finished, meanwhile.
      if (this.client) return this.client;
      if (signal.aborted) throw new Error(ABANDONED);
    }
    const initialization = this.initialization ?? this.initialize(resortId);
    return waitAtMost<OneIdClient>(
      INIT_TIMEOUT_MS,
      signal,
      'Disney sign-in did not initialize in time',
      (resolve, reject) => {
        initialization.then(resolve, reject);
      }
    );
  }

  protected static initialize(resortId: string) {
    const os = navigator.userAgent.includes('Android') ? 'AND' : 'IOS';
    this.clientId = `TPR-${resortId}-LBSDK.${os}`;
    const initialization = (async () => {
      const client = self.OneID!.get({
        clientId: this.clientId,
        responderPage: `${PAGES_BASE}/responder.html`,
      });
      await client.init();
      return client;
    })();
    this.initialization = initialization;
    // Attached before any attempt waits, so this runs before any launches.
    initialization.then(
      client => {
        if (this.initialization !== initialization) return;
        this.initialization = undefined;
        // Kept however late it arrives, even after every attempt has given
        // up on it: the next Retry then opens the sheet straight away.
        this.client = client;
        this.deleteGuestData();
      },
      () => {
        // Nothing to keep: the next attempt starts over with a fresh get().
        if (this.initialization === initialization) {
          this.initialization = undefined;
        }
      }
    );
    return initialization;
  }

  protected static loadOneIdScript(signal: AbortSignal): Promise<void> {
    if (self.OneID) return Promise.resolve();
    const existing = document.getElementById(
      SCRIPT_ID
    ) as HTMLScriptElement | null;
    let script: HTMLScriptElement;
    if (existing?.dataset.state === 'loading') {
      // Wait for this download again rather than repeat it. Removing the
      // element would not stop the browser fetching and running it, so a
      // second element could run OneID.js twice.
      script = existing;
    } else {
      // Anything else ended without OneID, or is not ours: replace it, so
      // that Retry really does download again.
      existing?.remove();
      script = this.createScript();
    }
    return waitAtMost<void>(
      SCRIPT_TIMEOUT_MS,
      signal,
      'Disney sign-in did not load in time',
      (resolve, reject, waiting) => {
        const settled = () => {
          // The element's own listeners ran first and recorded the outcome.
          if (script.dataset.state === 'loading') return;
          if (self.OneID) resolve();
          else reject(new Error('Disney sign-in could not be loaded'));
        };
        script.addEventListener('load', settled, { signal: waiting });
        script.addEventListener('error', settled, { signal: waiting });
        // Listen before insertion: an already-cached SDK may load before the
        // next task, and missing that event would otherwise become a timeout.
        if (!script.isConnected) document.head.appendChild(script);
      }
    );
  }

  /**
   * Creates the OneID.js element, with listeners attached once, here, that
   * record how its download ends in `data-state`: `loading`, then `loaded` or
   * `failed`. They go on recording after every attempt has stopped waiting,
   * which is how the next attempt tells a download to wait for from one to
   * replace. A failed element is removed at once.
   */
  protected static createScript() {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.dataset.state = 'loading';
    const failed = () => {
      script.dataset.state = 'failed';
      script.remove();
    };
    script.addEventListener('load', () => {
      if (self.OneID) script.dataset.state = 'loaded';
      else failed();
    });
    script.addEventListener('error', failed);
    return script;
  }

  protected static on<T extends keyof OneIdEventListeners>(
    client: OneIdClient,
    type: T,
    listener: OneIdEventListeners[T]
  ) {
    if (this.listeners[type]) client.off(type, this.listeners[type]);
    this.listeners[type] = listener;
    client.on(type, listener);
  }

  protected static deleteGuestData() {
    localStorage.removeItem(this.clientId + '-PROD.guest');
  }
}

/** Test seam: forget the SDK client and any initialization, as a reload does. */
// eslint-disable-next-line react-refresh/only-export-components
export function resetOneIdForTests() {
  OneId.resetForTests();
}

export default function LoginForm({
  resort,
  onLogin,
  reason,
}: {
  resort: Pick<Resort, 'id'>;
  onLogin: (data: AuthData) => void;
  reason?: AuthStatus;
}) {
  const [state, setState] = useState<'starting' | 'ready' | 'error'>(
    'starting'
  );
  const [error, setError] = useState('');
  const attempt = useRef<AbortController>(undefined);

  const beginLogin = useCallback(async () => {
    // A new attempt abandons the one before, which stops waiting at once.
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    const { signal } = controller;
    setState('starting');
    setError('');
    try {
      await OneId.launchLogin(
        resort.id,
        ({ token }: any) => {
          try {
            onLogin({
              swid: token.swid,
              accessToken: token.access_token,
              expires: new Date(token.exp).getTime(),
              resortId: resort.id,
              version: 1,
              receivedAt: Date.now(),
            });
          } catch {
            setState('error');
            setError(
              'Disney returned an incomplete sign-in result. Try again.'
            );
          }
        },
        () => setState('ready'),
        signal
      );
    } catch {
      if (signal.aborted) return;
      setState('error');
      setError(
        'Disney sign-in could not start. Check your connection and try again.'
      );
    }
  }, [onLogin, resort.id]);

  useEffect(() => {
    void beginLogin();
    return () => {
      // The latest attempt, read now, so a retry started since is abandoned
      // too. Only the waiting stops; a download or initialization under way
      // goes on for the next mount.
      attempt.current?.abort();
    };
  }, [beginLogin]);

  useEffect(() => {
    return () => {
      const wrapper = document.getElementById(WRAPPER_ID);
      wrapper?.parentNode?.removeChild(wrapper);
    };
  }, []);

  return (
    <div className="fixed inset-0 grid place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3 rounded-lg bg-white p-5 text-black shadow-lg">
        <h1>Sign in to Disney</h1>
        {reason === 'expires-before-park-close' && (
          <p>
            Your saved session ends before 5:00 PM park time. Sign in again
            before using Autopilot.
          </p>
        )}
        {reason === 'expired' && <p>Your Disney session has expired.</p>}
        {reason === 'wrong-resort' && (
          <p>This saved session belongs to a different resort.</p>
        )}
        {reason === 'invalid' && (
          <p>Your saved session could not be read safely.</p>
        )}
        {error && <p role="alert">{error}</p>}
        {state !== 'starting' && (
          <button className="button" onClick={() => void beginLogin()}>
            Sign in with Disney
          </button>
        )}
        {state === 'starting' && <p>Opening Disney sign-in…</p>}
      </div>
    </div>
  );
}
