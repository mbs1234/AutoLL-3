import { ak, booking, bookings, ep, hs, mk } from '@/__fixtures__/ll';
import { Booking, notePlansGaps } from '@/api/itinerary';
import PlansContext from '@/contexts/PlansContext';
import { click, nav, render, screen, see, setTime, within } from '@/testing';

import BookingDetails from './BookingDetails';
import Plans from './Plans';

setTime('09:00');
const refreshPlans = jest.fn();
const { Provider: NavProvider, goTo } = nav;

function renderComponent(plans: Booking[]) {
  render(
    <PlansContext
      value={{
        plans,
        refreshPlans,
        pollPlans: async () => [],
        loaderElem: null,
      }}
    >
      <NavProvider>
        <Plans />
      </NavProvider>
    </PlansContext>
  );
}

describe('Plans', () => {
  it('shows reservations', async () => {
    renderComponent(bookings);

    click('Refresh Plans');
    expect(refreshPlans).toHaveBeenCalledTimes(1);

    const planLIs = await screen.findAllByTestId('plan');
    see('Today, October 1');
    bookings
      .filter(b => b.type !== 'APR')
      .forEach((booking, i) => {
        const inLI = within(planLIs[i]!);
        inLI.getByText(booking.choices ? 'Multiple Experiences' : booking.name);
        if (booking.type === 'BG') {
          inLI.getByText(`BG ${booking.boardingGroup}`);
        } else if (booking.start.time) {
          inLI.getByTime(booking.start.time);
        } else {
          inLI.getByText('Park Open');
        }
        if (booking.type === 'LL') {
          if (booking.end?.time) {
            inLI.getByTime(booking.end.time);
          } else {
            inLI.getByText('Park Close');
          }
        }
      });

    screen.getByRole('listitem', { name: mk.name });
    screen.getByRole('listitem', { name: ak.name });
    expect(
      screen.queryByRole('listitem', { name: ep.name })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('listitem', { name: hs.name })
    ).not.toBeInTheDocument();

    within(see('Tomorrow, October 2').closest('li') as HTMLLIElement).getByText(
      'No existing plans'
    );
    expect(see.all('No existing plans')).toHaveLength(1);

    click(booking.name);
    expect(goTo).toHaveBeenLastCalledWith(<BookingDetails booking={booking} />);
  });

  it('warns when Plans could not all be read', () => {
    const plans = [...bookings];
    notePlansGaps(plans, [{ facilityId: booking.facilityId }]);
    renderComponent(plans);
    expect(screen.getByText(/could not all be read/)).toBeVisible();
  });

  it('does not warn after a complete read', () => {
    renderComponent(bookings);
    expect(screen.queryByText(/could not all be read/)).not.toBeInTheDocument();
  });

  it('shows "No existing plans" message', async () => {
    renderComponent([]);
    see('No existing plans');
  });
});
