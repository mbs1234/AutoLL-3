import { TODAY, TOMORROW, YESTERDAY, setTime } from '@/testing';

import {
  DateFormat,
  DateTime,
  ParkTime,
  formatDate,
  formatTime,
  parkDate,
  toDate,
  upcomingTimes,
} from './datetime';

const date = '1998-04-22';
const time = '16:35:40';
const dateTimeString = `${date}T${time}`;

beforeEach(() => {
  setTime('08:00');
});

describe('ParkTime', () => {
  const t = new ParkTime(10, 47, 12);

  describe('ParkTime.from()', () => {
    it('creates PlainTime', () => {
      expect(ParkTime.from('10:47:12')).toEqual(t);
      expect(ParkTime.from({ hour: 10, minute: 47, second: 12 })).toEqual(t);
      expect(ParkTime.from(t)).toEqual(t);
    });
  });

  describe('constructor()', () => {
    it('throws RangeError if given non-finite field', () => {
      expect(() => new ParkTime(NaN, 0, 0)).toThrow(RangeError);
      expect(() => new ParkTime(Infinity, 0, 0)).toThrow(RangeError);
    });
  });

  describe('add()', () => {
    it('adds specified duration to time', () => {
      expect(t.add({ hours: 8, minutes: 20, seconds: 33 })).toEqual(
        new ParkTime(19, 7, 45)
      );
      expect(t.add({ hours: -1 })).toEqual(new ParkTime(9, 47, 12));
    });

    it('wraps subtraction across midnight', () => {
      expect(new ParkTime(0, 10).add({ minutes: -40 })).toEqual(
        new ParkTime(23, 30)
      );
    });

    it('returns same PlainTime if zero duration added', () => {
      expect(t.add({ hours: 0, minutes: 0, seconds: 0 })).toBe(t);
    });
  });

  describe('with()', () => {
    it('returns a new PlainTime with updated fields', () => {
      expect(t.with({ hour: 8, second: 0 })).toEqual(new ParkTime(8, 47, 0));
      expect(t.with({ minute: 30 })).toEqual(new ParkTime(10, 30, 12));
    });
  });

  describe('valueOf()', () => {
    it('returns seconds since ParkTime.dayStart', () => {
      const t = ParkTime.dayStart;
      expect(t.valueOf()).toBe(0);
      expect(t < t.add({ seconds: 1 })).toBe(true);
      expect(t < t.add({ seconds: -1 })).toBe(true);
    });
  });

  describe('toString()', () => {
    it('converts to string', () => {
      expect(t.toString()).toBe('10:47:12');
    });
  });

  describe('toJSON()', () => {
    it('converts to string', () => {
      expect(t.toJSON()).toBe('10:47:12');
    });
  });
});

describe('DateTime', () => {
  const dt = DateTime.from(dateTimeString);

  it('can be used with comparison operators', () => {
    const dt2 = DateTime.from('1998-04-23T10:00:00');
    expect(dt < dt2).toBe(true);
    expect(dt >= dt2).toBe(false);
  });

  it('implements toString() and toJSON()', () => {
    expect(dt.toString()).toBe(dateTimeString);
    expect(dt.toJSON()).toBe(dateTimeString);
  });

  describe('DateTime.from()', () => {
    it('accepts string', () => {
      expect(DateTime.from(dateTimeString)).toEqual({
        date: '1998-04-22',
        time: new ParkTime(16, 35, 40),
      });
    });

    it('accepts Date object', () => {
      expect(DateTime.from(new Date('1998-04-22T16:35:40-0400'))).toEqual({
        date: '1998-04-22',
        time: new ParkTime(16, 35, 40),
      });
    });

    it('accepts timestamp', () => {
      expect(DateTime.from(893277340000)).toEqual({
        date: '1998-04-22',
        time: new ParkTime(16, 35, 40),
      });
    });
  });

  describe('DateTime.now()', () => {
    it('returns current date/time', () => {
      expect(DateTime.now()).toEqual({
        date: '2021-10-01',
        time: new ParkTime(8),
      });
    });
  });

  describe('DateTime.setTimeZone()', () => {
    const resetTZ = () => DateTime.setTimeZone('America/New_York');
    beforeEach(resetTZ);
    afterAll(resetTZ);

    it('sets default time zone', () => {
      DateTime.setTimeZone('America/Los_Angeles');
      expect(DateTime.from(new Date(893277340752))).toEqual({
        date: '1998-04-22',
        time: new ParkTime(13, 35, 40),
      });
    });
  });
});

