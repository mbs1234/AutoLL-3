# Roadmap

Written 2026-09-16, against `main` at `787cff3`, version 0.5.0.

`docs/FUTURE.md` is the standing list of everything not done. This file is the
argument about what to do next and in what order, and it is shorter on purpose:
there are roughly ten weeks between now and the December freeze, worked in
evenings, with a full external review cycle around each change. Nine items fit.
Everything else is after the trip.

**How to read it.** Each item says what it is, why it earns time *before the
trip specifically*, what could go wrong, and — the part that matters — what
"done" observably means. Sizes are honest rather than encouraging: _small_ is an
evening, _medium_ is a session or two with tests, _large_ is a week and a
decision. Nothing here is scheduled.

**Nothing in this file is required.** The tool is usable today. This is what
would make it better, ordered by what it is worth on a park day.

---

## The three themes

**1. Never lose something silently.** Four places where the engine acts,
declines to act, or stops acting, and the screen in your hand does not say so.
That is the failure mode this project rates worst, and four of the nine items
below are instances of it. All four are small.

**2. Be there when inventory appears.** One genuinely new capability, and it is
ranked first: on the 7:00 a.m. morning a *future* park date's booking window
opens, the poller idles at forty-five seconds. That is the minute the trip's
headliners are won or lost.

**3. Make the December plan exist, and check the facts it rests on.** A December
plan cannot currently be built at all — and not for the reason `FUTURE.md` §3.2
gives. Three of the facts the plan depends on are unverified and checkable
before the freeze.

---

## Before the freeze

### 1. Burst at 7:00 a.m. when a future date's booking window opens — _medium_

**The gap.** `dropTimes`, `refillWindows` and `nextBookTimes` are all passed to
the poller as `undefined` unless the booking date is today
(`AutopilotProvider.tsx:1738-1743`), and the only other fast path is `tomorrow`
at a flat fifteen seconds. For a date three or seven days out, `cadence()`
therefore returns `idle` at `IDLE_INTERVAL_MS` = 45,000 — through the exact
instant that date's inventory opens. `BookingDateProvider`'s own comment already
describes the shape: with neither `watchingToday` nor `watchingTomorrow`,
"cadence never leaves the 45-second idle interval. No approach, no burst."
Meanwhile the status line reads exactly like a healthy run.

**Do it in two steps, and the first is not code.** Set the booking date three
and seven days out and log what `bookWindows` actually returns — specifically
whether the eligibility block for a date whose window has not opened carries a
usable instant, is absent, or carries a window meaning something else entirely.
Only then decide between feeding `ll.nextBookTimes` for future dates into
`cadence()` as it already does for today, and an explicit window-open burst
target.

**Risk.** A naive change fails in one of two silent directions: it bursts at
nothing, spending the shared `RateLimit(5)` at the worst moment of the trip, or
it does nothing because the eligibility block for an unopened date is absent.
Do not widen `bookingDate` itself to make this work — that is item 6's problem,
and conflating them puts the booker on a day Disney will refuse.

**Done means.** A `schedule.test.ts` case that fails on today's code: with a
future-date window-open target thirty seconds away, `cadence()` returns
`'burst'`; at 05:00 the same morning it returns `'idle'`. Plus the harness,
booking date three days out, showing burst across the window-open instant where
it shows idle on HEAD. Step A is done when the raw `bookWindows` response is
pasted into a comment beside the change, with the date it was captured.

**Where.** `src/autopilot/schedule.ts`, `src/providers/AutopilotProvider.tsx`,
`src/api/ll.ts`, `src/providers/BookingDateProvider.tsx`.

This is also the only item here that cannot be done later. After December it is
a feature for a trip that has happened.

### 2. Say on Today when the engine has stopped touching a reservation — _small_

An unresolved change is the state where the engine has deliberately stopped
acting and needs a human to open Disney's Plans. Since `787cff3` it is visible —
but only on Activity and Plan Check, two screens you must navigate to. Today is
the default tab and the one actually open while walking around a park.

So the park-day failure is: a move times out mid-afternoon, the engine correctly
quarantines the reservation and stops touching it, and the screen in your hand
says nothing. You find out an hour later, wondering why nothing has moved.

