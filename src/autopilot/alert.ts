import type { NotificationTag } from '@/storageNamespace';

export type AlertPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** Two-note chime. A single tone is easy to miss in a noisy park. */
const CHIME_HZ = [880, 1320];
const NOTE_S = 0.16;
const PEAK_GAIN = 0.3;
/** Attack/release ramp. Gating a sine abruptly produces an audible click. */
const RAMP_S = 0.01;
const VIBRATE_MS = [120, 60, 120];
/** A later chime would sound like a new find even though the offer is stale. */
export const RESUME_REPLAY_MS = 3_000;

type AudioContextCtor = typeof AudioContext;
type StatusListener = () => void;

let audioCtx: AudioContext | undefined;
let detachAudioState: (() => void) | undefined;
let pendingResume: { ctx: AudioContext; promise: Promise<boolean> } | undefined;
/** Newest alert waiting for one shared resume; concurrent finds make one chime. */
let pendingChimeAt: number | undefined;
const audioStatusListeners = new Set<StatusListener>();
let lastAudioStatus: AudioStatus | undefined;

function audioContextCtor(): AudioContextCtor | undefined {
  const w = self as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

/** Tell React only when the primitive snapshot has actually changed. */
function publishAudioStatus(): void {
  const next = audioStatus();
  if (next === lastAudioStatus) return;
  lastAudioStatus = next;
  for (const listener of audioStatusListeners) listener();
}

function setAudioContext(next: AudioContext | undefined): void {
  detachAudioState?.();
  detachAudioState = undefined;
  audioCtx = next;
  pendingResume = undefined;
  pendingChimeAt = undefined;
  if (next) {
    const changed = () => publishAudioStatus();
    next.addEventListener?.('statechange', changed);
    detachAudioState = () => next.removeEventListener?.('statechange', changed);
  }
  publishAudioStatus();
}

/**
 * Ask one context to wake once, however many callers notice it sleeping.
 *
 * The boolean is deliberately about the state after the promise settles: Web
 * Audio implementations can resolve without becoming usable, and callers must
 * not announce or schedule sound merely because `resume()` fulfilled.
 */
function resumeAudio(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') {
    publishAudioStatus();
    return Promise.resolve(true);
  }
  if (pendingResume?.ctx === ctx) return pendingResume.promise;

  let resumed: Promise<void>;
  try {
    resumed = ctx.resume();
  } catch {
    publishAudioStatus();
    return Promise.resolve(false);
  }
  const promise = resumed
    .then(
      () => {
        publishAudioStatus();
        return ctx.state === 'running';
      },
      () => {
        publishAudioStatus();
        return false;
      }
    )
    .finally(() => {
      if (pendingResume?.promise === promise) pendingResume = undefined;
    });
  pendingResume = { ctx, promise };
  return promise;
}

export function alertPermission(): AlertPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as AlertPermission;
}

/**
 * Ask for notification permission.
 *
 * Must be called from a user gesture: browsers reject permission prompts that
 * are not user-initiated, and some (Safari) throw rather than resolve.
 */
export async function requestAlertPermission(): Promise<AlertPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') {
    return Notification.permission as AlertPermission;
  }
  try {
    return (await Notification.requestPermission()) as AlertPermission;
  } catch {
    return 'denied';
  }
}

/**
 * Play one inaudible sample, which is what actually unlocks output on iOS.
 *
 * `resume()` alone is not enough there: WebKit wants a source to have been
 * started inside the gesture before it will let the context sound, and a
 * context that was resumed but never fed stays silent while reporting
 * `running`. A one-frame buffer is the cheapest thing that counts as output.
 */
function unlockOutput(ctx: AudioContext): void {
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // An engine without buffer sources still has oscillators, which is all
    // `chime` needs. Failing to unlock is not a reason to lose the context.
  }
}

/**
 * Create and unlock the AudioContext.
 *
 * Call this from a user gesture -- toggling the poller on is the natural one.
 * Mobile browsers start an AudioContext in the `suspended` state and refuse to
 * resume it outside a gesture, so priming later (say, at the moment a drop
 * lands) silently produces no sound at all.
 *
 * Safe to call repeatedly: it is also the recovery path. iOS moves a context
 * to `interrupted` -- a state the DOM types do not name -- when the screen
 * locks, a call arrives, or another app takes audio, and never leaves it on
 * its own. The test is therefore "not running" rather than "suspended", or a
 * run would go mute for good the first time a notification interrupted it.
 */
export function primeAudio(): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    if (!audioCtx) setAudioContext(new Ctor());
    const ctx = audioCtx;
    if (!ctx) return;
    if (ctx.state !== 'running') void resumeAudio(ctx);
    unlockOutput(ctx);
    publishAudioStatus();
  } catch {
    setAudioContext(undefined);
  }
}

export function audioReady(): boolean {
  return audioCtx?.state === 'running';
}

