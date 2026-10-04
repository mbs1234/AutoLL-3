import {
  allDayExp,
  bg,
  booking,
  hm,
  hs,
  jc,
  ll,
  lttRes,
  mickey,
  minnie,
  mk,
  multiExp,
  pluto,
  renderResort,
  sdd,
  sm,
} from '@/__fixtures__/ll';
import { Booking, DasBooking } from '@/api/itinerary';
import { OfferError } from '@/api/ll';
import ParkContext from '@/contexts/ParkContext';
import RebookingContext from '@/contexts/RebookingContext';
import { DEFAULT_THEME } from '@/contexts/ThemeContext';
import { act, click, nav, screen, see, setTime, waitFor } from '@/testing';

import BookingDetails from './BookingDetails';
import CancelGuests from './CancelGuests';
import ChangeBookingTime from './ChangeBookingTime';
import Home from './Home';

setTime('09:00');
const rebooking = {
  begin: jest.fn(),
  end: jest.fn(),
  current: undefined,
  auto: false,
};
const setPark = jest.fn();

function renderComponent(booking: Booking, isNew = false) {
  return renderResort(
    <ParkContext value={{ park: mk, setPark }}>
      <RebookingContext value={rebooking}>
        <nav.Provider>
          <BookingDetails booking={booking} isNew={isNew} />
        </nav.Provider>
      </RebookingContext>
    </ParkContext>
  );
}

describe('BookingDetails', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows LL booking details', async () => {
    renderComponent(booking);
    await see.screen('Your Lightning Lane');
    see.time(booking.start.time);
    see.time(booking.end.time);
    see(mickey.name);
    see(minnie.name);
    see(pluto.name);
    click('Modify');
    expect(rebooking.begin).toHaveBeenLastCalledWith(booking);
    expect(nav.goBack).toHaveBeenCalledTimes(1);

    click('Cancel');
    expect(nav.goTo).toHaveBeenLastCalledWith(
      <CancelGuests booking={booking} onCancel={expect.any(Function)} />
    );

    const onCancel = nav.goTo.mock.lastCall?.[0]?.props?.onCancel;
    // Mickey and Minnie, as the booking holds them.
    const kept = booking.guests.slice(0, 2);
    act(() => onCancel(kept));
    see(mickey.name);
    see(minnie.name);
    await waitFor(() => see.no(pluto.name));

    act(() => onCancel([]));
    expect(nav.goBack).toHaveBeenCalledTimes(2);

    ll.offer.mockRejectedValueOnce(
      new OfferError({ eligible: [], ineligible: booking.guests })
    );
    click('Change');
    // For the guests still on it, after Pluto was removed above.
    expect(nav.goTo).toHaveBeenLastCalledWith(
      <ChangeBookingTime booking={{ ...booking, guests: kept }} />
    );

    see.no('Show Plans', 'button');
  });

  // After Cancel removes some guests, the pass is theirs alone. Change and
  // Modify used to get it as this screen first loaded it, and asked Disney to
  // move the removed guests as well.
  it('changes and modifies only for the guests still on the pass', async () => {
    renderComponent(booking);
    click('Cancel');
    const onCancel = nav.goTo.mock.lastCall?.[0]?.props?.onCancel;
    const remaining = booking.guests.filter(g => g.id !== pluto.id);
    act(() => onCancel(remaining));
    await waitFor(() => see.no(pluto.name));
    click('Change');
    expect(nav.goTo).toHaveBeenLastCalledWith(
      <ChangeBookingTime booking={{ ...booking, guests: remaining }} />
    );
    click('Modify');
    expect(rebooking.begin).toHaveBeenLastCalledWith({
      ...booking,
      guests: remaining,
    });
  });

  it('has Show Plans button if new booking', () => {
    renderComponent(booking, true);
    click('Show Plans');
    expect(nav.goBack).toHaveBeenLastCalledWith({
      screen: Home,
      props: { tabName: 'Plans' },
    });
  });

  it('shows Multiple Experiences LL details', async () => {
    const { container } = renderComponent(multiExp);
    expect(see('Your Lightning Lane').parentNode?.parentNode).toHaveClass(
      DEFAULT_THEME.bg
    );
    see('Multiple Experiences');
    see.time(multiExp.start.time);
    see('Park Close');
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map(h => h.textContent)
        .slice(0, 2)
    ).toEqual([hs.name, mk.name]);
    expect(
      screen
        .getAllByRole('listitem')
        .map(li => li.textContent)
        .slice(0, 4)
    ).toEqual([sdd.name, hm.name, jc.name, sm.name]);
    expect(container).toHaveTextContent(
      `${sdd.name} was temporarily unavailable during your return time.`
    );
    see.no('Redemptions left: 1');
    see.no('Modify');
    see.no('Cancel');
  });

  it('omits "temporarily unavailable" message if unknown original experience', async () => {
    const { container } = renderComponent({
      ...multiExp,
      facilityId: '',
      name: '',
    });
    see('Multiple Experiences');
    expect(container).not.toHaveTextContent('was temporarily unavailable');
  });

  it('uses park theme for single-park Multiple Experiences LL', async () => {
    renderComponent({
      ...multiExp,
      choices: multiExp.choices?.filter(exp => exp.park === booking.park),
    });
    see('Multiple Experiences');
    expect(see('Your Lightning Lane').parentNode?.parentNode).toHaveClass(
      mk.theme.bg
    );
  });

  it('shows all-day experience redemption details', async () => {
    renderComponent(allDayExp);
    see(allDayExp.name);
    see('Park Open');
    see('Park Close');
    see('Redemptions left: 2');
    see.no('Cancel');
  });

  it('shows boarding group details', async () => {
    renderComponent(bg);
    see(bg.name);
    expect(see('Boarding Group:')).toHaveTextContent(
      `Boarding Group: ${bg.boardingGroup}`
    );
    see.no('Your boarding group has been called');
    see.no('Cancel');
  });

  it('shows when boarding group is called', async () => {
    renderComponent({ ...bg, status: 'SUMMONED' });
    see('Boarding Group Called');
  });

  it('specifies DAS in heading', async () => {
    renderComponent({
      ...booking,
      type: 'DAS',
      subtype: 'IN_PARK',
      modifiable: undefined,
    } as DasBooking);
    await see.screen('Your DAS Selection');
  });

  it('shows dining reservation', () => {
    renderComponent(lttRes);
    see(lttRes.name);
    see.no('Cancel');
    see.no('Modify');
  });

  it("doesn't show Modify or Change buttons if unmodifiable", () => {
    renderResort(<BookingDetails booking={booking} unmodifiable />);
    see.no('Modify');
    see.no('Change');
  });
});
