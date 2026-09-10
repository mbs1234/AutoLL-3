import { render } from '@testing-library/react';

import { mk, wdw } from '@/__fixtures__/resort';
import { Booking } from '@/api/itinerary';
import { Experience, LLClient } from '@/api/ll';
import { AlertPermission } from '@/autopilot/alert';
import { PollerStatus } from '@/autopilot/usePoller';
import AutopilotContext, { AutopilotState } from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext, { Clients } from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import { ParkTime } from '@/datetime';
import { TODAY, nav } from '@/testing';

export const BZ = '80010114';
export const DB = '80010129';

export function llExperience(id: string): Experience {
  return {
    ...wdw.experience(id),
    park: mk,
    standby: { available: true, waitTime: 30 },
    flex: { available: true, nextAvailableTime: new ParkTime(11) },
  } as Experience;
}

/** An experience with no `flex` field, i.e. not Multi Pass eligible. */
export function nonLLExperience(id: string): Experience {
  return {
    ...wdw.experience(id),
    park: mk,
    standby: { available: true, waitTime: 30 },
  } as Experience;
}

export const OFF: PollerStatus = {
  mode: 'off',
  consecutiveFailures: 0,
  polls: 0,
};

export type ScreenSetup = Partial<AutopilotState> & {
  experiences?: Experience[];
  watched?: string[];
  unknownExperienceIds?: string[];
  experiencesUpdated?: number;
  plans?: Booking[];
  plansUpdated?: number;
  bookingDate?: string;
  ll?: Partial<LLClient>;
};

/**
 * Renders one of the Autopilot screens inside the contexts they read, with
 * every action a mock. Shared by the Today, Configure and Activity suites,
 * which were one suite when the three were one screen.
 */
export function renderScreen(
  screen: React.ReactNode,
  {
    experiences = [llExperience(BZ), llExperience(DB)],
    watched = [] as string[],
    unknownExperienceIds = [] as string[],
    experiencesUpdated,
    plans = [] as Booking[],
    plansUpdated,
    bookingDate = TODAY,
    ll = {},
    status = OFF,
    enabled = false,
    notifications = 'granted' as AlertPermission,
    targets,
    ...rest
  }: ScreenSetup = {}
) {
  const effectiveTargets =
    targets ?? watched.map(experienceId => ({ experienceId }));
  const mocks = {
    setEnabled: jest.fn(),
    addTarget: jest.fn(),
    removeTarget: jest.fn(),
    toggleAutoBook: jest.fn(),
    toggleAutoModify: jest.fn(),
    toggleBookThenMove: jest.fn(),
    togglePaused: jest.fn(),
    toggleAutoSwap: jest.fn(),
    setRequireWholeParty: jest.fn(),
    setDryRun: jest.fn(),
    setAvoidOverlaps: jest.fn(),
    refillBudget: jest.fn(),
    setMaxActionsPerDay: jest.fn(),
    setTargetWindow: jest.fn(),
    setTargetRank: jest.fn(),
    togglePasskey: jest.fn(),
    requestNotifications: jest.fn(),
  };
  const clients = {
    ll: {
      rules: { prebook: false },
      nextBookTimes: [],
      nextBookTime: undefined,
      ...ll,
    },
  } as unknown as Clients;
  render(
    <nav.Provider>
      <ClientsContext value={clients}>
        <BookingDateContext value={{ bookingDate, setBookingDate: () => {} }}>
          <ParkContext value={{ park: mk, setPark: () => {} }}>
            <PlansContext
              value={{
                plans,
                refreshPlans: () => {},
                pollPlans: async () => plans,
                loaderElem: null,
                plansLoaded: true,
                lastUpdated: plansUpdated,
              }}
            >
              <ExperiencesContext
                value={{
                  experiences,
                  refreshExperiences: () => {},
                  pollExperiences: async () => [],
                  unknownExperienceIds,
                  lastUpdated: experiencesUpdated,
                  loaderElem: null,
                }}
              >
                <AutopilotContext
                  value={{
                    enabled,
                    status,
                    targets: effectiveTargets,
                    // Derived from the same list the test supplied, exactly
                    // as the provider derives it -- otherwise a test that sets
                    // flags on `targets` gets a `targetsHere` with none of
                    // them, and every assertion about what is armed reads
                    // false.
                    targetsHere: effectiveTargets.filter(
                      t =>
                        experiences.length === 0 ||
                        experiences.some(e => e.id === t.experienceId)
                    ),
                    isWatched: (id: string) => watched.includes(id),
                    replaceTargets: () => {},
                    passkeyStatus: 'off',
                    notifications,
                    requireWholeParty: false,
                    dryRun: false,
                    avoidOverlaps: true,
                    skipCounts: {},
                    dropSummaries: [],
                    bookingLog: [],
                    bookedCount: 0,
                    bookingsRemaining: 3,
                    actionBudget: 10,
                    maxActionsPerDay: 10,
                    ...mocks,
                    ...rest,
                  }}
                >
                  {screen}
                </AutopilotContext>
              </ExperiencesContext>
            </PlansContext>
          </ParkContext>
        </BookingDateContext>
      </ClientsContext>
    </nav.Provider>
  );
  return mocks;
}
