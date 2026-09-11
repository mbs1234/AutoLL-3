import { use, useEffect, useState } from 'react';

import { LLMP, isLLMP } from '@/api/itinerary';
import { checklist } from '@/autopilot/checklist';
import { describeMode } from '@/autopilot/describe';
import { latestActivity } from '@/autopilot/events';
import { loadPendingSearch } from '@/autopilot/nextll';
import { NO_REFUSALS } from '@/autopilot/refusal';
import { WatchTarget } from '@/autopilot/watchlist';
import Button from '@/components/Button';
import Tab from '@/components/Tab';
import { Time } from '@/components/Time';
import AutopilotStatus from '@/components/ll/AutopilotStatus';
import ContextStrip from '@/components/ll/ContextStrip';
import LatestEvent from '@/components/ll/LatestEvent';
import TargetWindow from '@/components/ll/TargetWindow';
import AutopilotContext from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import NavContext from '@/contexts/NavContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import TabsContext from '@/contexts/TabContext';
import { parkDate, upcomingTimes } from '@/datetime';
import { PARTY_IDS_KEY } from '@/hooks/useSavedParty';
import kvdb from '@/kvdb';

import Activity from './Activity';
import Configure from './Configure';
import { HomeTabProps } from './Home';
import BookingDateSelect from './Home/BookingDateSelect';
import ParkSelect from './Home/ParkSelect';
import PartySelector from './PartySelector';
import PlanCheck from './PlanCheck';
import RefreshButton from './RefreshButton';
import Timeline from './Timeline';

export const TODAY = 'Today';

const acts = (t: WatchTarget) =>
  !!(t.autoBook || t.autoModify || t.bookThenMove || t.autoSwap);

/**
 * The park day at a glance, and the one switch that matters.
 *
 * Everything a person asks on a park day, in the order they ask it: is
 * Autopilot on, what did it just do, what is held, what is it after, when is
 * the next window. Setting the plan up is the Configure screen's job, and the
 * long lists are Activity's; this screen only ever reads what the providers
 * already hold, so opening it costs no request.
 *
 * The on/off switch lives here rather than in a header on purpose: enabling
 * is a deliberate step -- pick rides, grant notifications -- and a mis-tapped
 * header toggle that silently started or stopped polling would be worse than
 * one extra tap.
 */
