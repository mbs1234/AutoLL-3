# What is left

Written 2026-09-13, against AutoLL-3 at 0.5.0. Revised 2026-09-14 when the day's
action allowance was removed (§7) and the 2026-09-12 review's correctness list
was cleared (§1), and again on 2026-09-15, when every decision in §4 was
answered and a Time Search was given precedence over the engine — decided and
built the same day, so it is not listed below.

This is the standing list of what is not done: the items still open from
`PLAN.md` and `UX-PLAN.md`, the
defects the 2026-09-12 review confirmed and the fixes of that day did not
cover, the decisions waiting on an answer, the questions only a park day can
settle, and — at the end, deliberately — the things already decided against, so
they are not proposed again as fresh ideas.

The two plans keep their reasoning. This file keeps the work.

**How to read it.** Each item says where it lives in the code, how big it is,
and what could go wrong doing it. Sizes are honest rather than encouraging:
_small_ is an evening, _medium_ is a session or two with tests, _large_ is a
week and a decision. Nothing here is scheduled; the ordering at the end is a
recommendation, not a plan.

**The trip is in December 2026, and the last two weeks before it are a freeze.**
That is the constraint every judgement below is made against. The tool is
usable today; everything here makes it better, and nothing here is required.

---

## The short list

If only four things get done, these:

1. **Expiry rescue** (§3.1) — the largest recoverable loss the tool still does
   not catch: a lapsed pass costs a selection for nothing.
2. **Plan from the sofa** (§3.2) — a December plan cannot currently be built
   without a live tip board, which is the opposite of how this is meant to work.
3. **The timeline's names and tap targets** (§2.1, §2.2) — the day view cannot
   currently tell you which ride a bar is for.
4. **The overlay IDs** (§3.3) — a watch list built in October against the wrong
   Jingle Cruise ID matches nothing in December, silently.

The correctness list above them is empty: §1 was cleared on 2026-09-14, and
with it the four screen defects that used to sit in §2.

---

## 1. Correctness still outstanding

**Nothing, as of 2026-09-14.** Every finding this section carried has been
fixed. Recorded here rather than deleted, because the section numbers below are
referenced from `UX-PLAN.md` and from the ordering at the end of this file.

What went, in the order they were listed: a Time Search committing outside the
shared action ledger, so it and the top-level Autopilot could modify the same
held pass; Home's on-visible refresh dying at the first tab switch, because
`useScreenState` compared React elements by identity while `withTabs` replaced
the active element on every change; a refusal burst flooding the saved activity
log, because the merge key carried the collapsed row's most-recent time and so
read every rewrite as a new event; a timed-out booking rendered as
"Request failed (0)" against this project's own rule that a status-0 result is
an unknown outcome; and the mount-time drop summary omitting the watched-days
record, so the Activity screen said "(not watched yet)" about drops it had been
watching for days.

Each landed with a test, and each of those tests was checked against a reverted
fix to prove it fails without it.


## 2. The screens

From `UX-PLAN.md` §9 and the gaps its phase notes record.

### 2.1 The timeline truncates every target name

At 360 px the Targets column is split again for every simultaneous bar, so
three full-day targets get about 50 px each and every name is cut. What shipped
instead of a fix was a `title` tooltip, which a touchscreen never shows. A
picture of the day that cannot say which ride a bar is for is a picture of
nothing.

_Where:_ `src/components/ll/DayTimeline.tsx:89,120-166`. _Size:_ medium. _Risk:_
wrapping, a legend and fewer columns each change the geometry the clash colours
depend on — settle it in the harness at 360 px first.

### 2.2 Timeline bars are 14–20 px tall and are the tap target

A bar's height is its time extent floored at 3 percent of the rail. Tapping one
is now how you reach a card or a booking. Phase 2 proposed an enlarged
invisible hit area so the drawn geometry stays honest; it was never added.

_Where:_ `src/components/ll/DayTimeline.tsx:18,24,46`. _Size:_ small. _Risk:_
adjacent bars' hit areas overlapping.