/** What the alert channel can currently do, for a screen to say out loud. */
export type AudioStatus = 'unsupported' | 'armed' | 'idle';

/**
 * Whether sound would actually be heard right now.
 *
 * Worth showing, because on iOS Safari sound is the *only* alert channel --
 * `Notification` is undefined outside an installed web app and vibration is
 * unimplemented -- so a context that failed to unlock leaves a run with no way
 * to reach anybody, and nothing else on screen would say so.
 */
export function audioStatus(): AudioStatus {
  if (!audioContextCtor()) return 'unsupported';
  return audioCtx?.state === 'running' ? 'armed' : 'idle';
}

/**
 * Subscribe to the bare status string used by `useSyncExternalStore`.
 *
 * Keep `audioStatus()` a primitive snapshot. Returning a fresh object from a
 * snapshot getter makes React see a change on every read and render forever.
 */
export function subscribeAudioStatus(listener: StatusListener): () => void {
  audioStatusListeners.add(listener);
  lastAudioStatus = audioStatus();
  return () => audioStatusListeners.delete(listener);
}

function playChime(ctx: AudioContext): void {
  try {
    const start0 = ctx.currentTime;
    CHIME_HZ.forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const start = start0 + i * NOTE_S;
      const end = start + NOTE_S;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + RAMP_S);
      gain.gain.linearRampToValueAtTime(0, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end);
    });
  } catch (error) {
    console.error(error);
  }
}

export function chime(): void {
  const ctx = audioCtx;
  // Only play when actually unlocked. Scheduling into a suspended context
  // queues notes that all fire at once whenever it later resumes.
  if (!ctx) return;
  if (ctx.state === 'running') {
    pendingChimeAt = undefined;
    playChime(ctx);
    return;
  }

  // Keep the newest request. `fireAlert` can call this several times in one
  // poll, and waking into several overlapping two-note chimes is cacophony.
  pendingChimeAt = Date.now();
  void resumeAudio(ctx).then(running => {
    if (audioCtx !== ctx) return;
    const requestedAt = pendingChimeAt;
    pendingChimeAt = undefined;
    if (!running || requestedAt === undefined) return;
    // A resume that only lands when the page is foregrounded means the user
    // is already looking. Sounding then would announce a find that may be
    // minutes stale, which is worse than dropping it.
    if (Date.now() - requestedAt > RESUME_REPLAY_MS) return;
    playChime(ctx);
  });
}

/**
 * Play the chime on purpose and report whether it could be heard.
 *
 * Call from a user gesture. Without this there is no way to find out that the
 * only alert channel iOS offers is dead except by waiting for a real find and
 * noticing the silence -- which is how it was found, on a phone, after a ride
 * came up and nothing happened.
 *
 * The await is why this is separate from `chime`: `resume` settles a task
 * later, so a caller that primed and chimed in one tick would still see a
 * context that had not woken up yet and play nothing.
 */
export async function soundCheck(): Promise<AudioStatus> {
  primeAudio();
  const ctx = audioCtx;
  // This deliberate sound supersedes an automatic replay that may be waiting
  // on the same resume, so the user hears one chime rather than two.
  pendingChimeAt = undefined;
  if (ctx && ctx.state !== 'running') {
    await resumeAudio(ctx);
  }
  if (ctx?.state === 'running') playChime(ctx);
  publishAudioStatus();
  return audioStatus();
}

function tryVibrate(): void {
  // Android only in practice; iOS Safari does not implement it.
  if (typeof navigator?.vibrate !== 'function') return;
  try {
    navigator.vibrate(VIBRATE_MS);
  } catch {
    // Ignore: vibration is never essential.
  }
}

export interface AlertOptions {
  title: string;
  body?: string;
  /**
   * Dedupe key. Notifications sharing a tag replace one another instead of
   * stacking, so a re-alert for the same ride does not pile up.
   */
  tag?: NotificationTag;
  sound?: boolean;
  vibrate?: boolean;
}

/**
 * Deliver an alert through every channel available.
 *
 * Channels degrade independently and none is required: sound needs a primed
 * AudioContext, vibration is Android-only, and notifications need permission
 * plus an API that iOS Safari only exposes to installed PWAs. Sound comes
 * first because it is the channel most likely to actually reach someone
 * holding a phone in a theme park.
 */
export function fireAlert({
  title,
  body,
  tag,
  sound = true,
  vibrate = true,
}: AlertOptions): void {
  if (sound) chime();
  if (vibrate) tryVibrate();
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag });
  } catch (error) {
    // Android Chrome throws for non-persistent notifications and requires a
    // service worker instead. Sound and vibration have already fired.
    console.error(error);
  }
}

/** Test seam: drop the cached AudioContext. */
export function resetAudioForTests(): void {
  setAudioContext(undefined);
}
