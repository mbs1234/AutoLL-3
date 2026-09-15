# What is left

Written 2026-09-13, against AutoLL-3 at 0.5.0, and revised 2026-09-14 when the
day's action allowance was removed (§7). This is the standing list of
what is not done: the items still open from `PLAN.md` and `UX-PLAN.md`, the
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

If only five things get done, these:

1. **Time Search and Autopilot can modify the same pass** (§1.1) — the one
   remaining collision the shared locks were built to prevent.
2. **Expiry rescue** (§3.1) — the largest recoverable loss the tool still does
   not catch: a lapsed pass costs a selection for nothing.
3. **Plan from the sofa** (§3.2) — a December plan cannot currently be built
   without a live tip board, which is the opposite of how this is meant to work.
4. **The timeline's names and tap targets** (§2.1, §2.2) — the day view cannot
   currently tell you which ride a bar is for.
5. **The overlay IDs** (§3.3) — a watch list built in October against the wrong
   Jingle Cruise ID matches nothing in December, silently.

---

## 1. Correctness still outstanding

All confirmed by the 2026-09-12 review and still true in the code today. The
six highest-severity findings from that review were fixed on the day and are
not repeated here.

### 1.1 Autopilot and a Time Search can modify the same held pass

`useTimeSearch` holds its commit guard in a ref: an in-memory, per-hook lock.
It never takes the per-attraction action locks the top-level engine shares, and
its commits go straight to `ll.book(offer)` without passing through the ledger,
so they are neither locked nor charged. Meanwhile the top-level Autopilot keeps
polling underneath the Time Search screen.

_Where:_ `src/components/ll/screens/TimeSearch.tsx:48-55`,
`src/autopilot/useTimeSearch.ts:110-126`. _Size:_ medium. _Risk:_ a foreground
search is one the user is standing there asking for, so it must not be silently
blocked by a lock the engine took — it needs the `releaseAttempt` escape NextLL
already uses.

### 1.2 Home stops refreshing itself after the first tab switch

`useScreenState` captures the active screen element once and compares by
identity, while `withTabs` replaces that element on every tab change. From the
first switch onward the on-visible refresh never fires again, so you take the
phone out of your pocket at :47 and read availability as old as your last
manual refresh, with nothing saying it is stale.

_Where:_ `src/hooks/useScreenState.ts:5-10`,
`src/components/withTabs.tsx:12-19`,
`src/components/ll/screens/Home.tsx:64,75-81`. _Size:_ small. _Risk:_ the
comparison has to stop depending on element identity without firing a refresh
on every tab switch, which would spend the shared rate limit.

### 1.3 A refusal burst still floods the saved activity log

Repeated failures collapse to one row carrying a count and the most recent
time — but that time is part of the key the save path dedupes on, so each
rewrite looks like a new event and every earlier copy is appended back. In
burst cadence the twenty stored rows become twenty copies of one error inside
half a minute, and the day's real bookings are gone.

_Where:_ `src/autopilot/bookinglog.ts:39-56`, `src/autopilot/storage.ts:86-125`.
_Size:_ small. _Risk:_ the merge exists because two providers write the same
log; a key that ignores the time must still tell two genuine events apart.

### 1.4 A timed-out booking is written down as a clean failure

`describeFailure` renders whatever status it is given, so the client timeout
logs as "Request failed (0)". The engine itself gets this right — the lock and
the doubt-hold both stand — but the screen contradicts the project's own rule
that a status-0 result is an unknown outcome, not a failure. On park wifi a 0
is common and can mean a booking that landed.

_Where:_ `src/autopilot/bookinglog.ts:13-19`. _Size:_ small. _Risk:_ none beyond
wording: it has to say "no answer, check your plans" without implying a booking
exists.

### 1.5 Activity says "(not watched yet)" about drops it has been watching for days

The mount-time drop summary omits the watched-days record, so every scheduled
check comes back with no coverage until something new arrives. That screen is
the only place you can see whether a built-in drop time has ever fired for you,
and the same numbers are the evidence the demotion switch (§4.2) would act on.

