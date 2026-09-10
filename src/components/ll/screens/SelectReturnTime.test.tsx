import {
  createBooking,
  hm,
  ll,
  offer,
  renderResort,
  wdw,
} from '@/__fixtures__/ll';
import { Offer } from '@/api/ll';
import { Overlap } from '@/api/ll/wdw';
import RebookingContext from '@/contexts/RebookingContext';
import { DateTime, ParkTime, formatTime } from '@/datetime';
import {
  TODAY,
  TOMORROW,
  click,
  loading,
  nav,
  screen,
  see,
  setTime,
} from '@/testing';

import Home from './Home';
import SelectReturnTime from './SelectReturnTime';

const changeOfferTime = jest.spyOn(ll, 'changeOfferTime');
const onOfferChange = jest.fn();

type MinutesByHour = { [hour: string]: number[] };

function toHourlyTimes(times: MinutesByHour) {
  return Object.entries(times).map(([h, minutes]) =>
    minutes.map(m => new ParkTime(+h, m))
  );
}

function createOffer(
  date: string,
  time: ParkTime,
  options?: Partial<Omit<Offer, 'itinerary'>> & {
    itinerary?: Pick<Offer['itinerary'][0], 'startTime' | 'endTime'>[];
  }
): Offer {
  const { itinerary, ...offerParts } = options ?? {};
  const startTime = ParkTime.from(time);
  return {
    ...offer,
    ...offerParts,
    ...(itinerary
      ? {
          itinerary: itinerary.map(item => ({
            ...item,
            facilityId: hm.id,
            overlap: new Overlap(item),
          })),
        }
      : {}),
    id: `offer-${date}-${time}`,
    offerSetId: `offerset-${date}-${time}`,
    start: new DateTime(date, startTime),
    end: new DateTime(date, startTime.add({ hours: 1 })),
  };
}

const fullHour = [0, 10, 20, 30, 40, 50];

const clickShowAll = () => click('Show all');

async function renderComponent(
  offer: Offer,
  apiTimes: MinutesByHour,
  rebooking: boolean | 'auto' = false
) {
  jest.spyOn(ll, 'times').mockResolvedValueOnce(toHourlyTimes(apiTimes));
  const view = renderResort(
    <nav.Provider>
      <RebookingContext
        value={{
          begin: jest.fn(),
          end: jest.fn(),
          current: rebooking ? offer.booking : undefined,
          auto: rebooking === 'auto',
        }}
      >
        <SelectReturnTime offer={offer} onOfferChange={onOfferChange} />
      </RebookingContext>
    </nav.Provider>
  );
  await loading();
  const { start, end } = rebooking ? offer : (offer.booking ?? offer);
  expect(view.container).toHaveTextContent(
    `Arrive by: ${formatTime(start.time ?? '')} – ${formatTime(end.time ?? '')}`
  );
  return view;
}

function expectTimes({
  available,
  firstHour,
  lastHour = 21,
}: {
  available: MinutesByHour;
  firstHour?: number;
  lastHour?: number;
}) {
  const expectedAvailable = Object.keys(available).flatMap(h =>
    available[h]!.map(m => new ParkTime(+h, m).toString())
  );
  const expectedTimes =
    firstHour === undefined
      ? expectedAvailable
      : [...Array(lastHour - firstHour).keys()].flatMap(h =>
          [...Array(6).keys()].map(m =>
            new ParkTime(firstHour + h, m * 10).toString()
          )
        );
  const actualAvailable: string[] = [];
  const actualTimes: string[] = [
    ...screen.getByTestId('time-buttons').querySelectorAll('button'),
  ].map(btn => {
    const time = (btn.firstElementChild as HTMLTimeElement)?.dateTime;
    const label = btn.getAttribute('aria-label');
    if (!label || label.startsWith('Available')) actualAvailable.push(time);
    return time;
  });
  expect(actualTimes).toEqual(expectedTimes);
  expect(actualAvailable).toEqual(expectedAvailable);
}

