import { use, useCallback, useLayoutEffect, useState } from 'react';

import { HourlyTimes, Offer } from '@/api/ll';
import { Overlap } from '@/api/ll/wdw';
import Button from '@/components/Button';
import LandLine from '@/components/LandLine';
import Screen from '@/components/Screen';
import { Time } from '@/components/Time';
import ClientsContext from '@/contexts/ClientsContext';
import NavContext from '@/contexts/NavContext';
import RebookingContext from '@/contexts/RebookingContext';
import ThemeContext from '@/contexts/ThemeContext';
import { DateTime, ParkTime, parkDate } from '@/datetime';
import useDataLoader from '@/hooks/useDataLoader';
import kvdb from '@/kvdb';

import BookingDate from '../BookingDate';
import RebookingHeader from '../RebookingHeader';
import ReturnTime from '../ReturnTime';
import YourDayButton from '../YourDayButton';
import Home from './Home';
import Legend from './Home/Legend';
import RefreshButton from './RefreshButton';
import TimeSearch from './TimeSearch';

export const FULL_AVAILABILITY_KEY = 'autoll3.ll.fullAvailability';

export default function SelectReturnTime<B extends Offer['booking']>({
  offer,
  onOfferChange,
}: {
  offer: Offer<B>;
  onOfferChange: (offer: Offer<B>) => void;
}) {
  const { goBack, goTo } = use(NavContext);
  const { ll } = use(ClientsContext);
  const rebooking = use(RebookingContext);
  const { loadData, loaderElem } = useDataLoader();
  const [times, setTimes] = useState<HourlyTimes>();
  const fullAvailabilityAllowed = allowsFullAvailability(offer);
  const [fullAvailability, setFullAvailability] = useState(
    fullAvailabilityAllowed && kvdb.get<boolean>(FULL_AVAILABILITY_KEY)
  );
  const { booking } = offer;
  const bookingTimeChange = booking && !rebooking.current;

  async function searchForBetter() {
    if (!booking) return;
    // Popped before the search is pushed, on purpose. `changeOfferTime`
    // replaces both the offer id and the offer-set id, so this screen left
    // mounted underneath would be holding ids the search had superseded --
    // and `NavProvider` keeps screens below the current position mounted.
    await goBack();
    goTo(<TimeSearch booking={booking} />);
  }

  const refreshTimes = useCallback(() => {
    loadData(async () => {
      setTimes(await ll.times(offer));
    });
  }, [offer, ll, loadData]);

  useLayoutEffect(refreshTimes, [refreshTimes]);

  const onButtonClick = async (time: ParkTime) => {
    if (time.equals(offer.start.time)) {
      await goBack();
      onOfferChange({ ...offer, changed: false });
    } else {
      await loadData(async () => {
        const newOffer = await ll.changeOfferTime(offer, time);
        await goBack();
        onOfferChange(newOffer);
      });
    }
  };

  const TimeButtons = fullAvailability
    ? FullAvailabilityButtons
    : AvailableOnlyButtons;

  return (
    <Screen
      title="Select Return Time"
      buttons={
        <>
          <YourDayButton date={parkDate(offer.start)} unmodifiable />
          <RefreshButton name="Times" onClick={refreshTimes} />
        </>
      }
      subhead={
        <>
          <RebookingHeader back={rebooking.auto ? { screen: Home } : true} />
          <BookingDate booking={offer} />
        </>
      }
      theme={offer.experience.park.theme}
    >
      <h2>{offer.experience.name}</h2>
      <LandLine land={offer.experience.land} />
      {booking && !rebooking.current && (
        <div className="mt-2 rounded-sm bg-gray-100 p-2 text-sm">
          <p>
            Nothing here yet? A search can keep checking every time on offer and
            take a better one the moment it appears.
          </p>
          <Button type="small" className="mt-2" onClick={searchForBetter}>
            Search for a better time
          </Button>
        </div>
      )}
      {offer && (
        <ReturnTime
          {...(bookingTimeChange ? booking : offer)}
          button={
            <Button type="small" onClick={goBack}>
              Keep
            </Button>
          }
        />
      )}
      {!times ? null : times.length > 0 ? (
        <>
          {fullAvailabilityAllowed && (
            <div className="flex items-center gap-x-4 mt-4">
              <h3 className="mt-0">Availabile Times</h3>
              <label className="flex items-center gap-x-2">
                <input
                  type="checkbox"
                  checked={!!fullAvailability}
                  onChange={() => {
                    const newFullAvailability = !fullAvailability;
                    setFullAvailability(newFullAvailability);
                    kvdb.set<boolean>(
                      FULL_AVAILABILITY_KEY,
                      newFullAvailability
                    );
                  }}
                />{' '}
                Show all
              </label>
            </div>
          )}

          <div
            className="overflow-auto mt-2 -mx-3 grid grid-cols-[min-content_1fr]"
            data-testid="time-buttons"
          >
            <TimeButtons offer={offer} times={times} onClick={onButtonClick} />
          </div>

          {fullAvailability && (
            <Legend title="Return Time Availability" flex="gap-x-4 py-1">
              <AvailabilityType code="A" />
              <AvailabilityType code="O" />
              <AvailabilityType code="U" />
            </Legend>
          )}

          <p className="mt-8 text-sm">
            The Lightning Lane system reports a limited subset of available
            return times. When &quot;show all&quot; is enabled, BG1 makes some
            educated guesses to give you more options. The closest available
            alternative will be offered if you select a return time that doesn't
            actually exist.
          </p>
        </>
      ) : (
        <p>No other times available</p>
      )}
      {loaderElem}
    </Screen>
  );
}

