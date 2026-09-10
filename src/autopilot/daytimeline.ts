import { LLMP } from '@/api/itinerary';
import {
  TimedBooking,
  clashWindow,
  clashablePlans,
  windowClash,
} from '@/autopilot/overlap';
import { WatchTarget } from '@/autopilot/watchlist';
import { ParkTime } from '@/datetime';

/** The end of a Disney park day, immediately before its 4am boundary. */
export const DAY_END = new ParkTime(3, 59, 59);

/** Assumed length of a held pass whose end time the itinerary did not carry. */
const ASSUMED_LENGTH_MIN = 30;

export interface TimelineLane {
  id: string;
  name: string;
  start: ParkTime;
  end: ParkTime;
  /** The end was not in the itinerary and is drawn at an assumed length. */
  endAssumed: boolean;
  /** Column to draw in, so simultaneous holds do not cover each other. */
  column: number;
  columns: number;
  protectedFrom: ParkTime;
  protectedTo: ParkTime;
}

export interface TimelineTarget {
  id: string;
  name: string;
  after: ParkTime;
  before: ParkTime;
  /**
   * Whether the user actually set both bounds.
   *
   * An un-windowed target is drawn across the whole day because that is what
   * it permits, but it must not be *flagged* for crossing a held plan: every
   * full-day window crosses everything, and an un-windowed target is the
   * default, so flagging it made the amber signal meaningless.
   */
  bounded: boolean;
  /** True when the window is inverted, i.e. nothing can satisfy it. */
  impossible: boolean;
  /** Held reservations whose protected span this bounded window intersects. */
  clashes: string[];
  /** Held reservations whose protected span covers the window entirely. */
  covered: string[];
  column: number;
  columns: number;
}

/**
 * Pack items into as few columns as possible without two overlapping.
 *
 * Greedy by start, which is enough here: a park day holds at most a handful
 * of reservations and a handful of targets. Absolutely-positioned bars at the
 * full column width used to paint on top of each other, so two holds at the
 * same time -- and, worse, two default full-day targets -- showed as one.
 */
function pack<T extends { start: number; end: number }>(items: T[]) {
  const columnEnds: number[] = [];
  const placed = items.map(item => {
    let column = columnEnds.findIndex(end => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.end);
    } else {
      columnEnds[column] = item.end;
    }
    return { item, column };
  });
  return { placed, columns: Math.max(1, columnEnds.length) };
}

/** A presentation model for the selected park day's held reservations and plan. */
export function dayTimeline(
  lanes: LLMP[],
  targets: WatchTarget[],
  date: string
) {
  // The same predicate the booker uses, so the timeline cannot disagree with
  // it about what constrains a return time -- a Multiple Experiences Pass
  // constrains nothing and used to be drawn as a clashing hold.
  const clashable = clashablePlans(lanes, { date });

  const drawable = lanes.filter(
    (lane): lane is LLMP & { start: { time: ParkTime } } => !!lane.start?.time
  );
  const laneRows = drawable
    .map(lane => {
      const { from, to } = clashWindow(lane);
      return {
        id: lane.id,
        name: lane.name,
        start: lane.start.time,
        endAssumed: !lane.end?.time,
      // A missing end is unusual, but a marked bar is more useful than making
      // the held reservation vanish from the timeline. `endAssumed` is what
      // stops the assumption being presented as fact.
        end:
          lane.end?.time ??
          lane.start.time.add({ minutes: ASSUMED_LENGTH_MIN }),
        protectedFrom: from,
        protectedTo: to,
      };
    })
    .sort((a, b) => +a.start - +b.start);
  const packedLanes = pack(
    laneRows.map(row => ({ ...row, start: +row.start, end: +row.end }))
  );

  const targetRows = targets
    .map(target => {
      const bounded = !!target.after && !!target.before;
      const after = target.after ?? ParkTime.dayStart;
      const before = target.before ?? DAY_END;
      const impossible = bounded && +after > +before;
      const relevant: TimedBooking[] = bounded && !impossible ? clashable : [];
      const results = relevant.map(lane => ({
        id: lane.id,
        ...windowClash({ after, before }, lane),
      }));
      return {
        id: target.experienceId,
        name: target.name ?? target.experienceId,
        after,
        before,
        bounded,
        impossible,
        clashes: results.filter(r => r.overlaps).map(r => r.id),
        covered: results.filter(r => r.covers).map(r => r.id),
      };
    })
    .sort((a, b) => +a.after - +b.after || +a.before - +b.before);
  const packedTargets = pack(
    targetRows.map(row => ({
      ...row,
      start: +row.after,
      // An inverted window has no extent to pack against; give it the bar the
      // renderer will draw so it still gets a column of its own.
      end: Math.max(+row.before, +row.after),
    }))
  );

  return {
    lanes: packedLanes.placed.map(({ item, column }) => ({
      ...laneRows.find(row => row.id === item.id)!,
      column,
      columns: packedLanes.columns,
    })) as TimelineLane[],
    targets: packedTargets.placed.map(({ item, column }) => ({
      ...targetRows.find(row => row.id === item.id)!,
      column,
      columns: packedTargets.columns,
    })) as TimelineTarget[],
  };
}

/** Percentage from the 4am park-day boundary, for positioning a timeline bar. */
export function dayPercent(time: ParkTime) {
  return (+time / 86_400) * 100;
}
