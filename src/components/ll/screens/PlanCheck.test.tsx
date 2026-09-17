import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

import { hm, jc } from '@/__fixtures__/ll';
import { mk } from '@/__fixtures__/resort';
import { Guest, Guests } from '@/api/ll';
import { leaseKey, quarantine } from '@/autopilot/lease';
import { WatchTarget } from '@/autopilot/watchlist';
import AutopilotContext, { AutopilotState } from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import NavContext from '@/contexts/NavContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import { ParkTime, modifyDate, parkDate } from '@/datetime';
import { RateLimitExceeded } from '@/ratelimit';
import { TODAY } from '@/testing';

import PlanCheck from './PlanCheck';

const guest = (id: string, name: string, rest: Partial<Guest> = {}): Guest =>
  ({ id, name, ...rest }) as Guest;

function setup({
  targets = [{ experienceId: hm.id, autoBook: true }] as WatchTarget[],
  experiences = [hm, jc],
  guests = jest.fn(
    async (): Promise<Guests> => ({ eligible: [], ineligible: [] })
  ),
  pollExperiences = jest.fn(async () => []),
  bookingDate = TODAY,
  ...state
}: Partial<AutopilotState> & {
  targets?: WatchTarget[];
  experiences?: (typeof hm)[];
  guests?: jest.Mock;
  pollExperiences?: jest.Mock;
  bookingDate?: string;
} = {}) {
  render(
    <NavContext
      value={{ goTo: () => {}, goBack: async () => {} } as unknown as never}
    >
      <ParkContext value={{ park: mk, setPark: () => {} }}>
        <BookingDateContext value={{ bookingDate, setBookingDate: () => {} }}>
          <ClientsContext value={{ ll: { guests } } as unknown as Clients}>
            <ExperiencesContext
              value={{
                experiences,
                refreshExperiences: () => {},
                pollExperiences,
                loaderElem: null,
              }}
            >
              <PlansContext
                value={{
                  plans: [],
                  refreshPlans: () => {},
                  pollPlans: async () => [],
                  loaderElem: null,
                }}
              >
                <AutopilotContext
                  value={
                    {
                      targets,
                      requireWholeParty: true,
                      avoidOverlaps: true,
                      dryRun: false,
                      passkeyStatus: 'off',
                      ...state,
                    } as unknown as AutopilotState
                  }
                >
                  <PlanCheck />
                </AutopilotContext>
              </PlansContext>
            </ExperiencesContext>
          </ClientsContext>
        </BookingDateContext>
      </ParkContext>
    </NavContext>
  );
  return { guests, pollExperiences };
}

const tapCheck = async () => {
  await act(async () => {
    screen.getByText('Check current party').click();
  });
};

beforeEach(() => localStorage.clear());