### 2.3 A second removal inside the undo window destroys the first undo

The undo holds one removal in a single state slot. Tidying two rows in a row —
the ordinary way to hit it — loses the first target's window, rank and flags
with no way back.

_Where:_ `src/components/ll/screens/Configure.tsx:91-101,296-317`. _Size:_
small. _Risk:_ keep the flash to one row at a time, or the footer grows
unpredictably at 360 px.

### 2.4 A Plan Check settings item opens Configure and abandons you

`Configure` accepts a focus of `{kind:'target'}` or `{kind:'setting'}` and
reads only the target case, so following a settings blocker drops you at the
top of a long screen with no indication of what to change.

_Where:_ `src/components/ll/screens/Configure.tsx:65-67`. _Size:_ small. _Risk:_
the screen is `fixed inset-0` with its own scroll pane, so scroll to a ref
rather than a hash.

### 2.5 The pre-trip checklist is missing three steps and has no way back into a finished one

It ships five of its eight steps: party, targets, an action armed,
notifications, Plan Check. "Park and date chosen", "windows set where wanted"
and "unrecognised attraction IDs" are absent — the last exists on Today as a
standalone red paragraph with no route to fix it. And the action button renders
only for steps that are *not* done, so a finished step cannot be reviewed.

_Where:_ `src/autopilot/checklist.ts:30-68`,
`src/components/ll/screens/Today.tsx:219-235`. _Size:_ small. _Risk:_ "windows
set where wanted" has no objective done state — make it an acknowledgement, not
a test, or it will never go green.

### 2.6 The timeline recomputes the whole day on every tick

`dayTimeline()` runs in the render body, and in burst cadence the status
updates every 1.2 seconds while `NavProvider` keeps the screen mounted
underneath whatever is pushed on top. `UX-PLAN.md` asked for a `useMemo` in
Phase 0 and still records it as unadded.

_Where:_ `src/components/ll/DayTimeline.tsx:76`. _Size:_ small. _Risk:_ the
dependency list must include the held plans, or the timeline freezes after a
booking.

### 2.7 The timeline's tooltips are in 24-hour time

Every bar's `title` is built by interpolating a `ParkTime`, whose `toString()`
is zero-padded `HH:MM:SS` — so the string a screen reader takes as the bar's
description, and the only place a truncated name survives at all, reads
"20:15:00" where the bar itself shows "8:15 PM" through `<Time>`.

_Where:_ `src/components/ll/DayTimeline.tsx:123,163`, `src/datetime.ts:91-95`.
_Size:_ small. Fold it into §2.1, which is already rewriting how a bar carries
its name.

---

## 3. Booking intelligence

Outstanding items from `PLAN.md`, in the order they are worth doing.

### 3.1 Nothing rescues a Lightning Lane about to expire unredeemed — P3.3

Letting a pass lapse counts against you exactly as riding it does. When a held
pass's window plus grace is about to run out with no realistic chance of
getting there, modifying it onto a low-demand, always-available attraction
keeps the good one rebookable. It reuses `automodify.ts` wholesale; only the
trigger and the target differ.

_Where:_ `src/autopilot/automodify.ts:160-300`. _Size:_ medium. _Risk:_ it
spends an action on a pass you might still redeem, so the trigger has to be
late and conservative, and it must respect the same locks and budget as any
other move.

### 3.2 A target can only be added from a loaded tip board — P4.1's planning half

The booking-correctness half landed: targets carry park, date and your rank,
and the rank drives both the ordering and the Tier 1 hold. What did not land is
building the add list from the shipped data table, so on a plane or in a hotel,
with no tip board loaded, you cannot add a single attraction to a December day.

_Where:_ `src/components/ll/screens/Configure.tsx:87,275-300`. _Size:_ medium.
_Risk:_ the static table includes attractions Disney's tip board never returns;
a target added from it that can never match needs the "Not on today's list"
treatment rather than silence.

### 3.3 The December overlay IDs are unverified, and there is no alias — P4.7, §10.4

