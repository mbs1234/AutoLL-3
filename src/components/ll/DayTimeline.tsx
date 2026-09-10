import { Fragment } from 'react';

import { LLMP } from '@/api/itinerary';
import {
  TimelineLane,
  TimelineTarget,
  dayPercent,
  dayTimeline,
} from '@/autopilot/daytimeline';
import { WatchTarget } from '@/autopilot/watchlist';
import { Time } from '@/components/Time';
import { ParkTime } from '@/datetime';

/** Rail labels, every four hours across the 4am-to-4am park day. */
const MARKERS = [4, 8, 12, 16, 20, 0].map(hour => new ParkTime(hour));

/** Minimum visible extent, as a percentage of the rail. */
const MIN_HEIGHT = 3;

/** Geometry for one bar, given a span that may be inverted or zero-length. */
function bar(from: ParkTime, to: ParkTime) {
  const top = dayPercent(from);
  const extent = dayPercent(to) - top;
  return { top, height: Math.max(MIN_HEIGHT, extent), inverted: extent < 0 };
}

function laneStyle(lane: TimelineLane) {
  const { top, height } = bar(lane.start, lane.end);
  return {
    top: `${top}%`,
    height: `${height}%`,
    left: `${(lane.column / lane.columns) * 100}%`,
    width: `${100 / lane.columns}%`,
  };
}

function protectedStyle(lane: TimelineLane) {
  const { top, height } = bar(lane.protectedFrom, lane.protectedTo);
  return { top: `${top}%`, height: `${height}%` };
}

function targetStyle(target: TimelineTarget) {
  const { top, height } = bar(target.after, target.before);
  return {
    top: `${top}%`,
    height: `${target.impossible ? MIN_HEIGHT : height}%`,
    left: `${(target.column / target.columns) * 100}%`,
    width: `${100 / target.columns}%`,
  };
}

/**
 * A deliberately read-only picture of the park day.
 *
 * Reservations live on the left and target windows on the right so a person
 * can see both the plan and its constraints without opening every target.
 * It does not decide whether a booking is legal; the booking path rechecks
 * that using the real offer before it acts.
 *
 * Everything it colours amber comes from `windowClash`, the same predicate
 * the booker uses, so the picture cannot disagree with what will happen.
 */
export default function DayTimeline({
  lanes,
  targets,
  date,
  onLaneTap,
  onTargetTap,
}: {
  lanes: LLMP[];
  targets: WatchTarget[];
  date: string;
  onLaneTap?: (lane: TimelineLane) => void;
  onTargetTap?: (target: TimelineTarget) => void;
}) {
  const timeline = dayTimeline(lanes, targets, date);
  if (timeline.lanes.length === 0 && timeline.targets.length === 0) return null;

  return (
    <section className="mt-4" aria-label="Day timeline">
      <h3>Day timeline</h3>
      <p className="text-xs text-gray-600">
        Held Lightning Lanes and the return windows Autopilot is allowed to use.
        An amber window crosses the protected time around a held plan; red means
        the whole window is inside it, or its bounds are reversed. A target with
        no window is drawn across the day in grey, because it permits any time
        at all.
      </p>
      <div className="mt-2 grid grid-cols-[3rem_1fr_1fr] gap-x-2 text-xs">
        <div />
        <div className="font-semibold">Held</div>
        <div className="font-semibold">Targets</div>
        <div className="relative h-[480px] text-right text-gray-500">
          {MARKERS.map(time => (
            <span
              key={time.toString()}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${dayPercent(time)}%` }}
            >
              <Time time={time} />
            </span>
          ))}
        </div>
        <div className="relative h-[480px] border-l border-gray-200">
          {MARKERS.map(time => (
            <div
              key={time.toString()}
              className="absolute inset-x-0 border-t border-gray-100"
              style={{ top: `${dayPercent(time)}%` }}
            />
          ))}
          {timeline.lanes.map(lane => (
            <Fragment key={lane.id}>
            <div aria-hidden className="absolute inset-x-0 bg-blue-50" style={protectedStyle(lane)} />
            <button
              className="absolute overflow-hidden rounded-sm bg-blue-100 px-1 text-left text-blue-950"
              style={laneStyle(lane)}
              onClick={() => onLaneTap?.(lane)}
              title={`${lane.name}: ${lane.start} to ${lane.end}${
                lane.endAssumed ? ' (end time unknown)' : ''
              }`}
            >
              <span className="block truncate font-semibold">{lane.name}</span>
              <span className="block truncate">
                <Time time={lane.start} />
                {lane.endAssumed && ' – ?'}
              </span>
            </button>
            </Fragment>
          ))}
        </div>
        <div className="relative h-[480px] border-l border-gray-200">
          {MARKERS.map(time => (
            <div
              key={time.toString()}
              className="absolute inset-x-0 border-t border-gray-100"
              style={{ top: `${dayPercent(time)}%` }}
            />
          ))}
          {timeline.targets.map(target => {
            const covered = target.covered.length > 0;
            const bad = covered || target.impossible;
            return (
              <button
                key={target.id}
                className={`absolute overflow-hidden rounded-sm border px-1 ${
                  bad
                    ? 'border-red-500 bg-red-100 text-red-950'
                    : target.clashes.length > 0
                      ? 'border-amber-500 bg-amber-100 text-amber-950'
                      : target.bounded
                        ? 'border-green-500 bg-green-50 text-green-950'
                        : 'border-gray-300 bg-gray-50 text-gray-700'
                }`}
                style={targetStyle(target)}
                onClick={() => onTargetTap?.(target)}
                title={`${target.name}: ${
                  target.bounded
                    ? `${target.after} to ${target.before}`
                    : 'no window set'
                }`}
              >
                <span className="block truncate font-semibold">
                  {target.name}
                </span>
                <span className="block truncate">
                  {target.bounded ? (
                    <>
                      <Time time={target.after} />
                      {' – '}
                      <Time time={target.before} />
                    </>
                  ) : (
                    'any time'
                  )}
                </span>
                {target.impossible && (
                  <span className="block truncate">bounds reversed</span>
                )}
                {!target.impossible && covered && (
                  <span className="block truncate">window fully blocked</span>
                )}
                {!target.impossible &&
                  !covered &&
                  target.clashes.length > 0 && (
                    <span className="block truncate">crosses a held plan</span>
                  )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
