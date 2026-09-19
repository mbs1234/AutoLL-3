# Roadmap

Written 2026-09-16, against `main` at `787cff3`, version 0.5.0.
Trip dates recorded 2026-09-17; items re-checked against `b7f225f` the same day.

Three items name a commit or a line number. Those were verified still true at
`b7f225f`: the cadence inputs are still gated on `watchingToday`
(`AutopilotProvider.tsx:1795`), `useQuarantine()` is still absent from Today, and
`shouldHoldTierSlot` still returns a boolean. Anything here that stops being true
should be struck rather than quietly left standing.

`docs/FUTURE.md` is the standing list of everything not done. This file is the
argument about what to do next and in what order, worked in evenings with a full
external review cycle around each change.

**The app is not built for these trips.** The dates below decide *when* work
lands and *when* an assumption can be replaced by a measurement. They must not
decide what the app does. Every item here is written for "a future park date",
"a held pass", "a reservation in doubt" — never for December 22, and never for
Walt Disney World in one particular week. If an item can only be stated in terms
of a specific date, it is data maintenance (item 7) or it does not belong here.

**How to read it.** Each item says what it is, why it earns time now, what could
go wrong, and — the part that matters — what "done" observably means. Sizes are
honest rather than encouraging: _small_ is an evening, _medium_ is a session or
two with tests, _large_ is a week and a decision. Nothing here is scheduled.

**Nothing in this file is required.** The tool is usable today. This is what
would make it better, ordered by what it is worth on a park day.

---

## Two dates, and what each is for

**October 18–20, 2026 — a park trip to test the app.** Twenty-nine days out as
this revision is written. Several things this project has been reasoning about
for six rounds are unmeasurable from a desk and need a park day: how long
Disney's itinerary takes to show a change that landed, whether an expired
unredeemed pass frees its slot, and whether the Tier 1 limit lifts per-guest.

The fourth thing this file used to list beside them — what `bookWindows` returns
for a date whose window has not opened — does **not** belong there, and putting
it there is what pushed item 1 to the top of the list. It is readable from a
desk, today, in about twenty minutes: the tipboard is fetched for the *selected*
date, so moving the date picker three and seven days out and reading
`ll.nextBookTimes` (or the `eligibility.geniePlusEligibility` block in devtools)
answers it without a park, without a booking window, and without writing a line
of code. Do that before ranking anything, because an empty block settles item 1's
design on its own.

There is also a second, earlier date that this file previously missed entirely:
the October **booking** morning. The party is on-site (recorded 2026-09-19), so
the resort rule applies: 7:00 a.m. ET seven days before check-in, for the whole
stay (`docs/PLAN.md:269-271`). That is **2026-10-11**, and it books all three
October park days at once. That morning, not the trip, is both the only
pre-December chance to watch a window actually open and the moment the trip's
headliners are actually won — and it happens from home.

A correction, because the first of those was written here badly. This file
originally named `DOUBT_SETTLE_MS`, "still 120 seconds, reasoned rather than
measured". That constant does not exist: PR #33 deleted it, and the whole
clock-based settling path with it, the day before the sentence was written. A
doubt now clears on evidence or not at all, and `lease.ts` calls clearing one on
elapsed time "the second mistake". The measurement is still wanted — `FUTURE.md`
§5.5 asks for it — but it is a distribution to look at, **not a timer to
restore**. Anyone reading this as licence to put the 120 seconds back has read
the opposite of what happened.

The consequence for ordering: **instrumentation earns its place before features
do.** A park day with no logging is a park day spent. Anything that turns an
assumption into a recorded fact should land before October 18; anything that
acts on an assumption is better built after, on the fact.

It also means an earlier stability point than this file originally assumed. The
app wants to be in a known-good state on October 18 — not frozen, but not
mid-surgery either.

**December 22–28, 2026 — the trip the deadlines are set by.** A two-week freeze
puts the last change on **December 8**, and that is the figure to schedule from.
`PLAN.md` and `FUTURE.md` carried December 6 in three places, written before
these dates were known; they now say December 8 too. The two are not
interchangeable — see the arithmetic below, where December 28 first appears in
the picker on December 7, a day before one freeze and a day after the other.

One piece of arithmetic worth having written down, because an item below turns
on it. The booking-date picker offers today plus twenty-one days
(`NUM_BOOKING_DAYS = 22`), so December 22 becomes selectable on December 1 and
December 28 on December 7 — the last of them arriving about a day before the
freeze. The December plan can therefore be built in the picker, day by day,
during the first week of December. It works, with almost no slack, and it is the
workflow that works today.

---

## The three themes

**1. Never lose something silently.** Four places where the engine acts,
declines to act, or stops acting, and the screen in your hand does not say so.
That is the failure mode this project rates worst. Items 2, 3, 4 and 8 are
instances of it. Two are small; the other two turned out larger than this
document first priced them, and the pricing was wrong because it assumed screen
work where the honest fix reaches into the provider.

**2. Be there when inventory appears.** On the 7:00 a.m. morning a *future*
park date's booking window opens, the unattended poller idles at forty-five
seconds. This was ranked first on the mistaken belief that it covered the
booking morning. It does not: a hand-started Time Search already polls at 600ms
on any date, so an owner who is awake is covered by shipped code. Item 1 is
about the engine running with **nobody watching**, which is a real gap and a
quieter one.

**3. Let a plan exist before the booking window does, and check the data it
rests on.** A plan for a date more than twenty-two days out cannot currently be
built at all — and not for the reason `FUTURE.md` §3.2 gives. Separately, three
facts in the shipped data are unverified and checkable without a park.

---

## Before the trips

Every item below was re-verified against the code on 2026-09-19 and every one
of them had drifted — wrong line numbers, a misattributed commit, halves that
had already shipped, and in two cases a **Done means** test that passes on HEAD
today and would therefore have proved nothing. What follows is the corrected
text. Where a claim in the old version was simply false it has been deleted
rather than softened.

Numbers are kept as stable identifiers, because they are referenced across
these items, in `docs/` and in commit messages. They are no longer priority
order. Priority order is:

| order | item | why here |
|---|---|---|
| 1 | **2** — engine stopped touching a reservation | the only one that is pure gain: under an hour, no unknowns, and it removes a screen that actively misleads |
| 2 | **3** — warn before a held pass lapses | half already shipped; the predicate it needs already exists |
| 2 | **5** — pre-trip checklist over-claims | a checklist that says ready when it has not checked is worse than none |
| 4 | **1** — future-date burst, unattended | demoted: the attended case already ships. Blocked on one reading |
| 4 | **4** — name the Tier 1 hold's attraction | re-priced _medium_; provider work, no October deadline |
| 6 | **8** — the drop the engine is bursting for | re-priced _medium_. Its cheap honesty half is worth taking alone |
| 7 | **9** — the housekeeping evening | (b)(c)(d) are one evening; (a) needs a decision first |
| 8 | **7** — late-November data check | calendar-blocked until ~Nov 27; nothing to do before then |

Item 6 has moved to *After the trip*.

### 2. Say on Today when the engine has stopped touching a reservation — and stop it saying the opposite — _small_

