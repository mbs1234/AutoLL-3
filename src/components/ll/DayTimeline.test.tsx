import { render, screen } from '@testing-library/react';

import { createBooking, hm, sm } from '@/__fixtures__/ll';
import { WatchTarget } from '@/autopilot/watchlist';
import { ParkTime } from '@/datetime';
import { TODAY } from '@/testing';

import DayTimeline from './DayTimeline';

const time = (hour: number, minute = 0) => new ParkTime(hour, minute);

function setup(
  lanes: ReturnType<typeof createBooking>[],
  targets: WatchTarget[]
) {
  return render(<DayTimeline lanes={lanes} targets={targets} date={TODAY} />);
}

/** The bar element for a target, found by the title the component sets. */
const bar = (name: string) =>
  screen.getByTitle(new RegExp(`^${name}:`)) as HTMLElement;

describe('DayTimeline', () => {
  it('renders nothing when there is nothing to draw', () => {
    const { container } = setup([], []);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws a held reservation and a target window', () => {
    setup(
      [createBooking(hm, { startTime: time(12) })],
      [
        {
          experienceId: sm.id,
          name: sm.name,
          after: time(15),
          before: time(16),
        },
      ]
    );
    expect(screen.getByLabelText('Day timeline')).toBeVisible();
    expect(bar(hm.name)).toBeVisible();
    expect(bar(sm.name)).toBeVisible();
  });

  // The default: starring an attraction sets no window. It permits any time,
  // so it is drawn across the day -- but it must not be flagged for crossing
  // a held plan, because a full-day window crosses everything.
  it('labels an un-windowed target as any time, without a clash warning', () => {
    setup(
      [createBooking(hm, { startTime: time(12) })],
      [{ experienceId: sm.id, name: sm.name }]
    );
    expect(bar(sm.name)).toHaveAttribute('title', `${sm.name}: no window set`);
    expect(screen.getByText('any time')).toBeVisible();
    expect(screen.queryByText('crosses a held plan')).not.toBeInTheDocument();
  });

  it('warns when a bounded window crosses a held plan', () => {
    setup(
      [createBooking(hm, { startTime: time(12) })],
      [
        {
          experienceId: sm.id,
          name: sm.name,
          after: time(12, 30),
          before: time(13, 30),
        },
      ]
    );
    expect(screen.getByText('crosses a held plan')).toBeVisible();
  });

  it('says so when a window is wholly blocked', () => {
    setup(
      [createBooking(hm, { startTime: time(12) })],
      [
        {
          experienceId: sm.id,
          name: sm.name,
          after: time(12),
          before: time(12, 20),
        },
      ]
    );
    expect(screen.getByText('window fully blocked')).toBeVisible();
  });

  // `Math.max(3, negative)` used to render this as an ordinary short bar, so
  // an AM/PM slip looked like a perfectly normal 20-minute window.
  it('names an inverted window rather than drawing it as a normal bar', () => {
    setup(
      [],
      [
        {
          experienceId: sm.id,
          name: sm.name,
          after: time(15),
          before: time(10),
        },
      ]
    );
    expect(screen.getByText('bounds reversed')).toBeVisible();
  });

  it('marks a held reservation whose end time is unknown', () => {
    const booking = createBooking(hm, { startTime: time(12) });
    setup([{ ...booking, end: { date: TODAY } } as typeof booking], []);
    expect(bar(hm.name).title).toMatch(/end time unknown/);
  });

  /*
   * The protected band -- the shaded span around a held pass that the booker
   * refuses to place anything into -- is a full-width absolutely positioned div
   * drawn once per lane, so on a day with two overlapping holds the upper
   * lane's band lies over the lower lane's bar. Without `pointer-events-none`
   * it swallowed the tap and that booking could not be opened at all, which is
   * the one thing the navigable timeline exists to do.
   */
  it('draws the protected band so it cannot take a tap', () => {
    // Asserted as a class rather than by clicking through it: jsdom does no
    // hit-testing, so `element.click()` on a covered bar succeeds whatever is
    // drawn on top, and a test written that way passes with the bug present.
    // The class is the only part of this a unit test can actually prove.
    setup(
      [
        createBooking(hm, { startTime: time(12) }),
        createBooking(sm, { startTime: time(12) }),
      ],
      []
    );
    const bands = [
      ...document.querySelectorAll<HTMLElement>('[aria-hidden][style*="top"]'),
    ];
    expect(bands.length).toBeGreaterThan(0);
    for (const el of bands) {
      expect(el.className).toContain('pointer-events-none');
    }
  });

  it('gives simultaneous holds separate columns rather than stacking them', () => {
    setup(
      [
        createBooking(hm, { startTime: time(12) }),
        createBooking(sm, { startTime: time(12) }),
      ],
      []
    );
    const widths = [hm.name, sm.name].map(n => bar(n).style.width);
    const lefts = [hm.name, sm.name].map(n => bar(n).style.left);
    expect(widths).toEqual(['50%', '50%']);
    expect(new Set(lefts).size).toBe(2);
  });
});
