import { use, useRef, useState } from 'react';

import { RequestNotSent } from '@/api/client';
import { LLMP } from '@/api/itinerary';
import { findSameReservation } from '@/autopilot/automodify';
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
import { overlappingPlans } from '@/autopilot/overlap';
import { saveCommit } from '@/autopilot/storage';
import { SearchGoal, SearchStop } from '@/autopilot/timesearch';
import useTimeSearch from '@/autopilot/useTimeSearch';
import { parseBound } from '@/autopilot/watchlist';
import Button from '@/components/Button';
import Screen from '@/components/Screen';
import { Time } from '@/components/Time';
import AutopilotContext from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import NavContext from '@/contexts/NavContext';
import PlansContext from '@/contexts/PlansContext';
import TopAutopilotContext from '@/contexts/TopAutopilotContext';
import { parkDate } from '@/datetime';

import Home from './Home';
import { NextLLTimeSearchActivity } from './NextLLActivity';

/** What to say when the search ends. `failed` carries an error and is built inline. */
const STOPPED: Record<Exclude<SearchStop, 'failed'>, string> = {
  'goal-met': 'That will do — the reservation is at the time you asked for.',
  'nothing-better': 'Nothing better is on offer right now.',
  'not-modifiable': 'This reservation can no longer be changed.',
  unconfirmed:
    'The move went through, but Plans has not caught up yet. Refresh Plans to confirm the new time.',
  stopped: 'Stopped.',
};

/**
 * An automated search for a better return time on a reservation already held.
 *
 * Distinct from Autopilot and NextLL because it reasons over a different set
 * of facts. Those two see one candidate per tick -- the earliest time the
 * tipboard advertises -- which is why they can only ever move a reservation
 * earlier. This screen owns a `/mod` offer and polls the return-time grid
 * behind it, so it can aim at a particular time, including a later one.
 *
 * The grid is not every time there is. Disney leaves out any that would
 * overlap the party's other plans, and grants one when asked for it by name,
 * so the search also asks for the tip board's earliest (or the time aimed at)
 * directly, unless the person has asked Autopilot to avoid clashes.
 *
 * It is its own screen rather than part of Select Return Time because the
 * offer is the thing being managed: `changeOfferTime` replaces both the offer
 * id and the offer-set id, so a manual screen left mounted underneath would
 * be holding ids this search had already superseded.
 */
