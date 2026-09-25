import { act, screen } from '@testing-library/react';

import { createBooking, hm, mickey, minnie, sm } from '@/__fixtures__/ll';
import { RequestControl, RequestNotSent } from '@/api/client';
import { LLClient, LLMP, Offer } from '@/api/ll';
import useTimeSearch from '@/autopilot/useTimeSearch';
import type { TimeSearchDeps } from '@/autopilot/useTimeSearch';
import { ParkTime } from '@/datetime';
import { TOMORROW } from '@/testing';

import TimeSearch from './TimeSearch';
import { renderScreen } from './screenTestSetup';

jest.mock('@/autopilot/useTimeSearch');

const mockedUseTimeSearch = jest.mocked(useTimeSearch);
let capturedDeps: TimeSearchDeps;

function fakeSearch(
  held: ParkTime,
  overrides: Partial<ReturnType<typeof useTimeSearch>> = {}
): ReturnType<typeof useTimeSearch> {
  return {
    running: false,
    held,
    cycles: 0,
    moves: 0,
    phase: 'idle',
    start: jest.fn(),
    accept: jest.fn(),
    cancel: jest.fn(),
    guard: { requested: undefined } as ReturnType<
      typeof useTimeSearch
    >['guard'],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  mockedUseTimeSearch.mockImplementation(deps => {
    capturedDeps = deps;
    return fakeSearch(deps.booking.start.time);
  });
});

describe('TimeSearch', () => {
  it('names the reservation and its currently held time', () => {
    const booking = createBooking(hm, { startTime: new ParkTime(12, 45) });
    renderScreen(<TimeSearch booking={booking} />);
    expect(screen.getByRole('heading', { name: booking.name })).toBeVisible();
    expect(screen.getByText(/Holding/)).toHaveTextContent('12:45 PM');
  });

  it('offers both the earliest search and a disabled targeted search', () => {
    renderScreen(<TimeSearch booking={createBooking(hm)} />);
    expect(screen.getByText('Find the earliest')).toBeEnabled();
    expect(screen.getByText('Aim for this time')).toBeDisabled();
  });

  it('explains that later moves require confirmation', () => {
    renderScreen(<TimeSearch booking={createBooking(hm)} />);
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          !!element.textContent?.includes('A move to a later time is offered')
      )
    ).toBeVisible();
  });

  it('forwards the mutation control to the real LL client seam', async () => {
    const booking = createBooking(hm);
    const book = jest.fn(async () => booking);
    renderScreen(<TimeSearch booking={booking} />, { ll: { book } });
    const control: RequestControl = {
      signal: new AbortController().signal,
      onDispatch: jest.fn(),
    };

    await act(async () => {
      await capturedDeps.commit({} as Offer<LLMP>, control);
    });

    expect(book).toHaveBeenCalledWith(expect.anything(), undefined, control);
  });

  it('keeps commit-time authorization in the screen wiring', async () => {
    const booking = createBooking(hm);
    renderScreen(<TimeSearch booking={booking} />);
    expect(await capturedDeps.claimCommit?.()).toBe(true);
    const send = jest.fn(async () => 'sent');

    await expect(
      capturedDeps.startCommit?.(() => false, send)
    ).rejects.toBeInstanceOf(RequestNotSent);
    expect(send).not.toHaveBeenCalled();
  });

  // As reported: opened on one person's 2:05 pm reservation while another
  // person held the same attraction at 9:10 am, the search re-read itself as
  // the 9:10. The screen must hand the search a matcher for *this* one.
  it('follows the reservation it was opened on, not the first for the ride', () => {
    const nine = createBooking(hm, {
      startTime: new ParkTime(9, 10),
      guests: [mickey],
    });
    const two = createBooking(hm, {
      startTime: new ParkTime(14, 5),
      guests: [minnie],
    });
    renderScreen(<TimeSearch booking={two} />);
    expect(capturedDeps.findHeld([nine, two], two)).toBe(two);
  });

  it('says a later move is being made the moment it is accepted', () => {
    const booking = createBooking(hm);
    mockedUseTimeSearch.mockReturnValue(
      fakeSearch(booking.start.time, {
        running: true,
        accepting: true,
        phase: 'committing',
        guard: { requested: new ParkTime(16) } as ReturnType<
          typeof useTimeSearch
        >['guard'],
      })
    );
    renderScreen(<TimeSearch booking={booking} />);
    expect(screen.getByText(/Moving to/)).toHaveTextContent('4:00 PM');
  });

  it('shows a protection error alongside an unresolved move', () => {
    const booking = createBooking(hm);
    mockedUseTimeSearch.mockReturnValue(
      fakeSearch(booking.start.time, {
        unresolved: new ParkTime(11),
        stop: 'failed',
        phase: 'unknown',
        lastError: 'The unresolved change could not be saved safely.',
      })
    );

    renderScreen(<TimeSearch booking={booking} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'could not be saved safely'
    );
  });
});

/**
 * The times Disney's grid leaves out. As reported: a 2:50 pm Big Thunder
 * beside a 2:05 pass for another ride, where "Show all" booked 1:40 by hand
 * and this search stayed put. The screen supplies what the search needs to
 * reach such a time -- the tip board's earliest, a way to ask for it by name,
 * and the same clash rule Autopilot uses.
 */
describe('TimeSearch and the times the grid leaves out', () => {
  it("hints the tip board's earliest for this ride, from this day's board", () => {
    renderScreen(<TimeSearch booking={createBooking(hm)} />, {
      experiences: [hm],
    });
    expect(`${capturedDeps.hint?.()}`).toBe('11:10:00');
  });

  it("gives no hint from another day's board", () => {
    renderScreen(<TimeSearch booking={createBooking(hm)} />, {
      experiences: [hm],
      bookingDate: TOMORROW,
    });
    expect(capturedDeps.hint?.()).toBeUndefined();
  });

  it('asks the client for a named time', async () => {
    const booking = createBooking(hm);
    const offer = jest.fn(async () => ({}) as Offer<LLMP>);
    renderScreen(<TimeSearch booking={booking} />, {
      ll: { offer: offer as unknown as LLClient['offer'] },
    });
    await capturedDeps.createOffer(booking, new ParkTime(13, 40));
    expect(offer).toHaveBeenCalledWith(booking.experience, booking.guests, {
      booking,
      targetTime: new ParkTime(13, 40),
    });
  });

  it('refuses a clashing time only when Avoid clashes is on', () => {
    const booking = createBooking(hm, { startTime: new ParkTime(14, 50) });
    const other = createBooking(sm, { startTime: new ParkTime(14, 5) });
    renderScreen(<TimeSearch booking={booking} />, {
      plans: [booking, other],
      avoidOverlaps: true,
    });
    expect(capturedDeps.clashes?.(new ParkTime(13, 40), booking)).toBe(true);
    // The reservation being moved cannot clash with itself.
    expect(capturedDeps.clashes?.(new ParkTime(14, 50), booking)).toBe(false);
  });

  it('allows a clashing time when Avoid clashes is off, as the manual screen does', () => {
    const booking = createBooking(hm, { startTime: new ParkTime(14, 50) });
    const other = createBooking(sm, { startTime: new ParkTime(14, 5) });
    renderScreen(<TimeSearch booking={booking} />, {
      plans: [booking, other],
      avoidOverlaps: false,
    });
    expect(capturedDeps.clashes?.(new ParkTime(13, 40), booking)).toBe(false);
  });
});