An unresolved change is the state where the engine has deliberately stopped
acting and needs a human to open Disney's Plans. It is visible on Activity and
Plan Check, two screens you must navigate to. The attribution in this file was
wrong: `useQuarantine()`, `QuarantinePanel` and both call sites arrived together
in `3beeae7` (#33), not `787cff3`, which only hardened the panel afterwards.
The substance is unchanged and still true at `767ea4b` — Today, the default tab
and the one actually open while walking around a park, does not call the hook.
`grep -rn 'quarantin' src/components/ll/screens/Today.tsx` is empty across its
388 lines, and `lease.ts:517` still documents its own consumers as "for Plan
Check and Activity", a docstring that needs correcting the moment Today becomes
a third one.

This file used to say that on a park-day timeout "the screen in your hand says
nothing". That is wrong, and wrong in the direction that makes the item worth
more. Today says something, and what it says is false. `acquire()` refuses a
quarantined key outright (`lease.ts:718`), so every later tick that gets as far
as the lease takes the `bumpSkip('already-attempted', experience.name)` branch
(`AutopilotProvider.tsx:1265`); `SKIP_TEXT['already-attempted']` is "a booking
for it was already held or in flight" (`events.ts:20`); `newestAction` sorts
that fresh skip above the older `failed` booking-log entry (`events.ts:113`);
and `latestActivity` (`events.ts:135`) is the only account of the engine Today
renders (`Today.tsx:98` and `Today.tsx:186`). So the line under the autopilot
switch settles on "Skipped Haunted Mansion: a booking for it was already held or
in flight" — a reservation the engine has permanently abandoned, reported as
one it is actively working on. The park-day failure is not an hour of silence;
it is an hour of reassurance. That chain is read from the source rather than
watched; the harness scenario below is what confirms it end to end.

`useQuarantine()` already exists (`src/autopilot/useQuarantine.ts:10`) and has
exactly two callers. Call it in Today and render a count and a route, on the
existing banner idiom. Keep it to a count and a link: `QuarantinePanel` carries
"Clear this protection" (`QuarantinePanel.tsx:128-132`) and "I checked Disney --
resolve this" (`:155-157`), and `resolveDoubt` un-blocks `acquire()`, so the
engine re-attempts the change on the next tick. That two-tap flow belongs beside
Activity's context, not beside the on/off switch where a thumb in a queue can
reach it.

**The one real decision.** The two existing surfaces disagree and Today has to
pick. Activity shows every doubt (`Activity.tsx:46,62`); Plan Check filters on
the picker, `doubts.filter(doubt => doubt.date === bookingDate)`
(`PlanCheck.tsx:59-60,206`). A doubt does not accumulate forever --
`loadPersistedQuarantine()` drops any key whose park date is behind `parkDate()`
(`lease.ts:244`) and `activeVolatileQuarantine()` does the same — so unfiltered
cannot go permanently stale; it can only talk about a day other than the one on
screen. Filtered does the more dangerous thing: it hides a live doubt about
*today's* reservation whenever the picker sits on a future date, which is the
normal pre-trip state and the state the app is in right now. What would settle
it is a park day's worth of real doubts to look at, and October is the first
chance to collect any. Until then, filter the count on `bookingDate` and give an
off-date doubt its own differently worded line, so nothing is hidden outright.
Route to Activity, not Plan Check: Today's two existing Plan Check buttons both
call `setPlanChecked(true)` on the way (`Today.tsx:197` and `Today.tsx:237`), so
sending a red alert through Plan Check would tick the pre-trip checklist's "Plan
Check reviewed" step as a side effect of reading an alarm — item 5's exact bug,
newly installed. Activity also renders the panel unfiltered, so a count that
disagrees with the panel it links to cannot arise.

**Do the harness scenario first**, and not only so the banner can be looked at.
A jsdom test with a seeded `quarantine()` call proves the component renders; it
does not prove the engine still reaches `quarantine()` on a dispatched-then-
failed commit. That is the half most likely to be skipped, because the jsdom
test is so cheap, and skipping it leaves a banner that passes its test and never
appears on a real timeout. Every piece exists and nothing connects them:
`book: 'timeout'` throws a status-0 `RequestError` after `control.onDispatch()`
(`harness/fakes/clients.ts:172-180`), which is exactly the `current.dispatched
&& outcome?.status === 'failed' && !outcome.rejected` classification that raises
the doubt (`AutopilotProvider.tsx:1431-1437`); the tipboard advertises Haunted
Mansion at `inMinutes(20)` (`harness/fakes/world.ts:138`) while `seedPlans()`
holds it at `inMinutes(60)` (`:244`) and `dayPlan()` saves
`target(IDS.hauntedMansion, { autoModify: true, rank: 2 })`
(`harness/scenarios.ts:65`), so the real engine attempts the move on the first
poll with no static `autopilot` override; `seedCommon()` already writes
`HOME_TAB_KEY` as `'Today'` (`scenarios.ts:74`), so a scenario with no `screen`
lands there, though it must add the `saveWatchList(dayPlan())` that `seedCommon`
leaves out; and `enabled` starts `false` and is not persisted
(`AutopilotProvider.tsx:216`), so the blurb has to say to turn autopilot on, the
way `dry-run`'s does. The two scenarios that already use the failure modes both
carry `screen: 'timesearch'` (`scenarios.ts:312` and `:321`) — none lands on
Today with a doubt raised. `DEFAULT_FRAME` is already `'360x780'`
(`harness/frames.ts:13`).

**Done means.** Unlike item 1's, this item's original test does fail on HEAD:
nothing renders a banner, and `npx jest src/components/ll/screens/Today.test.tsx`
is 33 green with no hit for `quarantin` anywhere in the file. Keep it and add
the half that names the falsehood. First, the new scenario, started from Today
at 360×780 with autopilot switched on, raises the doubt through the engine,
shows the banner, and the link lands on the panel. Second, a Today test seeded
the way `Activity.test.tsx:142-150` seeds one — `leaseKey(BZ, parkDate())`,
then `quarantine(key, { id: 'move-1', kind: 'modify', ... })` — asserts the
count; `renderScreen` from `screenTestSetup` is already the Today suite's
harness (`Today.test.tsx:16`) and `nav.goTo` is already a mock its tests assert
against. Third, with that doubt seeded and an `already-attempted` skip recorded
for the same reservation, Today does not offer "a booking for it was already
held or in flight" as its account of that reservation. The third is the
assertion that fails today for the right reason.

### 3. Warn before a held pass lapses — _small_

A lapsed pass costs the slot and the attraction. The party holds at most three
Multi Passes at a time, and a window that closes unredeemed spends one of those
three exactly as riding would. Nothing in the tool notices a pass approaching
its `end.time`, and nothing on Today says how long is left.

The deletion half is finished, and the title no longer carries it. Today used to
render "(grace scan until 1:59 PM)" against every held pass — 119 minutes past
the window, a number with no constant, no comment and no traceable origin,
describing engine behaviour that does not exist. That string is gone from every
source file in `src/` and `harness/` in both repos; `Today.test.tsx:200`, `it('does
not promise to watch a pass it is not watching')`, forbids both the phrase and
the 13:59 timestamp it produced; and AutoLL-4's `Today.tsx` is byte-identical, so
the deletion is already merged downstream.

What remains is smaller than the roadmap made it look, because the hard predicate
is already shipped and tested. "The pass is not redeemed" is `isHeldMP` at
`src/autopilot/autoswap.ts:79-88` — `isLLMP(booking) && parkDate(booking.start) ===
date && !!booking.cancellable && booking.guests.length > 0 &&
!isMultipleExperiences(booking)` — where the `guests.length > 0` clause carries
the redemption signal, because the parser drops guests with `redemptionsRemaining
=== 0` (`src/api/itinerary.ts:319`). The provider already calls the list form on
every tick: `let allHeldToday = heldMPToday(currentPlans, date)` at
`src/providers/AutopilotProvider.tsx:720`, alongside `const nowTime =
syncedParkTime()` at `:917`, and `secondsUntil` (`src/autopilot/schedule.ts:137`)
measures from a 4am day start so a window ending after midnight still subtracts
correctly. The alert needs no new request, no new poll and no new data: a `Set`
ref in the shape of `alertedRef` (`:271`) plus a `fireAlert` tagged per pass in
the shape of the reopened alert (`:651-655`) is the whole engine side.

Two things will make it fail silently if they are not written down. First, the
tick's `date` is `bookingDateRef.current` (`:590`) — the *selected booking date*,
not today. A check built on the existing `allHeldToday` goes quiet the moment the
picker sits on a future day, which is precisely what someone standing in the park
planning tomorrow has done. `plans` is stored unfiltered by date
(`src/providers/PlansProvider.tsx:19, 52`), so the correct call is
`heldMPToday(currentPlans, parkDate())`. One word of difference, and the wrong one
has no symptom.

Second, Today's Held list is not the list of live passes and must not be treated
as one. `Today.tsx:102-105` filters on bare `isLLMP(booking) &&
parkDate(booking.start) === bookingDate` — no `cancellable` check, no
`guests.length` check, no MEP check, and keyed on the selected date rather than
`parkDate()` — and it does that deliberately, with the comment at `:99-101`
arguing that "hiding one would hide a slot that is spent". A countdown attached
to that list as the old wording described would count down on a ride the party
has already been on, which is how a real warning gets ignored. The one owner
decision here is whether to narrow that filter or to leave the list alone and
suppress the countdown per row on `isHeldMP(booking, parkDate())`. The second is
the smaller diff and preserves the spent-slot visibility the comment argues for.
Neither choice blocks starting.

**Risk.** The old risk paragraph conflated two different numbers. N, the warning
lead time, is a usability choice about how long someone needs to walk to a ride;
no Disney fact sits behind it and October cannot observe it. The unmeasured fact
is the *grace period* past `end.time` — how late a turnstile still accepts a
pass — and it decides whether `end.time` is even the right anchor at all. That
one can only be observed by deliberately tapping in late at a real turnstile,
which is something to choose to do in October, not something the trip produces on
its own. So: ship N as a named, explicitly-unverified constant now, and record the
grace-period observation as a separate October decision rather than as a reason to
wait.

The sharper risk is that the alert exists only while autopilot is on. The tick
that would fire it does not run when the poller is off, and `alertedRef` is wiped
on every enable (`:1837`), so a party that has booked its three passes and
switched autopilot off — exactly the party about to let one lapse — gets nothing,
and nothing on screen says the warning is off. The Today-side countdown is
therefore the half that must not depend on the poller; build that first and treat
the notification as the addition, not the reverse. Related: the redeemed signal is
only as fresh as the last plans poll (`PLANS_EVERY_N_TICKS = 10` at `:152`,
`IDLE_INTERVAL_MS = 45_000` at `schedule.ts:63`, so roughly 7.5 minutes at idle
cadence), which means a pass tapped in minutes ago can still fire once. The copy
has to survive being slightly wrong — "window ends in 20 min", a reminder — and
must never read as a promise that anything will act. This item sits in the
never-lose-something-silently theme, and the specific way to fail it is to make
the screen imply something is being watched when it is not, which is the exact sin
the deleted string committed.

**Where.** `end` is declared `end: DateTime` on `LLMP` (`src/api/itinerary.ts:66`),
but the parser can return `{ date }` with no `time` for a pass carried over from
an earlier park day (`:311-314`). `Today.tsx:323-325` already guards that and says
why — an unguarded deref "would throw and take the provider above down with the
screen" — and a new call site in the provider inherits no such guard. The
fixtures need nothing new: `createBooking`'s `startTime` option
(`src/__fixtures__/ll.ts:127`) and the harness equivalent
(`harness/fakes/world.ts:199-200`) both set `end` to one hour after start, so a
near-lapse pass is one argument away in each.

**Done means.** The old section had none. A Today test seeding a pass whose `end`
is twenty minutes out asserts a countdown on that row; it fails on HEAD, because
`Today.tsx:321-335` renders the name and `<Time>` start-to-end and nothing else.
Its companion — no countdown on a spent pass — passes vacuously today, since
nothing renders a countdown at all, and only becomes a real assertion once the
first half lands, which is why it belongs in the same commit rather than as
evidence of anything now. On the engine side, an `AutopilotProvider.test.tsx` case
with the booking-date picker on a future date and a pass ending *today* in fifteen
minutes asserts `fireAlert` is called exactly once; that fails on HEAD because
nothing fires, and fails again against a naive fix built on `allHeldToday`, which
is empty in that scenario.

### 5. Stop the pre-trip checklist claiming a readiness it never verified — _medium_

The checklist ticks "Plan Check reviewed" the instant you tap Open, whatever
Plan Check reported. Both entry points — the header button at `Today.tsx:194-202`
and the row's own button at `Today.tsx:236-238` — call `setPlanChecked(true)`
*before* `goTo(<PlanCheck />)`, so nothing `checkPlan` computes can reach the
flag. `checklist()` could not use it if it did: its entire input is
`{partySize, targets, notifications, planChecked}` (`checklist.ts:10-21`), and
it renders `done: planChecked` with `'Plan Check reviewed'` at
`checklist.ts:61-67`. A plan holding a blocker ticks exactly like a clean one.

An earlier draft of this item said such a plan "displays a green pre-trip
checklist". It does not, and that distinction is most of the work. The
checklist has no colour at all: the section is `bg-gray-100` (`Today.tsx:213`)
and every row is `{item.done ? '✓' : '○'}` (`Today.tsx:224`). Green and amber
belong to Plan Check's own `STYLE` map (`PlanCheck.tsx:25-29`). So the old risk
paragraph — "the row goes permanently amber and gets ignored" — assumed a
severity vocabulary this checklist does not possess. Deriving the row from
`checkPlan()` means inventing one, and that is the part of this item carrying
the most copy decisions, not a detail to settle while coding.

"It resets on every remount" is true and misleading about which path. Pushing
Plan Check and coming back does *not* remount Today: `NavProvider.tsx:103-112`
renders every stacked screen and merely sets `hidden` on the inactive ones, so
the tick survives the round trip that sets it. Anyone testing the bug that way
will fail to reproduce it and conclude it is already fixed. The paths that do
reset it are a tab switch — `withTabs.tsx:12-19` calls
`goTo(<Tabbed tabName={name} />, { replace: true })` and `Home.tsx:89` then
renders `<tab.component ref={ref} />` with a different component type, which
unmounts Today — and a page reload.

**The over-claim this item missed is the worst one.** `planChecked` is never
reset when the park or the booking date changes. Today's only `useEffect` is
the one-minute clock at `Today.tsx:92-95`; nothing watches `park.id` or
`bookingDate`. Compare `PlanCheck.tsx:139`, which does
`useEffect(() => setParty(undefined), [park.id, bookingDate])` for precisely
this reason. Review Magic Kingdom / December 22, change either control in the
header, and the checklist still reads "Plan Check reviewed" for a plan nobody
has checked. That is a sharper instance of this item's own thesis than either
failure it named, and "persist the acknowledgement per park and date" only
fixes it if whoever implements it notices it needs fixing.

**The work.** Three fixes and one new step, not four and two. Derive the
plan-check row from an actual `checkPlan()` result and persist the
acknowledgement under a key encoding park and booking date; move the action
button out of the `!item.done` guard at `Today.tsx:226` so a finished step can
be reopened; give the unrecognised-attraction-ID warning a checklist row with a
route into Configure — today it is a bare red paragraph at `Today.tsx:272-278`
that tells you to open Configure and gives you no button to do it, from the
count at `Today.tsx:129`. Of `FUTURE.md` §2.5's three missing steps, "windows
set where wanted" is a genuine acknowledgement step, but **"park and date
chosen" should not be built.** It cannot be false where the checklist renders:
`ParkProvider.tsx:35` blocks children behind `ParkInitializer` until a park
exists, `BookingDateProvider.tsx:39-40` coerces `bookingDate` to a valid value
unconditionally, and the section renders only when the date is not today
(`Today.tsx:211`). It would also duplicate `ContextStrip.tsx:29-31`, which
prints park and date as Today's subhead one line above (`Today.tsx:169`) and
did not exist when that eight-step list was written. A step that is always
green is decorative reassurance on the one screen whose whole complaint is
decorative reassurance.

**Done means.** This item carried no test before, and the suite currently
asserts the bug: `Today.test.tsx:85-96`, "marks Plan Check reviewed after
opening it from the checklist", clicks Open on the row and asserts it then
reads "Plan Check reviewed". `npx jest src/autopilot/checklist.test.ts
src/autopilot/plancheck.test.ts src/components/ll/screens/Today.test.tsx` is 3
suites, 62 tests, all green at `767ea4b` — so a fix that only adds tests
leaves a green suite contradicting itself. That test has to be rewritten, not
supplemented. Two assertions that fail on today's code: render Today with a
future booking date and a target `checkPlan` returns a blocker for, open the
row and come back, and assert the row does **not** read as reviewed — it fails
now because the row ticks unconditionally; and tick the row, change
`bookingDate`, and assert it un-ticks — it fails now because nothing clears
the flag.

**Risk.** Four traps, in the order an implementer meets them. First,
`targetsHere` is already destructured at `Today.tsx:64-77` and is the tempting
argument to `checkPlan` — do not use it. `AutopilotProvider.tsx:1884-1891`
filters it by the loaded tipboard, so `plancheck.ts:140-150`'s blocker, "X is
not on the loaded tipboard, so it cannot be watched or acted on", can never
fire against it, and the new derived row would certify a plan in exactly the
place the old flag did. Pass the unfiltered `targets`, which is on the same
context (`AutopilotContext.ts:56`) and merely not destructured. Second, do not
persist with `kvdb.setDaily`: `getDaily` returns a value only while
`date === parkDate()` (`kvdb.ts:31-34`), and a pre-trip acknowledgement is made
days before the date it is about, so one made on October 11 for October 18
would evaporate at the next park-date rollover — the same silent un-tick on a
slower clock. The repo already records this failure once, in the comment at
`nextll.ts:28-33`, which is why that file carries its own date field beside
`getDaily`/`setDaily` (`nextll.ts:56,63`). Use plain `kvdb.set` with a
`storageKey()` (`storageNamespace.ts:33-38`); the guard at
`storageNamespace.test.ts:31-64` now reads test files too, so no literal prefix
anywhere. Third, the risk the earlier draft named is real: `plancheck.ts:112-119`
pushes a `review` item whenever `input.experiences.length === 0`, which
pre-trip is nearly always, so a naively derived row sits permanently at the
warning level and stops being read. Fourth, memoise the call --
`PlanCheck.tsx:64-92` wraps `checkPlan` in a `useMemo` for a screen that is
merely mounted behind the poller, while Today re-renders on every status tick
and burst cadence is `BURST_INTERVAL_MS = 1200` (`schedule.ts:38`), which is
the same complaint `FUTURE.md` §2.6 files against `dayTimeline()`.

**Not known.** Two owner decisions belong before the code, not during it. What
does the plan-check row say in the three states that will now exist — never
opened, opened with blockers, opened and clean — given that "the tipboard has
not loaded" is the ordinary pre-trip answer and has to read as *not checked
yet* rather than as a finding? And is a fourth state, "checked, then the plan
changed", worth distinguishing from never-checked, or should a park or date
change simply clear the tick? Nothing technical is blocking: `renderScreen`
(`screenTestSetup.tsx:61-168`) already supplies every context `checkPlan`
needs, and no new request is involved. What would settle the copy fastest is a
harness scenario that does not exist — `pretrip`
(`harness/scenarios.ts:232-244`) puts the booking date five days out with a
clean plan, and `plancheck` (`harness/scenarios.ts:245-273`) stamps its
blocking targets `date: parkDate()`. Neither gives a future date *and* a
blocking plan, which is the only way to look at the corrected row instead of
reasoning about it.

**Where.** `src/components/ll/screens/Today.tsx` (the flag, the checklist
block, the unrecognised-ID paragraph), `src/autopilot/checklist.ts`,
`src/autopilot/plancheck.ts`, `src/components/ll/screens/PlanCheck.tsx`, plus
`src/components/ll/screens/Today.test.tsx` and `src/autopilot/checklist.test.ts`.
`FUTURE.md` §2.5's own _Where_ is stale: it cites `Today.tsx:219-235`, but the
block is `Today.tsx:211-249` with the `!item.done` guard at `226-244`.
`checklist.ts:30-68` is still correct.

### 1. Burst for a future date's booking window in the unattended engine — _medium_

**Half of this already ships, and it is the half the booking morning uses.**
`NextLLChooser` mounts its own `AutopilotProvider` with `rapid`
(`src/components/ll/screens/Home/NextLL.tsx:99`), and `cadence()` short-circuits
on `rapid` at `src/autopilot/schedule.ts:158`, before any `watchingToday` gating
can matter. A hand-started search therefore polls at `RAPID_INTERVAL_MS` = 600ms
whatever date it is working on, and the screen says which one: "Working on
{bookingDate}, not today." (`NextLL.tsx:437-439`). An owner awake at 7:00 with
NextLL running is already covered at a faster cadence than this item would ever
give them. What is left is the **unattended background engine** — the poller
running with nobody watching — and the item should be read that way throughout.

**The gap that is left.** `dropTimes`, `refillWindows` and `ll.nextBookTimes`
are passed to `usePoller` as `undefined` unless the booking date is today
(`src/providers/AutopilotProvider.tsx:1792`, `:1797-1801` — the old citation of
`1795-1799` has moved). The standing comment at `:1787-1791` makes that discard
deliberate rather than an oversight. The only other fast path is `tomorrow`,
which `cadence()` serves at `TOMORROW_INTERVAL_MS` = 15,000 and only between
07:00 and 22:00 (`schedule.ts:159-161`). For a date three or seven days out
`targets` is `[]` (`schedule.ts:164`), so the poller falls through to `idle` at
`IDLE_INTERVAL_MS` = 45,000 (`schedule.ts:63`, `:200`) through the exact instant
that date's inventory opens, and the status line reads like a healthy run. The
`BookingDateProvider` comment this item used to quote is still accurate and
still current (`BookingDateProvider.tsx:76-78`), but it was written about a tab
left open across 4am still holding *yesterday*, not about a deliberately chosen
future date. The mechanism is shared; the case is not.

**Step A is smaller than this item used to claim, and needs no code.** Half the
question is already answered by the code: the tipboard is fetched for the
*selected* date (`ExperiencesProvider.tsx:68` passes `bookingDate` into
`ll.experiences`), and `ll.nextBookTimes` is reassigned unconditionally on every
poll from `bookWindows(data.eligibility, date)` (`ll.ts:330`), which reads
`eligibility.geniePlusEligibility[date].flexEligibilityWindows` keyed by the
date that was requested (`ll.ts:246-251`). A future date's windows are already
parsed and sitting on the client; they are thrown away one line later at
`AutopilotProvider.tsx:1801`. So step A is not an instrumentation build, it is:
move the date picker three and seven days out and read `ll.nextBookTimes` off
the live client. The genuinely open question is what the *values* mean for a
date whose window has not opened — a usable instant, an absent block, or a
window meaning something else. If the block is empty for those dates the
API-driven design is dead and the decision is made without waiting for October.
`NUM_BOOKING_DAYS = 22` (`BookingDateProvider.tsx:24`) bounds what can be looked
at: today the picker offers 2026-09-19 through 2026-10-10, so October 18 itself
cannot be inspected until 2026-09-27.

**Risk, and it is not either direction this item used to name.** `ParkTime` is
hour, minute and second with no date at all (`datetime.ts:19-44`). A window-open
instant, once through `ParkTime.from`, is a bare clock time. Feed it into
`cadence()` the way today's is fed and the poller does not burst once on the
right morning — it bursts at that clock time *every day* the booking date stays
selected, because nothing downstream can tell which day the time belonged to.
Across a week of pre-trip planning that is seven unattended bursts at nothing,
each spending the shared `RateLimit(5)` the interval floor exists to protect
(`schedule.ts:26-36`), with a healthy-looking status line throughout. The date
guard is therefore not a refinement of the fix, it *is* the fix; the four-line
ternary change at `AutopilotProvider.tsx:1797-1801` is the easy part and the
part most likely to be shipped alone. `bookWindows`'s own date guard (`ll.ts:251`,
tested at `ll.windows.test.ts:38-40`) protects the parse, not the consumption.

