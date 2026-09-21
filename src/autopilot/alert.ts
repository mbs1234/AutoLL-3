import type { NotificationTag } from '@/storageNamespace';

export type AlertPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** Two-note chime. A single tone is easy to miss in a noisy park. */
const CHIME_HZ = [880, 1320];
const NOTE_S = 0.16;
const PEAK_GAIN = 0.3;
/** Attack/release ramp. Gating a sine abruptly produces an audible click. */
const RAMP_S = 0.01;
const VIBRATE_MS = [120, 60, 120];
/**
 * One clock for every in-memory deadline in this module.
 *
 * Select it once so a timestamp and its later comparison can never mix epoch
 * milliseconds with milliseconds since navigation. Browsers all expose the
 * monotonic Performance clock; Date is only a defensive non-browser fallback.
 */
const deadlineNow =
  typeof performance === 'undefined'
    ? () => Date.now()
    : () => performance.now();
/** How long background callers may share one in-flight resume attempt. */
export const BACKGROUND_RESUME_REUSE_MS = 3_000;
/** A later chime would sound like a new find even though the offer is stale. */
export const RESUME_REPLAY_MS = 3_000;
/** A diagnostic must answer even when WebKit leaves `resume()` pending. */
export const SOUND_CHECK_TIMEOUT_MS = 3_000;
/** Derived from the actual notes, so a changed chime cannot outgrow its guard. */
export const TEST_CHIME_GUARD_MS = CHIME_HZ.length * NOTE_S * 1_000;

type AudioContextCtor = typeof AudioContext;
type StatusListener = () => void;

let audioCtx: AudioContext | undefined;
let detachAudioState: (() => void) | undefined;
let pendingBackgroundResume:
  | {
      ctx: AudioContext;
      startedAt: number;
      promise: Promise<boolean>;
    }
  | undefined;
/** Newest alert waiting for one shared resume; concurrent finds make one chime. */
let pendingChimeAt: number | undefined;
let soundCheckGeneration = 0;
let testChimeBlockedUntil = -Infinity;
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

/**
 * Claim a pending automatic alert before inspecting it.
 *
 * Both the context's `statechange` event and a resolving resume promise arrive
 * here. Clearing first makes those two witnesses idempotent: whichever sees a
 * usable context first owns the one possible replay.
 */
function deliverPendingChime(ctx: AudioContext): void {
  if (audioCtx !== ctx || ctx.state !== 'running') return;
  const requestedAt = pendingChimeAt;
  pendingChimeAt = undefined;
  if (requestedAt === undefined) return;
  if (deadlineNow() - requestedAt > RESUME_REPLAY_MS) return;
  playChime(ctx);
}

function observeAudioState(ctx: AudioContext): boolean {
  const running = audioCtx === ctx && ctx.state === 'running';
  if (running) {
    // A real running state supersedes every request for this same context,
    // including one whose promise WebKit has left pending.
    if (pendingBackgroundResume?.ctx === ctx) {
      pendingBackgroundResume = undefined;
    }
    deliverPendingChime(ctx);
  }
  publishAudioStatus();
  return running;
}

function setAudioContext(next: AudioContext | undefined): void {
  detachAudioState?.();
  detachAudioState = undefined;
  audioCtx = next;
  pendingBackgroundResume = undefined;
  pendingChimeAt = undefined;
  ++soundCheckGeneration;
  testChimeBlockedUntil = -Infinity;
  if (next) {
    const changed = () => observeAudioState(next);
    next.addEventListener?.('statechange', changed);
    detachAudioState = () => next.removeEventListener?.('statechange', changed);
  }
  publishAudioStatus();
}

/**
 * Ask one context to wake for an automatic alert or foreground rearm.
 *
 * Calls share an attempt only briefly. WebKit may keep a resume promise pending
 * for minutes, so the promise itself cannot own the channel indefinitely.
 */
function resumeAudioInBackground(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') {
    observeAudioState(ctx);
    return Promise.resolve(true);
  }
  const at = deadlineNow();
  if (
    pendingBackgroundResume?.ctx === ctx &&
    at - pendingBackgroundResume.startedAt <= BACKGROUND_RESUME_REUSE_MS
  ) {
    return pendingBackgroundResume.promise;
  }

  let resumed: Promise<void>;
  try {
    resumed = ctx.resume();
  } catch {
    publishAudioStatus();
    return Promise.resolve(false);
  }
  const promise = resumed
    .then(
      () => observeAudioState(ctx),
      () => {
        publishAudioStatus();
        return false;
      }
    )
    .finally(() => {
      if (pendingBackgroundResume?.promise === promise) {
        pendingBackgroundResume = undefined;
      }
    });
  pendingBackgroundResume = { ctx, startedAt: at, promise };
  return promise;
}

