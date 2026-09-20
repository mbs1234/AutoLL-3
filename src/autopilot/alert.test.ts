import { NOTIFICATION_TAG_NAMESPACE } from '@/storageNamespace';

import {
  BACKGROUND_RESUME_REUSE_MS,
  RESUME_REPLAY_MS,
  SOUND_CHECK_TIMEOUT_MS,
  TEST_CHIME_GUARD_MS,
  alertPermission,
  audioReady,
  audioStatus,
  chime,
  fireAlert,
  primeAudio,
  rearmAudio,
  requestAlertPermission,
  resetAudioForTests,
  soundCheck,
  subscribeAudioStatus,
} from './alert';

/** The chime is two notes; asserting on the count keeps that honest. */
const CHIME_NOTES = 2;

// Omit the lib.dom declarations before re-adding them as `unknown`. An
// intersection would not help: `AudioContext & unknown` collapses back to the
// real DOM type, so assigning a partial double would still be an error.
type Global = Omit<typeof globalThis, 'Notification' | 'AudioContext'> & {
  Notification?: unknown;
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
};

const g = globalThis as Global;

/** Minimal AudioContext double: records what got scheduled. */
function fakeAudioContext(state: string = 'running') {
  const started: number[] = [];
  const stateListeners = new Set<() => void>();
  // Settles a task later, as a browser's does. A double that woke the context
  // synchronously would hide the bug this file exists to pin: priming and
  // chiming in one tick plays nothing, because the context is not awake yet.
  const resume = jest.fn(async () => {
    await Promise.resolve();
    ctx.state = 'running';
    for (const listener of stateListeners) listener();
  });
  // The silent one-frame source that unlocks output on iOS. Counted rather
  // than inspected: that it was started at all is the whole behaviour.
  const unlocks: number[] = [];
  const gainNode = {
    gain: {
      setValueAtTime: jest.fn(),
      linearRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(() => ({})),
  };
  const ctx = {
    state,
    currentTime: 0,
    resume,
    createOscillator: jest.fn(() => ({
      type: '',
      frequency: { value: 0 },
      connect: jest.fn(() => gainNode),
      start: jest.fn((t: number) => started.push(t)),
      stop: jest.fn(),
    })),
    createGain: jest.fn(() => gainNode),
    sampleRate: 48_000,
    createBuffer: jest.fn(() => ({})),
    createBufferSource: jest.fn(() => ({
      buffer: undefined as unknown,
      connect: jest.fn(),
      start: jest.fn((t: number) => unlocks.push(t)),
    })),
    destination: {},
    addEventListener: jest.fn((type: string, listener: () => void) => {
      if (type === 'statechange') stateListeners.add(listener);
    }),
    removeEventListener: jest.fn((type: string, listener: () => void) => {
      if (type === 'statechange') stateListeners.delete(listener);
    }),
    setState(next: string) {
      this.state = next;
      for (const listener of stateListeners) listener();
    },
  };
  return { ctx, started, resume, unlocks };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settleResume(): Promise<void> {
  // async resume -> status continuation -> finally -> chime continuation
  for (let i = 0; i < 4; ++i) await Promise.resolve();
}

function stubNotification(
  permission: NotificationPermission,
  impl?: () => void
) {
  const ctor = jest.fn(impl ?? (() => undefined));
  const requestPermission = jest.fn(async () => permission);
  g.Notification = Object.assign(ctor, { permission, requestPermission });
  return { ctor, requestPermission };
}

beforeEach(() => {
  resetAudioForTests();
  delete g.Notification;
  delete g.AudioContext;
  delete g.webkitAudioContext;
  jest.restoreAllMocks();
});

it('never reuses a background resume after an alert becomes stale', () => {
  expect(BACKGROUND_RESUME_REUSE_MS).toBeLessThanOrEqual(RESUME_REPLAY_MS);
});

describe('alertPermission()', () => {
  // iOS Safari exposes Notification only to installed PWAs, so absence is a
  // normal state to handle rather than an error.
  it('reports unsupported when the API is missing', () => {
    expect(alertPermission()).toBe('unsupported');
  });

  it('reports the current permission', () => {
    stubNotification('granted');
    expect(alertPermission()).toBe('granted');
  });
});

describe('requestAlertPermission()', () => {
  it('reports unsupported when the API is missing', async () => {
    await expect(requestAlertPermission()).resolves.toBe('unsupported');
  });

  it('does not prompt when already decided', async () => {
    const { requestPermission } = stubNotification('denied');
    await expect(requestAlertPermission()).resolves.toBe('denied');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('prompts when undecided', async () => {
    stubNotification('default');
    const requestPermission = jest.fn(async () => 'granted');
    (g.Notification as { requestPermission: unknown }).requestPermission =
      requestPermission;
    await expect(requestAlertPermission()).resolves.toBe('granted');
    expect(requestPermission).toHaveBeenCalled();
  });

  // Safari has historically thrown here instead of resolving.
  it('treats a throwing prompt as denied', async () => {
    stubNotification('default');
    (g.Notification as { requestPermission: jest.Mock }).requestPermission =
      jest.fn(() => {
        throw new Error('nope');
      });
    await expect(requestAlertPermission()).resolves.toBe('denied');
  });
});

describe('primeAudio()', () => {
  it('does nothing without an AudioContext implementation', () => {
    primeAudio();
    expect(audioReady()).toBe(false);
  });

  it('creates a running context', () => {
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    expect(audioReady()).toBe(true);
  });

  // Mobile browsers hand back a suspended context and refuse to resume it
  // outside a user gesture, which is why priming happens on the toggle.
  it('resumes a suspended context', () => {
    const { ctx, resume } = fakeAudioContext('suspended');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    expect(resume).toHaveBeenCalled();
  });

  // The regression this exists for: resume() alone left a phone silent for a
  // whole run. WebKit wants a source to have been started inside the gesture
  // before it will let the context sound.
  it('starts a silent source, which is what actually unlocks iOS', () => {
    const { ctx, unlocks } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    expect(unlocks).toHaveLength(1);
  });

  // iOS parks a context here when the screen locks or a call arrives. It is
  // not in the DOM state union, and testing for 'suspended' missed it, so a
  // single interruption used to end the run's only alert channel.
  it('resumes a context iOS interrupted, not just a suspended one', () => {
    const { ctx, resume } = fakeAudioContext('interrupted');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    expect(resume).toHaveBeenCalled();
  });

  it('falls back to the webkit-prefixed constructor', () => {
    const { ctx } = fakeAudioContext('running');
    g.webkitAudioContext = jest.fn(() => ctx);
    primeAudio();
    expect(audioReady()).toBe(true);
  });

  it('survives a constructor that throws', () => {
    g.AudioContext = jest.fn(() => {
      throw new Error('blocked');
    });
    expect(() => primeAudio()).not.toThrow();
    expect(audioReady()).toBe(false);
  });

  it('keeps the context when the engine has no buffer sources', () => {
    const { ctx } = fakeAudioContext('running');
    ctx.createBufferSource = jest.fn(() => {
      throw new Error('unimplemented');
    }) as unknown as typeof ctx.createBufferSource;
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    // Oscillators are all `chime` needs; a failed unlock must not cost the
    // context on an engine that never needed unlocking.
    expect(audioReady()).toBe(true);
  });
});

describe('audioStatus()', () => {
  it('reports unsupported where there is no AudioContext at all', () => {
    expect(audioStatus()).toBe('unsupported');
  });

  it('reports idle until something primes it', () => {
    const { ctx } = fakeAudioContext('suspended');
    g.AudioContext = jest.fn(() => ctx);
    expect(audioStatus()).toBe('idle');
    primeAudio();
    ctx.state = 'suspended';
    expect(audioStatus()).toBe('idle');
  });

  it('reports armed once the context is running', () => {
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    expect(audioStatus()).toBe('armed');
  });

  it('publishes an interruption immediately from the context state event', () => {
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    const changed = jest.fn();
    const unsubscribe = subscribeAudioStatus(changed);

    ctx.setState('interrupted');

    expect(changed).toHaveBeenCalledTimes(1);
    expect(audioStatus()).toBe('idle');
    unsubscribe();
  });
});

describe('rearmAudio()', () => {
  it('coalesces background recovery only inside the bounded reuse window', () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    const first = deferred();
    const second = deferred();
    ctx.resume = jest
      .fn<Promise<void>, []>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    rearmAudio();
    now += BACKGROUND_RESUME_REUSE_MS;
    rearmAudio();
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    now += 1;
    rearmAudio();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('lets a provider visibility rearm replace a resume that never settles', () => {
    let now = 2_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    ctx.resume = jest.fn(() => new Promise<void>(() => undefined));

    rearmAudio();
    now += BACKGROUND_RESUME_REUSE_MS + 1;
    rearmAudio();

    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('does not let an old promise erase a newer background attempt', async () => {
    let now = 3_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    const first = deferred();
    const second = deferred();
    ctx.resume = jest
      .fn<Promise<void>, []>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    rearmAudio();
    now += BACKGROUND_RESUME_REUSE_MS + 1;
    rearmAudio();
    first.resolve();
    await settleResume();
    rearmAudio();

    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('starts another recovery after a native self-recovery and interruption', () => {
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    ctx.resume = jest.fn(() => new Promise<void>(() => undefined));

    rearmAudio();
    ctx.setState('running');
    ctx.setState('interrupted');
    rearmAudio();

    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });
});

describe('soundCheck()', () => {
  // The button exists because the only way to discover a dead alert channel
  // was to wait for a real find and notice the silence.
  it('wakes a sleeping context and then plays', async () => {
    const { ctx, started, resume } = fakeAudioContext('suspended');
    g.AudioContext = jest.fn(() => ctx);
    await expect(soundCheck()).resolves.toBe('armed');
    expect(resume).toHaveBeenCalled();
    expect(started).toHaveLength(CHIME_NOTES);
  });

  // Awaiting the resume is the point: priming and chiming in one tick sees a
  // context that has not woken up yet and plays nothing.
  it('would play nothing without waiting for the resume', () => {
    const { ctx, started } = fakeAudioContext('suspended');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    chime();
    expect(started).toHaveLength(0);
  });

  it('reports idle when the context refuses to wake', async () => {
    const { ctx } = fakeAudioContext('suspended');
    ctx.resume = jest.fn(async () => {
      throw new Error('gesture required');
    });
    g.AudioContext = jest.fn(() => ctx);
    await expect(soundCheck()).resolves.toBe('idle');
  });

  it('does not inherit a wedged background recovery attempt', async () => {
    jest.useFakeTimers();
    try {
      const { ctx } = fakeAudioContext('running');
      g.AudioContext = jest.fn(() => ctx);
      primeAudio();
      ctx.state = 'interrupted';
      ctx.resume = jest.fn(() => new Promise<void>(() => undefined));

      rearmAudio();
      const result = soundCheck();
      expect(ctx.resume).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(SOUND_CHECK_TIMEOUT_MS);
      await result;
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives three pending presses fresh resumes but only the newest may play', async () => {
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    const attempts = [deferred(), deferred(), deferred()];
    let next = 0;
    ctx.resume = jest.fn(() => attempts[next++]!.promise);

    const checks = [soundCheck(), soundCheck(), soundCheck()];
    expect(ctx.resume).toHaveBeenCalledTimes(3);
    ctx.state = 'running';
    attempts[0]!.resolve();
    await settleResume();
    expect(started).toHaveLength(0);

    ctx.state = 'interrupted';
    attempts[1]!.resolve();
    await settleResume();
    expect(started).toHaveLength(0);

    ctx.state = 'running';
    attempts[2]!.resolve();
    await Promise.all(checks);

    expect(started).toHaveLength(CHIME_NOTES);
  });

  it('always resolves when WebKit leaves a gesture resume pending', async () => {
    jest.useFakeTimers();
    try {
      const { ctx } = fakeAudioContext('running');
      g.AudioContext = jest.fn(() => ctx);
      primeAudio();
      ctx.state = 'interrupted';
      ctx.resume = jest.fn(() => new Promise<void>(() => undefined));

      const result = soundCheck();
      await jest.advanceTimersByTimeAsync(SOUND_CHECK_TIMEOUT_MS);

      await expect(result).resolves.toBe('idle');
    } finally {
      jest.useRealTimers();
    }
  });

  it('publishes a late recovery without playing a delayed diagnostic', async () => {
    jest.useFakeTimers();
    try {
      const { ctx, started } = fakeAudioContext('running');
      g.AudioContext = jest.fn(() => ctx);
      primeAudio();
      ctx.state = 'interrupted';
      const gate = deferred();
      ctx.resume = jest.fn(() => gate.promise);

      const result = soundCheck();
      await jest.advanceTimersByTimeAsync(SOUND_CHECK_TIMEOUT_MS);
      await expect(result).resolves.toBe('idle');

      ctx.setState('running');
      gate.resolve();
      await settleResume();
      expect(audioStatus()).toBe('armed');
      expect(started).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('guards only diagnostic playback for exactly the derived chime length', async () => {
    let now = 5_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { ctx, started, resume } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();

    await soundCheck();
    await soundCheck();
    expect(started).toHaveLength(CHIME_NOTES);

    now += TEST_CHIME_GUARD_MS;
    await soundCheck();
    expect(resume).toHaveBeenCalledTimes(3);
    expect(started).toHaveLength(CHIME_NOTES * 2);
  });
});

describe('chime()', () => {
  it('does nothing when audio was never primed', () => {
    expect(() => chime()).not.toThrow();
  });

  // Scheduling into a suspended context queues notes that all fire at once
  // when it eventually resumes.
  it('does nothing while the context is suspended', () => {
    const { ctx } = fakeAudioContext('suspended');
    ctx.resume = jest.fn(async () => undefined) as never;
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'suspended';
    chime();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  // This is the alert that motivated recovery: on iOS there may be no
  // notification or vibration channel to compensate for losing it.
  it('resumes and plays the current alert when recovery is prompt', async () => {
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    const gate = deferred();
    ctx.resume = jest.fn(async () => {
      await gate.promise;
      ctx.setState('running');
    });

    chime();
    expect(started).toHaveLength(0);
    expect(ctx.resume).toHaveBeenCalled();

    gate.resolve();
    await gate.promise;
    await settleResume();
    expect(started).toHaveLength(CHIME_NOTES);
  });

  it('plays once when statechange wins and the original resume settles later', async () => {
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    const gate = deferred();
    ctx.resume = jest.fn(() => gate.promise);

    chime();
    ctx.setState('running');
    expect(started).toHaveLength(CHIME_NOTES);

    gate.resolve();
    await settleResume();
    expect(started).toHaveLength(CHIME_NOTES);
  });

  // A context can stay pending until the page is foregrounded. Sounding then
  // would claim an old offer had just appeared, which is less honest than
  // dropping the audio channel for that alert.
  it('drops a replay whose resume settles after the freshness deadline', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    const gate = deferred();
    ctx.resume = jest.fn(async () => {
      await gate.promise;
      ctx.setState('running');
    });

    chime();
    now += RESUME_REPLAY_MS + 1;
    gate.resolve();
    await gate.promise;
    await settleResume();

    expect(started).toHaveLength(0);
  });

  it('stays silent and retryable when resume is rejected', async () => {
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    ctx.resume = jest.fn(async () => {
      throw new Error('gesture required');
    });

    chime();
    await settleResume();
    expect(started).toHaveLength(0);
    expect(audioStatus()).toBe('idle');

    chime();
    await settleResume();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh alert recovery after the background reuse window', () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    ctx.resume = jest.fn(() => new Promise<void>(() => undefined));

    chime();
    now += BACKGROUND_RESUME_REUSE_MS + 1;
    chime();

    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent alerts and uses the newest request time', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    ctx.state = 'interrupted';
    const gate = deferred();
    ctx.resume = jest.fn(async () => {
      await gate.promise;
      ctx.setState('running');
    });

    chime();
    now += RESUME_REPLAY_MS - 1;
    chime();
    now += 2;
    gate.resolve();
    await gate.promise;
    await settleResume();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(started).toHaveLength(CHIME_NOTES);
  });

  it('schedules both notes in sequence', () => {
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    chime();
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    expect(started).toHaveLength(2);
    expect(started[1]!).toBeGreaterThan(started[0]!);
  });

  it('leaves already-running real alerts uncoalesced', () => {
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    chime();
    chime();
    expect(started).toHaveLength(CHIME_NOTES * 2);
  });
});

describe('fireAlert()', () => {
  it('posts a notification when permitted', () => {
    const { ctor } = stubNotification('granted');
    fireAlert({
      title: 'Slinky Dog',
      body: '11:05 AM',
      tag: `${NOTIFICATION_TAG_NAMESPACE}test-sdd`,
    });
    expect(ctor).toHaveBeenCalledWith('Slinky Dog', {
      body: '11:05 AM',
      tag: `${NOTIFICATION_TAG_NAMESPACE}test-sdd`,
    });
  });

  it('posts nothing when not permitted', () => {
    const { ctor } = stubNotification('denied');
    fireAlert({ title: 'Slinky Dog' });
    expect(ctor).not.toHaveBeenCalled();
  });

  it('does not throw when the API is missing', () => {
    expect(() => fireAlert({ title: 'Slinky Dog' })).not.toThrow();
  });

  // Android Chrome throws for non-persistent notifications; sound and
  // vibration have already fired by then, so the alert still lands.
  it('survives a throwing Notification constructor', () => {
    stubNotification('granted', () => {
      throw new Error('needs a service worker');
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => fireAlert({ title: 'Slinky Dog' })).not.toThrow();
  });

  it('vibrates when supported', () => {
    const vibrate = jest.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
    });
    fireAlert({ title: 'Slinky Dog' });
    expect(vibrate).toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('honors sound and vibrate opt-outs', () => {
    const vibrate = jest.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
    });
    const { ctx } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    fireAlert({ title: 'Slinky Dog', sound: false, vibrate: false });
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'vibrate');
  });
});
