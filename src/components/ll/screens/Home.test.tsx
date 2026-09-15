import { waitFor } from '@testing-library/react';

import {
  booking,
  das,
  hs,
  liveData,
  ll,
  mk,
  renderResort,
} from '@/__fixtures__/ll';
import kvdb from '@/kvdb';
import { click, loading, revisitTab, see, setTime } from '@/testing';

import Merlock from '../Merlock';
import Home, { HOME_TAB_KEY } from './Home';

jest.mock('@/ping');
jest.spyOn(das, 'parties').mockResolvedValue([]);
jest.spyOn(liveData, 'shows').mockResolvedValue({});

beforeEach(() => {
  kvdb.clear();
});

describe('Home', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setTime('10:00');
  });

  it('shows LL home screen', async () => {
    // Today is the default tab now; this flow is about the LL tab.
    kvdb.set(HOME_TAB_KEY, 'LL');
    renderResort(<Merlock />);
    await loading();

    revisitTab(60);
    await loading();

    click('Times');
    expect(kvdb.get(HOME_TAB_KEY)).toBe('Times');

    click(mk.name);
    click(hs.name, 'radio');
    await loading();
    see(hs.name);

    click('Plans');
    click(booking.name);
    jest.spyOn(Element.prototype, 'scroll');
    await see.screen('Your Lightning Lane');
    click('Modify');
    await see.screen('LL');
    expect(see(hs.name)).toBeEnabled();
    expect(Element.prototype.scroll).toHaveBeenCalledTimes(2);

    click('Plans');
    click(booking.name);
    await see.screen('Your Lightning Lane');
    click('Cancel');
    await see.screen('Cancel Guests');
    click('Select All');
    click('Cancel Reservation');
    await see.screen('Your Plans');
  });
});

/*
 * Returning to a backgrounded tab is what refreshes availability without a
 * deliberate tap, and it is the whole reason the phone can sit in a pocket
 * between drops. `useScreenState` used to capture the active *element* and
 * compare it by identity, while `withTabs` hands the nav stack a fresh element
 * on every tab change -- so from the first tab switch onward the screen
 * believed it was no longer active and the on-visible refresh never fired
 * again. Nothing on screen said the data was stale.
 */
describe('Home auto-refresh on return to tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setTime('10:00');
  });

  const fetches = () => jest.mocked(ll.experiences).mock.calls.length;

  it('still refreshes after the tab has been switched', async () => {
    kvdb.set(HOME_TAB_KEY, 'LL');
    renderResort(<Merlock />);
    await loading();

    // The baseline: it refreshes on return to the tab before any switch.
    const before = fetches();
    revisitTab(120);
    await waitFor(() => expect(fetches()).toBeGreaterThan(before));

    // The switch that used to break it, and back again.
    click('Times');
    click('LL');

    const beforeSecond = fetches();
    revisitTab(120);
    await waitFor(() => expect(fetches()).toBeGreaterThan(beforeSecond));
  });
});

describe('Home.currentTabName()', () => {
  it('returns default tab', () => {
    expect(Home.getSavedTabName()).toBe('Today');
    kvdb.set(HOME_TAB_KEY, 'Times');
    expect(Home.getSavedTabName()).toBe('Times');
  });
});
