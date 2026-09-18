import { use, useMemo, useRef, useState } from 'react';

import { RequestNotSent } from '@/api/client';
import { LLMP } from '@/api/itinerary';
import { Experience } from '@/api/ll';
import { APP_NAME } from '@/appIdentity';
import {
  acquire as acquireLease,
  keepAlive as keepLeaseAlive,
  leaseKey,
  quarantine as quarantineReservation,
  release as releaseLease,
  resolveDoubt,
  resolveDoubtAndAcquire,
  startWhileHeld,
} from '@/autopilot/lease';
import { saveCommit } from '@/autopilot/storage';
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
import { parkDate } from '@/datetime';

import { NextLLTimeSearchActivity } from './NextLLActivity';

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
  // The reservation's own park day, not whatever date the app is showing. The
  // lease is on this booking, and a move of a future one filed under today
  // would warn about a clash on a day it is not on.
  const bookingDate = parkDate(booking.start);
  const reservation = leaseKey(booking.facilityId, bookingDate);
  /**
   * This search's own identity on the lease.
   *
   * Its own, and not the engine's: the lease is re-entrant for its holder, so
   * sharing an id with the provider would have the engine's in-flight work
   * quietly grant this search a claim rather than refuse it -- which is the
   * whole thing the lease is for. A ref, so StrictMode's double mount does not
   * produce two searches that cannot release each other's work.
   */
  const searchOwner = useRef(
    `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  ).current;
  const [targetId, setTargetId] = useState('');
  const target = experiences.find(
    (exp): exp is Experience => exp.id === targetId && !!exp.flex
  );
  const choices = useMemo(
    () =>
      experiences
        .filter(
          (exp): exp is Experience =>
            !!exp.flex && exp.id !== booking.facilityId
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [booking.facilityId, experiences]
  );
  const search = useTimeSearch({
    booking,
    // Not `soonest`: that measures the incoming attraction's times against
    // the reservation being given up, so only a replacement at least five
    // minutes earlier than it could ever be accepted.
    goal: { kind: 'replace' },
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
    commit: (offer, control) => ll.book(offer, undefined, control),
    pollPlans,
    // The operation lease on the reservation this screen was opened for,
    // taken through the *top-level* engine rather than the nearest provider:
    // this screen is reachable from inside NextLL, whose nested provider is a
    // short-lived search of its own.
    claimCommit: () => acquireLease(reservation, searchOwner),
    keepCommitAlive: onLost => keepLeaseAlive(reservation, searchOwner, onLost),
    startCommit: async (authorize, send) => {
      const begun = await startWhileHeld(
        reservation,
        searchOwner,
        authorize,
        send
      );
      if (!begun.started) {
        throw new RequestNotSent('Reservation lease was lost before send');
      }
      return begun.value;
    },
    releaseCommit: () => releaseLease(reservation, searchOwner),
    // The hook supplies the reservation's time at the commit boundary, and the
    // attraction being swapped in is what a later plans read must find to
    // settle the doubt. The victim merely being gone is not proof: a swap that
    // never happened looks exactly like one plans response leaving out a
    // reservation that is still there.
    quarantineCommit: async (id, change, dispatchedAt) => {
      const result = await quarantineReservation(
        reservation,
        { id, ...change },
        dispatchedAt
      );
      return result.durable;
    },
    resolveCommit: id => resolveDoubt(reservation, id),
    retainCommit: id => resolveDoubtAndAcquire(reservation, id, searchOwner),
    mutationKind: 'swap',
    gainingFacility: () => target?.id,
    onCommitted: moved =>
      saveCommit({
        facilityId: moved.facilityId,
        time: String(moved.start.time),
        date: bookingDate,
        kind: 'swap',
        reservationIds: [
          ...new Set([
            moved.id,
            ...moved.guests.map(guest => guest.entitlementId),
          ]),
        ],
      }),
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
            Searches continuously for a replacement. {APP_NAME} will always ask
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
          {search.contended && (
            <div
              role="status"
              className="mt-3 rounded-sm bg-amber-100 p-2 text-amber-900"
            >
              <p className="font-semibold">
                Waiting for Autopilot to finish a request&hellip;
              </p>
              <p className="mt-1">
                It has one out for this Lightning Lane right now, and two at
                once is how one of them gives away what the other just secured.
                This search takes over as soon as that returns.
              </p>
            </div>
          )}
          {search.pending && target && (
            <div className="mt-3 rounded-sm bg-amber-100 p-2 text-amber-900">
              <p className="font-semibold">
                Replace {booking.name} with {target.name} at{' '}
                <Time time={search.pending} />?
              </p>
              <p className="mt-1 text-sm">
                This changes the attraction you hold. It will not be done unless
                you confirm it.
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
          {search.lastError && (
            <p role="alert" className="mt-2 font-semibold">
              {search.lastError}
            </p>
          )}
        </div>
      )}
      {search.running && search.lastError && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-700">
          {search.lastError}
        </p>
      )}
      {search.stop && !search.unresolved && (
        <div className="mt-3 text-sm text-gray-600">
          <p>
            {search.stop === 'failed'
              ? `Stopped because of an error${search.lastError ? `: ${search.lastError}` : ''}.`
              : STOPPED[search.stop]}
          </p>
          {search.stop !== 'failed' && search.lastError && (
            <p className="mt-1 text-red-700">{search.lastError}</p>
          )}
        </div>
      )}
      <NextLLTimeSearchActivity
        search={search}
        requested={search.guard.requested}
      />
    </Screen>
  );
}
