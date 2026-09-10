import { memo, use, useEffect, useRef, useState } from 'react';

import { isLLMP } from '@/api/itinerary';
import { Experience, FlexExperience } from '@/api/ll';
import { Park } from '@/api/resort';
import Screen from '@/components/Screen';
import Tab from '@/components/Tab';
import { Time } from '@/components/Time';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import NavContext from '@/contexts/NavContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import ResortContext from '@/contexts/ResortContext';
import ThemeContext from '@/contexts/ThemeContext';
import { DateTime, parkDate, upcomingTimes } from '@/datetime';
import useSavedParty from '@/hooks/useSavedParty';
import CheckmarkIcon from '@/icons/CheckmarkIcon';
import DropIcon from '@/icons/DropIcon';
import { IconProps } from '@/icons/Icon';
import LightningIcon from '@/icons/LightningIcon';
import StarIcon from '@/icons/StarIcon';
import kvdb from '@/kvdb';

import RebookingHeader from '../../RebookingHeader';
import { HomeTabProps } from '../Home';
import RefreshButton from '../RefreshButton';
import AutopilotButton from './AutopilotButton';
import BookingDateSelect from './BookingDateSelect';
import LLButton from './LLButton';
import LLTime from './LLTime';
import LabeledItem from './LabeledItem';
import Legend, { Symbol } from './Legend';
import ParkSelect from './ParkSelect';
import StandbyTime from './StandbyTime';
import TimeBanner from './TimeBanner';
import useSort, { Sorter } from './useSort';

const LP_MIN_STANDBY = 30;
const LP_MAX_LL_WAIT = 60;
export const STARRED_KEY = 'autoll3.genie.tipBoard.starred';
const LIGHTNING_PICK = 'Lightning Pick';
const BOOKED = 'Booked';

export interface ExtFlexExp extends FlexExperience {
  booked: boolean;
  lp: boolean;
  starred: boolean;
}

const isExperienced = (exp: ExtFlexExp) => exp.experienced && !exp.starred;

export default function MultiPassList({ ref }: HomeTabProps) {
  useSavedParty();
  const { ll } = use(ClientsContext);
  const { park } = use(ParkContext);
  const { experiences, refreshExperiences, loaderElem } =
    use(ExperiencesContext);
  const { bookingDate } = use(BookingDateContext);
  const { sortType, sorter, SortSelect } = useSort();
  const firstUpdate = useRef(true);

  useEffect(() => {
    if (!firstUpdate.current) ref.current?.scroll(0, 0);
  }, [sortType, ref]);

  useEffect(() => {
    firstUpdate.current = false;
  }, []);

  const today = parkDate();
  const dropTime = upcomingTimes(park.dropTimes)[0];

  return (
    <Tab
      title={<abbr title="Lightning Lane">LL</abbr>}
      buttons={
        <>
          {ll.rules.prebook && <BookingDateSelect />}
          <SortSelect />
          <ParkSelect />
          <AutopilotButton />
          <RefreshButton name="Experiences" onClick={refreshExperiences} />
        </>
      }
      subhead={
        <>
          <RebookingHeader />
          {bookingDate === today && (
            <TimeBanner bookTime={ll.nextBookTime} dropTime={dropTime} />
          )}
        </>
      }
      ref={ref}
    >
      <Experiences experiences={experiences} park={park} sorter={sorter} />
      {loaderElem}
    </Tab>
  );
}