Jingle Cruise and Jungle Cruise are two IDs for one ride; so are Glimmering
Greenhouses and Living with the Land. Jingle Cruise runs the whole trip and
Glimmering Greenhouses from late November. A watch list built in October
against the wrong ID matches nothing in December — and the durable half of this
(the "Not on today's list" group) will tell you, but only after the fact.

_Where:_ `src/api/data/wdw.ts:295-302,707-712`. _Size:_ small. _Risk:_ the
re-verification needs a live tip board once the overlays are running, which is
inside the freeze — so treat it as a data check with a one-line data edit, not a
code change.

### 3.4 The next drop is a time, not a countdown — P4.5

Today shows "Next drop: 1:17 PM". The plan asked for a counting header and an
audible cue at T−60s. The chime already exists and the audio context is already
unlocked for alerts; it is wired to alerts only. The tool's whole advantage is
being the thing that looks in the first two seconds, and that only pays if the
phone is out and foregrounded when the drop lands.

_Where:_ `src/components/ll/screens/Today.tsx:300-316`,
`src/autopilot/alert.ts:71-140`. _Size:_ small. _Risk:_ a ticking countdown is
another re-render per second on the screen most likely to be open during a
burst — keep it in its own component.

### 3.5 Pop-up drops and earlier-time drops are one list — P2.7

`dropTimes` is a flat array. Public tracking separates "a sold-out pass coming
back" from "one that jumps an hour earlier"; they run on different schedules,
and some attractions only ever show the second kind. Once you hold a pass, an
earlier return time is the only thing that improves your day — and the burst
that would catch it is currently spent on the wrong schedule.

_Where:_ `src/api/data/wdw.ts`, `src/autopilot/learned.ts:53-101`. _Size:_
medium. _Risk:_ it changes the shape of a table upstream merges also write, so
an untagged entry must keep behaving exactly as it does today.

### 3.6 Drop learning needs two distinct park days — P2.9

`LEARNED_MIN_DAYS = 2` means a four-to-six day trip spends the first half
gathering and the second half barely acting. Accepting a second observation
from the same day at a different hour, when the minute-of-hour matches, follows
the actual recurrence pattern.

_Where:_ `src/autopilot/learned.ts:15,53-101`. _Size:_ small. _Risk:_ loosening
the evidence bar is how noise becomes a schedule. Drop detection already fires
on cancellation flicker, and this must never reach the Tier 1 hold — see §6.

### 3.7 Autoswap assumes any Tier 2 is cheap to give up — P3.6

The victim choice prefers a non-Tier-1 and then sorts by rank, with no notion
of how reclaimable an attraction actually is: some Tier 2s stay selectable for
ten hours, others are gone by 9am. A swap that trades away the one you could
not get back is a worse day than not swapping.

_Where:_ `src/autopilot/autoswap.ts:100-130`. _Size:_ small. _Risk:_ the honest
data source is this build's own observations, not a paid table — with one trip's
worth the numbers are thin, so the fallback must be today's behaviour.

### 3.8 "Which guests" is one global switch — P4.8

A height restriction or a nap makes one attraction a subset ride and the rest
whole-party, and the only way to say so today is to flip a global safeguard and
accept it everywhere.

_Where:_ `src/autopilot/watchlist.ts:20-60`. _Size:_ medium. _Risk:_ guest IDs
in the watch list are persisted personal data on Disney's own origin, and the
activity log was already trimmed once for leaking guest records. Store IDs,
never names.

### 3.9 Nothing answers "which three do I grab first" at 7:00am — P4.3

Booking earlier in your window buys dramatically earlier return times, and
`PLAN.md` calls the 7:00am moment the most important minute of the trip. It is
the one moment the tool gives no guidance for.

_Where:_ `src/components/ll/BookingDate.tsx`. _Size:_ medium. _Risk:_ the
prohibition on scraping paid tables stands, so the honest version stays thin
until the build has observations of its own. `PLAN.md` §12 names this the first
thing to cut.

### 3.10 Crowd-level qualifiers are not carried — P2.6

