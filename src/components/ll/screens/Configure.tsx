import { use, useEffect, useState } from 'react';

import { Experience } from '@/api/ll';
import { MAX_ACTIONS_PER_DAY, MIN_ACTIONS_PER_DAY } from '@/autopilot/autobook';
import { WatchTarget, targetApplies } from '@/autopilot/watchlist';
import Button from '@/components/Button';
import Disclosure from '@/components/Disclosure';
import Screen from '@/components/Screen';
import Toggle from '@/components/Toggle';
import ContextStrip from '@/components/ll/ContextStrip';
import TargetCard from '@/components/ll/TargetCard';
import AutopilotContext from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import ParkContext from '@/contexts/ParkContext';
import StarIcon from '@/icons/StarIcon';

export const CONFIGURE = 'Configure';

/** How long the offer to undo a removal stays: long enough to notice a mis-tap. */
export const UNDO_MS = 8000;

/**
 * The day's allowance, committed on blur rather than per keystroke.
 *
 * Typing "15" passes through "1", and a controlled input writing straight
 * through would set the day's budget to 1 mid-keystroke -- enough, with two
 * actions already spent, to mark it exhausted and stop autopilot acting until
 * the second digit landed.
 */
function BudgetInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (actions: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="mt-1 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-600">Actions allowed per day</span>
      <input
        type="number"
        min={MIN_ACTIONS_PER_DAY}
        max={MAX_ACTIONS_PER_DAY}
        step={1}
        className="w-20 rounded-sm border border-gray-300 px-1 py-0.5"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => onCommit(Number(draft))}
      />
    </label>
  );
}

/**
 * Choosing what Autopilot watches and what it may do about it.
 *
 * Setup, done once: the three safeguards, a card per watched attraction with
 * its actions, window and rank, and the list to add from. Turning Autopilot
 * on, and everything it reports while running, is the Today tab's.
 */
