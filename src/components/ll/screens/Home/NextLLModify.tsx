import { use } from 'react';

import { LLMP, isLLMP } from '@/api/itinerary';
import Button from '@/components/Button';
import Screen from '@/components/Screen';
import Tab from '@/components/Tab';
import BookingListing from '@/components/ll/BookingListing';
import BookingDateContext from '@/contexts/BookingDateContext';
import NavContext from '@/contexts/NavContext';
import PlansContext from '@/contexts/PlansContext';
import { parkDate } from '@/datetime';

import { HomeTabProps } from '../Home';
import RefreshButton from '../RefreshButton';
import SwapAttractionSearch from '../SwapAttractionSearch';
import TimeSearch from '../TimeSearch';

export function NextLLModifyPicker({
  ref,
  onBack,
}: Partial<HomeTabProps> & { onBack: () => void }) {
  const { bookingDate } = use(BookingDateContext);
  const { plans, refreshPlans } = use(PlansContext);
  const { goTo } = use(NavContext);
  const held = plans.filter(
    (booking): booking is LLMP =>
      isLLMP(booking) && parkDate(booking.start) === bookingDate
  );
  const modifiable = held.filter(booking => booking.modifiable);
  const locked = held.filter(booking => !booking.modifiable);

  return (
    <Tab
      title="NextLL"
      ref={ref}
      buttons={<RefreshButton name="Plans" onClick={refreshPlans} />}
    >
      <Button type="small" onClick={onBack}>
        Choose another action
      </Button>
      <h2 className="mt-4 text-xl font-semibold">
        Modify a held Lightning Lane
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Pick the reservation to improve or replace. Only Multi Pass Lightning
        Lanes held on {bookingDate} are listed.
      </p>
      {modifiable.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {modifiable.map(booking => (
            <li
              key={booking.id}
              className="rounded-sm border border-gray-300 p-2"
            >
              <BookingListing booking={booking} />
              <Button
                type="small"
                className="mt-2"
                onClick={() => goTo(<NextLLModifyActions booking={booking} />)}
              >
                Modify this Lightning Lane
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-sm bg-gray-100 p-3 text-sm text-gray-700">
          No modifiable Multi Pass Lightning Lanes are held for this date.
        </p>
      )}
      {locked.length > 0 && (
        <div className="mt-4">
          <h3>Not available to modify</h3>
          <ul className="space-y-2">
            {locked.map(booking => (
              <li
                key={booking.id}
                className="rounded-sm bg-gray-100 p-2 opacity-70"
              >
                <BookingListing booking={booking} />
                <p className="mt-1 text-sm text-gray-600">
                  Disney currently marks this reservation as unmodifiable.
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tab>
  );
}

export function NextLLModifyActions({ booking }: { booking: LLMP }) {
  const { goBack, goTo } = use(NavContext);
  return (
    <Screen title="Modify Lightning Lane" theme={booking.park.theme}>
      <h2>{booking.name}</h2>
      <p className="mt-2 text-sm text-gray-600">
        Choose how to change this held Lightning Lane.
      </p>
      <Button
        type="full"
        className="mt-4"
        onClick={() => goTo(<TimeSearch booking={booking} />)}
      >
        Improve return time
      </Button>
      <p className="mt-1 text-sm text-gray-600">
        Searches every available return time for this same attraction.
      </p>
      <Button
        type="full"
        className="mt-4"
        onClick={() => goTo(<SwapAttractionSearch booking={booking} />)}
      >
        Change attraction
      </Button>
      <p className="mt-1 text-sm text-gray-600">
        Searches for a replacement attraction, then asks before replacing your
        held Lightning Lane.
      </p>
      <Button type="small" className="mt-5" onClick={() => void goBack()}>
        Back to held Lightning Lanes
      </Button>
    </Screen>
  );
}
