import { bg, booking, multiExp } from '@/__fixtures__/ll';
import { ak, ll, renderResort } from '@/__fixtures__/resort';
import { Booking } from '@/api/itinerary';
import { Park } from '@/api/resort';
import BookingDateContext from '@/contexts/BookingDateContext';
import { NavError } from '@/contexts/NavContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import RebookingContext, { Rebooking } from '@/contexts/RebookingContext';
import { ParkTime } from '@/datetime';
import { TODAY, TOMORROW, click, nav, see, setTime, waitFor } from '@/testing';

import ModifyButton from './ModifyButton';
import BookExperience from './screens/BookExperience';
import Home from './screens/Home';

setTime('10:00');

const setBookingDate = jest.fn();
const setPark = jest.fn();
const rebooking: Rebooking = {
  begin: jest.fn(),
  end: jest.fn(),
  current: undefined,
  auto: false,
};

function ModifyButtonTest({
  booking: b = booking,
  bookingDate = TODAY,
  park,
  auto = false,
}: {
  booking?: Booking;
  bookingDate?: string;
  park?: Park;
  auto?: boolean;
}) {
  park ??= b.park;
  return (
    <PlansContext
      value={{
        plans: [booking],
        refreshPlans: () => {},
        pollPlans: async () => [],
        loaderElem: null,
      }}
    >
      <BookingDateContext value={{ bookingDate, setBookingDate }}>
        <ParkContext value={{ park, setPark }}>
          <RebookingContext
            value={{
              ...rebooking,
              current: auto ? booking : undefined,
              auto,
            }}
          >
            <nav.Provider>
              <ModifyButton booking={b} />
            </nav.Provider>
          </RebookingContext>
        </ParkContext>
      </BookingDateContext>
    </PlansContext>
  );
}

const home = { screen: Home, props: { tabName: 'LL' } };
const bookExp = { screen: BookExperience };

describe('ModifyButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ll.rules.parkModify = true;
  });

  it('goes back to BookExperience if booking in current park', async () => {
    renderResort(<ModifyButtonTest />);
    click('Modify');
    expect(rebooking.begin).toHaveBeenCalledWith(booking);
    expect(nav.goBack).toHaveBeenCalledWith(bookExp);
  });

  it('goes Home if no previous BookExperience screen', async () => {
    nav.goBack.mockRejectedValueOnce(new NavError());
    renderResort(<ModifyButtonTest />);
    click('Modify');
    expect(nav.goBack).toHaveBeenCalledWith(bookExp);
    await waitFor(() => expect(nav.goBack).toHaveBeenLastCalledWith(home));
  });

  it('goes Home if booking not in current park and bookingDate not today', async () => {
    renderResort(
      <ModifyButtonTest
        booking={{
          ...booking,
          start: { date: TOMORROW, time: new ParkTime(10) },
          end: { date: TOMORROW, time: new ParkTime(11) },
        }}
        park={ak}
      />
    );
    click('Modify');
    expect(setBookingDate).toHaveBeenCalledWith(TOMORROW);
    expect(setPark).toHaveBeenCalledWith(booking.park);
    expect(nav.goBack).toHaveBeenCalledWith(home);
  });

  it('goes Home if booking not in current park and no parkModify', async () => {
    ll.rules.parkModify = false;
    renderResort(<ModifyButtonTest park={ak} />);
    click('Modify');
    expect(setPark).toHaveBeenCalledWith(booking.park);
    expect(nav.goBack).toHaveBeenCalledWith(home);
  });

  it("doesn't show Modify button when auto rebooking or not a modifiable LL", async () => {
    renderResort(<ModifyButtonTest auto />);
    see.no('Modify');
    renderResort(<ModifyButtonTest booking={bg} />);
    see.no('Modify');
    renderResort(<ModifyButtonTest booking={multiExp} />);
    see.no('Modify');
  });
});