export default function Today({ ref }: HomeTabProps) {
  const {
    enabled,
    setEnabled,
    status,
    targetsHere,
    notifications,
    requestNotifications,
    lastHit,
    lastSkip,
    bookingLog,
    bookingsRemaining,
    actionBudget,
    refillBudget,
    dryRun,
    refusals,
    passkeyStatus,
  } = use(AutopilotContext);
  const {
    experiences,
    refreshExperiences,
    unknownExperienceIds,
    lastUpdated: experiencesUpdated,
    loaderElem,
  } = use(ExperiencesContext);
  const { plans, refreshPlans, lastUpdated: plansUpdated } = use(PlansContext);
  const { park } = use(ParkContext);
  const { bookingDate } = use(BookingDateContext);
  const { ll } = use(ClientsContext);
  const { goTo } = use(NavContext);
  const { changeTab } = use(TabsContext);
  const [planChecked, setPlanChecked] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // The underlying data timestamps only change after successful requests. A
  // lightweight clock lets the wording remain truthful while this tab stays
  // open, without scheduling any additional network work.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const isToday = bookingDate === parkDate();
  const activity = latestActivity({ bookingLog, lastSkip, lastHit });
  // Every Multi Pass held on the date, wherever it is: the party holds at
  // most three at a time and on a hopping day they span parks, so hiding one
  // would hide a slot that is spent.
  const held = plans.filter(
    (booking): booking is LLMP =>
      isLLMP(booking) && parkDate(booking.start) === bookingDate
  );
  const nextDrop = isToday
    ? upcomingTimes(park.dropTimes)[0]
    : park.dropTimes[0];
  const nameOf = (target: WatchTarget) =>
    experiences.find(e => e.id === target.experienceId)?.name ??
    target.name ??
    target.experienceId;
  const plan = [...targetsHere].sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)
  );
  // Armed means it will act: a paused target keeps its arming but is counted
  // with the paused, not with the armed.
  const armed = targetsHere.filter(t => acts(t) && !t.paused).length;
  const paused = targetsHere.filter(t => t.paused).length;
  // A NextLL search stops when its tab is left; the tab offers to resume it,
  // but only once you are back there. This is the reminder to go back. Matched
  // on the day it was aimed at, so a search for another park day is not
  // advertised against this one.
  const pending = loadPendingSearch(bookingDate);
  const pendingName = pending
    ? (experiences.find(e => e.id === pending.experienceId)?.name ??
      pending.experienceId)
    : undefined;
  const unknown = unknownExperienceIds?.length ?? 0;
  const readiness = checklist({
    // Read-only: mounting useSavedParty here would call ll.setPartyIds while
    // this screen is merely being viewed.
    partySize: kvdb.get<string[]>(PARTY_IDS_KEY)?.length ?? 0,
    targets: targetsHere,
    notifications,
    planChecked,
  });
  // This line describes both data sets, so use the older successful fetch;
  // calling the pair fresh when only one has refreshed would be misleading.
  const updatedAt = [experiencesUpdated, plansUpdated].filter(
    (updated): updated is number => updated !== undefined
  );
  const lastUpdated = updatedAt.length > 0 ? Math.min(...updatedAt) : undefined;
  const freshness =
    lastUpdated === undefined
      ? undefined
      : Math.max(0, Math.floor((now - lastUpdated) / 60_000));

  return (
    <Tab
      title={TODAY}
      buttons={
        <>
          {ll.rules.prebook && <BookingDateSelect />}
          <ParkSelect />
          <RefreshButton
            name="Plans and experiences"
            onClick={() => {
              refreshExperiences();
              refreshPlans();
            }}
          />
        </>
      }
      subhead={<ContextStrip />}
      ref={ref}
    >
      <div className="mt-3">
        {freshness !== undefined && (
          <p className="mb-2 text-xs text-gray-600">
            Plans and LL availability are current as of{' '}
            {freshness === 0 ? 'just now' : `${freshness} min ago`}.
          </p>
        )}
        <Button
          type="full"
          onClick={() => setEnabled(!enabled)}
          color={enabled ? 'bg-red-700 text-white' : undefined}
        >
          {enabled ? 'Turn off autopilot' : 'Turn on autopilot'}
        </Button>
        <LatestEvent event={activity} />
        <AutopilotStatus
          status={status}
          bookingsRemaining={bookingsRemaining}
          actionBudget={actionBudget}
          onRefill={refillBudget}
          refusals={refusals ?? NO_REFUSALS}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="small" onClick={() => goTo(<Configure />)}>
          Configure
        </Button>
        <Button
          type="small"
          onClick={() => {
            setPlanChecked(true);
            goTo(<PlanCheck />);
          }}
        >
          Plan check
        </Button>
        <Button type="small" onClick={() => goTo(<Timeline />)}>
          Timeline
        </Button>
        <Button type="small" onClick={() => goTo(<Activity />)}>
          Activity
        </Button>
      </div>

      {!isToday && (
        <section
          className="mt-4 rounded-sm bg-gray-100 p-3"
          aria-label="Pre-trip checklist"
        >
          <h3>Before your trip</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {readiness.map(item => (
              <li
                key={item.subject}
                className="flex items-center justify-between gap-2"
              >
                <span>
                  {item.done ? '✓' : '○'} {item.text}
                </span>
                {!item.done && (
                  <Button
                    type="small"
                    onClick={() => {
                      if (item.subject === 'party') goTo(<PartySelector />);
                      else if (
                        item.subject === 'targets' ||
                        item.subject === 'settings'
                      ) {
                        goTo(<Configure />);
                      } else if (item.subject === 'plan-check') {
                        setPlanChecked(true);
                        goTo(<PlanCheck />);
                      } else requestNotifications();
                    }}
                  >
                    {item.subject === 'notifications' ? 'Enable' : 'Open'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dryRun && (
        <p className="mt-3 rounded-sm bg-yellow-100 p-2 text-sm font-semibold text-yellow-900">
          Dry run is on. Autopilot will watch, alert, and run every check, and
          the activity log will show what it <em>would</em> have booked, moved,
          or swapped &mdash; but nothing will actually be booked. Turn it off in
          Configure when you are ready for it to act.
        </p>
      )}
      {notifications === 'denied' && (
        <p className="mt-3 text-sm font-semibold text-red-700">
          Notifications are blocked, so alerts will only chime. Enable them for
          this site in your browser settings.
        </p>
      )}
      {notifications === 'unsupported' && (
        <p className="mt-3 text-sm text-gray-600">
          This browser has no notification support, so alerts will chime and
          vibrate only. On iOS, notifications require adding this page to your
          Home Screen.
        </p>
      )}
      {unknown > 0 && (
        <p className="mt-3 text-sm font-semibold text-red-700">
          Disney is listing {unknown} attraction{unknown === 1 ? '' : 's'} this
          build does not recognise. Configure names{' '}
          {unknown === 1 ? 'it' : 'them'}.
        </p>
      )}
      {pending && (
        <div className="mt-3 rounded-sm border border-gray-300 p-2 text-sm">
          <p>
            Still looking for <b>{pendingName}</b>? That search stopped when you
            left the NextLL tab.
          </p>
          <Button
            type="small"
            className="mt-2"
            onClick={() => changeTab('NextLL')}
          >
            Open NextLL
          </Button>
        </div>
      )}

      {(ll.nextBookTime || nextDrop) && (
        <p className="mt-3 text-sm">
          {ll.nextBookTime && (
            <>
              <span className="font-semibold">Next Lightning Lane:</span>{' '}
              <Time time={ll.nextBookTime} />
            </>
          )}
          {ll.nextBookTime && nextDrop && ' · '}
          {nextDrop && (
            <>
              <span className="font-semibold">Next drop:</span>{' '}
              <Time time={nextDrop} />
            </>
          )}
        </p>
      )}

      <h3>Held ({held.length})</h3>
      {held.length === 0 ? (
        <p className="text-sm text-gray-600">
          No Multi Pass reservations {isToday ? 'yet today' : 'on this date'}.
        </p>
      ) : (
        <ul className="text-sm">
          {held.map(lane => (
            <li key={lane.id} className="py-1">
              <span className="font-semibold">{lane.name}</span>
              {/* A pass carried over from an earlier park day comes back with
                  a date and no time; dereferencing `.time` there would throw
                  and take the provider above down with the screen. */}
              {lane.start?.time && lane.end?.time ? (
                <>
                  {' '}
                  &mdash; <Time time={lane.start.time} /> to{' '}
                  <Time time={lane.end.time} />
                  <span className="text-gray-600">
                    {' '}
                    (grace scan until{' '}
                    <Time time={lane.end.time.add({ minutes: 119 })} />)
                  </span>
                </>
              ) : (
                <span className="text-gray-600"> &mdash; no return time</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Plan ({targetsHere.length})</h3>
      {targetsHere.length === 0 ? (
        <p className="text-sm text-gray-600">
          Nothing watched at {park.name} on this date. Configure is where a plan
          starts.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-600">
            {armed} armed
            {paused > 0 ? `, ${paused} paused` : ''}
            {armed > 0
              ? ` · ${bookingsRemaining} of ${actionBudget} actions left`
              : ''}
          </p>
          <ul className="text-sm">
            {plan.map(target => (
              <li key={target.experienceId} className="py-1">
                <span className="font-semibold">{nameOf(target)}</span>
                <span className="text-gray-600">
                  {' '}
                  · {target.paused ? 'Paused · ' : ''}
                  {describeMode(target)}
                  {(target.after || target.before) && (
                    <>
                      {' '}
                      ·{' '}
                      <TargetWindow
                        after={target.after}
                        before={target.before}
                      />
                    </>
                  )}
                  {typeof target.rank === 'number' && ` · Rank ${target.rank}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {passkeyStatus !== 'off' && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Passkey:</span>{' '}
          {passkeyStatus === 'unlocked'
            ? 'Disney confirmed the Tier 1 hold is unlocked for the selected party.'
            : 'Waiting for Disney to confirm every selected guest cleared the Tier 1 hold.'}
        </p>
      )}
      {loaderElem}
    </Tab>
  );
}
