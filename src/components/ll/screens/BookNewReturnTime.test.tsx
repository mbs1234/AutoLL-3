import { booking, ll, modOffer, renderResort, wdw } from '@/__fixtures__/ll';
import { RequestError } from '@/api/client';
import PlansContext from '@/contexts/PlansContext';
import { ParkTime } from '@/datetime';
import { ping } from '@/ping';
import { TODAY, act, click, loading, nav, see } from '@/testing';

import BookNewReturnTime from './BookNewReturnTime';
import BookingDetails from './BookingDetails';
import Home from './Home';
import SelectReturnTime from './SelectReturnTime';

jest.mock('@/ping');
jest.useFakeTimers();
const refreshPlans = jest.fn();

async function renderComponent() {
  return renderResort(
    <PlansContext
      value={{
        plans: [],
        refreshPlans,
        pollPlans: async () => [],
        loaderElem: null,
      }}
    >
      <nav.Provider>
        <BookNewReturnTime offer={modOffer} />
      </nav.Provider>
    </PlansContext>
  );
}

describe('BookNewReturnTime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('books new return time', async () => {
    renderComponent();
    see(modOffer.experience.name, 'heading');
    see.time(modOffer.start.time);
    see.time(modOffer.end.time);

    click('Change');
    expect(nav.goTo).toHaveBeenCalledWith(
      <SelectReturnTime offer={modOffer} onOfferChange={expect.any(Function)} />
    );
    const { onOfferChange } = nav.goTo.mock.lastCall?.[0].props ?? {};
    expect(onOfferChange).toBeInstanceOf(Function);

    const newOffer = {
      ...modOffer,
      start: { date: TODAY, time: new ParkTime(12, 25) },
      end: { date: TODAY, time: new ParkTime(13, 25) },
    };
    act(() => onOfferChange(newOffer));

    click('Modify Lightning Lane');
    await loading();
    expect(ll.book).toHaveBeenCalledWith(newOffer);
    expect(refreshPlans).toHaveBeenCalledTimes(1);
    expect(nav.goBack).toHaveBeenCalledWith({ screen: Home });
    expect(nav.goTo).toHaveBeenCalledWith(
      <BookingDetails booking={booking} isNew />
    );
    expect(ping).toHaveBeenCalledWith(wdw, 'G');
  });

  // No answer is not a failure: the move may have happened. It used to read
  // as one, with the same button live beneath it.
  it('stops offering Modify when Disney does not answer', async () => {
    renderComponent();
    ll.book.mockRejectedValueOnce(
      new RequestError({ ok: false, status: 0, data: {} })
    );
    click('Modify Lightning Lane');
    await loading();
    see('Disney did not answer.');
    see.no('Modify Lightning Lane');
    expect(refreshPlans).toHaveBeenCalled();
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it('leaves Modify to try again after a refusal', async () => {
    renderComponent();
    ll.book.mockRejectedValueOnce(
      new RequestError({ ok: false, status: 400, data: {} })
    );
    click('Modify Lightning Lane');
    await loading();
    see.no('Disney did not answer.');
    see('Modify Lightning Lane');
  });
});
