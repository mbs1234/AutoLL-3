import { use } from 'react';

import { Booking } from '@/api/itinerary';
import { leaseKey, quarantine, quarantinedAt } from '@/autopilot/lease';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import PlansContext from '@/contexts/PlansContext';
import { DateTime, ParkTime, parkDate } from '@/datetime';
import { act, fireEvent, render, screen, waitFor } from '@/testing';

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
  afterEach(() => jest.restoreAllMocks());

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

/*
 * Reconciliation belongs to the read, not to one engine's poll loop.
 *
 * It used to run only in Autopilot's every-tenth tick, so a reservation left in
 * an unknown state by a foreground search went unexamined whenever Autopilot was
 * off -- and then vanished at the 4am rollover having been settled by nothing.
 * Every successful plans read is evidence, whoever asked for it.
 */
describe('PlansProvider reconciles unresolved reservations', () => {
  const BZ = '80010114';
  const INCOMING = '80010129';
  // The reservation's own park day. A doubt is pruned by the day its key names,
  // so a fixture date in the past would make every test here pass vacuously.
  const DATE = parkDate();
  const key = leaseKey(BZ, DATE);
  const held = (facilityId: string, time: string) =>
    ({
      id: `ent-${facilityId}`,
      facilityId,
      name: 'Ride',
      start: new DateTime(DATE, ParkTime.from(time)),
    }) as unknown as Booking;
  const modifyDoubt = { kind: 'modify' as const, from: '19:00:00' };

  let now = 0;

  beforeEach(() => {
    localStorage.clear();
    // Controlled, because what a read can speak about is decided by when it
    // *started* -- and a doubt raised in the same millisecond as a read begins
    // would otherwise decide these tests.
    now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  const mount = (plans: () => Promise<Booking[]>) =>
    render(
      <ClientsContext value={{ itinerary: { plans } } as unknown as Clients}>
        <PlansProvider>
          <View />
        </PlansProvider>
      </ClientsContext>
    );

  it('settles a doubt when the reservation has moved', async () => {
    await quarantine(key, modifyDoubt, 1000);
    const plans = jest.fn(async () => [held(BZ, '11:00:00')]);
    mount(plans);
    await waitFor(() => expect(plans).toHaveBeenCalled());
    await waitFor(() => expect(quarantinedAt(key)).toBeUndefined());
  });

  it('leaves it alone while the reservation is unchanged', async () => {
    await quarantine(key, modifyDoubt, 1000);
    const plans = jest.fn(async () => [held(BZ, '19:00:00')]);
    mount(plans);
    await waitFor(() => expect(plans).toHaveBeenCalled());
    expect(quarantinedAt(key)).toBeDefined();
  });

  /*
   * A modify leaves the reservation in place at a new time. Missing from one
   * plans response says the response is incomplete, not that the move landed --
   * and clearing on that is the protection undoing itself on no evidence.
   */
  it('does not settle a modify on the reservation merely being absent', async () => {
    await quarantine(key, modifyDoubt, 1000);
    const plans = jest.fn(async () => []);
    mount(plans);
    await waitFor(() => expect(plans).toHaveBeenCalled());
    expect(quarantinedAt(key)).toBe(1000);
  });

  // A swap is the case where the reservation is supposed to vanish, and the
  // proof is what replaced it.
  it('settles a swap when the incoming attraction appears', async () => {
    await quarantine(
      key,
      { kind: 'swap', from: '19:00:00', gaining: INCOMING },
      1000
    );
    const plans = jest.fn(async () => [held(INCOMING, '13:00:00')]);
    mount(plans);
    await waitFor(() => expect(plans).toHaveBeenCalled());
    await waitFor(() => expect(quarantinedAt(key)).toBeUndefined());
  });

  /*
   * The response was already in flight when the reservation fell into doubt, so
   * it describes the world before the request that caused the doubt went out.
   * Reading a verdict out of it is wrong in both directions; here it is the
   * expensive one, clearing a doubt on a photograph taken before the event.
   */
  it('ignores a response that started before the doubt was raised', async () => {
    const first = deferred<Booking[]>();
    const plans = jest.fn(() => first.promise);
    now = 1000;
    mount(plans);
    await waitFor(() => expect(plans).toHaveBeenCalled());

    now = 2000;
    await quarantine(key, modifyDoubt, 2000);
    now = 3000;
    await act(async () => {
      first.resolve([held(BZ, '11:00:00')]);
      await first.promise;
    });
    expect(quarantinedAt(key)).toBe(2000);
  });

  /*
   * Evidence has the opposite rule to publication. An older snapshot is still
   * worth showing when a newer request failed, but it can only ever weaken a
   * doubt raised since -- so once a later read has spoken, an earlier one is
   * not offered at all.
   */
  it('does not offer an overtaken response as evidence', async () => {
    const initial = deferred<Booking[]>();
    const second = deferred<Booking[]>();
    const third = deferred<Booking[]>();
    const plans = jest
      .fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    now = 1000;
    mount(plans);
    await waitFor(() => expect(plans).toHaveBeenCalledTimes(1));
    await act(async () => {
      initial.resolve([held(BZ, '19:00:00')]);
      await initial.promise;
    });

    now = 2000;
    await quarantine(key, modifyDoubt, 2000);

    now = 3000;
    fireEvent.click(screen.getByRole('button', { name: 'Poll' }));
    await waitFor(() => expect(plans).toHaveBeenCalledTimes(2));
    now = 4000;
    fireEvent.click(screen.getByRole('button', { name: 'Poll' }));
    await waitFor(() => expect(plans).toHaveBeenCalledTimes(3));

    // The newest read speaks first, and says nothing has changed.
    await act(async () => {
      third.resolve([held(BZ, '19:00:00')]);
      await third.promise;
    });
    // The one it overtook then arrives carrying what would settle the doubt.
    await act(async () => {
      second.resolve([held(BZ, '11:00:00')]);
      await second.promise;
    });
    expect(quarantinedAt(key)).toBe(2000);
  });
});
