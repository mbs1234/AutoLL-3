import { use, useState } from 'react';

import { MODE_TEXT } from '@/autopilot/status';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';

import {
  BOX_POSITIONS,
  INITIAL,
  TAPS_REQUIRED,
  isDeliberateTouch,
  nextPosition,
  onHit,
  onMiss,
} from './pocketGuard';

/**
 * What the phone shows while it is in your pocket.
 *
 * Autopilot holds a screen wake lock, so a pocketed phone has its display on
 * and its glass live. Today's on/off control is one unconfirmed tap, and a
 * stopped engine says nothing -- `AutopilotStatusRow` already refuses to carry
 * that control for the same reason ("a footer mis-tap should never change
 * booking behaviour"); this extends the idea to the whole screen.
 *
 * It guards nothing in the engine, because it does not need to: the poller runs
 * on a timer and does not care what is rendered. Notifications still arrive and
 * the wake lock is still held, since the page stays visible. The shield is
 * purely what the glass will accept.
 *
 * It is also the screen worth having when you take the phone back out. Rather
 * than blank the display it shows the state in type you can read at arm's
 * length, so a glance answers "is it still working" without lifting the shield
 * at all -- which is the question being asked most of the time.
 */
export default function PocketShield({ onExit }: { onExit: () => void }) {
  const autopilot = use(TopAutopilotContext);
  const [guard, setGuard] = useState(INITIAL);

  const mode = autopilot?.status.mode ?? 'off';
  const stopped = mode === 'stopped';
  const armed =
    autopilot?.targetsHere.filter(target => !target.paused).length ?? 0;
  const box = BOX_POSITIONS[guard.position] ?? BOX_POSITIONS[0]!;
  const remaining = TAPS_REQUIRED - guard.taps;

  /**
   * A touch the rules refuse never reaches the counter, hit or miss.
   *
   * `radiusX` is read through a cast because React's `Touch` type omits it.
   * It is on the platform where it matters -- iOS and Android both report it --
   * and `isDeliberateTouch` treats a missing reading as a plain finger, so the
   * cast can only ever add information, never withhold a legitimate tap.
   */
  const deliberate = (event: React.TouchEvent | React.MouseEvent) => {
    if (!('touches' in event)) return true;
    const first = event.changedTouches[0] as { radiusX?: number } | undefined;
    return isDeliberateTouch(
      event.touches.length || event.changedTouches.length,
      first?.radiusX
    );
  };

  const hit = (event: React.TouchEvent | React.MouseEvent) => {
    event.stopPropagation();
    if (!deliberate(event)) return;
    const result = onHit(guard, Date.now(), nextPosition);
    if (result.kind === 'unlocked') onExit();
    else setGuard(result.state);
  };

  const miss = (event: React.TouchEvent | React.MouseEvent) => {
    if (!deliberate(event)) return;
    setGuard(current => onMiss(current, nextPosition));
  };

  return (
    <div
      className={`fixed inset-0 z-50 select-none ${
        stopped ? 'bg-red-950' : 'bg-black'
      } text-white`}
      onTouchEnd={miss}
      onClick={miss}
      data-testid="pocket-shield"
    >
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        {stopped ? (
          <>
            <div className="text-4xl font-bold text-red-300">Stopped</div>
            <p className="mt-3 max-w-xs text-base text-red-100">
              Autopilot stopped after repeated errors and is no longer checking.
              Lift the shield and start it again.
            </p>
          </>
        ) : (
          <>
            <div className="text-4xl font-bold">{MODE_TEXT[mode]}</div>
            <div className="mt-3 text-lg text-gray-300">
              {armed} armed
              {autopilot?.dryRun ? ' · Dry run' : ''}
            </div>
            <div className="mt-1 text-lg text-gray-300">
              {autopilot?.bookedCount ?? 0} booked today
            </div>
          </>
        )}
        <p className="mt-10 text-sm text-gray-400">
          Screen guarded. Tap the box {remaining} more{' '}
          {remaining === 1 ? 'time' : 'times'} to unlock.
        </p>
      </div>

      <button
        type="button"
        className="absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70 bg-white/10 text-lg font-semibold transition-[left,top] duration-200"
        style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%` }}
        // Two positions can share an x or a y -- the target moves diagonally
        // between them -- so the index is the only honest way to assert that it
        // moved at all.
        data-position={guard.position}
        aria-label={`Unlock the screen: ${remaining} more ${
          remaining === 1 ? 'tap' : 'taps'
        } needed`}
        onTouchEnd={hit}
        onClick={hit}
      >
        {remaining}
      </button>
    </div>
  );
}
