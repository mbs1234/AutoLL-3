import { booking, ll, modOffer, renderResort, times } from '@/__fixtures__/ll';
import { click, loading, nav, see, settled, waitFor } from '@/testing';

import BookNewReturnTime from './BookNewReturnTime';
import ChangeBookingTime from './ChangeBookingTime';

ll.offer.mockResolvedValue(modOffer);
jest.useFakeTimers();
const { Provider: NavProvider, goTo } = nav;

describe('ChangeBookingTime', () => {
  it('allows changing booking return time', async () => {
    renderResort(
      <NavProvider>
        <ChangeBookingTime booking={booking} />
      </NavProvider>
    );
    await see.screen('Select Return Time');
    expect(ll.offer).toHaveBeenCalledWith(booking.experience, booking.guests, {
      booking,
    });
    expect(ll.offer).toHaveBeenCalledTimes(1);
    await loading();
    const newOffer = { ...modOffer, id: 'new-offer' };
    ll.changeOfferTime.mockResolvedValueOnce(newOffer);
    click(see.time(times[1]![1]));
    await waitFor(() =>
      expect(goTo).toHaveBeenCalledWith(<BookNewReturnTime offer={newOffer} />)
    );
    // The new time's load is still in its minimum time. See `settled`.
    await settled();
  });
});