**Two traps to hold a review to.** The shortest path to making a future date
burst is to widen `watchingToday`, which would also switch on drop learning:
`forToday` (`AutopilotProvider.tsx:591`, used at `:622`) is a separate
today-gate, and widening it files a future date's cancellation churn as drop
events under the wrong day. The older warning against widening `bookingDate`
itself still stands — that is item 6's problem — but `forToday` is the nearer
trap. Second, `timeStatus: 'NOW' | 'LATER'` is declared on the wire shape
(`ll.ts:102`) and never read; `bookWindows` uses only `w.time?.time` and drops a
parse failure silently (`ll.ts:255-258`). An unopened window is exactly where a
non-parseable literal would land, and it would vanish without a trace.

**Done means — and the old test here did not.** The previously stated
`schedule.test.ts` case already passes on HEAD, both halves. `cadence()` is
date-blind, so a booking-window target thirty seconds out already returns
`'burst'` (`schedule.test.ts:134-138` asserts precisely that), and a 07:00
target read at 05:00 is 7,200 seconds away, far outside `APPROACH_LEAD_S` = 300,
so `'idle'` is already true too; `npx jest src/autopilot/schedule.test.ts` is
green at `767ea4b`. Replace it with a wiring test, where the gate actually
lives. `AutopilotProvider.test.tsx` already has every piece: `setup()` takes
both `nextBookTimes` (`:307`) and `bookingDate` (`:320`), and the probe renders
`status.mode` into `data-testid="mode"` (`:145`). With the clock pinned by
`setTime('09:00')`, `bookingDate: modifyDate(TODAY, 3)` and
`nextBookTimes: [new ParkTime(9, 0, 20)]`, HEAD renders `idle` and the change
must render `burst`. A second case must pin the failure the date guard exists
for: the same booking date and the same window time, on a day that is *not* the
window-open day, must stay `idle`. That one cannot be made to pass at all until
`cadence()` or the wiring above it gains a date-aware input, which is the point
of writing it. Drop the harness half or price it honestly:
`harness/fakes/clients.ts:79` sets `this.nextBookTimes = [inMinutes(90)]`
unconditionally and ignores `date`, and ninety minutes is outside both
`BURST_LEAD_S` = 120 and `APPROACH_LEAD_S` = 300, so the harness shows idle
before the fix and after it. It needs a scenario knob for the window-open
instant before it can demonstrate anything. Step A is done when the raw
`ll.nextBookTimes` (or the eligibility block from devtools) is pasted into a
comment beside the change, with the date it was captured and the booking date it
was captured for.