const AVAILABILITY_CODE_TO_NAME = {
  A: 'Available',
  U: 'Unavailable',
  O: 'Overlap',
};

/**
 * A = Available, U = Unavailable, O = Overlap
 */
type AvailabilityCode = 'A' | 'U' | 'O';

function AvailabilityType({ code }: { code: 'A' | 'U' | 'O' }) {
  return (
    <tr className="flex flex-col items-center gap-1">
      <td>
        <ExampleMinuteButton code={code} />
      </td>
      <th className="text-xs text-gray-500 font-semibold uppercase">
        {AVAILABILITY_CODE_TO_NAME[code]}
      </th>
    </tr>
  );
}

const allowsFullAvailability = (
  offer: Offer
): offer is Offer & Required<Pick<Offer, 'parkHours'>> =>
  offer.experience.type !== 'E' && !!offer.parkHours;

interface TimeButtonsProps {
  offer: Offer;
  times: HourlyTimes;
  onClick: (time: ParkTime) => Promise<void>;
}

function AvailableOnlyButtons({ times, onClick }: TimeButtonsProps) {
  return times.map(times => {
    const { hour } = times[0]!;
    return (
      <TimeButtonsRow hour={hour} key={hour}>
        {times.map(t => (
          <div key={t.toString()}>
            <Button onClick={() => onClick(t)}>
              <Time time={t} />
            </Button>
          </div>
        ))}
      </TimeButtonsRow>
    );
  });
}

function FullAvailabilityButtons({ offer, times, onClick }: TimeButtonsProps) {
  return (fullAvailabilityTimes(offer, times) ?? []).map(({ hour, times }) => {
    return (
      <TimeButtonsRow hour={hour} key={hour}>
        {[...times].map(([time, code]) => {
          return (
            <MinuteButton
              time={time}
              code={code}
              onClick={onClick}
              key={time.minute}
            />
          );
        })}
      </TimeButtonsRow>
    );
  });
}