const Experiences = memo(function Experiences({
  experiences,
  park,
  sorter,
}: {
  experiences: Experience[];
  park: Park;
  sorter: Sorter;
}) {
  const { ll } = use(ClientsContext);
  const { goTo } = use(NavContext);
  const theme = use(ThemeContext);
  const resort = use(ResortContext);
  const { plans } = use(PlansContext);
  const { bookingDate } = use(BookingDateContext);
  const [starred, setStarred] = useState<Set<string>>(() => {
    const ids = kvdb.get<string[]>(STARRED_KEY) ?? [];
    return new Set(Array.isArray(ids) ? ids : []);
  });
  const today = parkDate();
  const isBookingToday = bookingDate === today;
  const dropTime = isBookingToday
    ? upcomingTimes(park.dropTimes)[0]
    : park.dropTimes[0];
  const now = +DateTime.now().time;

  useEffect(() => {
    kvdb.set<string[]>(STARRED_KEY, [...starred]);
  }, [starred]);

  function toggleStar({ id }: { id: string }) {
    setStarred(starred => {
      starred = new Set(starred);
      if (starred.has(id)) {
        starred.delete(id);
      } else {
        starred.add(id);
      }
      return starred;
    });
  }

  const showLightningPickDesc = () => goTo(<LightningPickDesc />);
  const showDropTimeDesc = (exp?: Experience) =>
    goTo(
      <DropTimeDesc
        park={park}
        experience={exp}
        isBookingToday={isBookingToday}
      />
    );
  const showBookedDesc = () => goTo(<BookedDesc />);

  const LLButtonOrTime = ll.rules.book ? LLButton : LLTime;

  const ExperienceList = ({
    experiences,
    type,
  }: {
    experiences: ExtFlexExp[];
    type: string;
  }) => (
    <ul className="dividers" data-testid={type}>
      {experiences.map(exp => {
        const nextDropTime = isBookingToday
          ? upcomingTimes(exp.dropTimes ?? [])[0]
          : exp.dropTimes?.[0];
        const bookedTime = bookedTimes.get(exp.id);
        const { nextAvailableTime } = exp.flex ?? {};
        const tierLatest =
          exp.tier !== undefined ? latestBookedByTier.get(exp.tier) : undefined;
        const earlierThanBooked =
          isBookingToday &&
          !exp.booked &&
          nextAvailableTime &&
          tierLatest !== undefined &&
          +nextAvailableTime < tierLatest;
        return (
          <li
            key={exp.id + (exp.starred ? '*' : '')}
            className={
              earlierThanBooked ? 'border-l-3 border-green-500 pl-1' : ''
            }
          >
            <div className="flex items-center gap-x-2">
              <StarButton experience={exp} toggleStar={toggleStar} />
              <h3 className="flex-1 mt-0 text-lg font-semibold leading-tight truncate">
                {exp.name}
              </h3>
              {exp.tier !== undefined && (
                <span className="text-xs font-semibold text-gray-400">
                  T{exp.tier}
                </span>
              )}
              {exp.lp ? (
                <InfoButton
                  name={LIGHTNING_PICK}
                  icon={LightningIcon}
                  onClick={showLightningPickDesc}
                />
              ) : nextDropTime ? (
                nextDropTime.equals(dropTime) ? (
                  <InfoButton
                    name="Next Drop"
                    icon={DropIcon}
                    onClick={() => showDropTimeDesc(exp)}
                  />
                ) : (
                  <InfoButton
                    name="Future Drop"
                    icon={DropIcon}
                    onClick={() => showDropTimeDesc(exp)}
                    className="opacity-50"
                  />
                )
              ) : null}
              {exp.booked && (
                <InfoButton
                  name={BOOKED}
                  icon={CheckmarkIcon}
                  onClick={showBookedDesc}
                />
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <StandbyTime experience={exp} average={!isBookingToday} />
              <LabeledItem label="LL">
                <LLButtonOrTime experience={exp} />
              </LabeledItem>
              {bookedTime && (
                <LabeledItem label="Booked">
                  <span className="text-xs font-semibold text-green-700">
                    <Time time={bookedTime} />
                  </span>
                </LabeledItem>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const todayBookings = plans
    .filter(isLLMP)
    .filter(b => parkDate(b.start) === bookingDate);
  const bookedIds = new Set(todayBookings.map(b => b.experience.id));
  // Map experience ID to its booking start time
  const bookedTimes = new Map(
    todayBookings.map(b => [b.experience.id, b.start.time])
  );
  // Find the latest booked start time per tier
  const latestBookedByTier = new Map<number, number>();
  for (const b of todayBookings) {
    const tier = b.experience.tier;
    if (tier !== undefined) {
      const existing = latestBookedByTier.get(tier) ?? 0;
      latestBookedByTier.set(tier, Math.max(existing, +b.start.time));
    }
  }
  const flexExps: ExtFlexExp[] = experiences
    .filter((exp): exp is FlexExperience => !!exp.flex)
    .map(exp => {
      const standby = exp.standby.waitTime || 0;
      const { nextAvailableTime } = exp.flex ?? {};
      const priorityLevel = Math.trunc(exp.priority || 4);
      return {
        ...exp,
        booked: bookedIds.has(exp.id),
        lp:
          isBookingToday &&
          !!nextAvailableTime &&
          standby >= LP_MIN_STANDBY &&
          priorityLevel < 3 &&
          +nextAvailableTime - now <=
            Math.min(LP_MAX_LL_WAIT, ((4 - priorityLevel) / 3) * standby) * 60,
        starred: starred.has(exp.id),
      };
    })
    .sort(
      (a, b) => +!a.starred - +!b.starred || +!a.lp - +!b.lp || sorter(a, b)
    );
  const unexperienced = flexExps.filter(exp => !isExperienced(exp));
  const experienced = flexExps
    .filter(isExperienced)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Group unexperienced rides by tier, sorted by earliest available within each
  const hasTiers = unexperienced.some(exp => exp.tier !== undefined);
  const tierGroups = hasTiers
    ? (() => {
        const groups = new Map<number | undefined, ExtFlexExp[]>();
        for (const exp of unexperienced) {
          const tier = exp.tier;
          if (!groups.has(tier)) groups.set(tier, []);
          groups.get(tier)!.push(exp);
        }
        // `flexExps` already carries the selected sort (after Favorites and
        // Lightning Picks). Preserve that order while splitting it by tier;
        // re-sorting here used to make every Sort By choice act like Soonest.
        // Sort groups by tier number (numbered tiers first, then undefined)
        return new Map(
          [...groups].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
        );
      })()
    : null;

  return (
    <>
      {tierGroups ? (
        [...tierGroups].map(([tier, exps]) => (
          <div key={tier ?? 'none'}>
            <div
              className={`-mx-3 px-3 py-1 text-sm uppercase text-center font-semibold ${theme.bg} text-white`}
            >
              {tier !== undefined ? `Tier ${tier}` : 'Other'}
            </div>
            <ExperienceList
              experiences={exps}
              type={`tier-${tier ?? 'none'}`}
            />
          </div>
        ))
      ) : (
        <ExperienceList experiences={unexperienced} type="unexperienced" />
      )}
      {experienced.length > 0 && (
        <>
          <h2
            className={`-mx-3 px-3 py-1 text-sm uppercase text-center ${theme.bg} text-white`}
          >
            Experienced or Expired
          </h2>
          <ExperienceList experiences={experienced} type="experienced" />
        </>
      )}
      {flexExps.length > 0 && (
        <>
          <Legend title="Symbols">
            <Symbol
              sym={<LightningIcon themed />}
              def={LIGHTNING_PICK}
              onInfo={showLightningPickDesc}
            />
            {park.dropTimes.length > 0 && (
              <Symbol
                sym={
                  <div className="flex gap-x-1">
                    <DropIcon themed /> /{' '}
                    <DropIcon themed className="opacity-50" />
                  </div>
                }
                def="Next/Future Drop"
                onInfo={showDropTimeDesc}
              />
            )}
            <Symbol
              sym={<CheckmarkIcon themed />}
              def={BOOKED}
              onInfo={showBookedDesc}
            />
          </Legend>
          {!isBookingToday && (
            <p className="text-sm">
              Standby times for future dates are monthly averages (source:{' '}
              <a
                href={`https://www.thrill-data.com/waits/park/${resort.id.toLowerCase()}/${park.name.toLowerCase().replaceAll(' ', '-')}/`}
                target="_blank"
                rel="noreferrer"
                className="whitespace-nowrap"
              >
                Thrill Data
              </a>
              ) meant to assist you in selecting your initial{' '}
              <abbr title="Lightning Lanes">LLs</abbr>. They are not wait time
              estimates for this particular day.
            </p>
          )}
        </>
      )}
    </>
  );
});

function InfoButton({
  name,
  icon: Icon,
  onClick,
  className,
}: {
  name: string;
  icon: React.FunctionComponent<IconProps>;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      title={`${name} (more info)`}
      className={`-mx-2 px-2 ${className ?? ''}`}
      onClick={onClick}
    >
      <Icon themed />
    </button>
  );
}

function StarButton({
  experience,
  toggleStar,
}: {
  experience: ExtFlexExp;
  toggleStar: (exp: ExtFlexExp) => void;
}) {
  return (
    <button
      title={`${experience.starred ? 'Remove from' : 'Add to'} Favorites`}
      className="-m-2 p-2 text-gray-300"
      onClick={() => toggleStar(experience)}
    >
      <StarIcon themed={experience.starred} />
    </button>
  );
}

function LightningPickDesc() {
  return (
    <Screen title={LIGHTNING_PICK}>
      <p>
        When an attraction with a long standby wait has a Lightning Lane return
        time in the near future, it's highlighted as a Lightning Pick. Book
        these quick before they're gone!
      </p>
    </Screen>
  );
}

function DropTimeDesc({
  park,
  experience,
  isBookingToday,
}: {
  park: Park;
  experience?: Experience;
  isBookingToday?: boolean;
}) {
  const resort = use(ResortContext);
  const dropTime = upcomingTimes(experience?.dropTimes ?? [])[0];
  const parks = resort.parks
    .filter(p => p.dropTimes.length > 0)
    .sort((a, b) => (a === park ? -1 : b === park ? 1 : 0));
  return (
    <Screen title="Upcoming Drop">
      <p>
        {experience ? <b>{experience.name}</b> : <>This attraction</>} may be
        part of{' '}
        {!isBookingToday ? (
          <>a day-of</>
        ) : dropTime ? (
          <>
            the <Time time={dropTime} className="font-semibold" />
          </>
        ) : (
          <>an upcoming</>
        )}{' '}
        drop of additional Lightning Lane inventory, with earlier return times
        than what's currently being offered. Availability varies but is always
        limited, so be sure you're ready to book when the drop time arrives!
      </p>
      {parks.map(park => {
        const [nextDropTime] = upcomingTimes(park.dropTimes);
        return (
          <div
            className={`mt-5 rounded-sm overflow-hidden ${park.theme.bg}`}
            key={park.id}
          >
            <h2
              className={`mt-0 py-1 ${park.theme.bg} text-white text-base text-center`}
            >
              {park.name}
            </h2>
            <div className="flex flex-col px-2 pb-3 bg-white/90">
              {resort.dropExperiences(park).map(exp => {
                const upcoming = new Set(upcomingTimes(exp.dropTimes ?? []));
                return (
                  <div key={exp.id}>
                    <h3 className="mt-3">{exp.name}</h3>
                    <ul className="flex flex-wrap gap-y-2 mt-1 leading-tight">
                      {exp.dropTimes?.map(time => {
                        const isNextDrop =
                          isBookingToday && time.equals(nextDropTime);
                        return (
                          <li className="min-w-[6em] text-center" key={+time}>
                            <div
                              className={`${isNextDrop ? `${park.theme.text} font-bold` : upcoming.has(time) || !isBookingToday ? 'font-semibold' : 'text-gray-500'}`}
                            >
                              <Time time={time} />
                            </div>
                            {isNextDrop ? (
                              <div
                                className={`rounded-xs ${park.theme.bg} text-white/90 text-xs font-semibold text-center uppercase`}
                              >
                                next
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </Screen>
  );
}

function BookedDesc() {
  return (
    <Screen title={BOOKED}>
      <p>
        You currently have a Lightning Lane reservation for this attraction.
      </p>
    </Screen>
  );
}
