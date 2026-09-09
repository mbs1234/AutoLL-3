import { use, useMemo, useState } from 'react';

import { LLMP } from '@/api/itinerary';
import { Experience } from '@/api/ll';
import { findHeldByEntitlement } from '@/autopilot/swap';
import { SearchStop } from '@/autopilot/timesearch';
import useTimeSearch from '@/autopilot/useTimeSearch';
import Button from '@/components/Button';
import LandLine from '@/components/LandLine';
import Screen from '@/components/Screen';
import { Time } from '@/components/Time';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import PlansContext from '@/contexts/PlansContext';

const STOPPED: Record<Exclude<SearchStop, 'failed'>, string> = {
  'goal-met': 'Replacement confirmed in Plans.',
  'nothing-better': 'No replacement is available right now.',
  'not-modifiable': 'This Lightning Lane can no longer be changed.',
  unconfirmed:
    'The replacement was accepted, but Plans has not caught up yet. Refresh Plans to confirm it.',
  stopped: 'Stopped.',
};

/**
 * Continuously looks for a replacement attraction for one held Multi Pass.
 *
 * The underlying time-search guard is deliberately reused: a replacement is
 * still a `/mod` offer, so it gets the same unknown-outcome stop and Plans
 * confirmation as a same-attraction move. Unlike a time-only improvement,
 * every swap pauses for the user to confirm the exact new attraction/time.
 */
export default function SwapAttractionSearch({ booking }: { booking: LLMP }) {
  const { ll } = use(ClientsContext);
  const { experiences } = use(ExperiencesContext);
  const { pollPlans } = use(PlansContext);
  const [targetId, setTargetId] = useState('');
  const target = experiences.find(
    (exp): exp is Experience => exp.id === targetId && !!exp.flex
  );
  const choices = useMemo(
    () =>
      experiences
        .filter(
          (exp): exp is Experience => !!exp.flex && exp.id !== booking.facilityId
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [booking.facilityId, experiences]
  );
  const search = useTimeSearch({
    booking,
    goal: { kind: 'soonest' },
    createOffer: held => {
      // An attraction removed from the current tipboard is never silently
      // replaced with the original attraction mid-search.
      if (!target) {
        throw new Error('The selected attraction is no longer available.');
      }
      return ll.offer(target, held.guests, { booking: held });
    },
    getTimes: offer => ll.times(offer),
    changeTime: (offer, time) => ll.changeOfferTime(offer, time),
    commit: offer => ll.book(offer),
    pollPlans,
    findHeld: findHeldByEntitlement,
    confirmEveryMove: true,
    stopAfterConfirmedMove: true,
  });

  function start() {
    if (!target || search.running || search.unresolved) return;
    search.start();
  }

  return (
    <Screen title="Change attraction" theme={booking.park.theme}>
      <p className="text-sm text-gray-600">Replacing</p>
      <h2>{booking.name}</h2>
      <LandLine land={booking.land} />
      <p className="mt-2">
        Currently held: <Time time={search.held ?? booking.start.time} />
      </p>

      {!search.running && !search.unresolved && (
        <>
          <p className="mt-3 text-sm text-gray-600">
            Searches continuously for a replacement. AutoLL-3 will always ask
            before replacing this Lightning Lane, even if the offered time is
            earlier.
          </p>
          <label className="mt-4 block">
            <span className="font-semibold">New attraction</span>
            <select
              className="mt-1 block w-full rounded-sm border border-gray-300 p-2"
              value={targetId}
              onChange={event => setTargetId(event.target.value)}
            >
              <option value="">Choose one&hellip;</option>
              {choices.map(exp => (
                <option key={exp.id} value={exp.id}>
                  {exp.name} — {exp.park.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="full"
            className="mt-4"
            disabled={!target}
            onClick={start}
          >
            Search for a replacement
          </Button>
        </>
      )}

      {search.running && (
        <>
          <p className="mt-3">
            Searching for <span className="font-semibold">{target?.name}</span>
            &hellip;{' '}
            <span className="text-gray-500">
              ({search.cycles} {search.cycles === 1 ? 'check' : 'checks'})
            </span>
          </p>
          {search.pending && target && (
            <div className="mt-3 rounded-sm bg-amber-100 p-2 text-amber-900">
              <p className="font-semibold">
                Replace {booking.name} with {target.name} at{' '}
                <Time time={search.pending} />?
              </p>
              <p className="mt-1 text-sm">
                This changes the attraction you hold. It will not be done
                unless you confirm it.
              </p>
              <Button type="small" className="mt-2" onClick={search.accept}>
                Replace Lightning Lane
              </Button>
            </div>
          )}
          <p className="mt-3 text-sm text-gray-600">
            Keep this screen open and in front. Your phone will not sleep while
            it runs.
          </p>
          <Button
            type="full"
            className="mt-4"
            color="bg-red-700 text-white"
            onClick={search.cancel}
          >
            Stop looking
          </Button>
        </>
      )}

      {search.unresolved && (
        <div className="mt-3 rounded-sm bg-red-100 p-2 text-red-900">
          <p className="font-semibold">The replacement outcome is unknown.</p>
          <p className="mt-1 text-sm">
            It may or may not have applied, so the search stopped rather than
            risk replacing the Lightning Lane twice. Check Plans before trying
            again.
          </p>
        </div>
      )}
      {search.stop && !search.unresolved && (
        <p className="mt-3 text-sm text-gray-600">
          {search.stop === 'failed'
            ? `Stopped after repeated errors${search.lastError ? `: ${search.lastError}` : ''}.`
            : STOPPED[search.stop]}
        </p>
      )}
    </Screen>
  );
}
