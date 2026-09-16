import { screen } from '@testing-library/react';

import { createBooking, hm } from '@/__fixtures__/ll';
import useTimeSearch from '@/autopilot/useTimeSearch';
import { ParkTime } from '@/datetime';

import TimeSearch from './TimeSearch';
import { renderScreen } from './screenTestSetup';

jest.mock('@/autopilot/useTimeSearch');

const mockedUseTimeSearch = jest.mocked(useTimeSearch);

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
  mockedUseTimeSearch.mockImplementation(deps =>
    fakeSearch(deps.booking.start.time)
  );
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
