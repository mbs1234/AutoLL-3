import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { use, useState } from 'react';

import { ep, mk } from '@/__fixtures__/resort';
import { Experience } from '@/api/ll';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import { TODAY } from '@/testing';

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