**Where.** `src/providers/AutopilotProvider.tsx`, `src/autopilot/schedule.ts`,
`src/api/ll.ts`, `src/providers/BookingDateProvider.tsx`,
`src/providers/AutopilotProvider.test.tsx`, `harness/fakes/clients.ts`.

**This item is not served by the October trip, and the old text said it was.**
The gap is inert during October 18-20: on those days `bookingDate === parkDate()`,
`watchingToday` is true, and the poller already bursts. The trip cannot exercise
this at all. The date-pressured moment is the October *booking* morning, from
home — 7:00am ET seven days before check-in for resort guests, or three days
before each park day for everyone else (`docs/PLAN.md:269-271`). Which of those
rule applies here was settled on 2026-09-19: on-site, so the morning is
2026-10-11. This item does not turn on it — that morning is before the trip
either way, and the feature is about any future park date. The one observation no amount of effort buys early is what the
response looks like at the instant a window actually opens, which requires
watching on a morning one does.

### 4. Name the attraction the Tier 1 hold is waiting for — _medium_

The tier hold turns down an advertised Lightning Lane to keep the party's only
Tier 1 selection free for a better one, and the message it leaves names the
wrong attraction. `bumpSkip('tier-hold', experience.name)`
(`src/providers/AutopilotProvider.tsx:1132`) passes the candidate destructured
from the hit at line 957 — the ride being turned *down* — and
`SKIP_TEXT['tier-hold']` (`src/autopilot/events.ts:13`) fills in the rest with
"held the Tier 1 slot for a better attraction". So Today reads "Skipped Tower
of Terror: held the Tier 1 slot for a better attraction", which is exactly what
`src/autopilot/events.test.ts:151-153` asserts today. The one fact that would
let a user decide whether to override it — which better attraction, and how
long the hold has left to run — is the one fact the sentence withholds.

