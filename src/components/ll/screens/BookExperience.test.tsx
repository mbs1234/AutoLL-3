import { use } from 'react';

import {
  booking,
  createBooking,
  donald,
  guests,
  hm,
  itinerary,
  ll,
  mickey,
  minnie,
  mockOffer,
  offer,
  pluto,
  renderResort,
} from '@/__fixtures__/ll';
import { RequestError } from '@/api/client';
import { LLMP, Offer, OfferError } from '@/api/ll';
import Button from '@/components/Button';
import Screen from '@/components/Screen';
import NavContext from '@/contexts/NavContext';
import { DateTime, ParkTime, parkDate } from '@/datetime';
import { ping } from '@/ping';
import BookingDateProvider from '@/providers/BookingDateProvider';
import NavProvider from '@/providers/NavProvider';
import PlansProvider from '@/providers/PlansProvider';
import RebookingProvider from '@/providers/RebookingProvider';
import {
  TODAY,
  YESTERDAY,
  click,
  loading,
  screen,
  see,
  setTime,
} from '@/testing';

import RebookingHeader from '../RebookingHeader';
import BookExperience from './BookExperience';

jest.mock('@/ping');
jest.mock('@/timesync');
setTime('09:00');
const errorMock = jest.spyOn(console, 'error');

const mockClickResponse = async (
  clientMethod: jest.MockedFunction<any>,
  buttonText: string,
  status: number
) => {
  const error =
    status >= 0
      ? new RequestError({ ok: status === 200, status, data: {} })
      : new Error();
  errorMock.mockImplementationOnce(() => null);
  clientMethod.mockRejectedValueOnce(error);
  click(buttonText);
  await loading();
};

const mockBook = (status: number) =>
  mockClickResponse(ll.book, 'Book Lightning Lane', status);

function mockExperienceLimitReached() {
  ll.guests.mockResolvedValue({
    eligible: [],
    ineligible: [
      ...booking.guests.map(g => ({
        ...g,
        ineligibleReason: 'EXPERIENCE_LIMIT_REACHED' as const,
      })),
      donald,
    ],
  });
}

async function clickModify() {
  click('Modify');
  await see.screen('Modify Party');
}

async function clickConfirm() {
  click('Confirm Party');
  await see.screen('Lightning Lane');
}

function expectModifying(booking: LLMP) {
  const rbHeader = see('Modifying Reservation').closest('div') as HTMLElement;
  expect(rbHeader).toHaveTextContent(booking.name);
  booking.guests.forEach(g => see(g.name));
  expect(ll.offer).toHaveBeenCalledWith(hm, booking.guests, { booking });
}

async function goBack(screenTitle: string) {
  click('Go Back');
  await see.screen(screenTitle);
}

async function renderComponent({
  screen,
  rebook,
}: { screen?: React.JSX.Element; rebook?: LLMP } = {}) {
  renderResort(
    <PlansProvider>
      <BookingDateProvider>
        <RebookingProvider
          value={
            rebook
              ? {
                  current: rebook,
                  auto: false,
                  begin: jest.fn(),
                  end: jest.fn(),
                }
              : undefined
          }
        >
          <NavProvider>
            {screen ?? <BookExperience experience={hm} />}
          </NavProvider>
        </RebookingProvider>
      </BookingDateProvider>
    </PlansProvider>
  );
  if (!screen) await loading();
}

