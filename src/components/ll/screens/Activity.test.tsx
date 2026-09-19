import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { sdd } from '@/__fixtures__/ll';
import { wdw } from '@/__fixtures__/resort';
import { APP_NAME } from '@/appIdentity';
import {
  QUARANTINE_KEY,
  leaseKey,
  quarantine,
  quarantinedAt,
} from '@/autopilot/lease';
import { ParkTime, parkDate } from '@/datetime';
import kvdb from '@/kvdb';

import Activity from './Activity';
import { BZ, renderScreen } from './screenTestSetup';

const setup = (options = {}) => renderScreen(<Activity />, options);

/**
 * The quarantine panel's wording for an entry it cannot clear on its own.
 *
 * `APP_NAME` is escaped on the way into the pattern rather than interpolated
 * raw. The current name has no regex metacharacters, but the name is whatever
 * `appIdentity` says it is, and a sibling build called `aLL.4` would turn the
 * `.` into a wildcard -- a test that still passes while matching the wrong
 * build's text is worse than one that fails.
 */
const OLDER_ENTRY = new RegExp(
  `saved by an older ${APP_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} version`
);

beforeEach(() => localStorage.clear());

describe('Activity log', () => {
  it('lists a successful booking', () => {
    setup({
      bookingLog: [
        {
          name: 'Big Thunder',
          at: new ParkTime(9, 47),
          status: 'booked',
          returnTime: new ParkTime(11, 5),
        },
      ],
    });
    expect(
      screen.getByRole('heading', { name: 'Booking activity (1)' })
    ).toBeVisible();
    expect(screen.getByText(/Big Thunder/)).toBeVisible();
  });

  it('lists a failed booking with its reason', () => {
    setup({
      bookingLog: [
        {
          name: 'Big Thunder',
          at: new ParkTime(9, 47),
          status: 'failed',
          detail: 'Request failed',
        },
      ],
    });
    expect(screen.getByText('failed')).toBeVisible();
    expect(screen.getByText(/Request failed/)).toBeVisible();
  });

  it('renders an unknown outcome as a warning to check Disney Plans', () => {
    setup({
      bookingLog: [
        {
          name: 'Big Thunder',
          at: new ParkTime(9, 47),
          status: 'unknown',
          detail: 'No answer — check your plans',
        },
      ],
    });
    expect(screen.getByText('no answer')).toBeVisible();
    expect(screen.getByText(/check Disney Plans/)).toHaveTextContent(
      'Big Thunder -- check Disney Plans'
    );
    expect(screen.queryByText(/check your plans/i)).not.toBeInTheDocument();
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
  });

  it('says when nothing has happened yet', () => {
    setup();
    expect(
      screen.getByText(/Nothing booked, moved or swapped yet/)
    ).toBeVisible();
  });

  it('logs a moved reservation with both times', () => {
    setup({
      bookingLog: [
        {
          name: 'Slinky Dog Dash',
          at: new ParkTime(9, 47),
          status: 'modified',
          fromTime: new ParkTime(19, 10),
          returnTime: new ParkTime(11, 20),
        },
      ],
    });
    expect(screen.getByText(/moved/)).toBeVisible();
    expect(screen.getByText(/Slinky Dog Dash/)).toBeVisible();
  });

  it('logs a swap with what was given up', () => {
    setup({
      bookingLog: [
        {
          name: 'Slinky Dog Dash',
          at: new ParkTime(9, 47),
          status: 'swapped',
          replacedName: 'Toy Story Mania',
          fromTime: new ParkTime(15),
          returnTime: new ParkTime(11, 20),
        },
      ],
    });
    expect(screen.getByText(/swapped in/)).toBeVisible();
    expect(screen.getByText('Toy Story Mania')).toBeVisible();
  });

  it('logs what would have happened, per action', () => {
    setup({
      bookingLog: [
        {
          name: 'A',
          at: new ParkTime(9),
          status: 'dry-run',
          detail: 'book',
          returnTime: new ParkTime(11),
        },
        {
          name: 'B',
          at: new ParkTime(9, 1),
          status: 'dry-run',
          detail: 'modify',
        },
        {
          name: 'C',
          at: new ParkTime(9, 2),
          status: 'dry-run',
          detail: 'swap',
        },
      ],
    });
    const items = screen
      .getAllByRole('listitem')
      .map(li => li.textContent ?? '');
    expect(items.some(t => /would have booked A/.test(t))).toBe(true);
    expect(items.some(t => /would have moved B/.test(t))).toBe(true);
    expect(items.some(t => /would have swapped in C/.test(t))).toBe(true);
  });
});