export default function Configure({
  focus,
}: {
  focus?: { kind: 'target'; experienceId: string } | { kind: 'setting' };
} = {}) {
  const {
    targets,
    targetsHere,
    isWatched,
    addTarget,
    removeTarget,
    bookingsRemaining,
    actionBudget,
    maxActionsPerDay,
    setMaxActionsPerDay,
    requireWholeParty,
    setRequireWholeParty,
    dryRun,
    setDryRun,
    avoidOverlaps,
    setAvoidOverlaps,
    passkeyStatus,
  } = use(AutopilotContext);
  const { experiences, unknownExperienceIds } = use(ExperiencesContext);
  const { park } = use(ParkContext);
  const { bookingDate } = use(BookingDateContext);

  // A removal can be undone for a moment. The target is kept whole, flags and
  // window included, because that is what a mis-tap used to lose.
  const [removed, setRemoved] = useState<{
    target: WatchTarget;
    name: string;
  }>();
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(undefined), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);
  // The target just added starts unfolded: adding is when it gets set up.
  const [justAdded, setJustAdded] = useState<string>();

  // Scoped to the park and date on screen. `targets` is the whole saved list
  // across every park and every date, so looking a row up in it returns
  // whichever entry happens to match the id first -- and after targets became
  // park/date-scoped that can be a different day's settings, shown against
  // today's row and edited by today's toggles. The same applies to the summary
  // flags below, which describe what Autopilot will do here and now.
  const targetFor = (experienceId: string) =>
    targetsHere.find(t => t.experienceId === experienceId);
  const anyAutoBook = targetsHere.some(t => t.autoBook);
  const anyAutoModify = targetsHere.some(t => t.autoModify);
  const anyBookThenMove = targetsHere.some(t => t.bookThenMove);
  const pausedCount = targetsHere.filter(t => t.paused).length;
  const anyAutoSwap = targetsHere.some(t => t.autoSwap);
  // Any armed action spends the budget, so any of them should see the count.
  // Gating it on auto-book alone hid it from anyone running only book-then-move
  // or swap -- both of which imply booking.
  const anyAction = targetsHere.some(
    t => t.autoBook || t.autoModify || t.bookThenMove || t.autoSwap
  );

  // Only Multi Pass attractions can be watched: matching reads the `flex`
  // field, and bg1 has no Single Pass booking flow, so offering Single Pass
  // headliners here would promise something it cannot deliver.
  const watchable = experiences
    .filter((exp): exp is Experience => !!exp.flex)
    .sort((a, b) => a.name.localeCompare(b.name));

  const watched = watchable.filter(exp => isWatched(exp.id));
  const unwatched = watchable.filter(exp => !isWatched(exp.id));
  const absentTargets =
    experiences.length === 0
      ? []
      : targets.filter(
          target =>
            targetApplies(target, park.id, bookingDate) &&
            !experiences.some(exp => exp.id === target.experienceId)
        );

  return (
    <Screen title={CONFIGURE} theme={park.theme} subhead={<ContextStrip />}>
      <p>
        Pick the attractions Autopilot watches at {park.name} and what it may do
        for each. Turn it on from Today.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Toggle
          on={dryRun}
          variant="rehearsal"
          label="Dry run"
          onText="Dry run: on"
          offText="Dry run: off"
          title={
            dryRun ? 'Let autopilot act for real' : 'Rehearse without booking'
          }
          onToggle={() => setDryRun(!dryRun)}
        />
        <Toggle
          on={requireWholeParty}
          variant="safeguard"
          label="Whole party only"
          onText="Whole party only: on"
          offText="Whole party only: off"
          title={
            requireWholeParty
              ? 'Allow booking for part of the party'
              : 'Only act when the whole party is eligible'
          }
          onToggle={() => setRequireWholeParty(!requireWholeParty)}
        />
        <Toggle
          on={avoidOverlaps}
          variant="safeguard"
          label="Avoid clashes"
          onText="Avoid clashes: on"
          offText="Avoid clashes: off"
          title={
            avoidOverlaps
              ? 'Allow times that clash with existing plans'
              : 'Refuse times that clash with existing plans'
          }
          onToggle={() => setAvoidOverlaps(!avoidOverlaps)}
        />
      </div>
      {dryRun && (
        <p className="mt-2 rounded-sm bg-yellow-100 p-2 text-sm font-semibold text-yellow-900">
          Dry run is on: every check runs and the log says what would have
          happened, but nothing is booked, moved or swapped.
        </p>
      )}
      <Disclosure title="Why these settings?">
        <div className="space-y-2 text-xs text-gray-600">
          <p>
            {requireWholeParty
              ? 'Autopilot will not book, move, or swap unless everyone in your party is eligible. A Lightning Lane for part of the group is often worse than none.'
              : 'Autopilot books for whoever is eligible, the way booking by hand does. Turn this on to guarantee the group is never split.'}
          </p>
          <p>
            {avoidOverlaps
              ? 'Autopilot will not take a return time that lands on top of a reservation you already hold — dining included. Booking by hand only warns about this; here there is nobody to warn.'
              : 'Autopilot will take any time that fits, even one overlapping an existing reservation.'}
          </p>
          <p>
            Dry run rehearses every check and logs what would have been booked,
            moved or swapped, but commits nothing.
          </p>
        </div>
      </Disclosure>

      {absentTargets.length > 0 && (
        <>
          <h3>Not on today&rsquo;s list ({absentTargets.length})</h3>
          <p className="text-sm text-gray-600">
            These saved targets are not in the current tipboard, so Autopilot
            cannot watch or book them today. Disney can use a seasonal version
            or change an attraction ID.
          </p>
          <ul>
            {absentTargets.map(target => (
              <li
                key={target.experienceId}
                className="flex items-center gap-2 py-1"
              >
                <Button
                  title={`Remove unavailable target ${target.experienceId}`}
                  onClick={() => removeTarget(target.experienceId)}
                >
                  <StarIcon />
                </Button>
                <span>{target.name ?? target.experienceId}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {unknownExperienceIds && unknownExperienceIds.length > 0 && (
        <p className="mt-3 rounded-sm bg-red-100 p-2 text-sm font-semibold text-red-900">
          Disney is listing {unknownExperienceIds.length} attraction
          {unknownExperienceIds.length === 1 ? '' : 's'} this build does not
          recognise ({unknownExperienceIds.join(', ')}). They cannot be watched,
          alerted on, or booked. This is what a re-themed ride looks like:
          Disney issues a new facility ID and the old one stops appearing.
        </p>
      )}

      <h3>Watching ({targetsHere.length})</h3>
      {targets.length > targetsHere.length && (
        <p className="text-xs text-gray-600">
          {targets.length - targetsHere.length} more saved for another park or
          date, or not on this park&rsquo;s list today. Autopilot only acts on
          what is loaded here.
        </p>
      )}
      {watched.length === 0 ? (
        <p className="text-sm text-gray-600">
          Nothing selected yet. Pick attractions below.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {watched.map(exp => (
            <li key={exp.id}>
              <TargetCard
                experience={exp}
                target={targetFor(exp.id)}
                defaultOpen={
                  exp.id === justAdded || exp.id === focus?.experienceId
                }
                onRemove={() => {
                  const target = targetFor(exp.id) ?? { experienceId: exp.id };
                  removeTarget(exp.id);
                  setRemoved({ target, name: exp.name });
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {removed && (
        <div
          role="status"
          className="mt-2 flex items-center gap-2 rounded-sm bg-gray-100 p-2 text-sm"
        >
          <span className="flex-1">Stopped watching {removed.name}.</span>
          <Button
            type="small"
            onClick={() => {
              addTarget(removed.target);
              setRemoved(undefined);
            }}
          >
            Undo
          </Button>
        </div>
      )}

      {pausedCount > 0 && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">{pausedCount} paused.</span> Still
          watched and alerting; nothing is booked or moved for them.
        </p>
      )}

      {targets.some(target => target.passkey) && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Passkey strategy:</span>{' '}
          {passkeyStatus === 'unlocked'
            ? 'Disney confirmed every selected guest cleared the Tier 1 hold.'
            : 'Autopilot prioritizes the marked easy attraction, then waits for Disney to confirm every selected guest has cleared the Tier 1 hold after redemption.'}
        </p>
      )}

      {anyAction && (
        <>
          <p className="mt-2 text-sm font-semibold">
            {bookingsRemaining} of {actionBudget} actions left today.
          </p>
          <BudgetInput
            value={maxActionsPerDay}
            onCommit={setMaxActionsPerDay}
          />
        </>
      )}

      {/* The long form of what each chip means, folded: a person setting up
          a day reads it once; a person in the park has the summary line. */}
      {watched.length > 0 && (
        <Disclosure title="What these actions do">
          <div className="space-y-2 text-sm">
            <p>
              A return-time window limits what Autopilot will <em>take</em>, not
              what it tells you about: an attraction outside its window still
              alerts, so a window can never hide the fact that something came
              back.
            </p>
            {anyAutoBook && (
              <p>
                <span className="font-semibold">Automatic booking is on.</span>{' '}
                Autopilot will book the attractions marked above without asking,
                but only when the offered return time falls inside that
                attraction&rsquo;s window. It will not book an attraction it is
                already holding or still waiting on an answer for.
              </p>
            )}
            {anyAutoModify && (
              <p>
                <span className="font-semibold">Auto-move is on.</span> For
                attractions marked above that you already hold a reservation
                for, Autopilot will move it earlier when a better time appears
                &mdash; but only if the gain is at least 30 minutes, and never
                to a later time than you already have.
              </p>
            )}
            {anyBookThenMove && (
              <p>
                <span className="font-semibold">Book then move is on.</span> For
                attractions marked above, Autopilot books the first time offered
                &mdash; even outside your window &mdash; so you hold something,
                then works to move it into the window. A wide search finds
                availability far more often than a narrow one.
              </p>
            )}
            {pausedCount > 0 && (
              <p>
                <span className="font-semibold">Pausing</span> keeps an
                attraction watched and alerting while nothing is booked or moved
                for it &mdash; and it will not make Autopilot hold back on
                others. Use it to make sure a higher-priority attraction gets
                booked first.
              </p>
            )}
            {anyAutoSwap && (
              <p>
                <span className="font-semibold">Swap in is on.</span> When all
                three Multi Pass slots are taken and an attraction marked above
                appears, Autopilot gives up your <em>lowest-priority</em>{' '}
                reservation for it &mdash; preferring to let go of a non-Tier-1.
                The swap is a single request, so the old reservation is only
                released if the new one is secured. With a slot free it simply
                books instead.
              </p>
            )}
            {anyAction && (
              <p>
                Bookings, moves and swaps share one budget for the park day. It
                survives a reload and turning Autopilot off and on.
              </p>
            )}
          </div>
        </Disclosure>
      )}

      <h3>Lightning Lane attractions</h3>
      {watchable.length === 0 ? (
        <p className="text-sm text-gray-600">
          No attractions loaded yet. Go back and refresh the list first.
        </p>
      ) : (
        <ul>
          {unwatched.map(exp => (
            <li key={exp.id} className="flex items-center gap-2 py-1">
              <Button
                title={`Watch ${exp.name}`}
                color="bg-gray-200 text-black"
                onClick={() => {
                  addTarget({ experienceId: exp.id });
                  setJustAdded(exp.id);
                }}
              >
                <StarIcon />
              </Button>
              <span>{exp.name}</span>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