describe('SelectReturnTime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setTime(new ParkTime(10, 15));
    localStorage.clear();
  });

  it('shows current day availability', async () => {
    await renderComponent(
      createOffer(TODAY, new ParkTime(12, 30), {
        itinerary: [
          {
            startTime: new ParkTime(12, 10),
            endTime: new ParkTime(13, 10),
          },
        ],
      }),
      {
        10: [45],
        11: [0, 10, 25],
        13: [15, 35, 50],
        14: [5, 25, 45],
      }
    );
    clickShowAll();
    expectTimes({
      firstHour: 10,
      available: {
        10: [40],
        11: [0, 10, 20, 30],
        12: [50],
        13: fullHour,
        14: fullHour,
      },
    });
    const newOffer = createOffer(TODAY, new ParkTime(13, 20));
    changeOfferTime.mockResolvedValueOnce(newOffer);
    click(see.time(newOffer.start.time));
    await loading();
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    expect(onOfferChange).toHaveBeenCalledWith(newOffer);

    click('Keep');
    expect(nav.goBack).toHaveBeenCalledTimes(2);
  });

  it('shows future day availability', async () => {
    await renderComponent(createOffer(TOMORROW, new ParkTime(12, 30)), {
      10: [50],
      11: [20, 40],
      12: [20, 40, 55],
      13: [35],
      20: [0, 15],
    });
    clickShowAll();
    expectTimes({
      firstHour: 9,
      available: {
        10: [50],
        11: [20, 40],
        12: fullHour,
        13: [30],
        20: [0, 10, 20, 30],
      },
    });
  });

  it('shows return times through an after-midnight park close', async () => {
    await renderComponent(
      createOffer(TOMORROW, new ParkTime(23, 30), {
        parkHours: {
          openTime: new ParkTime(21),
          closeTime: new ParkTime(1),
        },
      }),
      { 23: [30], 0: [20] }
    );
    clickShowAll();

    const buttons = [
      ...screen.getByTestId('time-buttons').querySelectorAll('button'),
    ];
    expect(buttons).toHaveLength(24);
    expect((buttons[0]!.firstElementChild as HTMLTimeElement).dateTime).toBe(
      '21:00:00'
    );
    expect(
      (buttons.at(-1)!.firstElementChild as HTMLTimeElement).dateTime
    ).toBe('00:50:00');
  });

  it('only shows actual show times for shows', async () => {
    const batb = wdw.experience('80010848');
    const available = {
      11: [0, 45],
      12: [30],
      13: [15],
    };
    await renderComponent(
      createOffer(TODAY, new ParkTime(10, 15), { experience: batb }),
      available
    );
    see.no('Show full availability');
    expectTimes({ available });

    const newOffer = createOffer(TODAY, new ParkTime(12, 30), {
      experience: batb,
    });
    changeOfferTime.mockResolvedValueOnce(newOffer);
    click(see.time(newOffer.start.time));
    await loading();
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    expect(onOfferChange).toHaveBeenCalledWith(newOffer);
  });

  it('shows probable available times when modifying existing LL', async () => {
    const booking = createBooking(hm, { startTime: new ParkTime(12, 45) });
    await renderComponent(
      createOffer(TODAY, new ParkTime(10, 30), { booking }),
      {
        10: [50],
        11: [10, 30, 50],
        13: [25, 45],
      }
    );
    clickShowAll();
    expectTimes({
      firstHour: 10,
      available: {
        10: [30, 50],
        11: fullHour,
        12: fullHour,
        13: fullHour,
      },
    });
  });

  it("doesn't call changeOfferTime when selecting current offer time", async () => {
    const offer = createOffer(TODAY, new ParkTime(12, 10));
    await renderComponent(offer, { 12: [20, 35, 55] });
    clickShowAll();
    expectTimes({ firstHour: 10, available: { 12: fullHour.slice(1) } });
    click(see.times('12:10:00')[1]!);
    expect(changeOfferTime).not.toHaveBeenCalled();
    expect(onOfferChange).not.toHaveBeenCalled();
    expect(nav.goBack).toHaveBeenCalled();
  });

  it('adjusts available times to not fall within overlap', async () => {
    const itinerary = [
      { startTime: new ParkTime(11, 5), endTime: new ParkTime(12, 5) },
      { startTime: new ParkTime(12, 35), endTime: new ParkTime(13, 35) },
    ];
    const offer = createOffer(TODAY, new ParkTime(10, 30), { itinerary });
    await renderComponent(offer, { 11: [45], 12: [55] });
    clickShowAll();
    expectTimes({ firstHour: 10, available: { 11: [50] } });
  });

  it('goes back to Home screen when auto-rebooking canceled', async () => {
    const booking = createBooking(hm, { startTime: new ParkTime(12) });
    await renderComponent(
      createOffer(TODAY, new ParkTime(10), { booking }),
      {},
      'auto'
    );
    click(see.all('Keep')[0]!);
    expect(nav.goBack).toHaveBeenCalledWith({ screen: Home });
  });
});