describe('Activity diagnostics', () => {
  it('shows unresolved changes and clears only after explicit confirmation', async () => {
    const key = leaseKey(BZ, parkDate());
    await quarantine(key, {
      id: 'move-1',
      kind: 'modify',
      from: '15:00:00',
      to: '11:00:00',
    });
    setup();
    expect(
      screen.getByText(/1 unresolved Lightning Lane change/)
    ).toBeVisible();
    expect(screen.getByText(OLDER_ENTRY)).toBeVisible();
    fireEvent.click(screen.getByText('I checked Disney — resolve this'));
    expect(screen.getByText(/Clear this only after checking/)).toBeVisible();
    expect(quarantinedAt(key)).toBeDefined();
    fireEvent.click(screen.getByText('Clear this protection'));
    await waitFor(() => expect(quarantinedAt(key)).toBeUndefined());
    await waitFor(() =>
      expect(
        screen.queryByText(/unresolved Lightning Lane change/)
      ).not.toBeInTheDocument()
    );
  });

  it('names a reservation outside the currently loaded tipboard', async () => {
    await quarantine(leaseKey(sdd.id, parkDate()), {
      id: 'future-park-move',
      kind: 'modify',
      to: '11:00:00',
    });

    setup({ experiences: [] });

    expect(screen.getByText(new RegExp(sdd.name))).toBeVisible();
    expect(screen.queryByText(new RegExp(sdd.id))).not.toBeInTheDocument();
  });

  it('labels protection that lasts only for the open page', async () => {
    const key = leaseKey(BZ, parkDate());
    const realSet = kvdb.set.bind(kvdb);
    const set = jest.spyOn(kvdb, 'set').mockImplementation((storage, value) => {
      if (storage === QUARANTINE_KEY) throw new Error('storage unavailable');
      realSet(storage, value);
    });
    const result = await quarantine(key, {
      id: 'volatile-move',
      kind: 'modify',
      to: '11:00:00',
    });
    set.mockRestore();

    setup();

    expect(result.durable).toBe(false);
    expect(screen.getByText(/only while this page remains open/)).toBeVisible();
    // Leave no module-local doubt for the next test.
    fireEvent.click(screen.getByText('I checked Disney — resolve this'));
    fireEvent.click(screen.getByText('Clear this protection'));
    await waitFor(() => expect(quarantinedAt(key)).toBeUndefined());
  });

  it('focuses confirmation and attributes a clear failure to its doubt', async () => {
    const first = leaseKey(BZ, parkDate());
    const secondId = sdd.id;
    const second = leaseKey(secondId, parkDate());
    await quarantine(first, {
      id: 'move-1',
      kind: 'modify',
      to: '11:00:00',
    });
    await quarantine(second, {
      id: 'move-2',
      kind: 'modify',
      to: '12:00:00',
    });
    setup({ experiences: [] });
    const item = screen
      .getAllByRole('listitem')
      .find(li => li.textContent?.includes(sdd.name))!;

    fireEvent.click(
      within(item).getByRole('button', {
        name: 'I checked Disney — resolve this',
      })
    );
    const clear = within(item).getByRole('button', {
      name: 'Clear this protection',
    });
    await waitFor(() => expect(clear).toHaveFocus());

    const realSet = kvdb.set.bind(kvdb);
    const set = jest.spyOn(kvdb, 'set').mockImplementation((key, value) => {
      if (key === QUARANTINE_KEY) throw new Error('storage unavailable');
      realSet(key, value);
    });
    fireEvent.click(clear);

    const alert = await within(item).findByRole('alert');
    expect(alert).toHaveTextContent('storage unavailable');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(
      within(item).getByRole('button', { name: 'Keep protection' })
    );
    expect(within(item).queryByRole('alert')).not.toBeInTheDocument();
    set.mockRestore();
  });

  // Skips stay out of the log; this is where they become visible.
  it('explains why nothing was booked, most frequent first', () => {
    setup({ skipCounts: { 'offer-outside-window': 2, 'partial-party': 7 } });
    expect(screen.getByText('Why nothing was booked')).toBeVisible();
    const items = screen.getAllByRole('listitem').map(li => li.textContent);
    const first = items.find(t => t?.includes('7×'));
    expect(first).toMatch(/not everyone in the party/);
    expect(screen.getByText(/outside the window/)).toBeVisible();
  });

  it('shows an unknown skip reason verbatim', () => {
    setup({ skipCounts: { 'something-new': 1 } });
    expect(screen.getByText(/something-new/)).toBeVisible();
  });

  it('hides the diagnostics when nothing was skipped', () => {
    setup();
    expect(
      screen.queryByText('Why nothing was booked')
    ).not.toBeInTheDocument();
  });
});

