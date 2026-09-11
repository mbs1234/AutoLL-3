import { use, useEffect, useMemo, useState } from 'react';

import { Guests } from '@/api/ll';
import { REFILL_ACTIONS } from '@/autopilot/autobook';
import { PlanCheckLevel, checkPlan } from '@/autopilot/plancheck';
import Button from '@/components/Button';
import Screen from '@/components/Screen';
import { Time } from '@/components/Time';
import AutopilotContext from '@/contexts/AutopilotContext';
import BookingDateContext from '@/contexts/BookingDateContext';
import ClientsContext from '@/contexts/ClientsContext';
import ExperiencesContext from '@/contexts/ExperiencesContext';
import NavContext from '@/contexts/NavContext';
import ParkContext from '@/contexts/ParkContext';
import PlansContext from '@/contexts/PlansContext';
import { formatDate } from '@/datetime';
import useDataLoader from '@/hooks/useDataLoader';
import { RATE_LIMIT_EXCEEDED } from '@/ratelimit';

import Configure from './Configure';

const STYLE: Record<PlanCheckLevel, string> = {
  blocker: 'bg-red-100 text-red-900',
  review: 'bg-amber-100 text-amber-900',
  ready: 'bg-green-100 text-green-900',
};

const LABEL: Record<PlanCheckLevel, string> = {
  blocker: 'Fix before enabling',
  review: 'Review',
  ready: 'Ready',
};