**Two claims this item used to make are false.** It is not "the one guard in
the whole tool that turns down a Lightning Lane actually on offer", on either
half. The gate at `AutopilotProvider.tsx:1127-1134` runs before any offer is
requested; the comment immediately below it, at line 1136, calls what follows
"the same pre-offer guards". And it is not the only decliner: `automodify.ts:337`
returns `offer-not-an-improvement` against an offer in hand, and the
`partyIsAcceptable` re-check composed at `AutopilotProvider.tsx:1182-1184` is
applied to `offer.guests` at `automodify.ts:329-331`. That is not pedantry, it
constrains the wording: at the moment of this skip there is no offer time to
report, only `hit.returnTime` (`src/autopilot/watchlist.ts:98`). Nor does "the
call site has everything it needs" survive the type checker.
`ArmedExperience.experience` is `Pick<Experience, 'id' | 'priority' | 'tier' |
'avgWait' | 'dropTimes'>` (`src/autopilot/priority.ts:60-66`), with no `name`.
At runtime the object really is the full tipboard `Experience` --
`AutopilotProvider.tsx:936-944` puts it there, and `src/api/resort.ts:40`
declares `name` on it — but widening that `Pick` is an unlisted first step.
Returning the blocking entry also does not get you "drop at 1:17":
`hasUpcomingDrop` (`priority.ts:140-148`) computes the matching `ParkTime` and
discards it behind a boolean, so it has to return the instant it matched on.

**The real risk is naming the wrong attraction, not naming none.** `armed.some`
(`priority.ts:97-103`) returns the first entry that qualifies in `activeTargets`
order — the user's own target list — not the best-ranked blocker, and `rank`
is optional (`src/autopilot/watchlist.ts:40`), falling back to
`experience.priority`. With two armed Tier 1s both blocking, the log can name
the one that is not the reason. A vague message gets ignored; a specific one
gets acted on, and the action it invites is to pause the named target to
release the hold — which then does not release. That is strictly worse than
today's honest vagueness. Pick the best-ranked blocker deliberately, and test
the two-blocker case.

Two smaller traps sit behind it. `bumpSkip` keys `skipCounts` by reason
(`AutopilotProvider.tsx:472-477`) and `Activity.tsx:147-158` renders that map
straight into the "Why nothing was booked" list, so composing the attraction
into the reason string would turn "3x held the Tier 1 slot" into three rows of
one and break the tally that answers the question the heading asks. The blocker
belongs in a new optional field on `Skip`
(`src/contexts/AutopilotContext.ts:42-46`), with the existing `SKIP_TEXT` entry
kept as the fallback for the counts and for older entries. And
`NextLLActivity.tsx:104-105` builds its own sentence out of `SKIP_TEXT` instead
of calling `skipEvent` (`events.ts:97-103`), so a change made only in
`events.ts` leaves two screens describing the same event differently.

**Where it can land.** Not the booking log — tier-hold never reaches it. The
reason is raised only through `bumpSkip`, which writes `skipCounts` and
`lastSkip`, both plain `useState` (`AutopilotProvider.tsx:231-232`), neither
persisted and both gone on remount. The named sentence has exactly two possible
homes: `Today.tsx:98` via `latestActivity`, and `NextLLActivity.tsx:102-107`.
`Activity.tsx` must stay generic.

**The open question is which drop time to print.** The hold reasons from the
static `experience.dropTimes`, while the poller times its bursts to
`effectiveDropTimes` — the scheduled and learned times merged
(`AutopilotProvider.tsx:1764-1771`, handed to `usePoller` at line 1797). Print
one while the engine waits for the other and this becomes item 8's
static-versus-merged disagreement in a new place. The defensible answer is to
print the time the hold actually matched on and settle the source in item 8,
which is an argument for doing item 8 first.

**Done means.** The existing assertion at `events.test.ts:151-153` passes today
and would keep passing: it is the proof of the gap, not a test of the fix. A
test that fails on HEAD has to live in `priority.test.ts` — with two armed
Tier 1s both qualifying, ordered so the better-ranked one is second in the
array, `shouldHoldTierSlot` returns *that* entry along with the `ParkTime` it
matched. Today that will not even type-check against a function declared
`: boolean` (`priority.ts:82-87`). Pair it with an events test that `skipEvent`
and the "Latest check" line render the same named sentence from one `Skip`.

**When it can be seen.** The gate is `forToday &&`
(`AutopilotProvider.tsx:1129`) and releases at the party's first redemption
(`redeemedToday`, `priority.ts:93`), so this message only ever exists in the
first hours of a real park morning. October 18-20 is the one chance to see it
fire before December. Build it against the fakes and treat October as the
sighting, not the test.

**The companion half shipped.** Four skip reasons — `waiting-to-retry`,
`not-enabled`, `no-existing-booking`, `already-held` — were declared,
reachable, and unlabelled, so the activity log printed raw identifiers at
exactly the moment a user asks why nothing is booking. All four now carry
labels (`events.ts:25-27` and `33-34`), and `events.test.ts:208-221` derives
the required set by reading `SkipReason`, `ModifySkipReason` and
`SwapSkipReason` out of the source. One caveat worth keeping honest: the three
reasons the provider raises that no union declares — `outside-window`,
`tier-hold`, `slots-full` — are hand-listed in that test at lines 215-217, so
a fourth added at a `bumpSkip` call site would still ship as a slug.
`waiting-to-retry` is not an instance of that hole, as it happens: it is
declared in `SkipReason` (`src/autopilot/autobook.ts:39`) even though the
provider raises it at `AutopilotProvider.tsx:1030`, so the test does cover it.

### 8. Count down to the drop the engine is actually bursting for — _medium_

The tool's one structural advantage is being the thing that looks in the first
two seconds of a drop, and that only pays if the phone is out and foregrounded
when the drop lands. A static time does not get a phone out of a pocket; a
countdown and a chime at T−60s do. None of that is built and the reason for it
still holds. What has changed is almost everything this item says about the
screen it would be built on.

**Half of the disagreement already shipped.** The item describes Today reading
the static table "while the poller times itself to the merged" times, as if the
engine-true value were nowhere on screen. It is on screen.
`AutopilotStatus.tsx:32-44` renders the cadence's own `status.target` with a
minute-granularity countdown — `(in {Math.round(status.secondsToTarget / 60)}
min)` — under the byte-identical label `Next drop:` at `AutopilotStatus.tsx:34`,
and `Today.tsx:187` mounts it unconditionally, 119 lines above Today's own
competing line at `Today.tsx:306`. Because `cadence()` populates `target` only
inside `APPROACH_LEAD_S = 300` (`schedule.ts:24`; the bare idle return at
`schedule.ts:200` carries none), the engine-true line is absent all day and then
appears in the last five minutes — precisely when someone is reading the
screen. So Today can show two lines reading `Next drop:`, with two different
times, at the one moment it matters. De-duplicating them is the work. Building a
third countdown beside them is not.

**And the disagreement is latent, not live.** With `DEMOTION_ENABLED = false`
(`learned.ts:51`), and `park.dropTimes` and `park.dropSchedule` built from the
same `dropExpsByPark` list (`resort.ts:122-133`), `activeScheduledDropTimes()`
returns exactly `park.dropTimes`. The two sources are identical until
`learnedDropTimes()` contributes, which needs `LEARNED_MIN_DAYS = 2` distinct
observed park days (`learned.ts:15`). On a fresh install the lie is not yet a
lie, and October 18-20 is the first trip long enough to manufacture one. It is
also one-directional: `mergeDropTimes` appends only uncovered times
(`learned.ts:87-99`), so merged is always a superset. Today can never invent a
drop the engine skips; it can only hide a learned one the engine bursts for,
which means the static line errs *late* — a countdown built on it would still
be ticking after the burst had started.

**The larger and cheaper lie, which this item misses entirely.** On a booking
date that is not today, `Today.tsx:106-108` shows `park.dropTimes[0]` — the
first drop of the day, not a next anything — while `AutopilotProvider.tsx:1797`
passes `dropTimes: watchingToday ? effectiveDropTimes : undefined` for exactly
that case. The screen names a "Next drop" for a date the engine will never burst
for at all. That is flatly false rather than merely stale, and it is what Today
shows on the October booking morning — 2026-10-11, now the rule is settled —
to apply — when the booking date is 10-18 and the real work is happening on
Time Search, which renders no `AutopilotStatus` at all: the component is
imported only by `Today.tsx:13`. Two lines fix it, independently of everything
else in this item, and it is the only part of this item with value before the
trip.