All five Animal Kingdom drop times carry a crowd-level qualifier in the source
they came from, and the data table carries none. For December this changes
nothing — Animal Kingdom will be crowd level 7 to 10 and all five fire. It
matters on an off-season day, when the poller bursts at five dead times.

_Where:_ `src/api/data/wdw.ts:1091-1120`. _Size:_ small. The clearest candidate
to leave until after the trip.

### 3.11 Live standby waits are not in the ranking — PLAN §8

Ties break on the static average wait from the shipped table. On a crowd-level
10 day the gap between a 40-minute average and a 110-minute actual is the whole
decision about which of two tied attractions to chase.

_Where:_ `src/autopilot/priority.ts:31-36`, `src/api/livedata.ts`. _Size:_
medium. _Risk:_ a new external dependency on the booking path's ordering.
`PLAN.md` §12 says do not start it after early November.

### 3.12 The passkey has a detector but no selector — P3.1

The hard half landed: the tap-in detector reads the authoritative signal —
`TIER_LIMIT_REACHED` disappearing for every selected guest — and is wired into
the provider. The role half did not. You mark one target by hand, and the flag
only moves that target to the front of hits that had already matched the watch
list; nothing seeks out the earliest-returning eligible non-Tier-1 regardless
of rank. The passkey move is the one every guide leads with, and it depends on
getting *something* early rather than on getting the right thing.

_Where:_ `src/autopilot/priority.ts:47-57`, `src/autopilot/passkey.ts:11-20`.
_Size:_ medium. _Risk:_ `PLAN.md` §12 left this unscheduled on purpose — the
hand-marked flag substitutes for it, and a selector that books the earliest
thing regardless of rank is one bad morning away from spending a slot on a
filler. If it is built, it has to be bounded to the pre-redemption window and
to attractions you marked as acceptable.

---

## 4. Decisions before code

**All four are answered as of 2026-09-15, and three of the four are answered
"leave it alone".** Nothing here is waiting on anybody. The items are kept with
their reasoning rather than deleted, because each says what would make the
question live again — and because a decision recorded only as silence gets
re-proposed as a discovery.

### 4.1 ~~Should a NextLL search survive a tab switch?~~ — UX-PLAN §6.3. No

NextLL mounts its own engine, so leaving the tab stops the search. Hoisting it
would let a quick search keep running while you look at your plans. The cost
has grown since the question was framed: the action-lock ledger now means two
pollers would have to arbitrate the same per-attraction locks — the collision
class §1 used to carry as its Time Search item, fixed on 2026-09-14 by making
that search take the engine's lock rather than commit outside the ledger. That
fix is the pattern a hoisted NextLL would have to follow, and it is why this
remains a decision rather than a straightforward port.

**Answered 2026-09-15: leave NextLL as it is.** A trip is the wrong week to find
out how two pollers share a lock ledger. What would make it live again is the
trip being over, or the arbitration being settled by something other than a
December park day.

### 4.2 ~~Turn drop demotion on?~~ — P2.3. No

The machinery is built and switched off. Five of the nine attractions with
built-in drop times show no reliable pop-ups in public data, and bursting at a
dead time wastes requests at the minute they are worth most. The stated
precondition is recording coverage per scheduled drop time rather than per park
day, so both counts derive from the same evidence.

**Answered 2026-09-15: leave demotion switched off.** `DEMOTION_ENABLED` stays
false. The evidence it would act on is still gathered and still shown on the
Activity screen, so nothing is lost by waiting; and the store starts empty and
needs three covered days, so a short trip barely reaches the threshold anyway.
Demotion is the only part of drop learning that can remove a real burst target,
which is the wrong thing to be discovering in December.

What would make it live again: coverage recorded per scheduled drop time rather
than per park day, so both counts derive from the same evidence, plus enough
observed days to mean something.

_Where:_ `src/autopilot/learned.ts:15-17,40-51,103-135`. _Size:_ medium.

### 4.3 ~~Will the December party use Park Hopper?~~ — P3.4. Dropped