describe('Activity learned drops', () => {
  it('hides the section with nothing learned', () => {
    setup();
    expect(screen.queryByText(/Learned drop times/)).not.toBeInTheDocument();
  });

  it('shows observed drops with how many days they were seen', () => {
    setup({
      dropSummaries: [
        {
          experienceId: BZ,
          observed: [{ time: new ParkTime(9, 47), days: 3, count: 4 }],
          scheduled: [],
        },
      ],
    });
    expect(
      screen.getByRole('heading', { name: /Learned drop times/ })
    ).toBeVisible();
    const entry = screen.getByText(/Seen:/).closest('li')!;
    expect(within(entry).getByText(wdw.experience(BZ).name)).toBeVisible();
    expect(within(entry).getByText(/3 days/)).toBeVisible();
    expect(screen.getByText(/4 observations/)).toBeVisible();
  });

  // Absence is evidence only when the poller was watching.
  it('flags a scheduled drop that was watched for but never seen', () => {
    setup({
      dropSummaries: [
        {
          experienceId: BZ,
          observed: [],
          scheduled: [
            { time: new ParkTime(9, 47), observedDays: 2, coveredDays: 2 },
            { time: new ParkTime(15, 47), observedDays: 0, coveredDays: 3 },
            { time: new ParkTime(19, 47), observedDays: 0, coveredDays: 0 },
          ],
        },
      ],
    });
    expect(screen.getByText(/seen 2 of 2 watched/)).toBeVisible();
    const missing = screen.getByText(/never seen in 3 watched days/);
    expect(missing).toBeVisible();
    expect(missing).toHaveClass('text-red-700');
    expect(screen.getByText(/not watched yet/)).toBeVisible();
  });

  it('omits attractions with schedule entries that were never watched', () => {
    setup({
      dropSummaries: [
        {
          experienceId: BZ,
          observed: [],
          scheduled: [
            { time: new ParkTime(9, 47), observedDays: 0, coveredDays: 0 },
          ],
        },
      ],
    });
    expect(screen.queryByText(/Learned drop times/)).not.toBeInTheDocument();
  });

  it("falls back to the id for an attraction not on today's tipboard", () => {
    setup({
      dropSummaries: [
        {
          experienceId: 'elsewhere',
          observed: [{ time: new ParkTime(13, 17), days: 1, count: 1 }],
          scheduled: [],
        },
      ],
    });
    expect(screen.getByText('elsewhere')).toBeVisible();
  });

  it('marks drops seen on enough days as used for timing', () => {
    setup({
      dropSummaries: [
        {
          experienceId: BZ,
          observed: [
            { time: new ParkTime(9, 47), days: 2, count: 2 },
            { time: new ParkTime(14, 17), days: 1, count: 1 },
          ],
          scheduled: [],
        },
      ],
    });
    const entry = screen.getByText(/Seen:/).closest('li')!;
    expect(within(entry).getByText(/2 days, used for timing/)).toBeVisible();
    expect(within(entry).getByText(/\(1 day\)/)).toBeVisible();
  });
});
