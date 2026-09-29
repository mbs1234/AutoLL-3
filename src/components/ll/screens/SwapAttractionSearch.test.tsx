import { fireEvent, screen } from '@testing-library/react';

import { mk, wdw } from '@/__fixtures__/resort';
import { LLMP } from '@/api/itinerary';
import { Experience, Offer, OfferError } from '@/api/ll';
import { acquire, leaseKey, release } from '@/autopilot/lease';
import { NothingOpen } from '@/autopilot/timesearch';
import useTimeSearch from '@/autopilot/useTimeSearch';
import type { TimeSearchDeps } from '@/autopilot/useTimeSearch';
import { DateTime, ParkTime } from '@/datetime';
import { TODAY, TOMORROW } from '@/testing';

import SwapAttractionSearch from './SwapAttractionSearch';
import {
  BZ,
  DB,
  llExperience,
  nonLLExperience,
  renderScreen,
} from './screenTestSetup';

jest.mock('@/autopilot/useTimeSearch');

const mockedUseTimeSearch = jest.mocked(useTimeSearch);
let capturedDeps: TimeSearchDeps;

beforeEach(() => {
  localStorage.clear();
  mockedUseTimeSearch.mockImplementation(deps => {
    capturedDeps = deps;
    return {
      running: false,
      held: deps.booking.start.time,
      cycles: 0,
      moves: 0,
      phase: 'idle',
      start: jest.fn(),
      accept: jest.fn(),
      cancel: jest.fn(),
      guard: { requested: undefined } as ReturnType<
        typeof useTimeSearch
      >['guard'],
    };
  });
});

/** The Multi Pass being given up. */
function held(facilityId = BZ): LLMP {
  const exp = wdw.experience(facilityId);
  return {
    type: 'LL',
    subtype: 'MP',
    id: 'ent-1',
    facilityId,
    name: exp.name,
    land: exp.land,
    park: mk,
    start: new DateTime(TODAY, new ParkTime(15)),
    end: new DateTime(TODAY, new ParkTime(16)),
    modifiable: true,
    guests: [{ id: 'guest', name: 'Guest', entitlementId: 'ent-1' }],
  } as unknown as LLMP;
}

const chooser = () => screen.getByLabelText(/New attraction/);
const searchButton = () => screen.getByText('Search for a replacement');