`useQuarantine()` already exists. Call it in Today and render a count and a
route, on the existing banner idiom. Keep it to a count and a link — putting the
resolve-confirm flow on two screens with different amounts of context around it
is how someone clears a real doubt by accident.

**Do the harness scenario first**, so the banner can be looked at rather than
reasoned about. Every piece exists and nothing connects them: `Script` already
carries `book: 'timeout'` and `plansFollow: false`, the fakes honour both, and
`HarnessApp` mounts the real provider — but the only scenarios using those
failure modes open the Time Search screen instead.

**Done means.** The new scenario at 360×780 shows the banner and it routes to
the panel; a Today test with a seeded quarantined mutation asserts the count.

### 3. Warn before a held pass lapses — and delete the grace scan that never existed — _small_

A lapsed pass counts exactly as a ridden one, so it costs the selection slot and
marks the attraction ridden for the rest of the day. Nothing notices one about
to lapse.

Half of this shipped in the review that produced this roadmap: Today used to
render "(grace scan until 1:59 PM)" against every held pass — 119 minutes past
the window, a number with no constant, no comment and no traceable origin,
describing engine behaviour that does not exist. That string is gone and a test
now forbids it coming back.

What remains is the real thing: one edge-triggered alert per pass when synced
park time is within N minutes of `end.time` and the pass is not redeemed, tagged
like the existing reopened alert, with the same countdown on Today's Held list.

**Risk.** N is a guess and stays one until December. Pick a number, name it, and
write in the comment that it is unverified — do not launder a guess into a
constant that reads as knowledge.

### 4. Name the attraction the Tier 1 hold is waiting for — _small_

The Tier 1 hold is the one guard in the whole tool that turns down a Lightning
Lane actually on offer, and the log will not say what for: `events.ts` renders
"held the Tier 1 slot for a better attraction", naming nothing. The call site
has everything it needs — the armed entries carry the full experience and its
drop times. Have `shouldHoldTierSlot` return the blocking entry instead of a
boolean and the log reads "held the Tier 1 slot for Slinky Dog Dash, drop at
1:17".

The companion half also shipped early with this roadmap: four skip reasons —
`waiting-to-retry`, `not-enabled`, `no-existing-booking`, `already-held` — were
declared, reachable, and had no label, so the activity log printed raw
identifiers at exactly the moment a user asks why nothing is booking. All four
are labelled and a test now derives the required set from the three declared
unions, so the next unlabelled reason fails the build rather than reaching a
screen.

### 5. Stop the pre-trip checklist claiming a readiness it never verified — _medium_

The checklist reads "Plan Check reviewed" the instant you tap Open, whatever
Plan Check reported — so a plan holding a blocker displays a green pre-trip
checklist. And because the flag is component state, it resets on every remount,
so the step silently un-ticks itself.

A readiness screen that claims readiness it never verified is the worst version
of the thing this project dislikes, on the screen whose entire purpose is the
week before the trip.

Four fixes to one screen: derive the step from `checkPlan()`'s actual result and
persist the acknowledgement per park and date; move the action button out of the
`!item.done` guard so a finished step can be reopened; give the
unrecognised-attraction-ID warning a row with a route into Configure; and add
the two missing steps.

**Risk.** `checkPlan` reports an unloaded tip board as a review item, which
pre-trip is most of the time — the copy must distinguish "not checked yet" from
"checked, with findings" or the row goes permanently amber and gets ignored.

### 6. Make a December plan possible — _large_

A December plan cannot be built today, and the reason is not the one
`FUTURE.md` §3.2 gives. §3.2 blames the add list needing a live tip board. The
harder wall is the **date**: `addTarget` stamps `date: bookingDate`,
`bookingDate` is clamped to twenty-two days by `NUM_BOOKING_DAYS`, and every
per-target edit is gated on `targetApplies(target, park.id, bookingDate)`. So a
target starred today is stamped `2026-09-16`, and `targetApplies` will refuse it
in December. Nothing in `FUTURE.md` or `PLAN.md` records this.

Three parts in strict order, because (b) and (c) are worthless without (a):

1. **Separate the date a plan is _for_ from the date the app is _booking_ for.**
2. Add a `Resort.experiences(park)` accessor and have Configure fall back to it
   when the tip board is empty.
