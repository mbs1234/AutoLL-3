import {
  alertPermission,
  audioReady,
  chime,
  fireAlert,
  primeAudio,
  requestAlertPermission,
  resetAudioForTests,
} from './alert';

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
function fakeAudioContext(state: AudioContextState = 'running') {
  const started: number[] = [];
  const resume = jest.fn(async () => {
    ctx.state = 'running';
  });
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
    destination: {},
  };
  return { ctx, started, resume };
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

  it('schedules both notes in sequence', () => {
    const { ctx, started } = fakeAudioContext('running');
    g.AudioContext = jest.fn(() => ctx);
    primeAudio();
    chime();
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    expect(started).toHaveLength(2);
    expect(started[1]!).toBeGreaterThan(started[0]!);
  });
});

describe('fireAlert()', () => {
  it('posts a notification when permitted', () => {
    const { ctor } = stubNotification('granted');
    fireAlert({
      title: 'Slinky Dog',
      body: '11:05 AM',
      tag: 'autoll3-test-sdd',
    });
    expect(ctor).toHaveBeenCalledWith('Slinky Dog', {
      body: '11:05 AM',
      tag: 'autoll3-test-sdd',
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