describe('SwapAttractionSearch', () => {
  it('names the reservation being replaced', () => {
    renderScreen(<SwapAttractionSearch booking={held()} />);
    expect(screen.getByText(wdw.experience(BZ).name)).toBeInTheDocument();
    expect(screen.getByText(/Currently held/)).toBeInTheDocument();
  });

  // Offering the attraction already held would be a swap for itself: a request
  // spent to change nothing, against a reservation it could fail and lose.
  it('leaves the held attraction out of the choices', () => {
    renderScreen(<SwapAttractionSearch booking={held(BZ)} />, {
      experiences: [llExperience(BZ), llExperience(DB)],
    });
    const options = [...chooser().querySelectorAll('option')].map(
      o => o.textContent
    );
    expect(options.join(' ')).not.toContain(wdw.experience(BZ).name);
    expect(options.join(' ')).toContain(wdw.experience(DB).name);
  });

  // No `flex` means the attraction is not Multi Pass eligible, so it can never
  // be the replacement.
  it('offers only Multi Pass eligible attractions', () => {
    renderScreen(<SwapAttractionSearch booking={held(BZ)} />, {
      experiences: [llExperience(BZ), nonLLExperience(DB)],
    });
    const options = [...chooser().querySelectorAll('option')].map(
      o => o.textContent
    );
    expect(options.join(' ')).not.toContain(wdw.experience(DB).name);
  });

  // The search is what risks the reservation, so it must not be startable
  // before an attraction has been picked.
  it('refuses to start before an attraction is chosen', () => {
    renderScreen(<SwapAttractionSearch booking={held()} />);
    expect(searchButton()).toBeDisabled();
  });

  // The promise this screen makes in its own copy, and the reason it passes
  // `confirmEveryMove` to the search.
  it('says it will always ask before replacing', () => {
    renderScreen(<SwapAttractionSearch booking={held()} />);
    expect(screen.getByText(/always ask before replacing/)).toBeInTheDocument();
  });

  // As reported: after "Replace Lightning Lane" nothing on the screen changed
  // until the next check, so the tap looked like it had done nothing -- and
  // the only word that it had worked was a small grey line at the end.
  describe('while and after replacing', () => {
    const shown: Partial<ReturnType<typeof useTimeSearch>> = {};
    beforeEach(() => {
      for (const key of Object.keys(shown)) {
        delete shown[key as keyof typeof shown];
      }
      mockedUseTimeSearch.mockImplementation(deps => ({
        running: false,
        held: deps.booking.start.time,
        cycles: 0,
        moves: 0,
        phase: 'idle',
        start: jest.fn(),
        accept: jest.fn(),
        cancel: jest.fn(),
        guard: { requested: undefined } as ReturnType<
          typeof useTimeSearch
        >['guard'],
        ...shown,
      }));
    });
    /** Render, then pick the new attraction: the pick is what re-renders. */
    function replacing(state: Partial<ReturnType<typeof useTimeSearch>>) {
      renderScreen(<SwapAttractionSearch booking={held(BZ)} />, {
        experiences: [llExperience(BZ), llExperience(DB)],
      });
      Object.assign(shown, state);
      fireEvent.change(chooser(), { target: { value: DB } });
    }
    const four = new ParkTime(16);
    const guard = { requested: four } as ReturnType<
      typeof useTimeSearch
    >['guard'];

    it('says the replacement is being made from the moment it is accepted', () => {
      replacing({ running: true, accepting: true, phase: 'committing', guard });
      expect(screen.getByRole('status')).toHaveTextContent(
        `Replacing ${wdw.experience(BZ).name} with ${wdw.experience(DB).name} at 4:00 PM`
      );
    });

    it('says when it is waiting for Plans to confirm', () => {
      replacing({ running: true, phase: 'awaiting', guard });
      expect(screen.getByRole('status')).toHaveTextContent(
        'waiting for Plans to confirm'
      );
    });

    it('says plainly when the replacement is done', () => {
      replacing({ stop: 'goal-met', held: four });
      const done = screen.getByRole('status');
      expect(done).toHaveTextContent(
        `Replaced ${wdw.experience(BZ).name} with ${wdw.experience(DB).name} at 4:00 PM.`
      );
      expect(done).toHaveTextContent('Confirmed in Plans.');
    });
  });

  it('claims both the victim and the attraction being gained', async () => {
    renderScreen(<SwapAttractionSearch booking={held(BZ)} />, {
      experiences: [llExperience(BZ), llExperience(DB)],
    });
    fireEvent.change(chooser(), { target: { value: DB } });
    const victim = leaseKey(BZ, TODAY);
    const gained = leaseKey(DB, TODAY);

    await acquire(gained, 'background-book');
    expect(await capturedDeps.claimCommit?.()).toBe(false);
    await release(gained, 'background-book');

    await acquire(victim, 'background-swap');
    expect(await capturedDeps.claimCommit?.()).toBe(false);
  });
});

/**
 * The friend's request: change a held pass into whichever of several rides
 * opens first, for no more requests than a search over one ride.
 */
