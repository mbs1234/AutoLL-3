import { use, useMemo, useRef, useState } from 'react';

import { RequestNotSent } from '@/api/client';
import { LLMP } from '@/api/itinerary';
import { Experience, OfferError } from '@/api/ll';
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
import { NothingOpen, SearchStop } from '@/autopilot/timesearch';
import useTimeSearch, { CYCLE_MS } from '@/autopilot/useTimeSearch';
import Button from '@/components/Button';
import LandLine from '@/components/LandLine';
import Screen from '@/components/Screen';
import { Time } from '@/components/Time';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import PlansContext from '@/contexts/PlansContext';
import { parkDate } from '@/datetime';

import PushbackWarning from '../PushbackWarning';
import { NextLLTimeSearchActivity } from './NextLLActivity';

const STOPPED: Record<Exclude<SearchStop, 'failed'>, string> = {
  'goal-met': 'Replacement confirmed in Plans.',
  'nothing-better': 'No replacement is available right now.',
  'not-modifiable': 'This Lightning Lane can no longer be changed.',
  unconfirmed:
    'The replacement was accepted, but Plans has not caught up yet. Refresh Plans to confirm it.',
  stopped: 'Stopped.',
  refused:
    'Stopped: Disney refused a request, so everything has stopped. You can start again, but the next refusal stops everything again.',
  throttled:
    'Stopped: Disney asked to slow down. You can start again early, but it may ask again.',
  session:
    'Stopped after 200 checks, about twenty minutes, with no replacement. Take a break before searching again: long searches can make Disney pause the account.',
};

/** Attractions one search may take, whichever opens first. */
export const MAX_RIDES = 3;

/**
 * How long a ride Disney made no offer for is left out.
 *
 * The tip board can show a ride open that Disney will not offer as a change.
 * Asked again on every check, that one ride would take every offer request
 * and the others would never be asked about.
 */
export const OFFER_COOLDOWN_MS = 5 * CYCLE_MS;