3. Mark Single Pass attractions so an offline list cannot offer a watch that can
   never fire.

**Risk.** The booking date drives what gets polled, booked and reported.
Widening it so an unbookable date becomes selectable would put the poller on a
day Disney refuses. The safe shape is a plan date that is free and a booking
date that stays bounded.

**This is the item to cut first if the weeks run out.** Cut it and you plan from
the hotel the night before — the workflow that works today.

### 7. Run the late-November data check — _small_

This corrects `FUTURE.md` §3.3, which says re-verification "needs a live tip
board once the overlays are running, which is inside the freeze". It does not:
the public themeparks.wiki mirror needs no Disney session, and both overlays
start before the December freeze.

That matters because a stale overlay ID is not a mis-ranking. `LLClient.experiences()`
drops an unknown id inside a `try`/`catch`, so the attraction has no tip-board
row at all — it cannot be watched, booked or alerted on, silently.

One dated session in late November, ending in at most three one-line data edits:
the two holiday overlay IDs, Tiana's status, and the drop table. Run a second
overlay check about a week after the first.

**Risk.** It is a read for verification and must stay one — §7 forbids scraping
paid tables into the repository, and the line between checking and importing is
the whole constraint.

### 8. Count down to the drop the engine is actually bursting for — _small_

The tool's one structural advantage is being the thing that looks in the first
two seconds of a drop, and that only pays if the phone is out and foregrounded
when the drop lands. A static time does not get a phone out of a pocket; a
countdown and a chime at T−60s do. The AudioContext is already unlocked when
autopilot is switched on.

On the way, fix a real disagreement: Today's "Next drop" reads the *static*
table, while the poller times itself to the merged scheduled-plus-learned times.
Building a countdown on the current source would count down to a moment the
engine is not bursting for — a worse lie than the bare time.

**Risk.** A per-second re-render on the screen most likely to be open during a
burst. Keep it in its own component owning its own interval.

### 9. One housekeeping evening — _small_

Four small diffs, none changing shipped behaviour.

**(a) Record how long a change takes to land.** This is before-trip or never:
the December park days are the only chance to collect the sample, and PRs #33
and #34 already did the hard half. `Doubt.at` is the instant the mutating
request left the device, written from `MutationOperation.dispatchedAt` at the
transport boundary; `reconcile()` already receives `polledAt` and already
computes `landed()`. The start, the end and the contrary reads all pass through
one function. Write one capped log row the first time a doubt settles.

This is the measurement `FUTURE.md` §5.5 asks for, and §5 is explicit that it
must never become an automatic fail-open rule again. Write that into the
comment, because a timing distribution living next to `landed()` is exactly
where someone later adds "…and it has been five minutes".

**(b) Make the gate tell the truth.** Give `npm ci` an id in `check.yml` and
guard the following steps on its success rather than running all five under
`if: '!cancelled()'`, so a broken lockfile produces one red step instead of five.

**(c) Give the two long screen suites their own timeout.** `MultiPassList` and
`Home` exceed the 5s default under load — reproduced here at load average 245,
where one run in three failed on timeout alone with no logic change. CI runners
are shared too. Name the number and say what it is for.

**(d) Pause Dependabot until January.** Nine PRs stand open, at least two of
which can never go green on their own. Standing PRs nobody intends to merge are
how a red check stops meaning anything.

---

## After the trip

Ordered loosely by value, not by effort.

- **Automatic expiry rescue** — _large_. Build it as a synthesized hit through
  the existing booking path, not a second commit path. December supplies the
  fact the warning in item 3 cannot.
- **Extract one commit primitive and decompose `AutopilotProvider` around it** —
  _large_. The provider is the file every round of review keeps returning to.
- **A legend for the day timeline** instead of a truncated name in each bar —
  _medium_ (`FUTURE.md` §2.1, §2.2, §2.7 together).
- **Configure polish** — _small_. More than one removal in the undo; a Plan
  Check settings blocker that lands on the setting it names (§2.3, §2.4).
- **Extract the duplicated reservation-guard wiring behind one hook** — _small_.
- **A user-settable facility-ID override and a matching-only alias** — _medium_.
  The general answer to the two-ID rides; item 7 is the manual one for this trip.
