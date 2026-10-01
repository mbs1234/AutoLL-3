import { Fragment } from 'react';

import { Booking } from '@/api/itinerary';
import {
  TimelineLane,
  TimelineTarget,
  dayPercent,
  dayTimeline,
} from '@/autopilot/daytimeline';
import { WatchTarget } from '@/autopilot/watchlist';
import { Time } from '@/components/Time';
import TargetWindow from '@/components/ll/TargetWindow';
import { ParkTime, formatTime } from '@/datetime';

/** Rail labels, every four hours across the 4am-to-4am park day. */
const MARKERS = [4, 8, 12, 16, 20, 0].map(hour => new ParkTime(hour));

/** Minimum visible extent, as a percentage of the rail. */
const MIN_HEIGHT = 3;

/** The rail's height in px, which the hit-area arithmetic below depends on. */
const RAIL_PX = 480;

/** A thumb-sized tap target, in px. */
const TAP_PX = 44;

/** Below this a bar has room for one line, so its name gets that line. */
const TWO_LINES_PX = 32;

/** A bar's drawn height in px, from the percentage it is styled with. */
const barPx = (heightPercent: string) =>
  (parseFloat(heightPercent) / 100) * RAIL_PX;

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
 * A bar drawn shorter than a thumb gets an invisible hit area that is not.
 *
 * Its own span, centred on the bar, rather than a taller bar: the drawn height
 * is the time it stands for, and a bar stretched to 44 px would claim an hour
 * it does not have. Only on short bars, so that a tall one's taps stay its
 * own; two short bars close together can still share some of the extra.
 */
function HitArea({ heightPercent }: { heightPercent: string }) {
  if (barPx(heightPercent) >= TAP_PX) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-x-0 top-1/2 h-11 -translate-y-1/2"
    />
  );
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
  plans,
  targets,
  date,
  onLaneTap,
  onTargetTap,
}: {
  /** Every plan; the timeline keeps the timed ones on `date`. */
  plans: Booking[];
  targets: WatchTarget[];
  date: string;
  onLaneTap?: (lane: TimelineLane) => void;
  /** With the attraction id, for a drawn window or one listed as any time. */
  onTargetTap?: (experienceId: string) => void;
}) {
  const timeline = dayTimeline(plans, targets, date);
  if (
    timeline.lanes.length === 0 &&
    timeline.targets.length === 0 &&
    timeline.anyTime.length === 0
  ) {
    return null;
  }

  return (
    <section className="mt-4" aria-label="Day timeline">
      <h3>Day timeline</h3>
      <p className="text-xs text-gray-600">
        Your plans for the day, Lightning Lanes in blue and dining and other
        reservations in grey, beside the return windows Autopilot is allowed to
        use. An amber window crosses the protected time around a plan; red means
        the whole window is inside it, or its bounds are reversed.
      </p>
      {timeline.anyTime.length > 0 && (
        <p className="mt-2 text-xs text-gray-700">
          <span className="font-semibold">Any time:</span>{' '}
          {timeline.anyTime.map((target, index) => (
            <Fragment key={target.id}>
              {index > 0 && ', '}
              <button
                className="underline decoration-gray-400 underline-offset-2"
                onClick={() => onTargetTap?.(target.id)}
              >
                {target.name}
              </button>
            </Fragment>
          ))}
          . No window, so not drawn: they can take any time.
        </p>
      )}
      {/* Each side's width in proportion to its columns, so that two plans
          at once do not get half the room one target window does. */}
      <div
        className="mt-2 grid gap-x-2 text-xs"
        style={{
          gridTemplateColumns: `3rem ${timeline.lanes[0]?.columns ?? 1}fr ${
            timeline.targets[0]?.columns ?? 1
          }fr`,
        }}
      >
        <div />
        <div className="font-semibold">Plans</div>
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
          {/* Every band before any bar, so a band lies under every bar rather
              than over the bars drawn before its own: lunch's band, drawn
              after it, hid a pass held at the same time entirely.
              `pointer-events-none` as well, for any band a bar does not cover:
              it is decoration, `aria-hidden` with no handler of its own, and
              on a day with two overlapping holds one band used to swallow the
              tap meant for the other booking. Not for a plan that protects
              nothing. */}
          {timeline.lanes
            .filter(lane => lane.protects)
            .map(lane => (
              <div
                key={`band-${lane.id}`}
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bg-blue-50"
                style={protectedStyle(lane)}
              />
            ))}
          {timeline.lanes.map(lane => {
            const style = laneStyle(lane);
            return (
              <Fragment key={lane.id}>
                <button
                  className={`absolute rounded-sm text-left ${
                    lane.kind === 'll'
                      ? 'bg-blue-100 text-blue-950'
                      : 'bg-gray-200 text-gray-900'
                  }`}
                  style={style}
                  onClick={() => onLaneTap?.(lane)}
                  title={`${lane.name}: ${formatTime(lane.start)} to ${formatTime(lane.end)}${
                    lane.endAssumed ? ' (end time unknown)' : ''
                  }`}
                >
                  <HitArea heightPercent={style.height} />
                  <span className="relative block h-full overflow-hidden px-1">
                    <span
                      className={`font-semibold ${
                        barPx(style.height) >= TWO_LINES_PX
                          ? 'line-clamp-2 break-words'
                          : 'block truncate'
                      }`}
                    >
                      {lane.name}
                    </span>
                    {/* Only with room for it: the description has the time,
                        and on a short bar it showed as a line cut in half. */}
                    {barPx(style.height) >= TWO_LINES_PX && (
                      <span className="block truncate">
                        <Time time={lane.start} />
                        {lane.endAssumed && ' – ?'}
                      </span>
                    )}
                  </span>
                </button>
              </Fragment>
            );
          })}
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
            const style = targetStyle(target);
            // A tall bar has room for every line in full; a short one keeps
            // one line each, cut, rather than lines cut off by the bar's end.
            const line =
              barPx(style.height) >= TWO_LINES_PX
                ? 'block break-words'
                : 'block truncate';
            // One bound is a window too: "from 10:00 AM", not "any time".
            const original = targets.find(
              item => item.experienceId === target.id
            );
            return (
              <button
                key={target.id}
                className={`absolute rounded-sm border text-left ${
                  bad
                    ? 'border-red-500 bg-red-100 text-red-950'
                    : target.clashes.length > 0
                      ? 'border-amber-500 bg-amber-100 text-amber-950'
                      : target.bounded
                        ? 'border-green-500 bg-green-50 text-green-950'
                        : 'border-gray-300 bg-gray-50 text-gray-700'
                }`}
                style={style}
                onClick={() => onTargetTap?.(target.id)}
                title={`${target.name}: ${
                  target.bounded
                    ? `${formatTime(target.after)} to ${formatTime(target.before)}`
                    : original?.after
                      ? `from ${formatTime(original.after)}`
                      : `by ${formatTime(target.before)}`
                }`}
              >
                <HitArea heightPercent={style.height} />
                <span className="relative block h-full overflow-hidden px-1">
                  <span className={`font-semibold ${line}`}>{target.name}</span>
                  <span className={line}>
                    {target.bounded ? (
                      <>
                        <Time time={target.after} />
                        {' – '}
                        <Time time={target.before} />
                      </>
                    ) : (
                      <TargetWindow
                        after={original?.after}
                        before={original?.before}
                      />
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
                      <span className="block truncate">
                        crosses a held plan
                      </span>
                    )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