/** "A", "A or B", "A, B or C". */
function either(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * Continuously looks for a replacement attraction for one held Multi Pass:
 * whichever of up to `MAX_RIDES` chosen attractions opens first.
 *
 * The underlying time-search guard is deliberately reused: a replacement is
 * still a `/mod` offer, so it gets the same unknown-outcome stop and Plans
 * confirmation as a same-attraction move. Unlike a time-only improvement,
 * every swap pauses for the user to confirm the exact new attraction/time.
 */
export default function SwapAttractionSearch({ booking }: { booking: LLMP }) {
  const { ll } = use(ClientsContext);
  const { experiences, pollExperiences, lastUpdated } = use(ExperiencesContext);
  const { bookingDate: boardDate } = use(BookingDateContext);
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
  // One slot per attraction; an empty slot is a choice not made.
  const [slots, setSlots] = useState<string[]>(['']);
  const chosenIds = slots.filter(Boolean);
  const rides = chosenIds
    .map(id =>
      experiences.find((exp): exp is Experience => exp.id === id && !!exp.flex)
    )
    .filter((exp): exp is Experience => !!exp);
  const chosenKey = chosenIds.join(',');
  // Every attraction this search may gain is claimed with the reservation, so
  // Autopilot does not book one of them while this search is changing into it.
  const conflictKeys = useMemo(
    () => [
      reservation,
      ...chosenKey
        .split(',')
        .filter(Boolean)
        .map(id => leaseKey(id, bookingDate)),
    ],
    [bookingDate, reservation, chosenKey]
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

  // What the offer step reads when it runs, which is after this render: the
  // search calls back into this component from its own loop.
  const latest = useRef({ experiences, lastUpdated, boardDate, chosenIds });
  latest.current = { experiences, lastUpdated, boardDate, chosenIds };
  // Per search: rides Disney last made no offer for, and whose turn it is when
  // the board cannot tell.
  const coolUntil = useRef(new Map<string, number>());
  const turn = useRef(0);

  /**
   * The attraction to ask Disney about on this check: whichever of the chosen
   * ones the tip board shows open, the one opening soonest when several are.
   *
   * The board is one request that covers every attraction and carries no
   * sensor payload, where each offer does. So a search over three attractions
   * asks Disney for no more offers than a search over one, and none at all
   * while nothing is open. A board Autopilot read moments ago is used as it
   * is, rather than read again.
   */
  async function rideToAsk(): Promise<Experience | undefined> {
    const now = Date.now();
    const { experiences, lastUpdated, boardDate, chosenIds } = latest.current;
    const ids = chosenIds.filter(id => (coolUntil.current.get(id) ?? 0) <= now);
    if (ids.length === 0) return undefined;
    // Another day's board says nothing about this reservation's day, so the
    // attractions take turns, as a search over one attraction always did.
    const inTurn = () => {
      const id = ids[turn.current++ % ids.length];
      return experiences.find(exp => exp.id === id);
    };
    if (boardDate !== bookingDate) return inTurn();
    const board =
      lastUpdated !== undefined && now - lastUpdated < CYCLE_MS
        ? experiences
        : await pollExperiences();
    // Nor does a board that lists none of them, as another park's would not.
    if (!ids.some(id => board.some(exp => exp.id === id))) return inTurn();
    return ids
      .map(id => board.find(exp => exp.id === id))
      .filter((exp): exp is Experience => !!exp?.flex?.available)
      .reduce<Experience | undefined>((soonest, exp) => {
        const at = exp.flex?.nextAvailableTime;
        const best = soonest?.flex?.nextAvailableTime;
        return !soonest || (at && (!best || +at < +best)) ? exp : soonest;
      }, undefined);
  }
  const search = useTimeSearch({
    booking,
    // Not `soonest`: that measures the incoming attraction's times against
    // the reservation being given up, so only a replacement at least five
    // minutes earlier than it could ever be accepted.
    goal: { kind: 'replace' },
    createOffer: async (held, targetTime, experienceId) => {
      void targetTime;
      // The attraction of a question already asked, when it is accepted;
      // otherwise whichever is open now.
      const ride = experienceId
        ? latest.current.experiences.find(exp => exp.id === experienceId)
        : await rideToAsk();
      if (!ride) {
        // An attraction removed from the current tipboard is never silently
        // replaced with the original attraction mid-search.
        if (experienceId) {
          throw new Error('The selected attraction is no longer available.');
        }
        throw new NothingOpen();
      }
      try {
        return await ll.offer(ride, held.guests, { booking: held });
      } catch (error) {
        if (error instanceof OfferError) {
          coolUntil.current.set(ride.id, Date.now() + OFFER_COOLDOWN_MS);
        }
        throw error;
      }
    },
    getTimes: offer => ll.times(offer),
    changeTime: (offer, time) => ll.changeOfferTime(offer, time),
    commit: (offer, control) => ll.book(offer, undefined, control),
    pollPlans,
    // The operation lease on the reservation this screen was opened for,
    // taken through the *top-level* engine rather than the nearest provider:
    // this screen is reachable from inside NextLL, whose nested provider is a
    // short-lived search of its own.
    claimCommit: () => acquireLease(conflictKeys, searchOwner),
    keepCommitAlive: onLost =>
      keepLeaseAlive(conflictKeys, searchOwner, onLost),
    startCommit: async (authorize, send) => {
      const begun = await startWhileHeld(
        conflictKeys,
        searchOwner,
        authorize,
        send
      );
      if (!begun.started) {
        throw new RequestNotSent('Reservation lease was lost before send');
      }
      return begun.value;
    },
    releaseCommit: () => releaseLease(conflictKeys, searchOwner),
    // The hook supplies the reservation's time at the commit boundary, and the
    // attraction being swapped in is what a later plans read must find to
    // settle the doubt. The victim merely being gone is not proof: a swap that
    // never happened looks exactly like one plans response leaving out a
    // reservation that is still there.
    quarantineCommit: async (id, change, dispatchedAt) => {
      const result = await quarantineReservation(
        reservation,
        { id, ...change, blockingKeys: conflictKeys },
        dispatchedAt
      );
      return result.durable;
    },
    resolveCommit: id => resolveDoubt(reservation, id),
    retainCommit: id => resolveDoubtAndAcquire(conflictKeys, id, searchOwner),
    mutationKind: 'swap',
    gainingFacility: quoted => quoted.experience.id,
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

  // The ride the question, the change or the result is about: the search's
  // own record, or the one attraction when only one was chosen.
  const ride = search.ride ?? (rides.length === 1 ? rides[0] : undefined);

  function start() {
    if (rides.length === 0 || search.running || search.unresolved) return;
    coolUntil.current.clear();
    turn.current = 0;
    search.start();
  }

  /** The attraction chosen in slot `index`, and room for another after it. */
  function choose(index: number, id: string) {
    setSlots(current => {
      const next = [...current];
      next[index] = id;
      // Drop the empty slots, then offer one more while there is room.
      const kept = next.filter(Boolean);
      return kept.length < MAX_RIDES ? [...kept, ''] : kept;
    });
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
            Searches continuously for a replacement: whichever of the
            attractions you choose opens first, up to {MAX_RIDES} of them.{' '}
            {APP_NAME} will always ask before replacing this Lightning Lane,
            even if the offered time is earlier.
          </p>
          {slots.map((id, index) => (
            <label key={index} className="mt-4 block">
              <span className="font-semibold">
                {index === 0 ? 'New attraction' : 'Or'}
              </span>
              {index > 0 && (
                <span className="text-sm text-gray-600"> (optional)</span>
              )}
              <select
                className="mt-1 block w-full rounded-sm border border-gray-300 p-2"
                value={id}
                onChange={event => choose(index, event.target.value)}
              >
                <option value="">Choose one&hellip;</option>
                {choices
                  .filter(exp => exp.id === id || !chosenIds.includes(exp.id))
                  .map(exp => (
                    <option key={exp.id} value={exp.id}>
                      {exp.name} — {exp.park.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <Button
            type="full"
            className="mt-4"
            disabled={rides.length === 0}
            onClick={start}
          >
            Search for a replacement
          </Button>
          <PushbackWarning />
        </>
      )}

      {search.running && (
        <>
          <p className="mt-3">
            Searching for{' '}
            <span className="font-semibold">
              {either(rides.map(exp => exp.name))}
            </span>
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
          {/* From the instant of the tap: the cycle that makes the change can
              be a poll away, and a tap that changed nothing on the screen was
              reported as a tap that did nothing. */}
          {(search.accepting || search.phase === 'awaiting') && ride && (
            <div
              role="status"
              className="mt-3 rounded-sm bg-blue-100 p-2 text-blue-900"
            >
              <p className="font-semibold">
                {search.phase === 'awaiting' ? (
                  <>
                    Replaced &mdash; waiting for Plans to confirm {ride.name} at{' '}
                    <Time time={search.guard.requested!} />
                    &hellip;
                  </>
                ) : (
                  <>
                    Replacing {booking.name} with {ride.name}
                    {search.guard.requested && (
                      <>
                        {' '}
                        at <Time time={search.guard.requested} />
                      </>
                    )}
                    &hellip;
                  </>
                )}
              </p>
            </div>
          )}
          {search.pending && ride && (
            <div className="mt-3 rounded-sm bg-amber-100 p-2 text-amber-900">
              <p className="font-semibold">
                Replace {booking.name} with {ride.name} at{' '}
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
      {search.stop === 'goal-met' && !search.unresolved && ride && (
        <div
          role="status"
          className="mt-3 rounded-sm bg-green-100 p-2 text-green-900"
        >
          <p className="font-semibold">
            Replaced {booking.name} with {ride.name}
            {search.held && (
              <>
                {' '}
                at <Time time={search.held} />
              </>
            )}
            .
          </p>
          <p className="mt-1 text-sm">Confirmed in Plans.</p>
        </div>
      )}
      {search.stop && search.stop !== 'goal-met' && !search.unresolved && (
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