function fullAvailabilityTimes(
  offer: Offer,
  times: HourlyTimes | undefined
): { hour: number; times: Map<ParkTime, AvailabilityCode> }[] {
  if (!times || times.length === 0 || !allowsFullAvailability(offer)) {
    return (times ?? []).map(times => ({
      hour: times[0]!.hour,
      times: new Map(times.map(t => [t, 'A'])),
    }));
  }
  const { booking } = offer;
  const offerTime = offer.start.time;
  const overlaps = offer.itinerary.map(b => b.overlap);
  let bookingOverlap: Overlap | undefined;
  if (booking) {
    bookingOverlap = new Overlap({
      startTime: booking.start.time,
      endTime: booking.end.time,
    });
    overlaps.push(bookingOverlap);
  }
  const timesByHour = new Map(times.map(times => [times[0]!.hour, [...times]]));
  const offerHourTimes = timesByHour.get(offerTime.hour);
  if (!offerHourTimes) {
    timesByHour.set(offerTime.hour, [offerTime]);
  } else if (
    offerHourTimes.every(t => Math.abs(t.minute - offerTime.minute) > 5)
  ) {
    offerHourTimes.push(offerTime);
    offerHourTimes.sort();
  }
  let firstTime = floor10Min(times[0]![0]!);
  if (offerTime < firstTime) firstTime = floor10Min(offerTime);
  const { openTime } = offer.parkHours;
  const now = DateTime.now().time;
  const firstHour =
    parkDate(offer.start) === parkDate() && +now > +openTime
      ? now.hour
      : openTime.hour;
  const closeTime = ParkTime.from(offer.parkHours.closeTime);
  const lastHour = (closeTime.hour + 23) % 24;
  const newTimes: { hour: number; times: Map<ParkTime, AvailabilityCode> }[] =
    [];
  let isFullHour = false;

  for (let h = firstHour; +new ParkTime(h) < +closeTime; h = (h + 1) % 24) {
    const hourStart = new ParkTime(h);
    const hourEnd = new ParkTime(h, 59);
    const hourOverlaps = overlaps.filter(
      o => o.contains(hourStart) || o.contains(hourEnd)
    );
    const hasAcceptableOverlap = (t: ParkTime) =>
      hourOverlaps.every(o => !o.contains(t) || o === bookingOverlap);
    const availableTimes = timesByHour.get(h) ?? [];
    const availableMinutes = new Set(
      (timesByHour.get(h) ?? []).flatMap(t => {
        t = floor10Min(t);
        if (hasAcceptableOverlap(t)) return t.minute;
        t = t.add({ minutes: 10 });
        return t.hour === h ? t.minute : [];
      })
    );
    isFullHour =
      availableTimes.length > 2 ||
      (h === lastHour && closeTime.minute === 0 && availableTimes.length > 1) ||
      (isFullHour && hourOverlaps.length > 0);

    const hourTimes = new Map(
      [0, 10, 20, 30, 40, 50]
        .map(m => new ParkTime(h, m))
        .map((t): [ParkTime, AvailabilityCode] => [
          t,
          !hasAcceptableOverlap(t)
            ? 'O'
            : isFullHour || availableMinutes.has(t.minute)
              ? 'A'
              : 'U',
        ])
    );

    if (!isFullHour && hourOverlaps.length > 0) {
      type TimesByCode = Record<AvailabilityCode, ParkTime[]>;
      const timesByCode: TimesByCode = { A: [], O: [], U: [] };
      for (const [time, code] of hourTimes) timesByCode[code].push(time);
      if (timesByCode.A.length * 2 >= timesByCode.U.length) {
        for (const t of timesByCode.U) hourTimes.set(t, 'A');
      }
    }

    if (h === firstTime.hour) {
      for (const [time, code] of hourTimes) {
        if (time >= firstTime) break;
        if (code === 'A') hourTimes.set(time, 'U');
      }
    } else if (h === lastHour) {
      const lastTime = closeTime.add({ minutes: -30 });
      for (const [time] of hourTimes) {
        if (time > lastTime) hourTimes.set(time, 'U');
      }
    }

    newTimes.push({ hour: h, times: hourTimes });
  }

  return newTimes;
}

const floor10Min = (time: ParkTime) => time.add({ minutes: -time.minute % 10 });

function TimeButtonsRow({
  hour,
  children,
}: {
  hour: number;
  children: React.ReactNode;
}) {
  const rowCls = `flex py-1.5 ${hour % 2 ? '' : ''}`;
  return (
    <>
      <h4 className={`items-center justify-end pl-3 font-bold ${rowCls}`}>
        <Time time={`${hour}`} />
      </h4>
      <div className={`gap-1.5 pl-3 ${rowCls}`}>{children}</div>
    </>
  );
}

interface MinuteButtonProps {
  time: ParkTime;
  code: AvailabilityCode;
  onClick: (time: ParkTime) => Promise<void>;
}

function MinuteButton({ time, code, onClick }: MinuteButtonProps) {
  const theme = use(ThemeContext);
  const classes = {
    A: { div: `${theme.bg} text-white`, button: '' },
    U: { div: 'bg-gray-200 text-gray-700', button: '' },
    O: { div: theme.bg, button: 'bg-white/75 text-black' },
  }[code];
  const timeStr = `${time}`;
  return (
    <div className={`rounded-lg font-semibold overflow-hidden ${classes.div}`}>
      <button
        className={`px-1.75 py-0.75 border border-black/20 rounded-lg ${classes.button}`}
        onClick={() => onClick(ParkTime.from(time))}
        aria-label={`${AVAILABILITY_CODE_TO_NAME[code]}: ${time}`}
      >
        <time dateTime={timeStr}>{timeStr.slice(2, 5)}</time>
      </button>
    </div>
  );
}

function ExampleMinuteButton(
  props: Omit<MinuteButtonProps, 'time' | 'onClick'>
) {
  return (
    <MinuteButton time={new ParkTime(0)} onClick={async () => {}} {...props} />
  );
}
