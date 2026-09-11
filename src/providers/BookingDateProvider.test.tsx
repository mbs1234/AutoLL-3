import { act, render, screen } from '@testing-library/react';
import { use } from 'react';

import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import kvdb from '@/kvdb';
import { TODAY, TOMORROW, setTime } from '@/testing';

import BookingDateProvider, {
  BOOKING_DATE_KEY,
  ROLLOVER_CHECK_MS,
} from './BookingDateProvider';

function Probe() {
  const { bookingDate, setBookingDate } = use(BookingDateContext);
  return (
    <div>
      <span data-testid="date">{bookingDate}</span>
      <button onClick={() => setBookingDate(TOMORROW)}>tomorrow</button>
    </div>
  );
}

function setup(prebook = true) {
  const clients = {
    ll: { rules: { prebook } },
  } as unknown as Clients;
  render(
    <ClientsContext value={clients}>
      <BookingDateProvider>
        <Probe />
      </BookingDateProvider>
    </ClientsContext>
  );
}

const shown = () => screen.getByTestId('date').textContent;

/** Move the clock past 4am into the next park day, as an open tab would see it. */
async function crossRollover() {
  jest.setSystemTime(new Date(`${TOMORROW}T07:00-0400`));
  await act(async () => {
    jest.advanceTimersByTime(ROLLOVER_CHECK_MS + 1000);
  });
}

beforeEach(() => {
  localStorage.clear();
  setTime('09:00');
});

describe('BookingDateProvider', () => {
  it('starts on today', () => {
    setup();
    expect(shown()).toBe(TODAY);
  });

  it('keeps a deliberately chosen future park day', async () => {
    setup();
    await act(async () => {
      screen.getByText('tomorrow').click();
    });
    expect(shown()).toBe(TOMORROW);
    // The rollover check runs constantly; a date still on offer must survive it.
    await act(async () => {
      jest.advanceTimersByTime(ROLLOVER_CHECK_MS + 1000);
    });
    expect(shown()).toBe(TOMORROW);
  });

  /**
   * The regression. `bookingDate` was read once at mount and this provider does
   * not remount, so a phone that kept the tab overnight was still holding
   * yesterday at 7am -- and `cadence` never leaves idle for a date that is
   * neither today nor tomorrow, so nothing bursts, prewarms or learns while the
   * display reads like a healthy run.
   */
  it('follows the park day when it turns under an open tab', async () => {
    setup();
    expect(shown()).toBe(TODAY);
    await crossRollover();
    expect(shown()).toBe(TOMORROW);
  });

  it('follows the park day when the page comes back to the front', async () => {
    setup();
    jest.setSystemTime(new Date(`${TOMORROW}T07:00-0400`));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(shown()).toBe(TOMORROW);
  });

  it('records the followed date under the new park day', async () => {
    setup();
    await crossRollover();
    expect(kvdb.getDaily<string>(BOOKING_DATE_KEY)).toBe(TOMORROW);
  });

  // Without prebooking there is only ever today, rollover included.
  it('stays on today when prebooking is not allowed', async () => {
    setup(false);
    await act(async () => {
      screen.getByText('tomorrow').click();
    });
    expect(shown()).toBe(TODAY);
    await crossRollover();
    expect(shown()).toBe(TOMORROW);
  });
});
