import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PollerStatus } from '@/autopilot/usePoller';
import { BookingLogEntry } from '@/contexts/AutopilotContext';
import { ParkTime } from '@/datetime';

import { SKIP_TEXT, latestActivity, latestEvent } from './events';

const now = new ParkTime(11, 45);
const off: PollerStatus = { mode: 'off', consecutiveFailures: 0, polls: 0 };
const idle: PollerStatus = { mode: 'idle', consecutiveFailures: 0, polls: 30 };
const burst: PollerStatus = {
  mode: 'burst',
  consecutiveFailures: 0,
  polls: 57,
  target: new ParkTime(11, 47),
  secondsToTarget: 100,
};
const booked: BookingLogEntry = {
  name: 'Space Mountain',
  at: new ParkTime(11, 20),
  status: 'booked',
  returnTime: new ParkTime(13, 10),
};
const facts = { status: idle, bookingLog: [], now };

describe('latestEvent', () => {
  it('says nothing when off with nothing to say', () => {
    expect(latestEvent({ ...facts, status: off })).toBeUndefined();
  });

  it('puts a stopped poller above everything', () => {
    const event = latestEvent({
      ...facts,
      status: {
        mode: 'stopped',
        consecutiveFailures: 5,
        polls: 12,
        lastError: 'Network request failed (no response experiences)',
      },
      bookingLog: [booked],
    });
    expect(event).toMatchObject({ level: 'error', at: now });
    expect(event?.text).toBe(
      'Stopped after 5 failed checks: Network request failed (no response experiences)'
    );
  });

  it('reports a refusal above an action, and only while running', () => {
    const refusals = { eligibility: { count: 6, since: new ParkTime(11, 40) } };
    expect(
      latestEvent({ ...facts, refusals, bookingLog: [booked] })
    ).toMatchObject({
      level: 'error',
      text: 'Disney is refusing checking who is eligible',
    });
    expect(latestEvent({ ...facts, status: off, refusals })).toBeUndefined();
  });

  it('picks the newer of the last action and the last skip', () => {
    const skip = {
      name: 'Tower of Terror',
      reason: 'offer-outside-window',
      at: new ParkTime(11, 30),
    };
    expect(
      latestEvent({ ...facts, bookingLog: [booked], lastSkip: skip })?.text
    ).toBe('Skipped Tower of Terror: the offered time was outside the window');
    expect(
      latestEvent({
        ...facts,
        bookingLog: [booked],
        lastSkip: { ...skip, at: new ParkTime(11, 10) },
      })?.text
    ).toBe('Booked Space Mountain for 1:10 PM');
  });

  it('words each kind of action', () => {
    const at = new ParkTime(11, 30);
    const texts = (
      [
        {
          name: 'Haunted Mansion',
          at,
          status: 'modified',
          fromTime: new ParkTime(14),
          returnTime: new ParkTime(12, 30),
        },
        { name: 'Jungle Cruise', at, status: 'swapped', replacedName: 'Dumbo' },
        {
          name: 'Space Mountain',
          at,
          status: 'failed',
          detail: 'Network request failed (403 offer)',
        },
        {
          name: 'Space Mountain',
          at,
          status: 'dry-run',
          detail: 'modify',
          returnTime: new ParkTime(13),
        },
      ] as BookingLogEntry[]
    ).map(entry => latestEvent({ ...facts, bookingLog: [entry] }));
    expect(texts.map(e => e?.text)).toEqual([
      'Moved Haunted Mansion from 2:00 PM to 12:30 PM',
      'Swapped in Jungle Cruise for Dumbo',
      'Failed on Space Mountain: Network request failed (403 offer)',
      'Would have moved Space Mountain for 1:00 PM',
    ]);
    expect(texts[2]?.level).toBe('warn');
  });

  it('while bursting, an old action gives way to the cadence and a fresh one does not', () => {
    expect(
      latestEvent({ ...facts, status: burst, bookingLog: [booked] })?.text
    ).toBe('Checking rapidly for the 11:47 AM drop');
    expect(
      latestEvent({
        ...facts,
        status: burst,
        bookingLog: [{ ...booked, at: new ParkTime(11, 44) }],
      })?.text
    ).toBe('Booked Space Mountain for 1:10 PM');
  });

  it('falls back to the last find, then to watching', () => {
    expect(
      latestEvent({
        ...facts,
        lastHit: {
          experienceId: '1',
          name: 'Space Mountain',
          returnTime: new ParkTime(13, 10),
        },
      })
    ).toMatchObject({ text: 'Found Space Mountain at 1:10 PM' });
    expect(latestEvent(facts)?.text).toBe('Watching');
  });
});

describe('latestActivity', () => {
  const skip = {
    name: 'Tower of Terror',
    reason: 'tier-hold',
    at: new ParkTime(11, 30),
  };

  it('is the newer of the last action and the last skip', () => {
    expect(latestActivity({ bookingLog: [booked], lastSkip: skip })?.text).toBe(
      'Skipped Tower of Terror: held the Tier 1 slot for a better attraction'
    );
    expect(
      latestActivity({
        bookingLog: [booked],
        lastSkip: { ...skip, at: new ParkTime(11) },
      })?.text
    ).toBe('Booked Space Mountain for 1:10 PM');
  });

  it('falls back to the last find, and otherwise says nothing', () => {
    const lastHit = {
      experienceId: '1',
      name: 'Space Mountain',
      returnTime: new ParkTime(13, 10),
    };
    expect(latestActivity({ bookingLog: [], lastHit })?.text).toBe(
      'Found Space Mountain at 1:10 PM'
    );
    expect(latestActivity({ bookingLog: [] })).toBeUndefined();
  });

  it('never reports status, which the screen reports itself', () => {
    // A stopped poller is `latestEvent`'s business; activity is what happened.
    expect(latestActivity({ bookingLog: [booked] })?.text).toBe(
      'Booked Space Mountain for 1:10 PM'
    );
  });
});

/*
 * Every reason the log can print needs plain English, and the check has to be
 * over the *declared* reasons rather than a list kept by hand.
 *
 * `skipText` falls back to the raw identifier, which is right at runtime -- a
 * log entry persisted by an older build can name a reason this one has dropped,
 * and crashing over it would be worse. But it also means a newly added reason
 * ships silently as a slug, which is what put "waiting-to-retry" on screen at
 * exactly the moment a user is asking why nothing is booking. Three more were
 * unlabelled beside it.
 */
describe('SKIP_TEXT', () => {
  const union = (file: string, name: string): string[] => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'autopilot', file),
      'utf8'
    );
    const declaration = new RegExp(`export type ${name} =([^;]+);`).exec(
      source
    );
    if (!declaration) throw new Error(`${name} not found in ${file}`);
    return [...declaration[1]!.matchAll(/'([a-z-]+)'/g)].map(
      match => match[1]!
    );
  };

  it('has plain English for every skip reason that can reach the log', () => {
    const declared = [
      ...union('autobook.ts', 'SkipReason'),
      ...union('automodify.ts', 'ModifySkipReason'),
      ...union('autoswap.ts', 'SwapSkipReason'),
      // Raised by the provider itself rather than returned by a helper, so no
      // union declares them.
      'outside-window',
      'tier-hold',
    ];
    expect(declared.length).toBeGreaterThan(10);
    expect(declared.filter(reason => !(reason in SKIP_TEXT))).toEqual([]);
  });
});