**Answered 2026-09-15: no work needed.** The party will hold Park Hopper through
an annual pass, but intends one park per day and does not want hopping
automated. So the distinction this item asked for — `TOO_EARLY_FOR_PARK_HOPPING`
carries a time and should schedule a poll, `TOO_EARLY_FOR_NEXT_PARK` has no
timer and should suppress cross-park targets — has nothing to act on: a plan
that never crosses parks never meets either code.

Kept rather than deleted, with the reasoning, because holding a Hopper and not
using it is not the same answer as not holding one. If a day does turn into two
parks, the two codes are still handled identically and the item is live again.
Nothing else depends on it: watch targets carry their own park and date since
P4.1, so a one-park-a-day plan cannot produce a cross-park attempt by accident.

_Where:_ `src/api/ll.ts:111-126`. _Size:_ medium, if it ever comes back.

### 4.4 ~~Should the live tier check run on a park day?~~ — P3.5. No

The tier bundle is fetched and the divergence warning exists, but the fetch is
gated so it never runs on a day-of poll — deliberately, because the bundle
appends closed attractions and the drop learner would read them as inventory.
Tiers moved twice in the last twelve months, and December is exactly when a
stale flag would have the tool hold a Tier 1 slot for the wrong attraction.

**Answered 2026-09-15: leave the tier check as it is.** The fetch stays gated
off the day-of poll. The narrow version — fetch once at park open, use it for
the warning only, keep it out of the tip board the learner reads — is probably
right, and is what to build if this comes back; but it re-opens a path closed on
purpose, and the failure it guards against (a tier moving between now and
December) is less likely than the one it would introduce (the drop learner
reading a closed attraction as inventory). The static flags were verified twice
and are correct today.

_Where:_ `src/api/ll/wdw.ts:176,246-265`. _Size:_ medium.

---

## 5. Questions only the park can answer

`PLAN.md` §10 lists four. Three need a timestamped record that does not exist
yet, and instrumenting them is small work that has to land before the freeze or
it cannot be used at all.

1. **Does an expired, never-tapped first Lightning Lane free its slot?** Log
   the ineligible reason at the moment a window lapses. Until it is settled,
   treat an expected free slot as a hypothesis: try one offer, back off on
   `REDEMPTION_NEEDED` rather than burning the budget.
2. **Is tier release per-guest, and does it need a Tier 1 redemption?** Log
   `TIER_LIMIT_REACHED` before and after the first tap, ideally with a
   split-party tap-in.
3. **What is Big Thunder's post-reopening drop schedule?** Unmeasured. Let the
   learner run at approach cadence and see.
4. **Do the December overlay IDs still resolve?** See §3.3 — a data check, once
   the overlays are running.
5. **How long does Disney's itinerary take to show a change that has landed?**
   This no longer controls safety. An unresolved mutation does not clear on a
   timer or on repeated contrary reads; it clears only when Plans shows the
   exact requested result, a definitive late response arrives, or the user
   confirms what happened. The measurement is still useful for tuning the
   visible settling wait and the lease timings, but it must never become an
   automatic fail-open rule again.

   **Measure from the request leaving, not from a response arriving.** The
   obvious instrumentation — the gap between `book()` returning and the
   itinerary agreeing — measures the wrong population entirely: a commit that
   returned is a commit whose outcome is known, which is exactly the case a
   doubt never arises for. The interval that matters runs from the mutating
   request going out, or from its status-0, through to stable itinerary
   evidence. Log the send, log every subsequent plans read that does and does
   not show the change, and let the distribution of the ones that eventually
   appear set the window.

_Size:_ small, and it must be log lines rather than behaviour changes.

---

## 6. Testing and housekeeping

**The mutation-lifecycle gaps were closed on 2026-09-16.** Quarantined
reservations are visible in Activity and Plan Check, carry operation-specific
details, and have a two-step manual resolution after the user checks Disney's
Plans. Plan Check also warns when the browser lacks Web Locks rather than
silently degrading cross-tab exclusion. If durable quarantine storage fails,
the open page still blocks the reservation and says that the protection will
not survive a reload or coordinate another tab; the live renewal loop stops,
while its last lease record is left to expire normally rather than being kept
alive invisibly.