export default function TimeSearch({ booking }: { booking: LLMP }) {
  const { ll } = use(ClientsContext);
  const { plans, pollPlans } = use(PlansContext);
  const { experiences } = use(ExperiencesContext);
  const { bookingDate: boardDate } = use(BookingDateContext);
  // One stored setting whichever provider is nearest; the day plan's is read
  // first so a NextLL search nested above this screen cannot shadow it.
  const topAutopilot = use(TopAutopilotContext);
  const autopilot = use(AutopilotContext);
  const avoidOverlaps = (topAutopilot ?? autopilot).avoidOverlaps;
  const { goBack } = use(NavContext);
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
  const [targetText, setTargetText] = useState('');
  const [goal, setGoal] = useState<SearchGoal>({ kind: 'soonest' });

  const search = useTimeSearch({
    booking,
    goal,
    // This reservation, not "the party's reservation for this attraction":
    // with two people holding it at different times, that was the other one.
    findHeld: findSameReservation,
    createOffer: (held, targetTime) =>
      ll.offer(held.experience, held.guests, { booking: held, targetTime }),
    // The tip board's earliest, only when the board on screen is for this
    // reservation's day: another date's board says nothing about this one.
    hint: () => {
      if (boardDate !== bookingDate) return undefined;
      const listed = experiences.find(exp => exp.id === booking.facilityId);
      return listed?.flex?.available
        ? listed.flex.nextAvailableTime
        : undefined;
    },
    // The engine's own clash rule, so this search and Autopilot refuse the
    // same times when the person asked for that, and allow the same otherwise.
    clashes: (time, held) =>
      avoidOverlaps &&
      overlappingPlans(time, plans, {
        date: bookingDate,
        ignoreIds: [held.id],
      }).length > 0,
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
    // The hook supplies the reservation's time as it last saw it, so a later
    // plans read can settle the doubt by seeing it move rather than by a clock.
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
    mutationKind: 'modify',
    onCommitted: moved =>
      saveCommit({
        facilityId: moved.facilityId,
        time: String(moved.start.time),
        date: bookingDate,
        kind: 'modify',
        reservationIds: [
          ...new Set([
            moved.id,
            ...moved.guests.map(guest => guest.entitlementId),
          ]),
        ],
      }),
  });

  function begin(kind: SearchGoal['kind']) {
    if (kind === 'soonest') {
      setGoal({ kind: 'soonest' });
    } else {
      const target = parseBound(targetText);
      if (!target) return;
      setGoal({ kind: 'at', target });
    }
    search.start();
  }

  return (
    <Screen title="Find a better time" theme={booking.park.theme}>
      <h2>{booking.name}</h2>
      <p className="mt-2">
        Holding {search.held ? <Time time={search.held} /> : '—'}
      </p>

      {!search.running && !search.unresolved && search.phase === 'idle' && (
        <>
          <p className="mt-3 text-sm text-gray-600">
            This checks every return time on offer, not just the earliest, and
            takes a better one when it appears. A move to a <b>later</b> time is
            offered rather than taken — giving up an earlier reservation is the
            one change that cannot be undone if it was not what you wanted.
          </p>
          <div className="mt-4">
            <Button type="full" onClick={() => begin('soonest')}>
              Find the earliest
            </Button>
          </div>
          <label className="mt-4 flex flex-wrap items-center gap-2">
            <span className="font-semibold">Or aim for</span>
            <input
              type="time"
              aria-label="Target return time"
              className="rounded-sm border border-gray-300 px-1 py-0.5"
              value={targetText}
              onChange={e => setTargetText(e.target.value)}
            />
          </label>
          <div className="mt-2">
            <Button
              type="full"
              disabled={!parseBound(targetText)}
              onClick={() => begin('at')}
            >
              Aim for this time
            </Button>
          </div>
        </>
      )}

      {search.running && (
        <>
          <p className="mt-3">
            {search.accepting && search.guard.requested ? (
              <>
                Moving to <Time time={search.guard.requested} />
                &hellip;{' '}
              </>
            ) : search.phase === 'awaiting' ? (
              <>
                Waiting for Plans to confirm the move to{' '}
                <Time time={search.guard.requested!} />
                &hellip;{' '}
              </>
            ) : (
              <>Checking&hellip; </>
            )}
            <span className="text-gray-500">
              ({search.cycles} {search.cycles === 1 ? 'check' : 'checks'},{' '}
              {search.moves} moved)
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
                It has one out for this attraction right now, and two at once is
                how one of them lands on a time the other just gave up. This
                search takes over as soon as that returns &mdash; a few seconds
                at most.
              </p>
            </div>
          )}
          {search.pending && (
            <div className="mt-3 rounded-sm bg-amber-100 p-2 text-amber-900">
              <p className="font-semibold">
                A later time is available: <Time time={search.pending} />
              </p>
              <p className="mt-1 text-sm">
                Taking it gives up the earlier reservation you hold now.
              </p>
              <Button type="small" className="mt-2" onClick={search.accept}>
                Take it
              </Button>
            </div>
          )}
          <p className="mt-3 text-sm text-gray-600">
            Keep this screen open and in front. Your phone will not sleep while
            it runs.
          </p>
          <div className="mt-4">
            <Button
              type="full"
              color="bg-red-700 text-white"
              onClick={search.cancel}
            >
              Stop looking
            </Button>
          </div>
        </>
      )}

      {search.unresolved && (
        <div className="mt-3 rounded-sm bg-red-100 p-2 text-red-900">
          <p className="font-semibold">
            A move to <Time time={search.unresolved} /> did not come back.
          </p>
          <Button
            type="small"
            className="mt-2"
            onClick={() =>
              goBack({ screen: Home, props: { tabName: 'Plans' } })
            }
          >
            Open Plans
          </Button>
          <p className="mt-1 text-sm">
            It may or may not have applied, and asking again could move the
            reservation twice — so the search stopped. Check Plans to see where
            it is now.
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
          {search.stop === 'unconfirmed' && (
            <div className="mt-2 flex gap-2">
              <Button
                type="small"
                onClick={() =>
                  goBack({ screen: Home, props: { tabName: 'Plans' } })
                }
              >
                Open Plans
              </Button>
              <Button type="small" onClick={search.start}>
                Keep waiting
              </Button>
            </div>
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
