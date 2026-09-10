import { use, useEffect, useRef, useState } from 'react';

import { Experience } from '@/api/ll';
import {
  MIN_TARGETED_IMPROVEMENT_MINUTES,
  findExistingLL,
} from '@/autopilot/automodify';
import {
  clearPendingSearch,
  loadPendingSearch,
  savePendingSearch,
} from '@/autopilot/nextll';
import { WatchTarget, parseBound, saveWatchList } from '@/autopilot/watchlist';
import Button from '@/components/Button';
import Tab from '@/components/Tab';
import { Time } from '@/components/Time';
import AutopilotContext from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import PlansContext from '@/contexts/PlansContext';
import { parkDate } from '@/datetime';
import useSavedParty from '@/hooks/useSavedParty';
import AutopilotProvider from '@/providers/AutopilotProvider';

import { HomeTabProps } from '../Home';
import { NextLLBookingActivity } from '../NextLLActivity';
import RefreshButton from '../RefreshButton';
import { NextLLModifyPicker } from './NextLLModify';
import ParkSelect from './ParkSelect';

export const NEXTLL = 'NextLL';

/**
 * Its own watch list, its own poller, inside AutoLL's tree.
 *
 * Nested rather than driving the Autopilot the tab bar already sits inside:
 * that one may be armed with a day's worth of attractions, and a quick search
 * must not add a sixth target to it, turn the whole thing on, or -- worse --
 * have Stop switch it all off. What it does inherit, by being nested, is the
 * park, the booking date, the plans, the tipboard and the login.
 */
export const NEXTLL_WATCHLIST_KEY = 'autoll3.nextll.watchlist';

export default function NextLLTab({ ref }: HomeTabProps) {
  return <NextLLChooser ref={ref} />;
}

/** The first decision keeps booking a new slot distinct from changing a hold. */
export function NextLLChooser({ ref }: Partial<HomeTabProps> = {}) {
  const [mode, setMode] = useState<'choose' | 'book' | 'modify'>('choose');
  if (mode === 'book') {
    return (
      <AutopilotProvider
        watchListKey={NEXTLL_WATCHLIST_KEY}
        rapid
        budgeted={false}
        repeatMoves
      >
        <NextLL ref={ref} onBack={() => setMode('choose')} />
      </AutopilotProvider>
    );
  }
  if (mode === 'modify') {
    return <NextLLModifyPicker ref={ref} onBack={() => setMode('choose')} />;
  }
  return (
    <Tab title={NEXTLL} ref={ref}>
      <h2 className="mt-2 text-xl font-semibold">What do you want to do?</h2>
      <p className="mt-2 text-sm text-gray-600">
        Find a new Lightning Lane, or improve one you already hold.
      </p>
      <Button type="full" className="mt-4" onClick={() => setMode('book')}>
        Book a new Lightning Lane
      </Button>
      <p className="mt-1 text-sm text-gray-600">
        Takes the first acceptable return time, then keeps trying to improve it.
      </p>
      <Button type="full" className="mt-4" onClick={() => setMode('modify')}>
        Modify a held Lightning Lane
      </Button>
      <p className="mt-1 text-sm text-gray-600">
        Improve a held return time or search for a different attraction.
      </p>
    </Tab>
  );
}

/**
 * One attraction, one goal, one button.
 *
 * Autopilot's screen exposes every lever: six toggles per attraction, windows,
 * a budget, dry run, whole-party, clash avoidance. That is the right shape for
 * setting up a day in advance. It is the wrong shape at 7am with one hand and
 * a coffee, which is the moment this exists for -- "I want Slinky Dog, as
 * early as you can, go".
 *
 * Everything below is the Autopilot machinery underneath, driven through a
 * single target rather than a list. The strategy is `bookThenMove`, which is
 * exactly this problem already solved: while nothing is held the window is
 * stripped so any offered time is taken -- holding something beats holding
 * nothing -- and once something is held the window becomes the goal the move
 * step works toward.
 */
