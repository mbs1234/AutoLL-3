import { render, screen } from '@testing-library/react';

import { createBooking, hm, lttRes, multiExp, sm } from '@/__fixtures__/ll';
import { Booking } from '@/api/itinerary';
import { WatchTarget } from '@/autopilot/watchlist';
import { ParkTime } from '@/datetime';
import { TODAY } from '@/testing';

import DayTimeline from './DayTimeline';

const time = (hour: number, minute = 0) => new ParkTime(hour, minute);

function setup(plans: Booking[], targets: WatchTarget[]) {
  return render(<DayTimeline plans={plans} targets={targets} date={TODAY} />);
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

  // The default: starring an attraction sets no window. It permits any time.
  // Drawn as a bar the height of the rail it took a column, which on a narrow
  // phone cut every name short; it is named instead, and never flagged.
  it('names an un-windowed target as any time, rather than drawing it', () => {
    const onTargetTap = jest.fn();
    render(
      <DayTimeline
        plans={[createBooking(hm, { startTime: time(12) })]}
        targets={[{ experienceId: sm.id, name: sm.name }]}
        date={TODAY}
        onTargetTap={onTargetTap}
      />
    );
    expect(screen.getByText('Any time:').parentElement).toHaveTextContent(
      `Any time: ${sm.name}.`
    );
    expect(
      screen.queryByTitle(new RegExp(`^${sm.name}:`))
    ).not.toBeInTheDocument();
    expect(screen.queryByText('crosses a held plan')).not.toBeInTheDocument();
    screen.getByRole('button', { name: sm.name }).click();
    expect(onTargetTap).toHaveBeenCalledWith(sm.id);
  });

  it('says one bound in its own words, not "any time"', () => {
    setup([], [{ experienceId: sm.id, name: sm.name, after: time(15) }]);
    expect(bar(sm.name)).toHaveTextContent('from 3:00 PM');
    expect(bar(sm.name)).toHaveAttribute('title', `${sm.name}: from 3:00 PM`);
  });

  // The title is what a screen reader reads, and it said "12:00:00".
  it('gives its descriptions in 12-hour time', () => {
    setup(
      [createBooking(hm, { startTime: time(12) })],
      [
        {
          experienceId: sm.id,
          name: sm.name,
          after: time(15),
          before: time(20, 15),
        },
      ]
    );
    expect(bar(hm.name).title).toMatch(/: 12:00 PM to 1:00 PM$/);
    expect(bar(sm.name)).toHaveAttribute(
      'title',
      `${sm.name}: 3:00 PM to 8:15 PM`
    );
  });

  // Lunch at 11:15 protects 10:35 to 12:15, as the booker has it.
  it('draws dining in grey, and flags a window that crosses it', () => {
    setup(
      [lttRes],
      [
        {
          experienceId: sm.id,
          name: sm.name,
          after: time(12),
          before: time(13),
        },
      ]
    );
    expect(bar(lttRes.name)).toHaveClass('bg-gray-200');
    expect(screen.getByText('crosses a held plan')).toBeVisible();
  });

  it('draws no protected band for a pass that protects nothing', () => {
    setup([multiExp], []);
    expect(bar(multiExp.name)).toBeVisible();
    expect(
      document.querySelectorAll('[aria-hidden][style*="top"]')
    ).toHaveLength(0);
  });

  // A bar's height is its time, and a short one was too small for a thumb.
  it('gives a short bar a thumb-sized hit area, and a tall one none', () => {
    setup(
      [createBooking(hm, { startTime: time(12) })],
      [
        {
          experienceId: sm.id,
          name: sm.name,
          after: time(9),
          before: time(17),
        },
      ]
    );
    expect(bar(hm.name).querySelector('.h-11')).toHaveAttribute('aria-hidden');
    expect(bar(sm.name).querySelector('.h-11')).toBeNull();
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
