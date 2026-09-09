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

  return (
    <BookingDateContext value={{ bookingDate, setBookingDate }}>
      {children}
    </BookingDateContext>
  );
}