describe('PlanCheck', () => {
  it('reviews the plan already on screen', () => {
    setup();
    expect(screen.getByText(/no configuration conflicts/)).toBeVisible();
  });

  // The screen's central safety claim, and the one thing no unit test of the
  // pure function can establish: rendering it asks Disney nothing.
  it('makes no request when it opens', () => {
    const { guests } = setup();
    expect(guests).not.toHaveBeenCalled();
  });

  it('warns when this browser cannot coordinate reservation locks', () => {
    delete (navigator as { locks?: unknown }).locks;
    setup();
    expect(
      screen.getByText(/cannot coordinate reservation locks across tabs/)
    ).toBeVisible();
  });

  it('shows current-date unresolved changes as protected review items', async () => {
    const date = parkDate();
    await quarantine(leaseKey(hm.id, date), {
      id: 'move-1',
      kind: 'modify',
      to: '11:00:00',
    });

    setup({ bookingDate: date });

    expect(
      screen.getByText(/1 unresolved Lightning Lane change/)
    ).toBeVisible();
    expect(screen.getByText(/items? to review/)).toBeVisible();
    expect(
      screen.queryByText(/blockers? need attention/)
    ).not.toBeInTheDocument();
  });

  it("does not count another date's protection against this plan", async () => {
    const date = parkDate();
    await quarantine(leaseKey(hm.id, modifyDate(date, 1)), {
      id: 'future-move',
      kind: 'modify',
      to: '11:00:00',
    });

    setup({ bookingDate: date });

    expect(
      screen.queryByText(/unresolved Lightning Lane change/)
    ).not.toBeInTheDocument();
  });

  it('reports dry run rather than calling the plan ready', () => {
    setup({ dryRun: true });
    expect(screen.getByText(/Dry run is on/)).toBeVisible();
    expect(
      screen.queryByText(/no configuration conflicts/)
    ).not.toBeInTheDocument();
  });

  // The park is on screen in the heading; the request used to ignore it and
  // ask about the resort's first park instead.
  it('scopes the party check to the park on screen', async () => {
    const { guests } = setup();
    await tapCheck();
    expect(guests).toHaveBeenCalledWith(
      undefined,
      TODAY,
      expect.objectContaining({ id: mk.id })
    );
  });

  it('says all guests are eligible only when some guest is', async () => {
    setup({
      guests: jest.fn(async () => ({
        eligible: [guest('g1', 'Ana'), guest('g2', 'Bo')],
        ineligible: [],
      })),
    });
    await tapCheck();
    await waitFor(() => expect(screen.getByText(/All 2 guests/)).toBeVisible());
  });

  // A saved party absent from the response comes back stamped NOT_IN_PARTY,
  // which the filter drops -- leaving an empty list that used to read as a
  // clean bill of health.
  it('does not call an empty party eligible', async () => {
    setup({
      guests: jest.fn(async () => ({
        eligible: [],
        ineligible: [
          guest('g9', 'Stale', { ineligibleReason: 'NOT_IN_PARTY' }),
        ],
      })),
    });
    await tapCheck();
    await waitFor(() =>
      expect(screen.getByText(/No guests came back eligible/)).toBeVisible()
    );
    expect(screen.queryByText(/generally eligible/)).not.toBeInTheDocument();
  });

  it('shows when an ineligible guest becomes eligible later', async () => {
    setup({
      guests: jest.fn(async () => ({
        eligible: [guest('g1', 'Ana')],
        ineligible: [
          guest('g2', 'Bo', {
            ineligibleReason: 'TOO_EARLY',
            eligibleAfter: new ParkTime(11, 30),
          }),
        ],
      })),
    });
    await tapCheck();
    await waitFor(() =>
      expect(screen.getByText(/eligible from/)).toBeVisible()
    );
  });

  // The limiter is shared with the poller and throws rather than throttling.
  // Unmapped, this surfaced as "Unknown error occurred".
  it('names a rate-limited party check', async () => {
    setup({
      guests: jest.fn(async () => {
        throw new RateLimitExceeded();
      }),
    });
    await tapCheck();
    await waitFor(() =>
      expect(screen.getByText(/Wait a few seconds/)).toBeVisible()
    );
  });

  it('does not report a ready plan when the tipboard is empty', () => {
    setup({ experiences: [] });
    expect(screen.getByText(/tipboard for this park and date/)).toBeVisible();
    expect(
      screen.queryByText(/no configuration conflicts/)
    ).not.toBeInTheDocument();
  });

  /*
   * The refresh used to call `refreshExperiences`, whose spinner and error
   * belong to the Experiences provider and are rendered by Today -- hidden
   * underneath this `fixed inset-0` screen. The request went out and the screen
   * said nothing, which reads as a broken button; the natural response is to
   * press it again and spend the shared limiter the poller needs.
   */
  describe('the tipboard refresh', () => {
    const tapRefresh = async () => {
      await act(async () => {
        screen.getByText('Refresh LL list').click();
      });
    };

    it('says it is refreshing while the request is in flight', async () => {
      let release = () => {};
      const pollExperiences = jest.fn(
        () => new Promise<never[]>(resolve => (release = () => resolve([])))
      );
      setup({ experiences: [], pollExperiences });
      await act(async () => {
        screen.getByText('Refresh LL list').click();
      });
      expect(screen.getByText('Refreshing…')).toBeVisible();
      await act(async () => release());
    });

    it('will not fire a second request while one is in flight', async () => {
      let release = () => {};
      const pollExperiences = jest.fn(
        () => new Promise<never[]>(resolve => (release = () => resolve([])))
      );
      setup({ experiences: [], pollExperiences });
      await act(async () => {
        screen.getByText('Refresh LL list').click();
      });
      await act(async () => {
        screen.getByText('Refreshing…').click();
      });
      expect(pollExperiences).toHaveBeenCalledTimes(1);
      await act(async () => release());
    });

    // The failure the provider's own toast would have swallowed out of sight.
    it('reports a refusal on this screen rather than silently', async () => {
      const pollExperiences = jest.fn(async () => {
        throw new RateLimitExceeded();
      });
      setup({ experiences: [], pollExperiences });
      await tapRefresh();
      await waitFor(() =>
        expect(screen.getByText(/Wait a few seconds/)).toBeVisible()
      );
      expect(screen.getByText('Refresh LL list')).toBeVisible();
    });
  });
});
