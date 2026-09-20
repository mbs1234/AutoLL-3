import { use, useEffect, useRef, useState } from 'react';

import { MODE_TEXT } from '@/autopilot/status';
import { targetActs } from '@/autopilot/watchlist';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';

import {
  BOX_POSITIONS,
  INITIAL,
  INITIAL_TOUCH_GESTURE,
  TAPS_REQUIRED,
  TouchGesturePhase,
  nextPosition,
  onHit,
  onMiss,
  reduceTouchGesture,
} from './pocketGuard';

/** Compatibility clicks arrive immediately after the touch that created them. */
const COMPATIBILITY_CLICK_MS = 1_000;

/** Widest contact patch reported anywhere in this event. */
function widestRadius(event: React.TouchEvent): number | undefined {
  let widest = 0;
  for (const list of [event.touches, event.changedTouches]) {
    for (let i = 0; i < list.length; ++i) {
      const touch = list[i] as
        | { radiusX?: number; radiusY?: number }
        | undefined;
      widest = Math.max(widest, touch?.radiusX ?? 0, touch?.radiusY ?? 0);
    }
  }
  return widest || undefined;
}

/** Primary contact position, used only to distinguish a tap from a drag. */
function touchPoint(
  event: React.TouchEvent
): { x: number; y: number } | undefined {
  const touch = (event.changedTouches[0] ?? event.touches[0]) as
    | { clientX?: number; clientY?: number }
    | undefined;
  return touch?.clientX === undefined || touch.clientY === undefined
    ? undefined
    : { x: touch.clientX, y: touch.clientY };
}

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
  const shield = useRef<HTMLDivElement>(null);
  const gesture = useRef(INITIAL_TOUCH_GESTURE);
  const lastTouchAt = useRef(-Infinity);

  // React's delegated touch listener can be passive in a browser, in which
  // case preventDefault() in the synthetic handler is only a wish. A scoped
  // native listener is the part that actually stops scroll, overscroll and
  // pull-to-refresh while the shield is mounted.
  useEffect(() => {
    const node = shield.current;
    if (!node) return;
    const preventGesture = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    const events = ['touchstart', 'touchmove', 'touchend'] as const;
    for (const name of events) {
      node.addEventListener(name, preventGesture, { passive: false });
    }
    return () => {
      for (const name of events) {
        node.removeEventListener(name, preventGesture);
      }
    };
  }, []);

  const mode = autopilot?.status.mode ?? 'off';
  const stopped = mode === 'stopped';
  const off = mode === 'off';
  const alarm = stopped || off;
  const armed =
    autopilot?.targetsHere.filter(
      target => targetActs(target) && !target.paused
    ).length ?? 0;
  const box = BOX_POSITIONS[guard.position] ?? BOX_POSITIONS[0]!;
  const remaining = TAPS_REQUIRED - guard.taps;

  const advance = () => {
    const result = onHit(guard, Date.now(), nextPosition);
    if (result.kind === 'unlocked') onExit();
    else setGuard(result.state);
  };

  const reset = () => {
    setGuard(current => onMiss(current, nextPosition));
  };

  /**
   * Touch is authoritative. The click a browser synthesises afterwards is
   * explicitly ignored, so a rejected pocket contact cannot become a mouse
   * hit and a valid touch cannot count twice.
   */
  const handleTouch = (
    phase: TouchGesturePhase,
    onTarget: boolean,
    event: React.TouchEvent
  ) => {
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    lastTouchAt.current = Date.now();
    const result = reduceTouchGesture(gesture.current, {
      phase,
      touches: event.touches.length,
      changedTouches: event.changedTouches.length,
      maxRadius: widestRadius(event),
      point: touchPoint(event),
      onTarget,
    });
    gesture.current = result.state;
    if (result.outcome === 'reset') reset();
    if (result.outcome === 'hit') advance();
  };

  const compatibilityClick = () =>
    Date.now() - lastTouchAt.current <= COMPATIBILITY_CLICK_MS;

  const hitByClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (compatibilityClick()) {
      event.preventDefault();
      return;
    }
    advance();
  };

  const missByClick = (event: React.MouseEvent) => {
    if (compatibilityClick()) {
      event.preventDefault();
      return;
    }
    reset();
  };

  return (
    <div
      ref={shield}
      className={`fixed inset-0 z-50 touch-none select-none overscroll-none ${
        alarm ? 'bg-red-950' : 'bg-black'
      } text-white`}
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
      onTouchStart={event => handleTouch('start', false, event)}
      onTouchMove={event => handleTouch('move', false, event)}
      onTouchEnd={event => handleTouch('end', false, event)}
      onTouchCancel={event => handleTouch('cancel', false, event)}
      onClick={missByClick}
      data-testid="pocket-shield"
    >
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        {alarm ? (
          <>
            <div className="text-4xl font-bold text-red-300">
              {stopped ? 'Stopped' : 'Off'}
            </div>
            <p className="mt-3 max-w-xs text-base text-red-100">
              {stopped
                ? 'Autopilot stopped after repeated errors and is no longer checking.'
                : 'Autopilot is off and is no longer checking.'}{' '}
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
        onTouchStart={event => handleTouch('start', true, event)}
        onTouchMove={event => handleTouch('move', true, event)}
        onTouchEnd={event => handleTouch('end', true, event)}
        onTouchCancel={event => handleTouch('cancel', true, event)}
        onClick={hitByClick}
      >
        {remaining}
      </button>
    </div>
  );
}
