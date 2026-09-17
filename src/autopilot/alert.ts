import type { NotificationTag } from '@/storageNamespace';

export type AlertPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** Two-note chime. A single tone is easy to miss in a noisy park. */
const CHIME_HZ = [880, 1320];
const NOTE_S = 0.16;
const PEAK_GAIN = 0.3;
/** Attack/release ramp. Gating a sine abruptly produces an audible click. */
const RAMP_S = 0.01;
const VIBRATE_MS = [120, 60, 120];

type AudioContextCtor = typeof AudioContext;

let audioCtx: AudioContext | undefined;

function audioContextCtor(): AudioContextCtor | undefined {
  const w = self as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
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
 * Create and unlock the AudioContext.
 *
 * Call this from a user gesture -- toggling the poller on is the natural one.
 * Mobile browsers start an AudioContext in the `suspended` state and refuse to
 * resume it outside a gesture, so priming later (say, at the moment a drop
 * lands) silently produces no sound at all.
 */
export function primeAudio(): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    audioCtx ??= new Ctor();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => undefined);
    }
  } catch {
    audioCtx = undefined;
  }
}

export function audioReady(): boolean {
  return audioCtx?.state === 'running';
}

export function chime(): void {
  const ctx = audioCtx;
  // Only play when actually unlocked. Scheduling into a suspended context
  // queues notes that all fire at once whenever it later resumes.
  if (!ctx || ctx.state !== 'running') return;
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
  audioCtx = undefined;
}
