import { use, useState } from 'react';

import { LLMP } from '@/api/itinerary';
import { SearchGoal, SearchStop } from '@/autopilot/timesearch';
import useTimeSearch from '@/autopilot/useTimeSearch';
import { parseBound } from '@/autopilot/watchlist';
import Button from '@/components/Button';
import Screen from '@/components/Screen';
import { Time } from '@/components/Time';
import ClientsContext from '@/contexts/ClientsContext';
import NavContext from '@/contexts/NavContext';
import PlansContext from '@/contexts/PlansContext';

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
 * earlier. This screen owns a `/mod` offer and polls the full return-time
 * grid behind it, so it can aim at a particular time, including a later one.
 *
 * It is its own screen rather than part of Select Return Time because the
 * offer is the thing being managed: `changeOfferTime` replaces both the offer
 * id and the offer-set id, so a manual screen left mounted underneath would
 * be holding ids this search had already superseded.
 */
export default function TimeSearch({ booking }: { booking: LLMP }) {
  const { ll } = use(ClientsContext);
  const { pollPlans } = use(PlansContext);
  const { goBack } = use(NavContext);
  const [targetText, setTargetText] = useState('');
  const [goal, setGoal] = useState<SearchGoal>({ kind: 'soonest' });

  const search = useTimeSearch({
    booking,
    goal,
    createOffer: held =>
      ll.offer(held.experience, held.guests, { booking: held }),
    getTimes: offer => ll.times(offer),
    changeTime: (offer, time) => ll.changeOfferTime(offer, time),
    commit: offer => ll.book(offer),
    pollPlans,
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
            {search.phase === 'awaiting' ? (
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
        </div>
      )}

      {search.stop && !search.unresolved && (
        <div className="mt-3 text-sm text-gray-600">
          <p>
            {search.stop === 'failed'
              ? `Stopped after repeated errors${search.lastError ? `: ${search.lastError}` : ''}.`
              : STOPPED[search.stop]}
          </p>
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