describe('DateFormat', () => {
  const fmt = new DateFormat({ month: 'long', day: 'numeric' });

  describe('format()', () => {
    it('formats date', () => {
      expect(fmt.format(TODAY)).toBe('October 1');
    });
  });

  describe('parts()', () => {
    it('returns parts', () => {
      expect(fmt.parts(TODAY)).toEqual({ month: 'October', day: '1' });
    });
  });
});

describe('formatDate()', () => {
  it('formats date for display', () => {
    expect(formatDate(TODAY)).toBe('Today, October 1');
    expect(formatDate(TODAY, 'short')).toBe('October 1');
    expect(formatDate(TOMORROW)).toBe('Tomorrow, October 2');
    expect(formatDate('2021-10-03')).toBe('Sunday, October 3');
    expect(() => formatDate('10/1/2021')).toThrow(RangeError);
  });
});

describe('formatTime()', () => {
  it('formats time for display', () => {
    expect(formatTime('08:14:42')).toBe('8:14 AM');
    expect(formatTime('08:14')).toBe('8:14 AM');
    expect(formatTime('8:00')).toBe('8:00 AM');
    expect(formatTime('8')).toBe('8 AM');
    expect(() => formatTime('8:14 PM')).toThrow(RangeError);
    expect(formatTime('12:45')).toBe('12:45 PM');
  });
});

describe('parkDate()', () => {
  it(`returns today's date if 4 AM or later`, () => {
    setTime('04:00:00');
    expect(parkDate()).toBe(TODAY);
    setTime('23:59:59');
    expect(parkDate()).toBe(TODAY);
  });

  it(`returns yesterday's date if before 4 AM`, () => {
    setTime('00:00:00');
    expect(parkDate()).toBe(YESTERDAY);
    setTime('03:59:59');
    expect(parkDate()).toBe(YESTERDAY);
  });

  it(`returns given date if time is >= 4 AM`, () => {
    const dt = { date: '2026-10-01', time: new ParkTime(4) };
    expect(parkDate(dt)).toBe('2026-10-01');
  });

  it(`returns prior day's date if time before 4 AM`, () => {
    const dt = { date: '2026-10-01', time: new ParkTime(0) };
    expect(parkDate(dt)).toBe('2026-09-30');
  });

  it('returns given date if time is not specified', () => {
    setTime('00:00:00');
    expect(parkDate({ date: '2026-10-01' })).toBe('2026-10-01');
  });
});

describe('toDate()', () => {
  it('converts the supplied value to a Date object', () => {
    const dateObj = new Date(dateTimeString);
    expect(toDate(dateTimeString)).toEqual(dateObj);
    expect(toDate(date)).toEqual(new Date(`${date}T00:00:00`));
    expect(toDate(+dateObj)).toEqual(dateObj);
    expect(toDate(dateObj)).toEqual(dateObj);
  });
});

describe('upcomingTimes()', () => {
  const times = ['11:30', '14:30', '17:30'].map(ParkTime.from);

  it('returns upcoming times', () => {
    expect(upcomingTimes(times)).toEqual(times);
    setTime('12:00');
    expect(upcomingTimes(times)).toEqual(times.slice(1));
    setTime('15:00');
    expect(upcomingTimes(times)).toEqual(times.slice(2));
    setTime('18:00');
    expect(upcomingTimes(times)).toEqual([]);
  });
});
