import { memo, use } from 'react';

import { Booking, plansGaps } from '@/api/itinerary';
import { Park } from '@/api/resort';
import { Day } from '@/components/Day';
import Tab from '@/components/Tab';
import PlansContext from '@/contexts/PlansContext';
import ThemeContext, { DEFAULT_THEME } from '@/contexts/ThemeContext';
import { parkDate } from '@/datetime';

import { ScreenProps } from '../../Screen';
import BookingListing from '../BookingListing';
import NoPlans from '../NoPlans';
import RefreshButton from './RefreshButton';

export default function Plans(props: Partial<ScreenProps>) {
  const { plans, refreshPlans, loaderElem } = use(PlansContext);

  return (
    <Tab
      title="Your Plans"
      buttons={<RefreshButton name="Plans" onClick={refreshPlans} />}
      theme={DEFAULT_THEME}
      {...props}
    >
      {plansGaps(plans).length > 0 && (
        <p
          className="mt-2 rounded-sm bg-yellow-100 p-2 text-sm text-yellow-900"
          role="status"
        >
          Disney's Plans could not all be read, so something may be missing
          here. Check Disney's app before you rely on this list. Protected
          changes stay protected until Plans can be read in full.
        </p>
      )}
      <PlansList plans={plans} />
      {loaderElem}
    </Tab>
  );
}

const PlansList = memo(function PlansList({ plans }: { plans: Booking[] }) {
  const theme = use(ThemeContext);

  const plansByDate = new Map<string, Booking[]>();
  const parksByDate = new Map<string, Set<Park>>();
  for (const plan of plans) {
    const date = parkDate(plan.start);
    if (!plansByDate.has(date)) plansByDate.set(date, []);
    if (plan.type !== 'APR') plansByDate.get(date)?.push(plan);
    if (!parksByDate.has(date)) parksByDate.set(date, new Set());
    if ((plan.type !== 'LL' || !plan.choices) && plan.park.icon) {
      parksByDate.get(date)?.add(plan.park as Park);
    }
  }

  return (
    <ul>
      {plans.length > 0 ? (
        [...plansByDate].map(([date, plans]) => (
          <li key={date}>
            <div className={`sticky top-0 -mx-3 pt-1 bg-white`}>
              <div className="flex items-center">
                <h2
                  className={`flex-1 mt-0 rounded-r-full px-3 py-1 ${theme.bg} text-white text-sm uppercase`}
                >
                  <Day>{date}</Day>
                </h2>
                <ul className="px-3 pl-2 text-lg text-right">
                  {[...(parksByDate.get(date) ?? [])].map(park => (
                    <li
                      key={park.id}
                      className="inline ml-1 first:ml-0"
                      aria-label={park.name}
                    >
                      {park.icon}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {plans.length > 0 ? (
              <ul className={`dividers ${plans.length === 0 ? 'mt-3' : ''}`}>
                {plans.map(booking => (
                  <li key={booking.id} data-testid="plan">
                    <BookingListing details booking={booking} />
                  </li>
                ))}
              </ul>
            ) : (
              <NoPlans />
            )}
          </li>
        ))
      ) : (
        <NoPlans />
      )}
    </ul>
  );
});