/** A no-request review of the current Autopilot configuration. */
export default function PlanCheck() {
  const { park } = use(ParkContext);
  const { bookingDate } = use(BookingDateContext);
  const { ll } = use(ClientsContext);
  const { experiences, refreshExperiences } = use(ExperiencesContext);
  const { plans } = use(PlansContext);
  const { goTo } = use(NavContext);
  const { loadData, loaderElem } = useDataLoader();
  const {
    targets,
    bookingsRemaining,
    requireWholeParty,
    avoidOverlaps,
    dryRun,
    passkeyStatus,
    refillBudget,
  } = use(AutopilotContext);
  // Recomputed only when a fact it reads changes, rather than on every render
  // -- this screen stays mounted while Autopilot polls behind it.
  const items = useMemo(
    () =>
      checkPlan({
        targets,
        parkId: park.id,
        date: bookingDate,
        experiences,
        plans,
        bookingsRemaining,
        requireWholeParty,
        avoidOverlaps,
        dryRun,
        // Only a spent entitlement lifts the limit, which is what the
        // provider reports as `unlocked`. A merely configured passkey does
        // not, and treating it as if it did was the same mistake as reading a
        // reservation as evidence of a redemption.
        tierLimitLifted: passkeyStatus === 'unlocked',
      }),
    [
      targets,
      park.id,
      bookingDate,
      experiences,
      plans,
      bookingsRemaining,
      requireWholeParty,
      avoidOverlaps,
      dryRun,
      passkeyStatus,
    ]
  );
  const blockers = items.filter(item => item.level === 'blocker').length;
  const reviews = items.filter(item => item.level === 'review').length;

  function actOn(item: (typeof items)[number]) {
    if (!item.subject) return;
    if (item.subject.kind === 'tipboard') return refreshExperiences();
    if (item.subject.kind === 'budget') return refillBudget();
    if (item.subject.kind === 'targets') return goTo(<Configure />);
    return goTo(<Configure focus={item.subject} />);
  }

  const [party, setParty] = useState<Guests>();
  const [checking, setChecking] = useState(false);
  // A party answer is about one park and one date. This screen stays mounted
  // in the nav stack, so without this it could outlive both.
  useEffect(() => setParty(undefined), [park.id, bookingDate]);

  const ineligible =
    party?.ineligible.filter(g => g.ineligibleReason !== 'NOT_IN_PARTY') ?? [];
  // Nobody eligible is not the same answer as everybody eligible, and the
  // saved party can be absent from the response entirely -- stale ids from an
  // earlier trip come back stamped NOT_IN_PARTY and filtered out above, which
  // used to leave an empty list reading as a clean bill of health.
  const eligibleCount = party?.eligible.length ?? 0;
  const allEligible = !!party && eligibleCount > 0 && !ineligible.length;
  const nobodyEligible = !!party && eligibleCount === 0;

  function checkParty() {
    if (checking) return;
    setChecking(true);
    loadData(
      async () => {
        // This asks only for current party eligibility, scoped to the park
        // and date on screen. It never creates an offer and it cannot spend
        // an entitlement.
        setParty(await ll.guests(undefined, bookingDate, park));
      },
      {
        // Keyed by error name, which `useDataLoader` already supports. The
        // limiter is shared with the poller and with every other tap in the
        // app, and it throws rather than throttling -- left unmapped this
        // surfaced as "Unknown error occurred", which says nothing about the
        // one thing the user can act on.
        //
        // The constant, not `RateLimitExceeded.name`: that is the class's name,
        // which minification rewrites, so the key was "Kr" in the shipped
        // bundle while the thrown instance still reported "RateLimitExceeded".
        // The branch passed in jest and was dead in the only build anyone runs.
        messages: {
          [RATE_LIMIT_EXCEEDED]:
            'Too many requests just now. Wait a few seconds and try again.',
        },
      }
    ).finally(() => setChecking(false));
  }

  return (
    <Screen title="Plan check" theme={park.theme}>
      <p>
        {park.name} &mdash; {formatDate(bookingDate)}
      </p>
      <p className="mt-2 text-sm text-gray-600">
        This checks the plan already on this screen. It does not request offers
        or make a booking. Live eligibility is checked only if you ask below,
        and is always checked again immediately before every Autopilot action.
      </p>
      <h3>
        {blockers > 0
          ? `${blockers} item${blockers === 1 ? '' : 's'} to fix`
          : 'Plan review'}
      </h3>
      <p
        className={`mb-2 rounded-sm p-2 text-sm ${
          blockers ? STYLE.blocker : reviews ? STYLE.review : STYLE.ready
        }`}
      >
        {blockers
          ? `${blockers} blocker${blockers === 1 ? '' : 's'} need attention.`
          : reviews
            ? `${reviews} item${reviews === 1 ? '' : 's'} to review.`
            : 'Ready to run within the current safeguards.'}
      </p>
      <ul className="space-y-2">
        {items.map(item => (
          <li
            className={`rounded-sm p-2 text-sm ${STYLE[item.level]}`}
            key={item.text}
          >
            <span className="font-semibold">{LABEL[item.level]}:</span>{' '}
            {item.text}
            {item.subject && (
              <Button type="small" className="mt-2" onClick={() => actOn(item)}>
                {item.subject.kind === 'tipboard'
                  ? 'Refresh LL list'
                  : item.subject.kind === 'budget'
                    ? `Add ${REFILL_ACTIONS} actions for today`
                    : 'Open Configure'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <h3>Current party</h3>
      <p className="text-sm text-gray-600">
        Check whether the guests AutoLL-3 currently sees are eligible in
        general, at {park.name} on this date. Attraction-specific eligibility,
        inventory, and the actual offered time can change and remain protected
        by the final action checks.
      </p>
      <Button
        type="small"
        className="mt-2"
        disabled={checking}
        onClick={checkParty}
      >
        {checking ? 'Checking…' : 'Check current party'}
      </Button>
      {allEligible && (
        <p className="mt-2 rounded-sm bg-green-100 p-2 text-sm text-green-900">
          All {eligibleCount} guest{eligibleCount === 1 ? '' : 's'} in the
          current party are generally eligible.
        </p>
      )}
      {nobodyEligible && (
        <p className="mt-2 rounded-sm bg-red-100 p-2 text-sm text-red-900">
          No guests came back eligible. Check the party selection on the LL tab
          — the saved party may no longer be on this account.
        </p>
      )}
      {ineligible.length > 0 && (
        <div className="mt-2 rounded-sm bg-amber-100 p-2 text-sm text-amber-900">
          <p className="font-semibold">
            {ineligible.length} party member
            {ineligible.length === 1 ? '' : 's'} currently ineligible.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {ineligible.map(guest => (
              <li key={guest.id}>
                {guest.name} &mdash;{' '}
                {guest.eligibleAfter ? (
                  <>
                    eligible from <Time time={guest.eligibleAfter} />
                  </>
                ) : (
                  (guest.ineligibleReason ?? 'ineligible')
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {loaderElem}
    </Screen>
  );
}