_Where:_ `src/providers/AutopilotProvider.tsx:381-388`. _Size:_ small (one
argument). _Risk:_ it makes the demotion evidence look ready before the
coverage work behind it is done.

---

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

### 2.3 A held pass's protected band swallows taps on the hold underneath

The band is a full-width absolutely positioned div drawn per lane with no
`pointer-events-none`, so on a day with two overlapping holds one of them
cannot be opened.

_Where:_ `src/components/ll/DayTimeline.tsx:113-122`. _Size:_ small (one class).

### 2.4 Plan Check's "Refresh LL list" reports nothing

The refresh runs, but the spinner and error flash belong to Today, which is
hidden while Plan Check sits on top. Pressing the button and getting silence
reads as broken, and the natural response is to press it again — spending the
rate limit the poller needs.

_Where:_ `src/components/ll/screens/PlanCheck.tsx:88-91`. _Size:_ small. _Risk:_
keep the status local to Plan Check rather than giving the Experiences provider
a second spinner owner.

### 2.5 Today's freshness line calls never-fetched data current

The line takes the older of the two `lastUpdated` values, but filters out
undefined ones first — so one loaded context and one that has never fetched
reads as both current. It is the line that tells you whether to trust the rest
of the screen, and it over-claims in exactly the state where trusting it is
wrong.

_Where:_ `src/components/ll/screens/Today.tsx:143-150`. _Size:_ small.

### 2.6 Configure contradicts its own heading

The heading counts saved targets for the park and date; the list under it is
those targets intersected with the loaded tip board. An unloaded tip board
gives "Nothing selected yet" under "Watching (4)", which reads as data loss at
the moment you are checking your plan survived.

_Where:_ `src/components/ll/screens/Configure.tsx:258,275-279`. _Size:_ small —
the "Not on today's list" group already has the wording to borrow.

### 2.7 A second removal inside the undo window destroys the first undo

The undo holds one removal in a single state slot. Tidying two rows in a row —
the ordinary way to hit it — loses the first target's window, rank and flags
with no way back.

_Where:_ `src/components/ll/screens/Configure.tsx:91-101,296-317`. _Size:_
small. _Risk:_ keep the flash to one row at a time, or the footer grows
unpredictably at 360 px.

### 2.8 A Plan Check settings item opens Configure and abandons you

`Configure` accepts a focus of `{kind:'target'}` or `{kind:'setting'}` and
reads only the target case, so following a settings blocker drops you at the
top of a long screen with no indication of what to change.

_Where:_ `src/components/ll/screens/Configure.tsx:65-67`. _Size:_ small. _Risk:_
the screen is `fixed inset-0` with its own scroll pane, so scroll to a ref
rather than a hash.

### 2.9 The pre-trip checklist is missing three steps and has no way back into a finished one

It ships five of its eight steps: party, targets, an action armed,
notifications, Plan Check. "Park and date chosen", "windows set where wanted"
and "unrecognised attraction IDs" are absent — the last exists on Today as a
standalone red paragraph with no route to fix it. And the action button renders
only for steps that are *not* done, so a finished step cannot be reviewed.

_Where:_ `src/autopilot/checklist.ts:30-68`,
`src/components/ll/screens/Today.tsx:219-235`. _Size:_ small. _Risk:_ "windows
set where wanted" has no objective done state — make it an acknowledgement, not
a test, or it will never go green.

### 2.10 The timeline recomputes the whole day on every tick

`dayTimeline()` runs in the render body, and in burst cadence the status
updates every 1.2 seconds while `NavProvider` keeps the screen mounted
underneath whatever is pushed on top. `UX-PLAN.md` asked for a `useMemo` in
Phase 0 and still records it as unadded.

_Where:_ `src/components/ll/DayTimeline.tsx:76`. _Size:_ small. _Risk:_ the
dependency list must include the held plans, or the timeline freezes after a
booking.

