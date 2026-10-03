import { use } from 'react';

import { booking, ll, modOffer, renderResort, times } from '@/__fixtures__/ll';
import { RequestError } from '@/api/client';
import Screen from '@/components/Screen';
import ChangeBookingTime from '@/components/ll/screens/ChangeBookingTime';
import NavContext from '@/contexts/NavContext';
import PlansContext from '@/contexts/PlansContext';
import useScreenState from '@/hooks/useScreenState';
import NavProvider from '@/providers/NavProvider';
import {
  click,
  loading,
  render,
  screen,
  see,
  setTime,
  settled,
  waitFor,
} from '@/testing';

// The fixtures' park day, so that protection raised on it is not pruned.
setTime('09:00');
jest.mock('@/ping');

// A screen opened straight after going back is first drawn while the
// navigator still points at the screen it went back to. It took that position
// for its own, so once the navigator caught up it believed it was hidden for
// good -- and since 1.8.3 a hidden screen may not send. Changing a return time
// by hand goes exactly this way: the times screen goes back, then opens the
// Modify screen.

function Position() {
  const { isActiveScreen, isFirstScreen } = useScreenState();
  return (
    <p>
      {isActiveScreen ? 'active' : 'hidden'},{' '}
      {isFirstScreen ? 'first' : 'not first'}
    </p>
  );
}

function Start() {
  const { goTo } = use(NavContext);
  return (
    <Screen title="Start">
      <Position />
      <button onClick={() => goTo(<Middle />)}>Middle</button>
      <button onClick={() => goTo(<ChangeBookingTime booking={booking} />)}>
        Change time
      </button>
    </Screen>
  );
}

function Middle() {
  const { goTo, goBack } = use(NavContext);
  return (
    <Screen title="Middle">
      <button
        onClick={async () => {
          await goBack();
          goTo(<Opened />);
        }}
      >
        Back, then open
      </button>
    </Screen>
  );
}

function Opened() {
  const { goTo } = use(NavContext);
  return (
    <Screen title="Opened">
      <Position />
      <button onClick={() => goTo(<Middle />)}>Middle again</button>
    </Screen>
  );
}

describe('a screen opened straight after going back', () => {
  it('knows it is the screen on top, and not the first', async () => {
    render(
      <NavProvider>
        <Start />
      </NavProvider>
    );
    await see.screen('Start');
    click('Middle');
    await see.screen('Middle');
    click('Back, then open');
    await see.screen('Opened');
    expect(screen.getByText('active, not first')).toBeVisible();

    // And it still follows the stack afterwards.
    click('Middle again');
    await see.screen('Middle');
    expect(screen.getByText('hidden, not first')).toBeInTheDocument();
    history.back();
    await see.screen('Opened');
    expect(screen.getByText('active, not first')).toBeVisible();
  });

  it('sends a return-time change picked on the times screen', async () => {
    ll.offer.mockResolvedValue(modOffer);
    const newOffer = { ...modOffer, id: 'new-offer' };
    ll.changeOfferTime.mockResolvedValueOnce(newOffer);
    // A definite refusal: enough to show the request went out, and it keeps
    // this screen where it is.
    ll.book.mockRejectedValueOnce(
      new RequestError({ ok: false, status: 400, data: {} })
    );
    renderResort(
      <PlansContext
        value={{
          plans: [],
          refreshPlans: jest.fn(),
          pollPlans: async () => [],
          loaderElem: null,
        }}
      >
        <NavProvider>
          <Start />
        </NavProvider>
      </PlansContext>
    );
    await see.screen('Start');
    click('Change time');
    await see.screen('Select Return Time');
    await loading();
    click(see.time(times[1]![1]));
    await waitFor(() =>
      expect(screen.getByText('Modify Lightning Lane')).toBeVisible()
    );
    click('Modify Lightning Lane');
    await waitFor(() => expect(ll.book).toHaveBeenCalledTimes(1));
    expect(ll.book).toHaveBeenCalledWith(
      newOffer,
      undefined,
      expect.objectContaining({ onDispatch: expect.any(Function) })
    );
    expect(
      screen.queryByText('Action stopped before send')
    ).not.toBeInTheDocument();
    await settled();
  });
});
