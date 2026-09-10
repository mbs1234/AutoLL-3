import { use } from 'react';

import { Booking } from '@/api/itinerary';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import PlansContext from '@/contexts/PlansContext';
import { fireEvent, render, screen, waitFor } from '@/testing';

import PlansProvider from './PlansProvider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

const booking = (id: string, name: string) =>
  ({ id, name }) as unknown as Booking;

function View() {
  const { plans, lastUpdated, pollPlans } = use(PlansContext);
  return (
    <>
      <div data-testid="plans">{plans.map(plan => plan.name).join(',')}</div>
      <div data-testid="updated">{lastUpdated}</div>
      <button onClick={() => void pollPlans()}>Poll</button>
    </>
  );
}

describe('PlansProvider request ordering', () => {
  it('does not let an older response replace a newer itinerary', async () => {
    const stale = deferred<Booking[]>();
    const current = deferred<Booking[]>();
    const plans = jest
      .fn()
      .mockResolvedValueOnce([booking('initial', 'Initial')])
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => current.promise);
    const clients = { itinerary: { plans } } as unknown as Clients;
    let now = 100;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    render(
      <ClientsContext value={clients}>
        <PlansProvider>
          <View />
        </PlansProvider>
      </ClientsContext>
    );
    await waitFor(() =>
      expect(screen.getByTestId('plans')).toHaveTextContent('Initial')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Poll' }));
    await waitFor(() => expect(plans).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Poll' }));
    await waitFor(() => expect(plans).toHaveBeenCalledTimes(3));

    now = 300;
    current.resolve([booking('new', 'Current')]);
    await waitFor(() =>
      expect(screen.getByTestId('plans')).toHaveTextContent('Current')
    );
    expect(screen.getByTestId('updated')).toHaveTextContent('300');

    now = 400;
    stale.resolve([booking('old', 'Stale')]);
    await waitFor(() =>
      expect(screen.getByTestId('plans')).toHaveTextContent('Current')
    );
    expect(screen.getByTestId('updated')).toHaveTextContent('300');
  });
});
