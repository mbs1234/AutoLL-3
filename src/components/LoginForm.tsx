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
const ONE_ID_TIMEOUT_MS = 15_000;

interface OneIdEventListeners {
  login: (data: any) => void;
  close: () => void;
}

class OneId {
  protected static client: OneIdClient | undefined;
  protected static clientId: string;
  protected static listeners: Partial<OneIdEventListeners> = {};
  protected static initialization?: Promise<OneIdClient>;
  protected static generation = 0;
  protected static launchGeneration = 0;
  protected static sdk?: Window['OneID'];
  protected static controller?: AbortController;
  protected static waiting = new Set<() => boolean>();

  static release() {
    // Let StrictMode's replacement mount share the same initialization.
    void Promise.resolve().then(() => {
      if ([...this.waiting].some(current => current())) return;
      this.controller?.abort();
      this.initialization = undefined;
    });
  }

  static async launchLogin(
    resortId: string,
    onLogin: (data: any) => void,
    onClose: () => void,
    current: () => boolean
  ) {
    const launch = ++this.launchGeneration;
    this.waiting.add(current);
    let client: OneIdClient;
    try {
      client = await this.loadClient(resortId);
    } finally {
      this.waiting.delete(current);
    }
    if (!current() || launch !== this.launchGeneration) return;
    this.on('login', data => {
      if (!current()) return;
      onLogin(data);
      this.deleteGuestData();
    });
    // Closing Disney's sheet is an intentional user action. Re-opening it in
    // a loop made the only escape route closing the whole bookmarklet.
    this.on('close', () => {
      if (current()) onClose();
    });
    client.launchLogin();
  }

  protected static loadClient(resortId: string): Promise<OneIdClient> {
    if (this.client && this.sdk === self.OneID) {
      return Promise.resolve(this.client);
    }
    if (this.initialization) return this.initialization;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Disney sign-in did not initialize in time'));
      }, ONE_ID_TIMEOUT_MS);
    });
    const initialize = async () => {
      await this.loadOneIdScript(controller.signal);
      if (controller.signal.aborted) throw new Error('Sign-in attempt expired');
      const os = navigator.userAgent.includes('Android') ? 'AND' : 'IOS';
      this.clientId = `TPR-${resortId}-LBSDK.${os}`;
      const client = self.OneID!.get({
        clientId: this.clientId,
        responderPage: `${PAGES_BASE}/responder.html`,
      });
      await client.init();
      if (controller.signal.aborted || generation !== this.generation) {
        throw new Error('Sign-in attempt expired');
      }
      this.client = client;
      this.sdk = self.OneID;
      this.deleteGuestData();
      return client;
    };
    const pending = Promise.race([initialize(), deadline]).finally(() => {
      clearTimeout(timer);
      controller.abort();
      if (this.initialization === pending) this.initialization = undefined;
    });
    this.initialization = pending;
    return pending;
  }

  protected static loadOneIdScript(signal: AbortSignal): Promise<void> {
    if (self.OneID) return Promise.resolve();
    const existing = document.getElementById(
      SCRIPT_ID
    ) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        script.removeEventListener('load', loaded);
        script.removeEventListener('error', failed);
        signal.removeEventListener('abort', failed);
      };
      const loaded = () => {
        if (!self.OneID) {
          failed();
          return;
        }
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        script.remove();
        reject(new Error('Disney sign-in could not be loaded'));
      };
      signal.addEventListener('abort', failed, { once: true });
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });
      // Listen before insertion: an already-cached SDK may load before the
      // next task, and missing that event would otherwise become a timeout.
      if (!existing) document.head.appendChild(script);
    });
  }

  protected static on<T extends keyof OneIdEventListeners>(
    type: T,
    listener: OneIdEventListeners[T]
  ) {
    const client = OneId.client;
    if (!client) return;
    if (this.listeners[type]) client.off(type, this.listeners[type]);
    this.listeners[type] = listener;
    client.on(type, listener);
  }

  protected static deleteGuestData() {
    localStorage.removeItem(this.clientId + '-PROD.guest');
  }
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
  const attempt = useRef(0);

  const beginLogin = useCallback(async () => {
    const id = ++attempt.current;
    const current = () => id === attempt.current;
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
        current
      );
    } catch {
      if (!current()) return;
      setState('error');
      setError(
        'Disney sign-in could not start. Check your connection and try again.'
      );
    }
  }, [onLogin, resort.id]);

  useEffect(() => {
    void beginLogin();
    return () => {
      // A generation counter, not a DOM ref: invalidate the latest retry too.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      attempt.current++;
      OneId.release();
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