**Not free at the provider.** `effectiveDropTimes` is local to
`AutopilotProvider.tsx:1764`; grep across `src` hits only that line and `:1797`,
and `AutopilotContext.ts` exposes `dropSummaries` (`:155`, default `:190`) but
nothing merged. Reading the engine's source from Today needs one context field,
its default, and the `screenTestSetup.tsx:157` stub. Recomputing the merge inside
Today instead would pass every test — both sides derive from the same fixtures
-- and drift silently the next time learning changes.

**Risk — and it is not the one stated.** The per-second re-render is the least
of it and is already solved by precedent: `Clock.tsx:6,15-18` is a
self-contained component owning a 50ms interval over synced `now`. What actually
breaks is quieter. `chime()` returns early unless the AudioContext is `running`
(`alert.ts:73-77`), and `primeAudio()` runs only inside the gesture that turns
autopilot on (`AutopilotProvider.tsx:1828`), so after a reload the countdown
ticks visibly to zero in silence with nothing on screen saying sound is off --
the exact failure this project rates worst. `audioReady()` exists for precisely
this (`alert.ts:69-71`) and is called nowhere in `src` outside its own test;
render a muted-state hint from it rather than assume. Worse for the premise
itself: `usePoller.ts:84-86` records that background tabs are heavily
timer-throttled, and a one-second interval is clamped the same way, so the chime
meant to get a phone out of a pocket cannot fire from a pocket — and on iPhone
outside an installed PWA there is no channel that survives a locked screen
(`alert.ts:125-126`). Ship it for a foregrounded phone and say so on the screen,
or it promises a ritual it cannot keep. Read the clock from `syncedParkTime()`
(`schedule.ts:126-128`) and not `upcomingTimes()`, which uses the device clock
via `DateTime.now()` (`datetime.ts:232-233`): a phone forty seconds fast chimes
at T−100s, reproducing this item's own bug one layer down. And key the fired set
on `(park date, target)` the way the reopened-alert tag already does
(`AutopilotProvider.tsx:651-654`), or the chime re-fires on every return to
Today.

**One more mislabel waiting to be inherited.** `status.target` is documented as
"The drop or booking time currently driving the cadence" (`usePoller.ts:22-25`)
and `schedule.ts:164` merges `nextBookTimes` into the same target list, so
`AutopilotStatus` already calls a booking window `Next drop:`. A countdown built
straight on `status.target` inherits that, and the booking morning is when it
would show.

**Done means.** The item carries no Done means, and the nearest existing
assertion is not one: `Today.test.tsx:152` passes `getByText('Next drop:')` only
because the default status carries no target (`screenTestSetup.tsx:39-43`), so it
never sees the duplicate. Two tests that fail on HEAD. Mount Today with a status
carrying a `target` and assert exactly one element reads `Next drop:` — today
`getAllByText` returns two and `getByText` throws outright. Mount it with a
booking date that is not today and assert there is no `Next drop:` line at all
-- today `Today.tsx:108` renders `park.dropTimes[0]` regardless of what the
poller was given. The countdown itself is done when a component reading synced
time renders the seconds, fires `chime()` once per target, and shows the muted
hint when `audioReady()` is false.

**Open, and the owner should settle it before the code, not during.** Which
`Next drop:` survives — Today's own, or `AutopilotStatus`'s engine-true one
promoted to run all day rather than only inside the approach window? And may the
chime fire at all with autopilot off? In practice it cannot, since audio is
primed only by the on-gesture, so the honest answer may be that the countdown
renders silent until autopilot is on and says so on its face.

**Where.** `src/components/ll/screens/Today.tsx`,
`src/components/ll/AutopilotStatus.tsx`, `src/providers/AutopilotProvider.tsx`,
`src/contexts/AutopilotContext.ts`, `src/autopilot/alert.ts`. `FUTURE.md:202-203`
still cites `Today.tsx:300-316` and `alert.ts:71-140`; the derivation is now
`106-108`, the render `295-311`, `chime` `73-97` and `fireAlert` `130-148`.

### 9. Fix the gate, the test timeout and Dependabot in one evening — and stop calling the settle-time row an October item — _medium_

Three small diffs and one thing that is not a diff. (b), (c) and (d) are the evening: unblocked, behaviour-neutral, and untouched in both repos — `check.yml`, `jest.config.js`, `lease.ts` and `observe.ts` are byte-identical to AutoLL-4's copies. (a) is a session, and the reason it was promoted on 2026-09-17 does not survive contact with when doubts are actually raised.

**(a) Record how long a change takes to land.** Retract the October 18 deadline as stated. The claim was that a park day without this is a park day spent; for the version described — one capped row the first time a doubt settles — three October days will almost certainly write zero rows. A doubt exists only when the outcome is indeterminate: `AutopilotProvider.tsx:1431-1434` raises one only when `current.dispatched && outcome?.status === 'failed' && !outcome.rejected`, and every commit whose response comes back, success or definite rejection, takes the `else if (current.dispatched)` branch at `:1449` and calls `resolveDoubt` at `:1453`, creating nothing to settle. The only other source is the deadline, and `MAX_MUTATION_MS` (`mutation.ts:7`) is `TICK_DEADLINE_MS + RENEW_INTERVAL_MS`, 90s plus 40s: a mutation has to hang 130 seconds. So the instrument samples exactly the sub-population where the response was lost *and* Plans later proved the exact requested state.

That is also why this is not the measurement `FUTURE.md` §5.5 asks for, despite the item saying it is. §5.5 is explicit: log the send, log every subsequent plans read that does and does not show the change, and let the distribution of the ones that eventually appear set the window. That is a second store plus a hook in `PlansProvider`, and it is the version with a real claim on October 18 under this file's own rule that anything turning an assumption into a recorded fact should land before the test trip. The narrow row's honest deadline is **December 8**, the freeze — six December park days are a better sample than three October ones, and an instrument not in the build before the freeze cannot produce anything in December either. Decide which of the two is being built before writing any of it; they are not the same size and only one of them has an October reason.

The mechanical claim about the code is nearly right and one word wrong. `Doubt.at` is the dispatch instant (`lease.ts:103`, written from `dispatchedAt` at the two `quarantine()` call sites, `AutopilotProvider.tsx:1440` and `:1223`), `reconcile()` takes `polledAt` (`lease.ts:613-619`), and `landed()` (`lease.ts:562`) is the only thing that counts as proof. But they do not pass through one function — they pass through one function in *two branches*: the volatile pass at `lease.ts:625`, outside `exclusive()`, and the durable pass at `:644`, inside it. A row written in one branch misses half the population, and the volatile half is precisely the case where durable storage has already failed.

**Risk, and it is not the one this item names.** The obvious place for the write is inside `exclusive()`'s body beside `if (changed) kvdb.set<Quarantine>(QUARANTINE_KEY, next)` (`lease.ts:649`), and `kvdb.set` is a bare `localStorage.setItem` with no try/catch (`kvdb.ts:19-21`). Put the measurement write before the quarantine write and a `QuotaExceededError` on a phone aborts the clear: the doubt is never removed, the `finally` at `:651-653` still fires `publishQuarantineChange()` so the UI repaints with the doubt still showing, and the throw lands in `PlansProvider.tsx:99`'s `.catch(error => console.error(error))`. The result is a reservation the engine refuses to touch for the rest of the trip, for a reason that exists only in a console nobody opens in a park. Which also disposes of the item's opening sentence: (a) is not behaviour-neutral, because it adds a storage write to the path that clears a quarantine. The measurement write goes *after* the quarantine write, in its own try/catch, in both branches.

**Not into the activity log** — that part stands, checked. `LOG_LIMIT` is 20 (`storage.ts:11`) and the log is written through `kvdb.setDaily` (`storage.ts:161-163`), so a park day's real bookings push the measurement out and the 4am rollover drops the rest; `storage.test.ts:84`, `is scoped to the park day`, asserts exactly that. `observe.ts` is the right home: plain `kvdb.set` (`:431`), not day-scoped by its own comment at `:412`, `MAX_EVENTS = 1000` (`:34`) and `MAX_COVERAGE_DAYS = 30` (`:38`). What the item never says is how the rows are read back. `observe.ts`'s data reaches a screen — `Activity.tsx:42` pulls `dropSummaries` out of the context — and a new store would not, so on a build that in practice runs only in a phone browser, reading it on October 21 means Web Inspector over a cable. Whether that is acceptable is an open owner question, and it is the difference between an evening and a weekend. Keep §5's warning in the comment either way: this must never become an automatic fail-open rule again.

**(b) Make the gate tell the truth.** Correct the count first: four steps carry `if: '!cancelled()'` — Tests, Lint, Typecheck, Build at `check.yml:44-62` — and `npm ci` at `:35` is unconditional. The consequence the item states is right and live: #30 and #31 are both red now, five red steps each from one unresolvable peer range. The form matters. A step `if` containing no status-check function is implicitly ANDed with `success()`, so `if: steps.install.outcome == 'success'` would restore fail-fast and destroy the report-everything-at-once property `check.yml:3-6` exists to defend; write `if: ${{ !cancelled() && steps.install.outcome == 'success' }}`. Do not rename the `check` job — it is the required status context on both protected mains.

