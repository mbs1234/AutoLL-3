import { RequestError } from '@/api/client';
import { BookingLogEntry } from '@/contexts/AutopilotContext';
import { ParkTime } from '@/datetime';

import { LOG_ROWS, addLogEntry, describeFailure } from './bookinglog';

const at = (h: number, m = 0) => new ParkTime(h, m);
const fail = (detail: string, name = 'Ride'): BookingLogEntry => ({
  name,
  at: at(9, 47),
  status: 'failed',
  detail,
});

/**
 * `RequestError` builds its message as `${message}: ${JSON.stringify(response)}`
 * -- the whole response object, `data` included. For an `ll.guests` call that
 * data is guest records, and it was going into the activity log, which renders
 * on screen and persists to localStorage on Disney's own origin.
 */
describe('describeFailure()', () => {
  it('names the status rather than the body when there is one', () => {
    const error = new RequestError({
      ok: false,
      status: 403,
      data: { guests: [{ name: 'A Real Person', id: 'swid-123' }] },
    } as never);
    const detail = describeFailure({ error: error.message, httpStatus: 403 });
    expect(detail).toBe('Request failed (403)');
    expect(detail).not.toContain('A Real Person');
    expect(detail).not.toContain('swid-123');
  });

  // No status is the client timeout and the dynamic-import failure, both of
  // which still carry a message worth reading.
  it('keeps a plain message when there is no status', () => {
    expect(describeFailure({ error: 'Network request failed' })).toBe(
      'Network request failed'
    );
  });

  // Belt and braces: a serialised body reaching here without a status must
  // still not be shown.
  it('drops a serialised body even with no status', () => {
    const detail = describeFailure({
      error: 'Request failed: {"data":{"guests":[{"name":"A Real Person"}]}}',
    });
    expect(detail).toBe('Request failed');
    expect(detail).not.toContain('A Real Person');
  });

  it('bounds the length of anything it does keep', () => {
    expect(describeFailure({ error: 'x'.repeat(500) })).toHaveLength(120);
  });

  it('never returns an empty detail', () => {
    expect(describeFailure({ error: '' })).toBe('Request failed');
  });
});

/**
 * During a refusal every tick produces the same failure. In burst cadence that
 * is several a second against a twenty-row log, so the day's real bookings were
 * gone within a minute, replaced by copies of one error.
 */
describe('addLogEntry()', () => {
  it('prepends an ordinary entry', () => {
    const first = fail('boom');
    const second: BookingLogEntry = {
      name: 'Ride',
      at: at(9, 48),
      status: 'booked',
    };
    expect(addLogEntry([first], second)).toEqual([second, first]);
  });

  it('collapses a repeat of the failure at the top', () => {
    let log = addLogEntry([], fail('boom'));
    log = addLogEntry(log, fail('boom'));
    log = addLogEntry(log, fail('boom'));
    expect(log).toHaveLength(1);
    expect(log[0]?.repeated).toBe(3);
  });

  it('keeps a real booking made before a refusal regime', () => {
    const booked: BookingLogEntry = {
      name: 'Tron',
      at: at(9, 40),
      status: 'booked',
    };
    let log = [booked];
    for (let i = 0; i < 100; ++i) log = addLogEntry(log, fail('boom'));
    expect(log.map(e => e.name)).toEqual(['Ride', 'Tron']);
    expect(log[0]?.repeated).toBe(100);
  });

  it('does not collapse a different failure', () => {
    let log = addLogEntry([], fail('boom'));
    log = addLogEntry(log, fail('different'));
    expect(log).toHaveLength(2);
    expect(log[0]?.repeated).toBeUndefined();
  });

  it('does not collapse the same failure on another attraction', () => {
    let log = addLogEntry([], fail('boom', 'Tron'));
    log = addLogEntry(log, fail('boom', 'Space Mountain'));
    expect(log).toHaveLength(2);
  });

  // Collapsing resumes only from the top, so an intervening success separates
  // two runs rather than merging them.
  it('starts a new row after something else intervenes', () => {
    let log = addLogEntry([], fail('boom'));
    log = addLogEntry(log, { name: 'Ride', at: at(9, 48), status: 'booked' });
    log = addLogEntry(log, fail('boom'));
    expect(log).toHaveLength(3);
  });

  it('keeps the time of the most recent occurrence', () => {
    let log = addLogEntry([], fail('boom'));
    log = addLogEntry(log, { ...fail('boom'), at: at(10, 15) });
    expect(String(log[0]?.at)).toBe(String(at(10, 15)));
  });

  it('caps the log', () => {
    let log: BookingLogEntry[] = [];
    for (let i = 0; i < LOG_ROWS + 10; ++i) {
      log = addLogEntry(log, { name: `R${i}`, at: at(9, i), status: 'booked' });
    }
    expect(log).toHaveLength(LOG_ROWS);
  });
});
