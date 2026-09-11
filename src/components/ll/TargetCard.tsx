import { use, useState } from 'react';

import { Experience } from '@/api/ll';
import { describeMode } from '@/autopilot/describe';
import { WatchTarget } from '@/autopilot/watchlist';
import Button from '@/components/Button';
import Toggle from '@/components/Toggle';
import TargetWindow from '@/components/ll/TargetWindow';
import AutopilotContext from '@/contexts/AutopilotContext';
import { ParkTime } from '@/datetime';

const DOT = <span aria-hidden> · </span>;

const bound = (time?: ParkTime) => (time ? String(time).slice(0, 5) : '');

/**
 * One end of the return-time window, committed when it is settled rather than
 * on the way there.
 *
 * An empty value is ambiguous: it means "no bound", and it is also the state
 * the field passes through when a bound is cleared to type a different one.
 * Writing it straight through treated the second as the first, and the watch
 * list it writes to is the one the running poller reads -- so backspacing over
 * 15:00 to type 14:00 handed autopilot an unbounded window for as long as the
 * field was empty, and a drop landing in that gap was booked at a time the
 * user had explicitly excluded.
 *
 * A complete time still commits immediately; there is nothing unsafe about it
 * and the responsiveness is worth keeping. Only the empty state waits, and it
 * waits for blur -- the point at which "no bound" is what the user actually
 * meant. Left mid-edit, the previous bound stands, which is the safe way to be
 * wrong.
 */
function BoundInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [cleared, setCleared] = useState(false);
  return (
    <input
      type="time"
      aria-label={label}
      className="rounded-sm border border-gray-300 px-1 py-0.5"
      value={cleared ? '' : value}
      onChange={e => {
        const next = e.target.value;
        if (next === '') return setCleared(true);
        setCleared(false);
        onCommit(next);
      }}
      onBlur={() => {
        if (!cleared) return;
        setCleared(false);
        onCommit('');
      }}
    />
  );
}

/**
 * One watched attraction: a line that says what will happen, and the controls
 * underneath it, folded away.
 *
 * A target used to be seven rows tall -- name, five chips, a window, a rank --
 * so four of them filled the screen. The folded line is what a person scans
 * for on a park day: which ride, what Autopilot will do, between which times.
 * The body is for setting that up, which happens once. Native `<details>`, as
 * `Disclosure` is, so the fold needs no state and survives the screen staying
 * mounted under whatever is pushed on top of it.
 *
 * Remove lives inside the body. It used to be the star at the head of every
 * row, one mis-tap from losing a window and a rank with no way back.
 */
export default function TargetCard({
  experience,
  target,
  defaultOpen,
  onRemove,
}: {
  experience: Experience;
  target?: WatchTarget;
  /** Start unfolded, for the target that was just added. */
  defaultOpen?: boolean;
  onRemove: () => void;
}) {
  const {
    toggleAutoBook,
    toggleAutoModify,
    toggleBookThenMove,
    togglePaused,
    toggleAutoSwap,
    togglePasskey,
    setTargetWindow,
    setTargetRank,
  } = use(AutopilotContext);
  const { id, name } = experience;
  const t: WatchTarget = target ?? { experienceId: id };
  const autoBook = !!t.autoBook;
  const autoModify = !!t.autoModify;
  const bookThenMove = !!t.bookThenMove;
  const autoSwap = !!t.autoSwap;
  const paused = !!t.paused;
  const passkey = !!t.passkey;

  return (
    <details
      className="rounded-md border border-gray-300 bg-white"
      open={defaultOpen || undefined}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-gray-500">
          &#9656;
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block text-xs text-gray-600">
            {paused && (
              <>
                <span className="font-semibold text-amber-800">Paused</span>
                {DOT}
              </>
            )}
            {describeMode(t)}
            {(t.after || t.before) && (
              <>
                {DOT}
                <TargetWindow after={t.after} before={t.before} />
              </>
            )}
            {typeof t.rank === 'number' && (
              <>
                {DOT}Rank {t.rank}
              </>
            )}
            {passkey && <>{DOT}Passkey</>}
          </span>
        </span>
      </summary>
      <div className="border-t border-gray-200 px-3 pb-3">
        <div className="mt-2 flex flex-wrap gap-2">
          <Toggle
            on={autoBook}
            variant="action"
            label="Auto-book"
            title={autoBook ? `Stop auto-booking ${name}` : `Auto-book ${name}`}
            onToggle={() => toggleAutoBook(id)}
          />
          <Toggle
            on={autoModify}
            variant="action"
            label="Auto-move"
            title={
              autoModify ? `Stop auto-moving ${name}` : `Auto-move ${name}`
            }
            onToggle={() => toggleAutoModify(id)}
          />
          <Toggle
            on={bookThenMove}
            variant="action"
            label="Book then move"
            title={
              bookThenMove
                ? `Stop book-then-move for ${name}`
                : `Book then move ${name}`
            }
            onToggle={() => toggleBookThenMove(id)}
          />
          <Toggle
            on={autoSwap}
            variant="action"
            label="Swap in"
            title={autoSwap ? `Stop swapping in ${name}` : `Swap in ${name}`}
            onToggle={() => toggleAutoSwap(id)}
          />
          <Toggle
            on={paused}
            variant="pause"
            label="Pause"
            onText="Paused"
            offText="Pause"
            title={paused ? `Resume ${name}` : `Pause ${name}`}
            onToggle={() => togglePaused(id)}
          />
          {/* Only a non-Tier-1 attraction can be the day's passkey. It decides
              what gets booked first, which is an action's colour. */}
          {experience.tier === undefined && (
            <Toggle
              on={passkey}
              variant="action"
              label="Passkey"
              title={
                passkey
                  ? `Stop using ${name} as a passkey`
                  : `Use ${name} as a passkey`
              }
              onToggle={() => togglePasskey(id)}
            />
          )}
        </div>
        {/* The window governs booking, moving and swapping. Leaving a bound
            empty means unbounded on that side. */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">Return between</span>
          <BoundInput
            label={`Earliest return time for ${name}`}
            value={bound(t.after)}
            onCommit={value => setTargetWindow(id, 'after', value)}
          />
          <span className="text-gray-600">and</span>
          <BoundInput
            label={`Latest return time for ${name}`}
            value={bound(t.before)}
            onCommit={value => setTargetWindow(id, 'before', value)}
          />
        </div>
        <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          Plan rank
          <input
            type="number"
            min={1}
            step={1}
            aria-label={`Plan rank for ${name}`}
            className="w-16 rounded-sm border border-gray-300 px-1 py-0.5"
            value={t.rank ?? ''}
            onChange={e =>
              setTargetRank(
                id,
                e.target.value === '' ? undefined : Number(e.target.value)
              )
            }
          />
          <span className="basis-full text-xs">
            lower goes first; blank uses the built-in priority
          </span>
        </label>
        <div className="mt-3">
          <Button
            type="small"
            color="bg-gray-200 text-black"
            title={`Stop watching ${name}`}
            onClick={onRemove}
          >
            Stop watching
          </Button>
        </div>
      </div>
    </details>
  );
}