### 2.11 The timeline's tooltips are in 24-hour time

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

Four things that need an answer before anyone writes anything.

### 4.1 Should a NextLL search survive a tab switch? — UX-PLAN §6.3

NextLL mounts its own engine, so leaving the tab stops the search. Hoisting it
would let a quick search keep running while you look at your plans. The cost
has grown since the question was framed: the action-lock ledger now means two
pollers would have to arbitrate the same per-attraction locks, which is the
same collision class as §1.1.

_Recommendation: no, not before December._ A trip is the wrong week to find out
how two pollers share a lock ledger.

### 4.2 Turn drop demotion on? — P2.3

The machinery is built and switched off. Five of the nine attractions with
built-in drop times show no reliable pop-ups in public data, and bursting at a
dead time wastes requests at the minute they are worth most. The stated
precondition is recording coverage per scheduled drop time rather than per park
day, so both counts derive from the same evidence.

_Where:_ `src/autopilot/learned.ts:15-17,40-51,103-135`. _Size:_ medium.
_Risk:_ the store starts empty and needs three covered days, so a short trip
barely reaches the threshold — and demotion is the only part of drop learning
that can remove a real burst target.

### 4.3 Will the December party use Park Hopper? — P3.4

The two hopping refusal codes are handled identically today, which is wrong for
both: one carries a time and should schedule a poll, the other has no timer and
should suppress cross-park targets until the tap-in detector fires. It only
pays if the party actually holds a Hopper and intends to use it. Settle that
first; if the answer is no, this drops off the list entirely.

_Where:_ `src/api/ll.ts:111-126`. _Size:_ medium.

### 4.4 Should the live tier check run on a park day? — P3.5

The tier bundle is fetched and the divergence warning exists, but the fetch is
gated so it never runs on a day-of poll — deliberately, because the bundle
appends closed attractions and the drop learner would read them as inventory.
Tiers moved twice in the last twelve months, and December is exactly when a
stale flag would have the tool hold a Tier 1 slot for the wrong attraction.

_Where:_ `src/api/ll/wdw.ts:176,246-265`. _Size:_ medium. The narrow version —
fetch once at park open, use it for the warning only, keep it out of the tip
board the learner reads — is probably right, but it re-opens a path that was
closed on purpose.

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

_Size:_ small, and it must be log lines rather than behaviour changes.

---

## 6. Testing and housekeeping

**Four named test deliverables were never written.** `PlanCheck.test.tsx` has
nine cases and none touches the outcome bar, the per-item buttons or the
navigation; `daytimeline.test.ts` never asserts the protected span;
`DayTimeline.test.tsx` has no test for a tap or for the band; `TimeSearch.test.tsx`
does not exist. The deploy now gates on the full suite, so an untested screen is
an ungated screen — and several fixes in §2 land in exactly these files. Write
them alongside those fixes, not as a separate pass, or they will be written to
match whatever the code happens to do.

**Nothing pins the storage namespace.** Every key is a literal spread across
some twenty files and every notification tag is a template — all correctly
`autoll3.*` today, with nothing enforcing it. AutoLL v1.0 has a source-scanning
test for exactly this, because more than one of these builds can sit on one
phone and they all run on the same Disney origin. _Size:_ small. Keep it to a
bare-prefix match after any quote character, which is the shape v1.0 settled on
after two misses.

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
| Now | §1.2 the refresh, §1.4 and §1.5 the two one-liners, §2.3–§2.6 |
| Late September | §3.1 expiry rescue, §1.1 the Time Search lock, with their tests |
| October | §3.2 planning offline, §2.1 and §2.2 the timeline, §2.9 the checklist |
| Early November | §4.2 and §4.4 decided and acted on, or explicitly dropped; §3.4 the countdown |
| Late November | §3.3 the overlay IDs against a live tip board; §5 instrumentation |
| December 6 → trip | Freeze. Full-day dry runs in the harness and in the park. |

Cut from the bottom: §3.11 live standby first, then §3.9, then §3.7.