describe('BookExperience', () => {
  const { maxPartySize } = ll.rules;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOffer(offer);
    itinerary.plans.mockResolvedValue([booking]);
    ll.guests.mockResolvedValue(guests);
    ll.rules.maxPartySize = maxPartySize;
  });

  it('performs successful booking', async () => {
    await renderComponent();
    see.times(`${offer.start.time}`);
    see.times(`${offer.end.time}`);
    await clickModify();
    click(mickey.name, 'checkbox');
    await clickConfirm();
    see.no(mickey.name);
    see(minnie.name);
    click('Book Lightning Lane');
    await loading();
    see('Your Lightning Lane');
    see(hm.name);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(ll.guests).toHaveBeenCalledTimes(1);
    expect(ll.book).toHaveBeenCalledTimes(1);
    expect(ll.cancelBooking).toHaveBeenLastCalledWith(
      booking.guests.filter(g => g.id === mickey.id)
    );
  });

  it('requests a new offer when necessary', async () => {
    await renderComponent();
    click('Your Day');
    await see.screen('Your Day');
    await goBack('Lightning Lane');
    click('Your Day');
    await see.screen('Your Day');
    expect(ll.offer).toHaveBeenCalledTimes(1);
    click('More Info');
    await see.screen('Your Lightning Lane');
    mockOffer({ ...offer, id: 'offer2' });
    click('Change');
    await see.screen('Select Return Time');
    await goBack('Your Lightning Lane');
    await goBack('Your Day');
    expect(ll.offer).toHaveBeenCalledTimes(2);
    await goBack('Lightning Lane');
    await loading();
    expect(ll.offer).toHaveBeenCalledTimes(3);
  });

  it('removes offer-ineligible guests from selected party', async () => {
    mockOffer({
      ...offer,
      guests: {
        eligible: [minnie],
        ineligible: [mickey, pluto].map(g => ({
          ...g,
          ineligibleReason: 'TOO_EARLY_FOR_PARK_HOPPING',
        })),
      },
    });
    await renderComponent();
    see(minnie.name);
    see.no(mickey.name);
    await clickModify();
    screen.getByRole('checkbox', { checked: true });
    expect(see(mickey.name)).toHaveTextContent('TOO EARLY FOR PARK HOPPING');
    expect(see(pluto.name)).toHaveTextContent('TOO EARLY FOR PARK HOPPING');
  });

  const newOffer: Offer = {
    id: 'new_offer',
    start: new DateTime(TODAY, new ParkTime(10, 5)),
    end: new DateTime(TODAY, new ParkTime(11, 5)),
    changed: true,
    guests: {
      eligible: [mickey, minnie, pluto],
      ineligible: [],
    },
    experience: hm,
    booking: undefined,
    itinerary: [],
  };

  it('refreshes offer when Refresh button clicked', async () => {
    await renderComponent();
    see.times(`${offer.start.time}`);
    mockOffer(newOffer);
    click('Refresh Offer');
    await loading();
    see.times(`${newOffer.start.time}`);
    see.no('Return time has been changed');
  });

  it('refreshes offer when someone added to party', async () => {
    await renderComponent();
    see.times(`${offer.start.time}`);
    await clickModify();
    click(mickey.name, 'checkbox');
    await clickConfirm();
    expect(ll.offer).toHaveBeenCalledTimes(1);
    see.no(mickey.name);
    await clickModify();
    click(mickey.name, 'checkbox');
    mockOffer(newOffer);
    await clickConfirm();
    await loading();
    see(mickey.name);
    expect(ll.offer).toHaveBeenCalledTimes(2);
    see.times(`${newOffer.start.time}`);
  });

  it('shows "No Guests Found" when no guests loaded', async () => {
    ll.guests.mockResolvedValueOnce({ eligible: [], ineligible: [] });
    await renderComponent();
    see('No Guests Found');

    click('Refresh Party');
    await loading();
    see(mickey.name);
  });

  it('shows "No Eligible Guests" when no eligible guests loaded', async () => {
    ll.guests.mockResolvedValueOnce({
      eligible: [],
      ineligible: [donald],
    });
    await renderComponent();
    see('No Eligible Guests');
    expect(see(donald.name)).toHaveTextContent(
      donald.ineligibleReason.replace(/_/g, ' ')
    );
  });

  it('shows "No Reservations Available" on failed response', async () => {
    ll.offer.mockRejectedValueOnce(
      new RequestError({ ok: false, status: 410, data: {} })
    );
    await renderComponent();
    see('No Reservations Available');
  });

  it('shows "No Eligible Guests" on OfferError with no eligible guests', async () => {
    ll.offer.mockRejectedValueOnce(
      new OfferError({
        eligible: [],
        ineligible: booking.guests.map(g => ({
          ...g,
          ineligibleReason: 'EXPERIENCE_LIMIT_REACHED',
        })),
      })
    );
    await renderComponent();
    see('No Eligible Guests');
    expect(see.all('EXPERIENCE LIMIT REACHED')).toHaveLength(3);
  });

  it('shows "No Reservations Available" on OfferError with eligible guests', async () => {
    ll.offer.mockRejectedValueOnce(
      new OfferError({
        eligible: booking.guests.slice(0, 1),
        ineligible: booking.guests.slice(1).map(g => ({
          ...g,
          ineligibleReason: 'EXPERIENCE_LIMIT_REACHED',
        })),
      })
    );
    await renderComponent();
    see('No Reservations Available');
    see(mickey.name);
    see.no(minnie.name);
    see.no(pluto.name);
  });

  it('refreshes an expired offer and reports other booking failures', async () => {
    await renderComponent();
    await mockBook(410);
    expect(ll.offer).toHaveBeenCalledTimes(2);
    await mockBook(0);
    see('Network request failed (no response)');
    await mockBook(-1);
    see('Unknown error occurred');
  });

  it('limits offers to maxPartySize', async () => {
    ll.rules.maxPartySize = 2;
    mockOffer({
      ...offer,
      guests: {
        eligible: offer.guests.eligible.slice(0, 2),
        ineligible: [],
      },
    });
    await renderComponent();
    expect(ll.offer).toHaveBeenLastCalledWith(hm, [mickey, minnie], {
      date: parkDate(),
    });
    see('Party Size Restricted');

    await clickModify();
    click(pluto.name);
    see('Selection limit reached');
  });

  it('can modify an existing reservation', async () => {
    await renderComponent({ rebook: booking });
    expect(ll.guests).not.toHaveBeenCalled();
    expectModifying(booking);
  });

  it('can modify same experience even if rebooking not started', async () => {
    function StartScreen() {
      const { goTo } = use(NavContext);
      return (
        <Screen title="Start">
          <RebookingHeader />
          <Button onClick={() => goTo(<BookExperience experience={hm} />)}>
            Start Test
          </Button>
        </Screen>
      );
    }

    mockExperienceLimitReached();
    const otherDayBooking = createBooking(hm, { date: YESTERDAY });
    itinerary.plans.mockResolvedValue([otherDayBooking, booking]);
    await renderComponent({ screen: <StartScreen /> });
    click('Start Test');
    await see.screen('Lightning Lane');
    await loading();
    expectModifying(booking);
    click('Go Back');
    await see.screen('Start');
    see.no('Modifying Reservation');
  });

  it("doesn't auto-rebook if multiple LLs for same experience", async () => {
    mockExperienceLimitReached();
    const booking1 = createBooking(hm, { guests: [mickey, minnie] });
    const booking2 = createBooking(hm, { guests: [pluto] });
    itinerary.plans.mockResolvedValue([booking1, booking2]);
    await renderComponent();
    see.no('Modifying Reservation');
  });
});
