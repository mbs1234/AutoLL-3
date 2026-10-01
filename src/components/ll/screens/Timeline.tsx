import { use } from 'react';

import { targetApplies } from '@/autopilot/watchlist';
import Screen from '@/components/Screen';
import ContextStrip from '@/components/ll/ContextStrip';
import DayTimeline from '@/components/ll/DayTimeline';
import AutopilotContext from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import NavContext from '@/contexts/NavContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import { parkDate } from '@/datetime';

import BookingDetails from './BookingDetails';
import Configure from './Configure';

export const TIMELINE = 'Timeline';

/** The day's plans beside the windows Autopilot may use, full height. */
export default function Timeline() {
  const { bookingDate } = use(BookingDateContext);
  const { park } = use(ParkContext);
  const { plans } = use(PlansContext);
  const { targets } = use(AutopilotContext);
  const { goTo } = use(NavContext);
  const targetsToday = targets.filter(target =>
    targetApplies(target, park.id, bookingDate)
  );
  // Every plan on the date, in any park: Lightning Lanes as Today lists
  // them, and the dining and other reservations the booker also keeps return
  // times away from. The timeline draws the timed ones.
  const plansToday = plans.filter(
    booking => parkDate(booking.start) === bookingDate
  );

  return (
    <Screen title={TIMELINE} theme={park.theme} subhead={<ContextStrip />}>
      {plansToday.length === 0 && targetsToday.length === 0 ? (
        <p>
          Nothing to draw yet: no Lightning Lane held on this date, and nothing
          watched at {park.name}.
        </p>
      ) : (
        <DayTimeline
          plans={plansToday}
          targets={targetsToday}
          date={bookingDate}
          onTargetTap={experienceId =>
            goTo(<Configure focus={{ kind: 'target', experienceId }} />)
          }
          onLaneTap={lane => {
            const booking = plansToday.find(item => item.id === lane.id);
            if (booking) goTo(<BookingDetails booking={booking} />);
          }}
        />
      )}
    </Screen>
  );
}