**(c) Give the two slowest tests their own timeout.** The word is *tests*, not suites, and an implementer following "suites" edits the wrong files: Jest's `testTimeout` is per test, and `jest.config.js` sets none at all, so the 5000 ms default is in force everywhere. Measured here on a full `TZ=UTC npx jest --ci` at load average 2.4 — 1446 tests, 7.5 s wall — the two slowest individual tests in the entire run are `Home.test.tsx :: shows LL home screen` at 1714 ms and `MultiPassList.test.tsx :: shows LL availability` at 1508 ms, with third place `BookExperience.test.tsx :: performs successful booking` far back at 657 ms. The item named the right two. By *suite* wall clock the ranking is different — `AutopilotProvider.test.tsx` 5251 ms and `BookExperience.test.tsx` 4496 ms lead, with Home and MultiPassList third and fourth — which is the trap the old wording sets. Name the number and say what it is for.

**(d) Pause Dependabot until January.** Nine stand open here (#1-#6, #8, #30, #31 — #7 was merged and #9 closed under `FUTURE.md` §6's plan), and two of them, the vite majors #30 and #31, cannot go green alone. The figure the item misses is AutoLL-4's own nine, all opened 2026-09-17, with two red of its own: #7, the TypeScript 7 bump this repo already investigated and closed, and #9 `eslint-plugin-react-hooks`. Eighteen across two repos, and `.github/dependabot.yml` is byte-identical in both, so pausing one leaves the other generating. Put the trade in the commit message rather than leaving it in a different document: `FUTURE.md` §6 records that Dependabot's *security* half is switched off for this repository, so pausing version updates removes the only Dependabot signal there is. The compensating control is real — `npm audit --omit=dev` is 0 and only `react` and `react-dom` ship — but it belongs where the pause is. Budget a rebased PR rather than a push: AutoLL-3's main is `strict: true` with `enforce_admins: true`, and the required context is `check`.

**Done means.** The item had none, which is part of why it drifted. Four, each failing on HEAD. (a): a `lease.test.ts` case that makes `localStorage.setItem` throw for the timing key only and asserts `reconcile()` still removes the doubt from *both* the volatile and the durable store — there is no timing instrumentation anywhere in `src` or `harness` today, so it fails now, and it is also the test that fails on the obvious implementation. Write it knowing `FUTURE.md` §6's warning that `volatileQuarantine` is module state `beforeEach` cannot reset, and that three cases already clean up by hand in a `finally` (`lease.test.ts:235`, `:267`, `:627`). (b): a branch with a deliberately broken lockfile reports one red step, not five. (c): `jest.config.js` carries a `testTimeout` with a comment naming the two tests and the margin. (d): `.github/dependabot.yml` is paused in both repos, in one PR each, with the security-half trade written into the message.

### 7. Run the late-November data check, and apply the correction it is named for — _small_

This corrects `FUTURE.md` §3.3, which still says re-verification "needs a live
tip board once the overlays are running, which is inside the freeze"
(`docs/FUTURE.md:189-192`). It does not. `docs/MONITOR.md:42-43` records the
mirror as "free, no API key, no account", `docs/MONITOR.md:87` establishes that
every attraction's `externalId` in that feed is the Disney facility id this
repository already keys on, and `docs/PLAN.md:241-242` records the repository
running exactly this check once already, on 2026-09-05. Both overlays also start
before the freeze: `docs/PLAN.md:887-888` dates Glimmering Greenhouses Nov 27 -
Dec 30, eleven days ahead of the two-week freeze starting around December 8
(`docs/PLAN.md:879`). The correction holds — and it is still unapplied.
`docs/FUTURE.md:189-192`, the schedule row at `docs/FUTURE.md:585`, and
`docs/PLAN.md:862-863` all say the old thing today; `1a453b0` corrected four
documents and touched none of the three. Applying the correction in those three
places belongs to this item, because the roadmap is the document that expires.

**The old justification was false, and was false when it was written.** Delete
it rather than soften it. A stale overlay id does not leave an attraction
unwatchable *silently*. `LLClient.experiences()` does drop the row in its
`catch` (`src/api/ll.ts:355-359`), but it collects the id into
`unknownExperienceIds` (`src/api/ll.ts:288`, assigned at `:362`), Today renders
an unconditional red banner on the default tab
(`src/components/ll/screens/Today.tsx:272-277`), and Configure names the ids
individually and explains what a re-theme looks like
(`src/components/ll/screens/Configure.tsx:230-238`). All of that shipped in
`650a1082` on 2026-09-07, ten days before this roadmap was added in `36d0035`.
The check is still worth running — the banner tells you in December, and the
whole point of a November desk session is to know before the freeze — but
visibility is not what it buys.

**The genuinely silent case is the one this item does not look at, and it sits
in holiday data.** `Resort.knows()` is `this.expsById[id] !== undefined`
(`src/api/resort.ts:147-149`), and `null !== undefined`, so an id listed as
`null` counts as *known*: `src/api/ll.ts:358` keeps it out of
`unknownExperienceIds`, and `Resort.experience()` suppresses even the console
warning for `null` (`src/api/resort.ts:151-156`). Four ids carry no comment at
all — `412380330`, `412380331`, `412380332`, `412380258`
(`src/api/data/wdw.ts:1484-1487`) — sitting immediately below a comment saying
that "a nulled one that Disney *does* serve is invisible and unbookable — which
is the failure this whole section exists to record"
(`src/api/data/wdw.ts:1478-1480`). If Disney serves one of those four in
December there is no row, no banner, no warning and no name. Widen the session
by five minutes and grep the live feed against the null list too: that is where
the harm the old text described actually lives.

**Cut two of the three named edits.** "Tiana's status" has no referent anywhere
in either repository — §10's four open questions (`docs/PLAN.md:855-863`) do not
include it, and §11's named operational check is Kali River Rapids
(`docs/PLAN.md:889-891`). Only the owner can say what was meant, and until they
do it is not an item. The drop table has no permitted desk source:
`docs/FUTURE.md:571` forbids scraping paid tables into the repository, and this
roadmap's own "Deliberately not doing" already says Big Thunder's drop schedule
needs no work because `observe.ts` and `learned.ts` record it and the park days
will answer it. The line between checking and importing is the whole constraint,
and the drop table is on the wrong side of it. That leaves the two overlay ids
and the four nulls.

**"At most three one-line data edits" understates it in the direction that
matters.** Only a negative result is cheap, and a negative result is no edit at
all. If an id has moved, `docs/PLAN.md:245-247` already settled the shape: "The
fix is to add the new IDs, not to edit the old ones." That means a full entry --
id, name, `land`, `type`, `geo`, `tier`, `priority`, `avgWait`, and for Jingle
Cruise a `refillWindows` block (`src/api/data/wdw.ts:295-310`) — plus nulling
the old id in the Ignored block, plus a pin in `src/api/resortData.test.ts`
beside the three at `:146-148`. `wdw.ts` is byte-identical between AutoLL-3 and
AutoLL-4 today and no test compares the two, so the edit is made once in
AutoLL-3 and reaches the fallback by merge, never by a second hand-edit.

**When.** Not before roughly Nov 27, and the date is not bookkeeping.
`docs/PLAN.md:730-734` records both ids "absent from Disney's live September
data, exactly as expected for a seasonal overlay", so running this in October
returns two misses indistinguishable from two stale ids — a false negative that
reads as a finding. Jingle Cruise's own start date is written down nowhere in
either repository; pinning it down is the first five minutes of the item, and if
it is early November the Jingle half can run then. Second overlay pass about a
week after the first, as before.

**Done means.** The obvious criterion already passes on HEAD and should not be
used: pinning `412010035` and `412010036` in `src/api/resortData.test.ts` goes
green today, because both entries are in the file
(`src/api/data/wdw.ts:295-296` and `:707-708`) — such a test asserts that the
file has *an* id, not that the id is *current*. Two checks that return nothing
today: both overlay entries carry a dated provenance comment naming the feed and
the date checked, in the form `docs/PLAN.md:241-242` already uses for the
September 5 pass, and each of the four nulls at `src/api/data/wdw.ts:1484-1487`
carries a name or is gone. And `docs/FUTURE.md:189-192`, `docs/FUTURE.md:585`
and `docs/PLAN.md:862-863` no longer claim a live tip board inside the freeze is
required.

## After the trip

Ordered loosely by value, not by effort.

Item 6 was demoted here on 2026-09-19. It is large, it is not needed
before either trip, and the October reading may reshape it.

### 6. Let a plan outlive the booking window — _large_

A plan for a date beyond the booking window still cannot be built, and the
reason is still not the one `FUTURE.md` §3.2 gives — §3.2 blames the add list
needing a live tip board. The harder wall is the **date**. `addTarget` stamps
every starred attraction with `date: target.date ?? bookingDate`
(`src/providers/AutopilotProvider.tsx:1910`); `bookingDate` cannot leave the
twenty-two-day window, because the mount-time read from storage and every
subsequent write both run through `validDate`, which returns `parkDate()` for
any date `getBookingDates()` does not list
(`src/providers/BookingDateProvider.tsx:24,34-41,55-64`); and `targetApplies`
compares that stamp to the current booking date by exact string equality
(`src/autopilot/watchlist.ts:111-120`) at sixteen non-test call sites, from the
engine's own `activeTargets` filter (`AutopilotProvider.tsx:593`) through every
per-target edit — `isWatched`, add, remove, the four toggles, the rank, the
return-time bounds — out to Plan Check (`plancheck.ts:88`) and the timeline
(`Timeline.tsx:28`). So a target starred today is stamped `2026-09-19`, and
`targetApplies` refuses it in December. Nor does it lapse on its own:
`saveWatchList` writes with `kvdb.set` (`watchlist.ts:289`), not the `setDaily`
the booking date itself gets (`BookingDateProvider.tsx:66`), so the stale stamp
is durable. `PLAN.md` §11 records the twenty-two-day clamp as a scheduling
fact; what neither it nor `FUTURE.md` records is that the clamp propagates into
every saved target.

Three parts in strict order, because (b) and (c) are worthless without (a):

1. **Separate the date a plan is _for_ from the date the app is _booking_ for.**
2. Add a `Resort.experiences(park)` accessor — `src/api/resort.ts:147-166`
   exposes only `knows`, `experience`, `park` and `dropExperiences`, and
   `expsById` is `protected` — and have Configure fall back to it when the tip
   board is empty.
3. Mark Single Pass attractions so an offline list cannot offer a watch that can
   never fire.

None of the three has shipped. What has changed since this item was written is
that Configure already says the mismatch out loud, in two places: "{N} more
saved for another park or date, or not on this park's list today"
(`Configure.tsx:250-256`) and "No attractions loaded yet."
(`Configure.tsx:377-380`). What is missing is a path forward, not a warning, so
a fix should not spend an evening re-adding a banner that exists.

**The demotion's missing half.** The 2026-09-17 demotion rests on the December
days becoming selectable in the picker before the freeze. Selecting the date is
necessary but not sufficient. Configure's add list is
`experiences.filter((exp): exp is Experience => !!exp.flex)`
(`Configure.tsx:83-84`), and `experiences` comes only from
`await ll.experiences(park, bookingDate)`
(`src/providers/ExperiencesProvider.tsx:68`) — Disney's tip board for that one
date (`src/api/ll.ts:320-327`). Nobody here knows what that endpoint returns
for a park date twenty-one days out: rows with `flex`, rows without, or
nothing. If it returns nothing usable, `watchable` is empty on December 1,
Configure renders "No attractions loaded yet.", and the December plan cannot be
built in the picker after all — which is `FUTURE.md` §3.2 exactly, and would
un-demote this item. **The roadmap treated that as settled; the code does not
settle it.**

What would settle it costs nothing and has a date on it. The same clamp that
blocks December blocks October right now: today the picker offers 2026-09-19
through 2026-10-10, so October 18 first becomes selectable on September 27 and
October 20 on September 29. That is nine days of slack and not a problem — but
it means the "build it in the picker" workflow the demotion rests on gets its
first rehearsal on September 27, at exactly twenty-one days out, and whoever
opens Configure that morning answers this question for free. One request
answers `PLAN.md` §10's recorded question too, because `experiences()` reads
the rows and sets `this.nextBookTimes = bookWindows(data.eligibility, date)`
off the same response (`src/api/ll.ts:320-330`).

**Risk.** The tempting shortcut is the first danger: relax `validDate` or raise
`NUM_BOOKING_DAYS` instead of adding a second date. That drags the whole engine
onto a day Disney refuses, because the tip-board fetch, the poller, autobook,
autoswap and the eligibility prewarm all read the same `bookingDate` — 111
non-test references across twenty-three files — and it fails silently in the
exact shape `BookingDateProvider.tsx:68-85` already documents for the overnight
rollover: `watchingToday` and `watchingTomorrow` are both false, `cadence`
never leaves the 45-second idle interval, and the status line reads like a
healthy run. The nastier danger is a half-done split, and it is one line away.
`targetApplies` treats an absent date as applying everywhere
(`watchlist.ts:118`, asserted at `watchlist.test.ts:264-265`), so if `addTarget`
stops stamping a date before `targetApplies` stops comparing one, every saved
target arms on every park day — a December plan booking on a September
morning. The opposite order merely makes targets vanish, which
`Configure.tsx:250-256` at least counts out loud. Do it in that order. And (c)
is not garnish on (b): `src/api/data/wdw.ts:442-449` gives TRON Lightcycle / Run
the same shape as any Multi Pass ride, Single Pass is knowable only at runtime
from `individual?:` (`src/api/ll.ts:33-37`), so an offline add list built from
`Resort` today would offer TRON, Guardians of the Galaxy, Rise of the
Resistance and Avatar Flight of Passage as watchable — a watch that looks
armed and can never fire, on the screen whose whole job is to say what Autopilot
will do.

**Done means.** This item has never had a "done" line, and the obvious
candidate would not earn one: `watchlist.test.ts:250-266` already asserts
`expect(targetApplies(scoped, 'mk', '2026-12-11')).toBe(false)` and passes
today, because it encodes the blocker rather than the fix — it will still pass
after this ships. The test that fails on HEAD belongs in
`src/providers/AutopilotProvider.test.tsx`, whose fixture already has what it
needs (`setBookingDate: (date: string) => view.rerender(<Tree date={date} />)`,
line 461): star an attraction while the plan date is a December day and the
booking date is still today, then assert the stored target carries
`date: '2026-12-22'` and that `isWatched` is true for it on that plan date.
Both halves fail now — `addTarget` has no input but `bookingDate`
(`AutopilotProvider.tsx:1910`), and `validDate` will not let `bookingDate` hold
a December day in the first place.

**Where.** `FUTURE.md` §3.2's _Where_ line cites
`src/components/ll/screens/Configure.tsx:87,275-300` and both halves have moved:
87 is now the `matchesFilter` helper and 275-300 the undo toast. The add list is
derived at `Configure.tsx:83-85` and rendered at `376-398`. Strike the old line
rather than leave it standing.

**Demoted 2026-09-17; moved here 2026-09-19.** The owner answer stands — skip
this cycle, revisit after December — and the date blocker is still real and
still worth fixing on general grounds, because planning a trip should not
depend on being inside a twenty-two-day window. The trips do not need it: the
October trip cannot exercise it, and for December the picker probably suffices.
But "probably" is the honest word, and it has a cheap test on September 27. If
that morning's tip board for October 18 comes back without usable `flex` rows,
the picker workflow will not serve December either, part (b) becomes
load-bearing rather than a convenience, and this item comes straight back to
_Before the trips_ in its (b)-and-(c) form.

- **Automatic expiry rescue** — _large_. Build it as a synthesized hit through
  the existing booking path, not a second commit path. A park day supplies the
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

**~~Is the October party staying on-site or off-site?~~** Answered 2026-09-19:
**on-site, for both trips.** That selects the resort rule — 7:00 a.m. ET seven
days before check-in, for the whole stay (`docs/PLAN.md:269-271`) — and both
stays are inside the fourteen-day cap. So each trip is booked in one morning,
from home: **2026-10-11** for Oct 18–20, and **2026-12-15** for Dec 22–28.

The consequence is larger than a date. The engineering deadline is the booking
morning, not the trip, which moves October's a week earlier than this file
assumed throughout. It also means the highest-stakes moment of the year happens
at a desk rather than in a park, which is a different set of failure modes than
the ones most of these items address.


**~~What are the actual December 2026 trip dates?~~** Answered 2026-09-17:
December 22–28, with a test trip October 18–20. Both are recorded above and
should go into `PLAN.md` §11 with the date they were recorded. The answer
demotes item 6 — the picker reaches every December day before the freeze — and
promotes the instrumentation half of item 9, which now has a deadline.

**Expiry rescue: build it on an unverified assumption, or ship only the warning
and let a park day supply the fact?** Recommendation: the warning, and October
is now the park day — which makes this the clearer call than it was. It captures most of the park-day value — the phone says "Jingle Cruise
ends in 20 minutes and nobody has tapped in" while you can still act — without
betting an automatic action on a grace period nobody in this repo has measured.

**Item 1: API-driven or clock-driven?** Let the investigation decide. Prefer
API-driven if the instant is genuinely there; a clock-driven 07:00 trigger
avoids depending on the API but hardcodes a rule Disney can change and fires on
mornings when nothing opens.

**Item 6 is large, and the dates have taken the urgency out of it.** Full
plan-date model, the narrow date-only version, or skip for now?
Recommendation: skip for this cycle and revisit after December. Nothing about
these two trips needs it, and the honest general version — a plan date genuinely
independent of the booking window — is better designed once a park day has shown
how the rest of the planning flow actually gets used.

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
