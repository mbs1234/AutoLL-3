import { bookings, renderResort } from '@/__fixtures__/ll';
import { Booking } from '@/api/itinerary';
import PlansContext from '@/contexts/PlansContext';
import { parkDate } from '@/datetime';
import NavProvider from '@/providers/NavProvider';
import { TODAY, screen, see, setTime, within } from '@/testing';

import YourDay from './YourDay';

setTime('09:00');
const refreshPlans = jest.fn();

function renderComponent(plans: Booking[] = bookings, unmodifiable = false) {
  renderResort(
    <PlansContext
      value={{
        plans,
        refreshPlans,
        pollPlans: async () => [],
        loaderElem: null,
      }}
    >
      <NavProvider>
        <YourDay date={TODAY} unmodifiable={unmodifiable} />
      </NavProvider>
    </PlansContext>
  );
}

describe('YourDay', () => {
  it('shows plans for specified date', async () => {
    renderComponent();

    const planLIs = await screen.findAllByRole('listitem');
    bookings
      .filter(b => b.type !== 'APR' && parkDate(b.start) === TODAY)
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
        if (booking.modifiable) {
          inLI.getByRole('button', { name: 'Modify' });
        }
      });
  });

  it("doesn't show Modify buttons if unmodifiable", async () => {
    renderComponent(bookings, true);
    see.no('Modify');
  });

  it('shows "No existing plans" message if no plans', async () => {
    renderComponent([]);
    see('No existing plans');
  });
});