/**
 * A resume begun inside a user gesture must never inherit a background wait.
 * Each call is independent so another tap can recover a promise WebKit wedged.
 */
function resumeAudioFromGesture(ctx: AudioContext): Promise<boolean> {
  if (pendingBackgroundResume?.ctx === ctx) {
    pendingBackgroundResume = undefined;
  }
  let resumed: Promise<void>;
  try {
    resumed = ctx.resume();
  } catch {
    publishAudioStatus();
    return Promise.resolve(false);
  }
  return resumed.then(
    () => observeAudioState(ctx),
    () => {
      publishAudioStatus();
      return false;
    }
  );
}

function settleWithin(
  ctx: AudioContext,
  attempt: Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  return new Promise(resolve => {
    let finished = false;
    const changed = () => {
      if (ctx.state === 'running') finish(true);
    };
    const finish = (result: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ctx.removeEventListener?.('statechange', changed);
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    ctx.addEventListener?.('statechange', changed);
    if (ctx.state === 'running') {
      finish(true);
      return;
    }
    void attempt.then(finish);
  });
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

/** Create the one context used by both real alerts and the diagnostic. */
function ensureAudioContext(): AudioContext | undefined {
  if (audioCtx) return audioCtx;
  const Ctor = audioContextCtor();
  if (!Ctor) return undefined;
  try {
    setAudioContext(new Ctor());
  } catch {
    setAudioContext(undefined);
  }
  return audioCtx;
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
  const ctx = ensureAudioContext();
  if (!ctx) return;
  // A deliberate user gesture supersedes every automatic or diagnostic wait.
  pendingChimeAt = undefined;
  ++soundCheckGeneration;
  if (pendingBackgroundResume?.ctx === ctx) {
    pendingBackgroundResume = undefined;
  }
  if (ctx.state !== 'running') void resumeAudioFromGesture(ctx);
  unlockOutput(ctx);
  publishAudioStatus();
}

/** Best-effort foreground recovery; unlike `primeAudio`, no gesture is assumed. */
export function rearmAudio(): void {
  const ctx = audioCtx;
  if (!ctx) return;
  void resumeAudioInBackground(ctx);
  // Fed as well as resumed, exactly as `primeAudio` does. `resume()` alone is
  // what left this channel silently dead through v1.2.3: WebKit wants a source
  // to have been started before it will let a context sound, and a context
  // that was resumed but never fed reports `running` while playing nothing --
  // which `audioStatus` would then report as "armed". Recovery must not be a
  // weaker operation than the gesture it is standing in for.
  unlockOutput(ctx);
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
  pendingChimeAt = deadlineNow();
  void resumeAudioInBackground(ctx).then(() => deliverPendingChime(ctx));
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
  const ctx = ensureAudioContext();
  const generation = ++soundCheckGeneration;
  if (!ctx) return audioStatus();

  // This function is called from a button. Every press must make a fresh
  // gesture-scoped attempt: sharing a background promise can permanently
  // disarm the diagnostic on WebKit when that promise never settles.
  const attempt = resumeAudioFromGesture(ctx);
  unlockOutput(ctx);
  const running = await settleWithin(ctx, attempt, SOUND_CHECK_TIMEOUT_MS);

  // Only the newest unresolved press owns playback. The small guard applies
  // only to this diagnostic; real alerts deliberately retain their existing
  // scheduling, including simultaneous alerts while the context is running.
  // A permitted diagnostic can likewise overlap a queued alert that recovers
  // in the same turn. The user is present and asked for sound; deduplicating
  // that cosmetic case would add shared delivery coordination to the critical
  // alert path, so it is deliberately deferred with the real-alert overlap.
  //
  const now = deadlineNow();
  const guarded = now < testChimeBlockedUntil;
  if (
    running &&
    audioCtx === ctx &&
    generation === soundCheckGeneration &&
    !guarded
  ) {
    testChimeBlockedUntil = now + TEST_CHIME_GUARD_MS;
    // Cleared only here, on the branch that actually sounds. Clearing it up
    // front meant a press the guard refused destroyed a real find's queued
    // replay and put nothing in its place: the find passed in silence while
    // the screen still read "armed". A press that plays legitimately stands
    // in for the replay; a press that does not must leave it alone.
    pendingChimeAt = undefined;
    playChime(ctx);
  }
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
