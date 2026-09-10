import {
  booking,
  createBooking,
  hm,
  jc,
  liveData,
  ll,
  mk,
  renderResort,
  sm,
  wdw,
} from '@/__fixtures__/ll';
import { Experience, FlexExperience } from '@/api/ll';
import BookingDateContext from '@/contexts/BookingDateContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import { ParkTime, formatTime } from '@/datetime';
import kvdb from '@/kvdb';
import ExperiencesProvider from '@/providers/ExperiencesProvider';
import NavProvider from '@/providers/NavProvider';
import {
  TODAY,
  TOMORROW,
  click,
  loading,
  screen,
  see,
  setTime,
  within,
} from '@/testing';

import MultiPassList, { STARRED_KEY } from './MultiPassList';

const BOOKED_INFO = 'Booked (more info)';
const LIGHTNING_PICK_INFO = 'Lightning Pick (more info)';
const FUTURE_DROP_INFO = 'Future Drop (more info)';
const NEXT_DROP_INFO = 'Next Drop (more info)';

const getExperiences = (
  testId: 'experienced' | 'unexperienced' = 'unexperienced'
) => {
  const list = screen.queryByTestId(testId);
  if (list) {
    return within(list)
      .getAllByRole('heading')
      .map(h => h.textContent);
  }
  // With tier grouping, find all tier group lists
  if (testId === 'unexperienced') {
    const tierLists = document.querySelectorAll('[data-testid^="tier-"]');
    if (tierLists.length === 0) return null;
    return [...tierLists].flatMap(list =>
      within(list as HTMLElement)
        .getAllByRole('heading')
        .map(h => h.textContent)
    );
  }
  return null;
};

const names = (exps: { name: string }[]) => exps.map(({ name }) => name);

const bz: FlexExperience = {
  ...wdw.experience('80010114'),
  park: mk,
  standby: { available: false },
  flex: { available: false },
};

const db: FlexExperience = {
  ...wdw.experience('80010129'),
  park: mk,
  standby: { available: true, waitTime: 25 },
  flex: { available: true, nextAvailableTime: new ParkTime(11, 5) },
};

async function goBack() {
  history.back();
  await see.screen('LL');
}

const inExp = (exp: Experience) => within(see(exp.name).closest('li')!);

function renderList(plans = [booking]) {
  return renderResort(
    <BookingDateContext
      value={{ bookingDate: TODAY, setBookingDate: () => {} }}
    >
      <ParkContext value={{ park: mk, setPark: () => {} }}>
        <PlansContext
          value={{
            plans,
            plansLoaded: true,
            refreshPlans: () => {},
            pollPlans: async () => [],
            loaderElem: null,
          }}
        >
          <ExperiencesProvider>
            <NavProvider>
              <MultiPassList ref={{ current: null }} />
            </NavProvider>
          </ExperiencesProvider>
        </PlansContext>
      </ParkContext>
    </BookingDateContext>
  );
}

describe('MultiPassList', () => {
  ll.experiences.mockResolvedValue([
    { ...hm },
    { ...db, experienced: true },
    { ...bz, experienced: true },
    { ...jc, experienced: true },
    sm,
  ]);
  jest.spyOn(liveData, 'shows').mockResolvedValue({});

  it('shows LL availability', async () => {
    setTime('09:00');
    kvdb.set(STARRED_KEY, [bz.id]);
    renderList();
    await loading();
    expect(ll.experiences).toHaveBeenCalledTimes(1);
    see.no(LIGHTNING_PICK_INFO);
    inExp(sm).getByTitle(NEXT_DROP_INFO);
    inExp(hm).getByTitle(BOOKED_INFO);
    inExp(hm).getByTitle(FUTURE_DROP_INFO);

    setTime('10:00');
    click('Refresh Experiences');
    await loading();
    expect(ll.experiences).toHaveBeenCalledTimes(2);

    see.no(NEXT_DROP_INFO);
    inExp(sm).getByTitle(LIGHTNING_PICK_INFO);
    inExp(hm).getByTitle(FUTURE_DROP_INFO);

    click(BOOKED_INFO);
    await see.screen('Booked');
    await goBack();

    click(LIGHTNING_PICK_INFO);
    await see.screen('Lightning Pick');
    await goBack();

    click(FUTURE_DROP_INFO);
    await see.screen('Upcoming Drop');
    see.time(mk.dropTimes[0]);
    expect(screen.getAllByTime(mk.dropTimes[1])).toHaveLength(3);
    see.time(mk.dropTimes[2]);
    see(hm.name, 'heading');
    see(sm.name, 'heading');
    await goBack();

    // Tier grouping: Tier 1 rides first, then Other (no tier)
    expect(getExperiences()).toEqual(names([sm, bz, hm]));
    expect(getExperiences('experienced')).toEqual(names([db, jc]));

    click('Remove from Favorites');
    expect(getExperiences()).toEqual(names([sm, hm]));

    click(screen.getAllByTitle('Add to Favorites')[4]!);
    expect(getExperiences()).toEqual(names([jc, sm, hm]));

    click(formatTime(sm.flex.nextAvailableTime));
    await see.screen('Lightning Lane');
    await loading();
    see(sm.name);
  });

  it('uses park day when marking an after-midnight reservation as booked', async () => {
    setTime('23:00');
    ll.experiences.mockResolvedValueOnce([hm]);
    renderList([
      createBooking(hm, { date: TOMORROW, startTime: new ParkTime(2) }),
    ]);
    await loading();

    inExp(hm).getByTitle(BOOKED_INFO);
    inExp(hm).getByTime('02:00:00');
  });

  it('honours the selected sort within a tier group', async () => {
    setTime('09:00');
    kvdb.set(STARRED_KEY, []);
    ll.experiences.mockResolvedValueOnce([sm, db, hm]);
    renderList([]);
    await loading();

    click('Sort By');
    click('Standby');
    expect(getExperiences()).toEqual(names([sm, hm, db]));
  });
});