export function NextLL({
  ref,
  onBack,
}: Partial<HomeTabProps> & { onBack?: () => void } = {}) {
  // Applies the party saved in the LL tab. Only `useSavedParty` calls
  // `ll.setPartyIds`, and it is mounted by `MultiPassList` -- which is not
  // mounted while this tab is showing. Without this, an empty party id set
  // means nobody is marked NOT_IN_PARTY and a search books for everyone
  // eligible on the account, silently overriding the choice made next door.
  const [partyIds] = useSavedParty();
  const { experiences, refreshExperiences } = use(ExperiencesContext);
  const { plans } = use(PlansContext);
  const { bookingDate } = use(BookingDateContext);
  const {
    enabled,
    setEnabled,
    status,
    targets,
    replaceTargets,
    sessionLog,
    skipCounts,
    lastSkip,
  } = use(AutopilotContext);

  const [choice, setChoice] = useState('');
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');
  // usePoller resets its public status when the search is turned off. Keep the
  // final count so Activity can still say how much work the completed search
  // did after Stop returns the form.
  const [lastPolls, setLastPolls] = useState(0);
  // What an interrupted search was after, read once on mount. Cleared as soon
  // as anything is started or dismissed, so it only ever describes a search
  // that is not running.
  const [pending, setPending] = useState(loadPendingSearch);

  // Multi Pass only, same as Autopilot: matching reads `flex`, and there is no
  // Single Pass booking flow to offer.
  const bookable = experiences
    .filter((exp): exp is Experience => !!exp.flex)
    .sort((a, b) => a.name.localeCompare(b.name));

  const target = targets[0];
  const pendingExp =
    !enabled &&
    pending &&
    bookable.find(exp => exp.id === pending.experienceId);
  const chosen = bookable.find(
    exp => exp.id === (target?.experienceId ?? choice)
  );
  const held = chosen && findExistingLL(plans, chosen.id, bookingDate);
  const goalMet =
    !!held && (!target?.before || +held.start.time <= +target.before);

  // `replaceTargets` rather than `addTarget`: this screen watches exactly one
  // attraction and names it, so a target from an earlier search must not
  // survive alongside the new one.
  function begin(experienceId: string, afterText: string, beforeText: string) {
    const lower = parseBound(afterText);
    const upper = parseBound(beforeText);
    const target: WatchTarget = {
      experienceId,
      bookThenMove: true,
      ...(lower ? { after: lower } : {}),
      ...(upper ? { before: upper } : {}),
      // Naming a time is the whole difference between this and an unattended
      // watch. The 30-minute bar exists to stop Autopilot churning a
      // reservation on its own; someone standing here asking for a slot has
      // already decided it is worth it, so any real gain counts. The bounds
      // above are what decide whether a time is wanted -- and `inWindow`
      // reads them in both directions, so a window around a *later* time is
      // admitted by the rules. What the search can actually reach is another
      // matter: the tipboard offers one time, the earliest, so a later slot
      // is only found if it happens to be that.
      ...(lower || upper
        ? { minImprovementMinutes: MIN_TARGETED_IMPROVEMENT_MINUTES }
        : {}),
    };
    replaceTargets([target]);
    setLastPolls(0);
    clearPendingSearch();
    setPending(undefined);
    setEnabled(true);
  }

  function start() {
    if (!choice) return;
    begin(choice, after, before);
  }

  function resume() {
    if (!pending) return;
    setChoice(pending.experienceId);
    // The stored bounds carry seconds; the time inputs do not want them.
    setAfter(pending.after?.slice(0, 5) ?? '');
    setBefore(pending.before?.slice(0, 5) ?? '');
    begin(pending.experienceId, pending.after ?? '', pending.before ?? '');
  }

  function dismissPending() {
    clearPendingSearch();
    setPending(undefined);
  }

  function stop() {
    // usePoller clears its counters when disabled; retain the completed total
    // without mirroring every rapid poll into a second render.
    setLastPolls(status.polls);
    setEnabled(false);
    replaceTargets([]);
    clearPendingSearch();
    setPending(undefined);
  }

  // Leaving the tab unmounts the provider, so the poller stops whatever this
  // does. What it must not do is leave the target behind: the provider
  // reloads the list on mount, and a leftover would be armed again while the
  // screen described only whatever was chosen next.
  //
  // Written straight to storage rather than through `replaceTargets`, because
  // an unmounting component's state update never reaches the effect that
  // persists it.
  const latest = useRef({ enabled, target });
  latest.current = { enabled, target };
  useEffect(
    () => () => {
      const { enabled, target } = latest.current;
      saveWatchList([], NEXTLL_WATCHLIST_KEY);
      if (enabled && target) {
        savePendingSearch({
          experienceId: target.experienceId,
          ...(target.after ? { after: String(target.after) } : {}),
          ...(target.before ? { before: String(target.before) } : {}),
        });
      }
    },
    []
  );

  return (
    <Tab
      title={NEXTLL}
      buttons={
        <>
          <ParkSelect />
          <RefreshButton name="Experiences" onClick={refreshExperiences} />
        </>
      }
      ref={ref}
    >
      {!enabled ? (
        <>
          {onBack && (
            <Button type="small" onClick={onBack}>
              Choose another action
            </Button>
          )}
          {pendingExp && (
            <div className="mt-2 rounded-sm border border-gray-300 p-3">
              <p>
                Still looking for{' '}
                <span className="font-semibold">{pendingExp.name}</span>?
                Searching stopped when you left this tab.
              </p>
              <div className="mt-3 flex gap-2">
                <Button onClick={resume}>Resume</Button>
                <Button onClick={dismissPending}>Start something else</Button>
              </div>
            </div>
          )}

          <p className={pendingExp ? 'mt-4' : undefined}>
            Pick one attraction and NextLL will take the first Lightning Lane it
            can get, then keep trying to move it earlier.
          </p>

          <label className="mt-4 block">
            <span className="font-semibold">Attraction</span>
            <select
              className="mt-1 block w-full rounded-sm border border-gray-300 p-2"
              value={choice}
              onChange={e => setChoice(e.target.value)}
            >
              <option value="">Choose one&hellip;</option>
              {bookable.map(exp => (
                <option key={exp.id} value={exp.id}>
                  {exp.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-semibold">Return after</span>
            <input
              type="time"
              aria-label="Earliest acceptable return time"
              className="rounded-sm border border-gray-300 px-1 py-0.5"
              value={after}
              onChange={e => setAfter(e.target.value)}
            />
            <span className="text-sm text-gray-600">
              optional &mdash; set both to aim at a particular time
            </span>
          </label>

          <label className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-semibold">Return by</span>
            <input
              type="time"
              aria-label="Latest acceptable return time"
              className="rounded-sm border border-gray-300 px-1 py-0.5"
              value={before}
              onChange={e => setBefore(e.target.value)}
            />
            <span className="text-sm text-gray-600">
              optional &mdash; leave empty for as early as possible
            </span>
          </label>

          <div className="mt-4">
            <Button type="full" onClick={start}>
              Find it
            </Button>
          </div>

          <p className="mt-3 text-sm text-gray-600">
            {partyIds.size > 0
              ? `Books for your saved party of ${partyIds.size}. Change it from the LL tab.`
              : 'Books for everyone eligible. Choose a smaller party from the LL tab if you want fewer.'}
          </p>

          {bookable.length === 0 && (
            <p className="mt-3 text-sm text-gray-600">
              No attractions loaded yet. Switch to the LL tab and let the list
              load first, or pick a different park there.
            </p>
          )}
        </>
      ) : (
        <>
          <h2 className="mt-2 text-xl font-semibold">{chosen?.name}</h2>

          {held ? (
            <p className="mt-2">
              Holding <Time time={held.start.time} />
              {goalMet ? (
                <span className="font-semibold"> &mdash; that will do.</span>
              ) : (
                <> &mdash; still looking for something earlier.</>
              )}
            </p>
          ) : (
            <p className="mt-2">
              Nothing held yet. Checking&hellip;{' '}
              <span className="text-gray-500">
                ({status.polls} {status.polls === 1 ? 'check' : 'checks'})
              </span>
            </p>
          )}

          {/* The poller gives up after MAX_CONSECUTIVE_FAILURES and returns
              without scheduling another tick, leaving `enabled` true and the
              wake lock released. Every line above still reads as a live
              search, so without this the screen says "Checking..." at a loop
              that stopped -- and an expired session, which is what usually
              stops it, is exactly the case where the user has to do something.
              Autopilot's screen has said this since it had one. */}
          {status.mode === 'stopped' && (
            <p className="mt-2 font-semibold text-red-700">
              Stopped after {status.consecutiveFailures} failed checks
              {status.lastError ? `: ${status.lastError}` : ''}. Tap{' '}
              {goalMet ? 'Done' : 'Stop looking'} and start it again to retry.
            </p>
          )}

          {target?.before && (
            <p className="mt-1 text-sm text-gray-600">
              Goal: a return time at or before <Time time={target.before} />.
            </p>
          )}

          {bookingDate !== parkDate() && (
            <p className="mt-1 text-sm text-gray-600">
              Working on {bookingDate}, not today.
            </p>
          )}

          <div className="mt-4">
            <Button type="full" color="bg-red-700 text-white" onClick={stop}>
              {goalMet ? 'Done' : 'Stop looking'}
            </Button>
          </div>

          <p className="mt-3 text-sm text-gray-600">
            Keep this screen open and in front. Your phone will not sleep while
            it runs. Switching tabs stops the search &mdash; come back and it
            will offer to pick it up again.
          </p>
        </>
      )}

      <NextLLBookingActivity
        active={enabled}
        polls={Math.max(status.polls, lastPolls)}
        entries={sessionLog}
        skipCounts={skipCounts}
        lastSkip={lastSkip}
      />
    </Tab>
  );
}