The named regression gaps are closed as well: `TimeSearch.tsx` has component
coverage for its mutation wiring, the real WDW client is tested forwarding that
control to both book endpoints, `daytimeline.test.ts` asserts the pure protected
span, and every durable/session storage key passes through a typed
`storageNamespace.ts` boundary. A source scan catches direct storage access and
handwritten namespaced literals, while notification tags have their own typed
`autoll3-*` namespace.

**The volatile quarantine is under-tested, as of 2026-09-17.** A review of
`787cff3` raised seventeen surviving findings and only two were defects; the
other fifteen were paths that can be deleted with the whole suite green. Four of
the most load-bearing were closed the same day — `renew()`'s quarantine gate,
`reconcile()`'s volatile pass, `resolveDoubt`'s volatile clear, and the shared
attraction-name rule. These remain open, all in the mechanism added that week:

- `activeVolatileQuarantine()` prunes the page-local store destructively on
  every read and nothing tests the predicate that decides what it drops.
- Promotion of a page-local doubt to durable protection, once storage recovers,
  is untested.
- `subscribeQuarantine`'s cross-tab `storage` listener has no test.
- `loadQuarantine()`'s deliberate swallow of a read failure has none either; its
  removal crashes Activity rather than failing a test.
- `settle()` in the provider's `finally` is the only thing stopping a deadline
  timer quarantining an already-successful mutation, and nothing covers it.
- The `return result.durable` both foreground search screens added is
  unverified: deleting it from both leaves the suite green.
- `TimeSearch.test.tsx` never pins *which* reservation the screen locks, so a
  wrong lease key would pass.
- `volatileQuarantine` is module state `beforeEach` cannot reset, so tests that
  touch it must clean up in a `finally` — three now do, by hand.

None is a known defect. They are places where a future change would break
something silently, which in this subsystem is the shape that has cost the most.

**One thing that pass established, worth keeping:** jsdom does no hit-testing,
so a test that "clicks through" an overlay passes with the overlay bug present.
Where the fix is a CSS property, assert the property; a behavioural test there
is a test that cannot fail.

**Nine Dependabot pull requests are open and none should be merged in a
hurry.** `.github/dependabot.yml` sweeps npm and GitHub Actions weekly, and all
nine date from 2026-09-09. The plan, decided 2026-09-15:

- **Merge now:** #7, jest 30.0.5 to 30.5.1. A patch bump on the test runner, and
  the only one where deferring buys nothing.
- **Close:** #9, TypeScript 5.9.2 to 7.0.2, the one red check. TypeScript 7
  removed `baseUrl` and forbids non-relative `paths`, and `tsconfig.json` uses
  both (`TS5102`, `TS5090`); the fix is to drop `baseUrl` and write
  `"paths": {"@/*": ["./src/*"]}`. Worth knowing that `tsc` never compiles the
  shipped code here — `build` is `vite build`, and `tsc --noEmit` is only the
  gate — so this changes what the gate catches, not what reaches the phone. That
  gate is still the only typecheck there is. A brand-new major three months
  before the trip is not worth it; Dependabot reopens it when someone is ready.
- **After the trip:** #5 `@eslint/compat`, #6 `@testing-library/jest-dom` and #8
  `@tailwindcss/vite`. #8 is the only npm bump with a user-visible surface — it
  generates the shipped CSS — so it wants a harness pass at 360 px rather than a
  merge on green CI.
- **After the trip, and one at a time while watching:** the four Actions bumps.
  #1 `checkout` and #3 `setup-node` are already partly stale, since `check.yml`
  and `deploy.yml` moved to v5 after these were opened and only
  `data-freshness.yml` is still on v4. #2 `upload-pages-artifact` and #4
  `deploy-pages` touch **only `deploy.yml`**, and `deploy.yml` runs on push to
  `main` — never on a pull request. Their green `check` therefore says nothing
  about them at all, and merging either is an unverified change to the two steps
  that publish the build. The deploy gates independently, so a failure leaves
  Pages serving the build already on the phone rather than breaking it; the cost
  is debugging a publish pipeline instead of booking Lightning Lanes.

