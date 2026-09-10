interface Duration {
  hours?: number;
  minutes?: number;
  seconds?: number;
}

interface TimeFields {
  hour: number;
  minute: number;
  second: number;
}

export type ParkTimeable = ParkTime | TimeFields | string;

function clamp(value: number, max: number, min = 0) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export class ParkTime {
  static readonly dayStart = new ParkTime(4);

  readonly hour;
  readonly minute;
  readonly second;

  static from(info: ParkTimeable) {
    return new ParkTime(
      ...(typeof info === 'string'
        ? info.split(':').map(Number)
        : [info.hour, info.minute, info.second])
    );
  }

  constructor(hour?: number, minute?: number, second?: number) {
    hour ??= 0;
    minute ??= 0;
    second ??= 0;
    if (![hour, minute, second].every(Number.isFinite)) {
      throw new RangeError('Invalid time');
    }
    this.hour = clamp(hour, 23);
    this.minute = clamp(minute, 59);
    this.second = clamp(second, 59);
  }

  add(duration: Duration) {
    const secondsToAdd =
      (duration.hours ?? 0) * 3600 +
      (duration.minutes ?? 0) * 60 +
      (duration.seconds ?? 0);
    if (secondsToAdd === 0) return this;
    const newTimeInSeconds =
      this.hour * 3600 + this.minute * 60 + this.second + secondsToAdd;
    // JavaScript's remainder keeps the sign of the dividend, so `% 86400`
    // alone leaves a negative value when subtracting across midnight. The
    // constructor then clamps every negative field to zero, turning 00:10 -
    // 40 minutes into 00:00 instead of 23:30.
    const wrapped = ((newTimeInSeconds % 86400) + 86400) % 86400;
    const hour = Math.floor(wrapped / 3600);
    const minute = Math.floor((wrapped % 3600) / 60);
    const second = wrapped % 60;
    return new ParkTime(hour, minute, second);
  }

  with(info: Partial<TimeFields>) {
    return new ParkTime(
      info.hour ?? this.hour,
      info.minute ?? this.minute,
      info.second ?? this.second
    );
  }

  valueOf() {
    return (
      ((this.hour + 24 - ParkTime.dayStart.hour) * 3600 +
        this.minute * 60 +
        this.second) %
      86400
    );
  }

  equals(other: unknown) {
    try {
      return +this === +ParkTime.from(other as ParkTimeable);
    } catch (error) {
      if (error instanceof TypeError) return false;
      throw error;
    }
  }

  toString() {
    return [this.hour, this.minute, this.second]
      .map(v => v.toString().padStart(2, '0'))
      .join(':');
  }

  toJSON() {
    return this.toString();
  }
}

export type Dateable = Date | number | string;

export function toDate(dt: Dateable): Date {
  return new Date(
    typeof dt === 'string' && !dt.includes('T') ? dt + 'T00:00:00' : dt
  );
}

export class DateFormat {
  protected fmt;

  constructor(options: Intl.DateTimeFormatOptions) {
    this.fmt = Intl.DateTimeFormat('en-US', options);
  }

  format(date: Dateable) {
    return this.fmt.format(toDate(date));
  }

  parts(date: Dateable): {
    [P in Intl.DateTimeFormatPartTypes]?: string;
  } {
    return Object.fromEntries(
      this.fmt
        .formatToParts(toDate(date))
        .filter(p => p.type !== 'literal')
        .map(p => [p.type, p.value])
    );
  }
}

export class DateTime {
  readonly date;
  readonly time;

  protected static format: DateFormat;

  static now() {
    return DateTime.from(Date.now());
  }

  static from(date: Dateable) {
    if (
      typeof date === 'string' &&
      date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    ) {
      const [d, t] = date.split('T');
      return new DateTime(d!, ParkTime.from(t!));
    }

    const dt = DateTime.format.parts(toDate(date));
    const d = `${dt.year}-${dt.month}-${dt.day}`;
    const t = `${dt.hour}:${dt.minute}:${dt.second}`;
    return new DateTime(d, ParkTime.from(t));
  }

  static setTimeZone(tz: string) {
    const d2 = '2-digit';
    DateTime.format = new DateFormat({
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: d2,
      day: d2,
      hour: d2,
      minute: d2,
      second: d2,
    });
  }

  constructor(date: string, time: ParkTime) {
    this.date = date;
    this.time = time;
  }

  toString() {
    return `${this.date}T${this.time}`;
  }

  toJSON() {
    return this.toString();
  }
}

DateTime.setTimeZone('America/New_York');

export function modifyDate(date: Dateable, days: number) {
  date = toDate(date);
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(v => `${v}`.padStart(2, '0'))
    .join('-');
}

/**
 * Returns park operating date for a given date/time, or the current park date
 */
export function parkDate(dateTime?: { date: string; time?: ParkTime }) {
  dateTime ??= DateTime.now();
  const { date, time } = { time: ParkTime.dayStart, ...dateTime };
  return `${time}` >= `${ParkTime.dayStart}` ? date : modifyDate(date, -1);
}

export type DateFormatType = 'short';

export function formatDate(date: string, type?: DateFormatType) {
  const dt = toDate(date);
  if (isNaN(+dt)) throw new RangeError(`Invalid date string: ${date}`);
  const monthDay = dt.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
  });
  if (type === 'short') return monthDay;
  const today = parkDate();
  if (date === today) return `Today, ${monthDay}`;
  if (date === modifyDate(today, 1)) return `Tomorrow, ${monthDay}`;
  const weekday = dt.toLocaleString('en-US', { weekday: 'long' });
  return `${weekday}, ${monthDay}`;
}

export function formatTime(time: unknown) {
  const m = String(time).match(/^([01]?\d|2[0-3])(:[0-5]\d)?(?::[0-5]\d)?$/);
  if (!m) throw new RangeError(`Invalid time string: ${time}`);
  const hour = +m[1]!;
  return `${hour % 12 || 12}${m[2] ?? ''} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Returns an array of non-past times from a sorted array of ParkTimes
 */
export function upcomingTimes(times: ParkTime[]) {
  const now = DateTime.now().time.with({ second: 0 });
  const nextIdx = times.findIndex(t => t >= now);
  return nextIdx >= 0 ? times.slice(nextIdx) : [];
}