describe('SwapAttractionSearch over several attractions', () => {
  const HM = '80010208';
  const BTMRR = '80010110';
  const shown: Partial<ReturnType<typeof useTimeSearch>> = {};
  beforeEach(() => {
    for (const key of Object.keys(shown)) {
      delete shown[key as keyof typeof shown];
    }
    mockedUseTimeSearch.mockImplementation(deps => {
      capturedDeps = deps;
      return {
        running: false,
        held: deps.booking.start.time,
        cycles: 0,
        moves: 0,
        phase: 'idle',
        start: jest.fn(),
        accept: jest.fn(),
        cancel: jest.fn(),
        guard: { requested: undefined } as ReturnType<
          typeof useTimeSearch
        >['guard'],
        ...shown,
      };
    });
  });

  const openAt = (id: string, hour: number) =>
    ({
      ...llExperience(id),
      flex: { available: true, nextAvailableTime: new ParkTime(hour) },
    }) as Experience;
  const shut = (id: string) =>
    ({ ...llExperience(id), flex: { available: false } }) as Experience;
  const others = () => screen.getAllByLabelText(/^Or/);

  /** Choose Dumbo and Haunted Mansion to replace a held Buzz Lightyear. */
  function several({
    board = [] as Experience[],
    bookingDate = TODAY,
    experiencesUpdated = undefined as number | undefined,
    offer = jest.fn(
      async (experience: Experience) =>
        ({ experience }) as unknown as Offer<LLMP>
    ),
  } = {}) {
    const poll = jest.fn(async () => board);
    renderScreen(<SwapAttractionSearch booking={held(BZ)} />, {
      experiences: [llExperience(BZ), llExperience(DB), llExperience(HM)],
      pollExperiences: poll,
      bookingDate,
      experiencesUpdated,
      ll: { offer } as never,
    });
    fireEvent.change(chooser(), { target: { value: DB } });
    fireEvent.change(others()[0]!, { target: { value: HM } });
    const asked = () => offer.mock.calls.map(([experience]) => experience.id);
    return { offer, poll, asked };
  }

  it('offers another attraction once one is chosen, up to three', () => {
    renderScreen(<SwapAttractionSearch booking={held(BZ)} />, {
      experiences: [BZ, DB, HM, BTMRR].map(llExperience),
    });
    expect(screen.queryByLabelText(/^Or/)).not.toBeInTheDocument();
    fireEvent.change(chooser(), { target: { value: DB } });
    fireEvent.change(others()[0]!, { target: { value: HM } });
    expect(others()).toHaveLength(2);
    fireEvent.change(others()[1]!, { target: { value: BTMRR } });
    // Three in all: no fourth.
    expect(others()).toHaveLength(2);
  });

  it('says it takes whichever opens first', () => {
    several();
    expect(screen.getByText(/whichever of the attractions/)).toBeVisible();
  });

  // The board is one request for every ride, and carries no sensor payload.
  it('asks Disney for no offer while none of them is open', async () => {
    const { offer, poll } = several({ board: [shut(DB), shut(HM)] });
    await expect(capturedDeps.createOffer(held(BZ))).rejects.toBeInstanceOf(
      NothingOpen
    );
    expect(poll).toHaveBeenCalledTimes(1);
    expect(offer).not.toHaveBeenCalled();
  });

  it('asks about the one that opens soonest, and only that one', async () => {
    const { asked } = several({ board: [openAt(DB, 14), openAt(HM, 12)] });
    await capturedDeps.createOffer(held(BZ));
    expect(asked()).toEqual([HM]);
  });

  it('uses a board read moments ago rather than reading it again', async () => {
    const { poll, asked } = several({
      board: [openAt(HM, 12)],
      experiencesUpdated: Date.now(),
    });
    await capturedDeps.createOffer(held(BZ));
    expect(poll).not.toHaveBeenCalled();
    expect(asked()).toHaveLength(1);
  });

  // The person answered a question about one ride; another opening since
  // must not change what they said yes to.
  it('accepts the attraction it asked about, whatever is open now', async () => {
    const { asked } = several({ board: [openAt(HM, 12)] });
    await capturedDeps.createOffer(held(BZ), undefined, DB);
    expect(asked()).toEqual([DB]);
  });

  it('leaves out for a while a ride Disney made no offer for', async () => {
    const offer = jest.fn(async (experience: Experience) => {
      if (experience.id === HM) {
        throw new OfferError({ eligible: [], ineligible: [] } as never);
      }
      return { experience } as unknown as Offer<LLMP>;
    });
    const { asked } = several({
      board: [openAt(DB, 14), openAt(HM, 12)],
      offer,
    });
    await expect(capturedDeps.createOffer(held(BZ))).rejects.toBeInstanceOf(
      OfferError
    );
    await capturedDeps.createOffer(held(BZ));
    expect(asked()).toEqual([HM, DB]);
  });

  // Another day's board says nothing about the reservation's day.
  it('takes turns when the board is for another day', async () => {
    const { poll, asked } = several({ bookingDate: TOMORROW });
    await capturedDeps.createOffer(held(BZ));
    await capturedDeps.createOffer(held(BZ));
    expect(asked()).toEqual([DB, HM]);
    expect(poll).not.toHaveBeenCalled();
  });

  it('claims every attraction it may gain', async () => {
    several();
    await acquire(leaseKey(HM, TODAY), 'background-book');
    expect(await capturedDeps.claimCommit?.()).toBe(false);
  });

  it('names the attraction gained from the offer it commits', () => {
    several();
    expect(
      capturedDeps.gainingFacility?.({
        experience: { id: HM },
      } as unknown as Offer<LLMP>)
    ).toBe(HM);
  });

  it('says what it is searching for', () => {
    several();
    Object.assign(shown, { running: true });
    fireEvent.change(others()[1]!, { target: { value: '' } });
    expect(
      screen.getByText(
        `${wdw.experience(DB).name} or ${wdw.experience(HM).name}`
      )
    ).toBeVisible();
  });

  it('names the attraction that came up in the question', () => {
    several();
    Object.assign(shown, {
      running: true,
      pending: new ParkTime(16),
      ride: { id: HM, name: wdw.experience(HM).name },
    });
    fireEvent.change(others()[1]!, { target: { value: '' } });
    expect(
      screen.getByText(
        `Replace ${wdw.experience(BZ).name} with ${wdw.experience(HM).name} at`,
        { exact: false }
      )
    ).toBeVisible();
  });
});