- **Break ranking ties on the live standby wait** already on the tip board — _small_.
- **Prefer a reclaimable swap victim**, using drop data already shipped — _small_.
- **Let drop learning pay on a second observation within one park day** — _small_.
- **Per-target guest subset** instead of one global whole-party switch — _medium_.
- **Component tests for the Time Search recovery states** — _small_.
- **Port the day's-work screens back to AutoLL v1.1** — _large_. Not before
  December: the fallback build's value is that it is proven, and porting
  unproven screens into it inverts that.
- **Stamp the December 2026 facts and their source dates into the documents** — _small_.

---

## Deliberately not doing

`docs/FUTURE.md` §7 is the binding list. These are the ones this round
reconsidered and rejected again, so the next pass does not rediscover them:

- **Any cap on bookings or actions per day, in any form.** Removed 2026-09-14.
  Disney counts a *redemption*, not a booking.
- **Park hopping automation, Disneyland, virtual queues, drop demotion, a NextLL
  search surviving a tab switch, a live tier check on a park day.** All decided.
- **`useMemo` on `dayTimeline()`** (§2.6). Still literally true and still not
  worth it — and the document names the wrong cause.
- **A passkey role selector that books the earliest eligible non-Tier-1 on its
  own** (§3.12). One bad morning from spending the party's first slot on a
  filler. The hard half — the detector, on the authoritative signal — is built.
- **A "which three do I grab first at 7:00am" recommender** (§3.9). The honest
  version stays thin: the build has no observations of how fast return times
  slip, and scraping paid tables is forbidden.
- **Separating pop-up from earlier-time drops in the learner** (§3.5). Half done
  already; what is flat is the shipped table, not the event model.
- **Sampling per-guest ineligible reasons before the trip** (§5.1, §5.2). Another
  `guests` request against the rate limiter at the moment of the day it is
  needed most.
- **Writing code to answer Big Thunder's drop schedule** (§5.3). No work needed:
  `observe.ts` and `learned.ts` already record and summarise what is required.
  Let the park days answer it.
- **Crowd-level qualifiers on Animal Kingdom drop times** (§3.10). Changes
  nothing for this trip on the document's own premise.
- **A per-attraction sell-out-time table** (§3.7's data version). The code is
  small; the data has no permitted source.
- **A Single Pass booking flow.** Single Pass is a paid per-person purchase and
  is not what this tool does. The marker in item 6 exists only so an offline add
  list cannot offer a watch that can never fire.

---

## Questions only the owner can answer

**What are the actual December 2026 trip dates?** They are nowhere in the
repository, and three judgements above rest on inferring them from the December
freeze. Put them in `PLAN.md` §11 with the date recorded. If the trip starts
before roughly December 17, item 6 drops in urgency — the twenty-two-day picker
reaches those days with time to spare.

**Expiry rescue: build it before the trip on an unverified assumption, or ship
only the warning and let December supply the fact?** Recommendation: the
warning. It captures most of the park-day value — the phone says "Jingle Cruise
ends in 20 minutes and nobody has tapped in" while you can still act — without
betting an automatic action on a grace period nobody in this repo has measured.

**Item 1: API-driven or clock-driven?** Let the investigation decide. Prefer
API-driven if the instant is genuinely there; a clock-driven 07:00 trigger
avoids depending on the API but hardcodes a rule Disney can change and fires on
mornings when nothing opens.

**Item 6 is large and could eat the ten weeks.** Full plan-date model, the
narrow date-only version, or skip? Recommendation: the narrow version if the
trip starts after about December 17, skip if earlier. The date half is
load-bearing; without it nothing else about offline planning is real.

**Jingle Cruise and Jungle Cruise are two facility IDs for one ride.** Build the
alias, or arm both by hand in December? Recommendation: by hand for this trip,
and note the consequence in the park-day routine — if the overlay books, pause
the base-ID target so it does not try for a second pass on the same ride.

---

## How this relates to the other documents

`docs/PLAN.md` is the booking-intelligence reasoning and the record of what was
decided. `docs/UX-PLAN.md` is the same for the screens. `docs/FUTURE.md` is the
complete standing list of what is not done, including the items this roadmap
declines. This file is only the ordering argument, and it expires: revisit it
when the December dates are recorded, and again after the trip, when the park
will have answered several of the questions above for free.
