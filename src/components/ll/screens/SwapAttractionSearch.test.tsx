import { screen } from '@testing-library/react';

import { mk, wdw } from '@/__fixtures__/resort';
import { LLMP } from '@/api/itinerary';
import { DateTime, ParkTime } from '@/datetime';
import { TODAY } from '@/testing';

import SwapAttractionSearch from './SwapAttractionSearch';
import {
  BZ,
  DB,
  llExperience,
  nonLLExperience,
  renderScreen,
} from './screenTestSetup';

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
});
