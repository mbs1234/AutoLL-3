import { use } from 'react';

import { Booking, isLLMP } from '@/api/itinerary';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import NavContext, { NavError } from '@/contexts/NavContext';
import ParkContext from '@/contexts/ParkContext';
import RebookingContext from '@/contexts/RebookingContext';
import { parkDate } from '@/datetime';

import Button from '../Button';
import BookExperience from './screens/BookExperience';
import Home from './screens/Home';
import useScopeGuard, { dayLabel } from './useScopeGuard';

type Props = Parameters<typeof Button>[0] & {
  booking: Booking;
};

export default function ModifyButton({ booking, ...buttonProps }: Props) {
  const { ll } = use(ClientsContext);
  const { goBack } = use(NavContext);
  const { park, setPark } = use(ParkContext);
  const { bookingDate, setBookingDate } = use(BookingDateContext);
  const rebooking = use(RebookingContext);
  const { guard, dialog } = useScopeGuard();

  const goHome = () => goBack({ screen: Home, props: { tabName: 'LL' } });

  return ll.rules.book &&
    booking.modifiable &&
    !rebooking.auto &&
    isLLMP(booking) ? (
    <>
      <Button
        {...buttonProps}
        onClick={() => {
          const today = parkDate();
          const newDate = parkDate(booking.start);
          const movesPark =
            (!ll.rules.parkModify || newDate > today) &&
            park.id !== booking.park.id;
          const modify = async () => {
            rebooking.begin(booking);
            setBookingDate(newDate);
            if (!ll.rules.parkModify || newDate > today) {
              setPark(booking.park);
              if (park !== booking.park) return goHome();
            }
            try {
              await goBack({ screen: BookExperience });
            } catch (error) {
              if (!(error instanceof NavError)) throw error;
              await goHome();
            }
          };
          // Modifying a pass moves the whole app to its park and day, which
          // moves a running Autopilot with it.
          if (newDate !== bookingDate || movesPark) {
            guard(
              movesPark
                ? `${booking.park.name} for ${dayLabel(newDate)}`
                : dayLabel(newDate),
              () => void modify()
            );
          } else {
            void modify();
          }
        }}
      >
        Modify
      </Button>
      {dialog}
    </>
  ) : null;
}
