import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { use, useState } from 'react';

import { ep, mk } from '@/__fixtures__/resort';
import { Experience } from '@/api/ll';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import { TODAY, settled } from '@/testing';

import ExperiencesProvider from './ExperiencesProvider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

const experience = (id: string, name: string) =>
  ({ id, name }) as unknown as Experience;

function View() {
  const { experiences, unknownExperienceIds, lastUpdated, pollExperiences } =
    use(ExperiencesContext);
  const { setPark } = use(ParkContext);
  return (
    <>
      <div data-testid="experiences">
        {experiences.map(exp => exp.name).join(',')}
      </div>
      <div data-testid="unknown">{unknownExperienceIds?.join(',')}</div>
      <div data-testid="updated">{lastUpdated}</div>
      <button onClick={() => void pollExperiences()}>Poll</button>
      <button onClick={() => setPark(ep)}>Epcot</button>
    </>
  );
}

describe('ExperiencesProvider request scope', () => {
  it('clears the old scope and ignores a stale response after park changes', async () => {
    const stale = deferred<Experience[]>();
    const current = deferred<Experience[]>();
    let mkCalls = 0;
    const ll = {
      unknownExperienceIds: [] as string[],
      experiences: jest.fn(async (park: typeof mk) => {
        if (park === mk) {
          if (++mkCalls === 1) {
            ll.unknownExperienceIds = ['initial-unknown'];
            return [experience('old', 'Old park')];
          }
          const result = await stale.promise;
          ll.unknownExperienceIds = ['stale-unknown'];
          return result;
        }
        const result = await current.promise;
        ll.unknownExperienceIds = ['current-unknown'];
        return result;
      }),
    };
    const clients = {
      ll,
      liveData: { shows: jest.fn(async () => ({})) },
    } as unknown as Clients;
    let now = 100;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    function Harness() {
      const [park, setPark] = useState(mk);
      return (
        <ClientsContext value={clients}>
          <ParkContext value={{ park, setPark }}>
            <BookingDateContext
              value={{ bookingDate: TODAY, setBookingDate: () => {} }}
            >
              <ExperiencesProvider>
                <View />
              </ExperiencesProvider>
            </BookingDateContext>
          </ParkContext>
        </ClientsContext>
      );
    }

    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('experiences')).toHaveTextContent('Old park')
    );
    expect(screen.getByTestId('unknown')).toHaveTextContent('initial-unknown');
    expect(screen.getByTestId('updated')).toHaveTextContent('100');

    fireEvent.click(screen.getByRole('button', { name: 'Poll' }));
    await waitFor(() => expect(ll.experiences).toHaveBeenCalledTimes(2));

    now = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Epcot' }));
    expect(screen.getByTestId('experiences')).toBeEmptyDOMElement();
    expect(screen.getByTestId('unknown')).toBeEmptyDOMElement();
    expect(screen.getByTestId('updated')).toBeEmptyDOMElement();
    await waitFor(() => expect(ll.experiences).toHaveBeenCalledTimes(3));

    now = 300;
    current.resolve([experience('new', 'New park')]);
    await waitFor(() =>
      expect(screen.getByTestId('experiences')).toHaveTextContent('New park')
    );
    expect(screen.getByTestId('unknown')).toHaveTextContent('current-unknown');
    expect(screen.getByTestId('updated')).toHaveTextContent('300');

    now = 400;
    stale.resolve([experience('stale', 'Stale park')]);
    await waitFor(() =>
      expect(screen.getByTestId('experiences')).toHaveTextContent('New park')
    );
    expect(screen.getByTestId('unknown')).toHaveTextContent('current-unknown');
    expect(screen.getByTestId('updated')).toHaveTextContent('300');
  });

  it('does not let an older response replace a newer response in one scope', async () => {
    const stale = deferred<Experience[]>();
    const current = deferred<Experience[]>();
    let calls = 0;
    const ll = {
      unknownExperienceIds: [] as string[],
      experiences: jest.fn(async () => {
        const call = ++calls;
        const result = await (call === 1 ? stale.promise : current.promise);
        ll.unknownExperienceIds = [call === 1 ? 'stale' : 'current'];
        return result;
      }),
    };
    const clients = {
      ll,
      liveData: { shows: jest.fn(async () => ({})) },
    } as unknown as Clients;

    render(
      <ClientsContext value={clients}>
        <ParkContext value={{ park: mk, setPark: () => {} }}>
          <BookingDateContext
            value={{ bookingDate: TODAY, setBookingDate: () => {} }}
          >
            <ExperiencesProvider>
              <View />
            </ExperiencesProvider>
          </BookingDateContext>
        </ParkContext>
      </ClientsContext>
    );
    await waitFor(() => expect(ll.experiences).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Poll' }));
    await waitFor(() => expect(ll.experiences).toHaveBeenCalledTimes(2));

    current.resolve([experience('new', 'Current')]);
    await waitFor(() =>
      expect(screen.getByTestId('experiences')).toHaveTextContent('Current')
    );
    stale.resolve([experience('old', 'Stale')]);
    await waitFor(() =>
      expect(screen.getByTestId('experiences')).toHaveTextContent('Current')
    );
  });
});

// The tip board was covered by the spinner on every refresh, not only the
// first: half a second or more of a screen nobody could read or tap.
describe('ExperiencesProvider refreshing', () => {
  // The tests above pin `Date.now`, which would hold the refresh throttle's
  // clock still and swallow the second refresh.
  beforeEach(() => jest.restoreAllMocks());

  function Screen() {
    const { experiences, refreshExperiences, loaderElem } =
      use(ExperiencesContext);
    const { setPark } = use(ParkContext);
    return (
      <>
        <div data-testid="experiences">
          {experiences.map(exp => exp.name).join(',')}
        </div>
        <button onClick={() => refreshExperiences()}>Refresh</button>
        <button onClick={() => setPark(ep)}>Epcot</button>
        {loaderElem}
      </>
    );
  }

  it('covers the first load of a park, and no refresh after it', async () => {
    const ll = {
      unknownExperienceIds: [] as string[],
      experiences: jest.fn(async (park: typeof mk) => [
        experience(park.id, park.name),
      ]),
    };
    const clients = {
      ll,
      liveData: { shows: jest.fn(async () => ({})) },
    } as unknown as Clients;
    function Harness() {
      const [park, setPark] = useState(mk);
      return (
        <ClientsContext value={clients}>
          <ParkContext value={{ park, setPark }}>
            <BookingDateContext
              value={{ bookingDate: TODAY, setBookingDate: () => {} }}
            >
              <ExperiencesProvider>
                <Screen />
              </ExperiencesProvider>
            </BookingDateContext>
          </ParkContext>
        </ClientsContext>
      );
    }
    render(<Harness />);
    // Nothing on screen yet, so the first load covers it.
    expect(screen.getByLabelText('Loading…')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('experiences')).toHaveTextContent(mk.name)
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Loading…')).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      screen.getByRole('status', { name: 'Refreshing…' })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading…')).not.toBeInTheDocument();
    expect(screen.getByTestId('experiences')).toHaveTextContent(mk.name);
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Refreshing…' })
      ).not.toBeInTheDocument()
    );

    // Another park starts empty, so its first load covers again.
    fireEvent.click(screen.getByRole('button', { name: 'Epcot' }));
    expect(await screen.findByLabelText('Loading…')).toBeInTheDocument();
    // And it is still running. See `settled`.
    await settled();
  });
});
