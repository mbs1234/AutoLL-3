import {
  booking,
  das,
  hm,
  jc,
  mickey,
  minnie,
  mk,
  party,
  renderResort,
} from '@/__fixtures__/das';
import { ConflictsError } from '@/api/das';
import PlansContext from '@/contexts/PlansContext';
import {
  act,
  click,
  nav,
  screen,
  see,
  settled,
  waitFor,
  within,
} from '@/testing';

import BookingDetails from './BookingDetails';
import DasExperienceList from './DasExperienceList';
import DasSelection from './DasSelection';
import Home from './Home';

jest.mock('@/ping');
const refreshPlans = jest.fn();
jest.spyOn(das, 'book').mockResolvedValue(booking);

function renderComponent() {
  renderResort(
    <PlansContext
      value={{
        plans: [],
        refreshPlans,
        pollPlans: async () => [],
        loaderElem: null,
      }}
    >
      <nav.Provider>
        <DasSelection park={mk} party={party} />
      </nav.Provider>
    </PlansContext>
  );
}

describe('DasSelection', () => {
  it('shows DAS Selection screen', async () => {
    renderComponent();
    within(see('DAS Guest').nextElementSibling as HTMLElement).getByText(
      mickey.name
    );
    within(
      see('Additional Guests').nextElementSibling as HTMLElement
    ).getByText(minnie.name);
    const bookBtn = see('Request Return Time');
    expect(bookBtn).toBeDisabled();

    click('Select Experience');
    expect(nav.goTo).toHaveBeenLastCalledWith(
      <DasExperienceList park={mk} onSelect={expect.any(Function)} />
    );

    expect(screen.getByRole('checkbox')).toBeChecked();
    click(minnie.name);
    expect(screen.getByRole('checkbox')).not.toBeChecked();

    click(minnie.name);
    expect(screen.getByRole('checkbox')).toBeChecked();

    let onSelect = nav.goTo.mock.lastCall?.[0].props.onSelect;
    act(() => onSelect(hm));
    await waitFor(() => see(hm.name));
    expect(bookBtn).toBeEnabled();

    das.book.mockRejectedValueOnce(
      new ConflictsError({
        [minnie.id]: 'NOT_IN_PARK',
      })
    );
    click(bookBtn);
    expect(das.book).toHaveBeenLastCalledWith({
      experience: hm,
      primaryGuest: mickey,
      guests: [mickey, minnie],
    });
    await waitFor(() => see('NOT IN PARK'));

    click('Change');
    expect(nav.goTo).toHaveBeenCalledTimes(2);
    onSelect = nav.goTo.mock.lastCall?.[0].props.onSelect;
    act(() => onSelect(jc));
    await waitFor(() => see(jc.name));

    click(bookBtn);
    expect(das.book).toHaveBeenLastCalledWith({
      experience: jc,
      primaryGuest: mickey,
      guests: [mickey, minnie],
    });
    await waitFor(() => expect(refreshPlans).toHaveBeenCalled());
    expect(nav.goBack).toHaveBeenLastCalledWith({ screen: Home });
    expect(nav.goTo).toHaveBeenLastCalledWith(
      <BookingDetails booking={booking} isNew={true} />
    );
    // The booking's load is still in its minimum time. See `settled`.
    await settled();
  });
});
