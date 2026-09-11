import { use, useCallback, useEffect, useState } from 'react';

import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import { modifyDate, parkDate } from '@/datetime';
import kvdb from '@/kvdb';

export const BOOKING_DATE_KEY = 'autoll3.date';
/**
 * How far ahead the date picker offers, today inclusive.
 *
 * Sized for the longest window Disney grants anyone: a resort guest books from
 * seven days before check-in and may cover a stay of up to fourteen days, so
 * the last reachable park day is three weeks out.
 *
 * Deliberately an upper bound rather than the rule. An off-site guest actually
 * books three days before each individual park day, and nothing here knows
 * which case applies -- so most of these dates are unbookable for most guests,
 * and requests for them simply fail. Offering too many is the harmless
 * direction to be wrong in; offering too few would hide a date that is
 * genuinely bookable. A planner that knew the guest's resort status could
 * narrow this properly.
 */
export const NUM_BOOKING_DAYS = 22;

/**
 * How often to check whether the park day has turned.
 *
 * A minute is far finer than the once-a-day event it watches for, and cheap:
 * the callback is a string comparison that usually changes nothing.
 */
export const ROLLOVER_CHECK_MS = 60_000;

function getBookingDates() {
  const today = parkDate();
  return [...Array(NUM_BOOKING_DAYS).keys()].map(i => modifyDate(today, i));
}

function validDate(date: string | void) {
  return date && getBookingDates().includes(date) ? date : parkDate();
}

export default function BookingDateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { prebook } = use(ClientsContext).ll.rules;
  const [bookingDate, setDate] = useState(() => {
    return prebook
      ? validDate(kvdb.getDaily<string>(BOOKING_DATE_KEY))
      : parkDate();
  });

  const setBookingDate = useCallback(
    (date: Parameters<typeof setDate>[0]) => {
      setDate(prevDate => {
        date = typeof date === 'function' ? date(prevDate) : date;
        return prebook ? validDate(date) : parkDate();
      });
    },
    [prebook, setDate]
  );

  useEffect(() => {
    kvdb.setDaily<string>(BOOKING_DATE_KEY, bookingDate);
  }, [bookingDate]);

  /**
   * Follow the park day when it turns under a tab that stayed open.
   *
   * `bookingDate` was read once, at mount, and this provider does not remount:
   * a phone that keeps the bookmarklet tab overnight was still holding
   * yesterday at 7am. Nothing downstream treats that as an error, because
   * yesterday is a date like any other -- but `watchingToday` and
   * `watchingTomorrow` are both false for it, so `cadence` never leaves the
   * 45-second idle interval. No approach, no burst, no eligibility prewarm, no
   * drop learning, and a status display that reads exactly like a healthy run.
   * Turning autopilot on does not fix it: on/off deliberately does not persist,
   * so a tap is required, and the tap does not touch this. A reload did fix it,
   * since `validDate` refuses a date the picker no longer offers -- but nothing
   * told anyone to reload.
   *
   * Checked on an interval and whenever the page comes back to the front, which
   * between them cover the two ways this is discovered: the tab was watched
   * across 4am, or it was woken hours later. `validDate` does the work; a date
   * still on offer is returned unchanged, so a deliberate choice of a future
   * park day is left alone and the state update bails out.
   */
  useEffect(() => {
    const follow = () =>
      setDate(prev => (prebook ? validDate(prev) : parkDate()));
    const timer = setInterval(follow, ROLLOVER_CHECK_MS);
    document.addEventListener('visibilitychange', follow);
    window.addEventListener('focus', follow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', follow);
      window.removeEventListener('focus', follow);
    };
  }, [prebook]);

  return (
    <BookingDateContext value={{ bookingDate, setBookingDate }}>
      {children}
    </BookingDateContext>
  );
}