Worth considering separately: moving the schedule to monthly, or pausing it
until January. Standing PRs nobody intends to merge make a red check stop
meaning anything.

**The port back to AutoLL v1.1 has not started.** Phase 1 deliberately kept the
new work in new files so the port would be cheap, and none of them exists in
that repository yet. AutoLL is the frozen build that still works if this one
breaks, and today it has none of the day's-work screens. The plan's own rule is
to port only after park use, so it cannot honestly start before the trip — and
the Walt Disney World narrowing must not be carried across.

---

## 7. Decided against — do not rebuild

These were considered and rejected with reasons. They are recorded so the same
idea is not proposed again as a discovery. The full arguments are in `PLAN.md`
§9 and `UX-PLAN.md` §8.

**Data and ranking.** A party-night date table for the Christmas Party and
Jollywood Nights — the 90-minute drop horizon already bounds the case, and a
wrong date silently suppresses real drops on an ordinary day. Deleting
DINOSAUR, removing TRON's priority, inventing one for Space Mountain, swapping
Frozen Ever After and Remy, swapping Tower of Terror and Toy Story Mania,
re-ranking Glimmering Greenhouses, demoting Jingle Cruise. A test asserting
every Tier 1 carries an average wait.

**Engine.** A day's action allowance — removed outright on 2026-09-14, and it
should not come back as a count of bookings. The cap's stated reason was that
"every action consumes a real entitlement", which is false: Disney counts a
*redemption*, not a booking, so an attraction can be booked, cancelled and
rebooked all day at no cost to what you may hold. `resolveBook`'s own comment
said so while the allowance contradicted it. What is genuinely one-way is a
*modify* or a *swap* — each gives up a held return time that may not come back —
and a day-count was a poor instrument for that: it let the harmless, frequent
kind (bookings) spend the budget, then locked out the booking the user actually
wanted. A runaway *request* loop was never its job either; `RateLimit(5)` and
its five-second cooldown exist for that and say so. If the one-way risk needs
bounding, bound moves and swaps on their own terms — see §3.7, which is the
honest version of it. A cascade model scoring offers by how much they delay the
next booking — the gate is 120 minutes from booking, not a function of the return
time you hold. Rejecting offers that land after park close — Disney does not
sell them, so the guard is a no-op. Feeding learned drop times into the Tier 1
hold — a false positive costs a wasted request in the cadence and a forfeited
Tier 1 in the hold. A Tier 1 guard on the future-date path — the obvious guard
deadlocks, because the hold only avoids deadlock when the better attraction has
a drop still ahead *today*.

**Screens.** "Suggest a safe window" on the timeline, and editing the timeline
in place — both would put a second opinion beside the booker's own predicate. A
sticky active-search banner across screens — it would describe something that
cannot be running.

**Scope.** Disneyland support and virtual queues. Scraping paid tables into the
repository. Anything whose purpose is to obtain more entitlements than Disney's
published rules allow.

---

## A suggested order

Nothing here is scheduled, but if the weeks are spent in this order the
expensive things land first and the freeze catches the cheap ones.

| When | What |
| ---- | ---- |
| ~~2026-09-14~~ | ~~All of §1, and the four screen defects §2 then carried~~ — done. The §2 numbers have moved since; do not read them across. |
| Now | §3.1 expiry rescue, with its tests |
| October | §3.2 planning offline, §2.1 and §2.2 the timeline, §2.5 the checklist |
| Early November | §4.2 and §4.4 decided and acted on, or explicitly dropped; §3.4 the countdown |
| Late November | §3.3 the overlay IDs against a live tip board; §5 instrumentation |
| December 6 → trip | Freeze. Full-day dry runs in the harness and in the park. |

Cut from the bottom: §3.11 live standby first, then §3.9, then §3.7.
