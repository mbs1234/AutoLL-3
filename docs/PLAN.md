# bg1 — Booking intelligence plan for December 2026

Written 2026-09-05. Sources: the four strategy articles supplied by the owner,
Thrill Data's public Lightning Lane pages and Wait Magic FAQ, Disney's own
Lightning Lane FAQ, TouringPlans, BlogMickey, WDWMagic's drop-tracking thread,
themeparks.wiki's live facility data, and a line-by-line read of this codebase
at `d8dd6c5`.

Seventy candidate findings came out of five parallel research passes. Each was
then handed to an independent agent told to _refute_ it. **Nineteen were
refuted and are recorded in §9 so they are not rediscovered later.** What
follows is what survived, plus what I verified directly against the tree and
against Disney's live data.

Platform work — the Capacitor app and the Fly.io service — is a separate track
and deliberately absent here. This document is about making the booker smarter.

## Status

This plan was written for the `mbs1234/bg1` fork. That work now lands in
**AutoLL-3** ([mbs1234/AutoLL-3](https://github.com/mbs1234/AutoLL-3)), which
is AutoLL-2's `main` at `650a108` plus everything since. **AutoLL-2** is the
stable base: AutoLL-3's deploy builds `main` from this repository and overlays
the static site from `mbs1234/AutoLL-2@goofy` and the runtime module from
`mbs1234/AutoLL-2@gh-pages` (`.github/workflows/deploy.yml`). **AutoLL** is
frozen at v1.0. The inherited reason Lightning Lane booking works at all is
unchanged; see FORK.md, "Booking". Section numbers below are unchanged.

A 59-agent review on 2026-09-12 produced the corrections recorded in this
section, and the fixes for its highest-severity findings landed the same day:
the saved party never reached the LL client, so autopilot booked for every
eligible guest on the account (`08a7f40`); shared action locks and committed
return times could never be released, so a refused request or a completed move
went on blocking an attraction for the rest of the park day (`2cbf82c`);
`chooseSwapVictim` protected every attraction the data deliberately leaves
unranked, and "whole party only" guarded booking but neither move nor swap
(`157ea7f`); and both NextLL searches judged their results by a rule that was
not the user's (`bfc6b43`).

**Landed:** all of Phase 0 (§3) and all of Phase 1 (§4).

Phase 0 and P1.1–P1.4: the three missing facility ids plus an on-screen warning
for the next one, the priority, land and drop-time corrections, the return-time
window UI, slot accounting, the overlap guard, and treating an expired pass as
ridden. A section-consistency test also found two Disneyland entries filed under
the wrong park.

P1.5–P1.8, with three of the four items corrected by the code:

- **P1.5** landed as written, and the same pass found a second bug the item did
  not name: the windows were ordered as `HH:MM:SS` text, so one just after
  midnight sorted ahead of a late Magic Kingdom night.
- **P1.6**'s diagnosis was wrong on both halves. Nothing was ever pinned --
  `staleAfter` layers on top of the 3-minute TTL rather than replacing it -- and
  its _absence_ means fewer refetches, not more. What is real is that the cache
  was cleared only for actions autopilot took itself, so a tap-in, an expiry, a
  hand cancellation, or a booking made in Disney's own app all moved eligibility
  and cleared nothing. It now clears whenever what the party holds changes,
  which is both simpler and covers the direction the item missed.
- **P1.7** is mostly refuted; see §9. An MEP parses as `subtype: 'OTHER'`, so
  `isLLMP` already excluded it from every path the item wanted guarded, and a
  burst cannot be forced from inside the tick that detects one. What survived is
  a bug P1.3 introduced: an MEP carries a start time, so the overlap guard was
  giving it a 100-minute clash band for the rest of the day.
- **P1.8** landed with the ceiling enforced on the effective budget rather than
  only on the setting, since the refill total is persisted and therefore
  editable; and dry run stops at an exhausted budget rather than being exempt
  from it.

Two fixes fell out that no item asked for: the acting loop was reading the
previous render's plans on the tick that polled them, and `heldMPToday` now also
excludes an MEP (a boundary guard rather than a live fix).

**Also landed since, beyond the plan:** P2.5's `hasUpcomingDrop` half — the
Tier 1 hold is now bounded to a 90-minute horizon rather than "any drop still
ahead today", which was holding Magic Kingdom's Tier 1 slot from park open
until the first tap-in because Tiana's drop list runs to 21:47. The party-night
date table (P2.5's other half) is deliberately **not** built: the horizon bounds
that case to ninety minutes, and a wrong date would silently suppress real drops
on a normal day, which is the worse failure.

§3.2's Jingle Cruise renumbering was also restored. It had been reverted by the
wholesale adoption of upstream's priority/avgWait values in `a474377`, which
re-tied it with Big Thunder at priority 1 — handing Magic Kingdom's single Tier 1
selection to a re-themed Jungle Cruise on the `avgWait` tiebreak, and disabling
the hold between the only pair it matters for. `priority.test.ts` now asserts
that ordering over the shipped data, which nothing did before.

**Decided against:** a Tier 1 guard for the future-date booking path
(§7 adjacent). `shouldHoldTierSlot` is gated `forToday`, so an overnight
cancellation fill can spend a park day's Tier 1 selection on a lesser ride. The
obvious guard deadlocks — the hold avoids deadlock only because the better
attraction has a drop still ahead _today_, and a date a week out has no such
clock. Left as is by decision, 2026-09-05.

**Phase 2–5, item by item.** Each status below was verified against the tree at
this commit on 2026-09-12.

Phase 2 (§5):

- **P2.1** landed. Burst lead widened to two minutes.
- **P2.2** landed. Refill windows are a target kind, scoped to watched
  attractions.
- **P2.3** plumbed but **inert**, and previously recorded here as landed, which
  was wrong. `DEMOTION_ENABLED = false` (`autopilot/learned.ts:51`) and
  `activeScheduledDropTimes` makes the whole rule conditional on it
  (`learned.ts:110-135`, the `enabled &&` conjunct at `:128`), so nothing has
  ever been demoted. Evidence is still gathered and still shown on the Activity
  screen. Re-enabling waits on coverage being recorded per scheduled drop time
  rather than per park day, so both counts derive from the same evidence
  (`learned.ts:48-49`).
- **P2.4** landed. `TOMORROW_INTERVAL_MS` is 15s (`autopilot/schedule.ts:64-70`)
  and `cadence()` returns approach cadence between 07:00 and 22:00 when the
  watched date is tomorrow (`schedule.ts:159-161`), with a test.
- **P2.5** half landed, as described above: the `hasUpcomingDrop` horizon is in,
  the party-night date table is declined by decision.
- **P2.6** not started. No crowd-level qualifier is carried in the data and
  there is no busy-day toggle.
- **P2.7** not started. `dropTimes` is still an undifferentiated union.
- **P2.8** landed. `detectReopenings` (`autopilot/observe.ts:105-128`) requires
  standby to be open again rather than only the down flag to clear, and feeds
  the alert path alone (`providers/AutopilotProvider.tsx:656`, `:666-674`).
- **P2.9** not started. Learning still requires two distinct park days.

Phase 3 (§6):

- **P3.1** **partly** landed. The `passkey` flag on `WatchTarget`
  (`autopilot/watchlist.ts:40`) and the tap-in detector (`autopilot/passkey.ts`,
  `tierLimitLifted`, wired at `providers/AutopilotProvider.tsx:1418-1493`) are
  built, and the detector uses the authoritative signal the item named. The
  selector is not: the user marks one target by hand, and the flag only
  reorders hits that already matched the watch list
  (`autopilot/priority.ts:52-54`). Nothing books the earliest-returning eligible
  non-Tier-1 regardless of rank.
- **P3.2** display half landed — `nextBookTime` is shown on Today
  (`components/ll/screens/Today.tsx:300-315`) and in `TimeBanner`. The cascade
  model remains refuted; one of the reasons given for refuting it was wrong
  about the code and is corrected in §6 below.
- **P3.3** not started.
- **P3.4** not started. Both codes exist only as members of the
  `IneligibleReason` union (`api/ll.ts:117`, `:122`).
- **P3.5** **built differently**, with a consequence recorded in §6 below: the
  dead return is gone and the bundle fetch and divergence warning exist, but the
  fetch is gated so that it never runs on an ordinary day-of poll.
- **P3.6** not started. No per-attraction reclaimability data exists.

Phase 4 (§7):

- **P4.1** partly landed. `WatchTarget` now carries `parkId`, `date` and a
  per-user `rank` (`autopilot/watchlist.ts:34-38`), and `rank` feeds both
  `orderByPriority` and `shouldHoldTierSlot` (`autopilot/priority.ts:55`,
  `:96-101`) — the booking-correctness half the item argued for. Targets are
  still added from a loaded tipboard, so planning offline is still not possible.
- **P4.2** landed. Only the Tier 1 hold is gated `forToday`
  (`providers/AutopilotProvider.tsx:609`, `:1121`); the book, move and swap
  paths act on whatever date is selected, and the poller drops to its slow rate
  for a future date (`:1544-1558`).
- **P4.3** not started.
- **P4.4** landed. Skip reasons render as sentences (`autopilot/events.ts`,
  including the tier-hold counterfactual) under "Why nothing was booked"
  (`components/ll/screens/Activity.tsx:142`), and armed targets describe
  themselves in `autopilot/describe.ts`.
- **P4.5** partly landed. The next drop is shown as a time rather than a
  countdown (`components/ll/screens/Today.tsx:300-315`), and the AudioContext
  chime exists for alerts (`autopilot/alert.ts`) but not as a T−60s pre-drop
  cue.
- **P4.6** landed. `components/ll/screens/Today.tsx:331-341` renders "grace scan
  until" at the window end plus 119 minutes.
- **P4.7** cheap half landed. Watched targets absent from today's tipboard are
  collected (`components/ll/screens/Configure.tsx:141-148`) and rendered as a
  "Not on today's list" group (`:220-245`). No alias table.
- **P4.8** not started. `requireWholeParty` is still one global setting.
- **P4.9** landed. Today, Timeline and `components/ll/DayTimeline.tsx` give the
  day on one screen.

Phase 5 (§8):

- Live standby in the ranking: not started. `comparePriority` still breaks ties
  on the static `avgWait` (`autopilot/priority.ts:34`), and `LiveDataClient` is
  used only for show times.

**How to read §5–§8.** Those sections are the original proposals and are still
written in the present tense throughout, including for work that has since been
built. They are the reasoning, not the status. The list above is the status.

---

## 1. Start here: three attractions are invisible to bg1 right now

This was not in the original research. It came out of cross-checking bg1's
facility IDs against Disney's live data, and it is the highest-value finding in
this document.

`LLClient.experiences()` maps Disney's tipboard through
`this.resort.experience(exp.id)` inside a `try/catch` that does `return []` on
`InvalidId` (`api/ll.ts:266-283`). **An attraction whose facility ID is missing
from `wdw.ts` is silently dropped** — no tipboard row, no watch target, no
alert, no auto-book, and nothing on screen saying why.

Three attractions were re-themed or added in 2026 and Disney issued each a new
facility ID. bg1 still carries only the retired one:

| Attraction                                   | bg1 has    | Disney serves   | Status                           |
| -------------------------------------------- | ---------- | --------------- | -------------------------------- |
| Rock 'n' Roller Coaster Starring The Muppets | `80010182` | **`412573652`** | DHS **Tier 1**, #2 behind Slinky |
| Soarin' Across America                       | `20194`    | **`412577054`** | EPCOT's **#1 Tier 2** attraction |
| Disney Jr. Mickey Mouse Clubhouse Live!      | `19583373` | **`412521565`** | DHS Tier 2, ~8 shows daily       |

Verified 2026-09-05 against `api.themeparks.wiki/v1/entity/{park}/children`,
which mirrors Disney's facility IDs (all of bg1's other DHS IDs match exactly).

This also explains why several verification agents refuted the "rename
`80010182` and re-rank it" proposals: that ID is retired, so editing it changes
nothing at runtime. **The fix is to add the new IDs, not to edit the old ones.**

The Clubhouse show matters more than its size suggests: an easy Tier 2 with
eight daily showtimes and near-certain availability is the ideal _passkey_ for
the tap-in-to-untier strategy in §5.

**Action.** Add three entries to `src/api/data/wdw.ts` with the new IDs, correct
names, and lands (`sunsetBlvd`, `world nature`/Land pavilion, and the DHS
Animation Courtyard land respectively). Keep the retired IDs as `id: null`
under the file's existing `// Ignored` convention rather than deleting them —
that is what the file already does for retired IDs, and it suppresses the
`Missing experience` warning if Disney ever returns one. Then add a startup
check that logs any tipboard ID absent from `wdw.ts`, so the next re-theme
surfaces immediately instead of silently.

Related but separate: the `animation` land is named "Animation Courtyard,"
which closed in September 2025 and reopened 2026-05-26 as **The Walt Disney
Studios**. Five entries point at it. Cosmetic, but wrong today.

---

## 2. The rules, as precisely as they can be stated

**Booking windows.** Resort guests book from 7:00am ET seven days before
check-in, for the whole stay up to fourteen days. Everyone else books from
7:00am ET three days before each park day. No rule changes landed in 2026 — the
September 1 announcement was pricing only. `NUM_BOOKING_DAYS = 22` is a correct
upper bound on the longest published window, not a bug.

**Three at a time.** You hold at most three Multi Pass selections; as one is
used a slot frees.

**When the next slot opens — corrected.** My first draft of this plan said the
slot frees when the arrival window _ends_. That is wrong, and the correction
matters. Disney's own FAQ: _"After redeeming a Lightning Lane experience — or
after two hours have passed since making your selection — you can choose
another."_ So the gate is **120 minutes after you book, or on redemption,
whichever comes first** — it is not a function of the return time you hold.

The practical consequence is the opposite of what the "cascade" idea in my
draft assumed: booking at 9:05 with an 8pm return unlocks your next pick at
11:05, exactly as a 10am return would. Stacking late returns while the
120-minute clock runs is a _recommended_ strategy, and it is precisely what
bg1's `bookThenMove` already implements.

**bg1 does not need to model any of this.** `LLClient.nextBookTime` reads
`flexEligibilityWindows` straight from the tipboard — Disney's authoritative
answer, refreshed every poll. The remaining gap is display, not logic.

**Tier 1 unlock.** Lifted by an **actual tap-in**, not by a window elapsing.
Tracked per guest; a party is blocked until every member has tapped in
somewhere. Two-touchpoint attractions need the second tap. Once unlocked, any
number of Tier 1 selections may be held. This is the single highest-leverage
moment of the day.

**Park hopping.** No 2pm rule any more. With a Park Hopper, second-park booking
unlocks on the first redemption. The two API codes almost certainly split as
`TOO_EARLY_FOR_PARK_HOPPING` = ticket clock (carries `eligibleAfter`, so
schedulable) and `TOO_EARLY_FOR_NEXT_PARK` = redemption gate (no timestamp).

**Grace period.** A pass keeps scanning for **119 minutes past the end** of its
window (TouringPlans measured it; Disney's stated policy is 5 early / 15 late).
Enforcement is Cast Member discretion. **Letting a pass expire unredeemed
counts as having ridden it** — that attraction cannot be rebooked that day.
Modifying it away before expiry preserves rebookability.

**Multiple Experiences Pass.** Issued when a ride goes down during your window.
Exempt from the once-per-attraction rule, holdable alongside others, clears any
ineligibility timer, expires end of day.

**Drops.** Disney withholds inventory at the 7am sale and returns the remainder
in scheduled batches; cancellations return continuously. The `:47`/`:17`
schedule is confirmed by four independent sources and all nine of bg1's entries
corroborate. The real event is a ±2-minute band. Animal Kingdom drops are
**crowd-level gated** (CL 4+ or CL 7+). Beyond discrete drops, a dozen
attractions have sustained **refill windows** — Test Track every 1–9 minutes
from 8:00–9:06am, Slinky 8:15–9:26am, Peter Pan's 10:55am–2:28pm — and
pre-arrival "earlier time" releases cluster heavily on the **day before**.

**Competitors.** Wait Magic and Standby Skipper run server-side through Disney's
Friends & Family connector, poll every few minutes, and **make no new bookings
before the park day**. Standby Skipper books whatever is soonest with no
priority ordering; Wait Magic's only ordering control is a manual pause.
TouringPlans plans but cannot book. **Nobody sells a tool that plans the day and
books it.** bg1's 1.2s drop burst, priority ordering and Tier 1 hold are already
ahead of every paid competitor on the things that decide a drop.

---

## 3. Phase 0 — Data corrections (ship first)

All in `src/api/data/wdw.ts`. **The 13 `tier: 1` flags are all correct** —
verified independently twice, including against a per-attraction scrape. No
tier edits are needed.

Because `comparePriority` is `(a.priority || Infinity) - (b.priority ||
Infinity) || (b.avgWait || -1) - (a.avgWait || -1)`, and `MultiPassList`
truncates priority to a band gating the Lightning Pick badge at `band < 3`,
these numbers drive same-tick attempt order, swap-victim choice, the list sort,
and the badge.

### 3.1 The three missing IDs (§1) — highest priority

### 3.2 Priority corrections that survived verification

> **The "Now" column is historical.** It was written against `d8dd6c5` and
> describes almost none of these rows as they ship today — several moved twice,
> once by an upstream data merge and once back. It is kept because the "Why"
> column argues from it. For what ships, read the summary under the table.

| Attraction                                | Now               | To                                 | Why                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Big Thunder Mountain Railroad** (MK T1) | 2.3, no `avgWait` | **1.0** + `avgWait` from real data | Hardest MK Tier 1 since reopening: gone 8:47am (May) and 9:07am (Jul) vs Tiana's ~11am. At 2.3 it ranks below Haunted Mansion and Pirates, `chooseSwapVictim` refuses to swap it in, and — worse — `shouldHoldTierSlot` actively **skips an available Big Thunder to hold the slot for Tiana's**. |
| Peter Pan's Flight                        | 1.1               | 1.2                                | Renumber so Big Thunder at 1.0 does not tie Jingle Cruise (1.0), which it would _lose_ on the `avgWait` tiebreak.                                                                                                                                                                                 |
| **Buzz Lightyear** (MK T2)                | 3.0, `avgWait` 22 | **1.2**, `avgWait` ~32             | #1 MK Tier 2 since its April 2026 reopening (DTB, mousehacking). Last touched 2025-11-12 while closed. Band 3 makes the badge unreachable, and `chooseSwapVictim` currently surrenders a held Buzz to book Haunted Mansion.                                                                       |
| Winnie the Pooh                           | 1.2               | 1.3 or leave                       | Published order is Buzz > Pooh > Haunted Mansion > Pirates. 1.3 ties Jungle Cruise — harmless (avgWait breaks it) but 1.4 is cleaner.                                                                                                                                                             |
| **Kilimanjaro Safaris** (AK)              | 3.1               | **3.0**                            | Three 2026 sources rank Safaris above Everest. They **collide at the 12:47 drop**, which is exactly the same-tick case `orderByPriority` decides — today bg1 attempts the worse ride first.                                                                                                       |
| **Expedition Everest** (AK)               | 3.0               | **3.1**                            | Swap in place. **Do not promote to 2.x** — that changes the truncated band, newly badges both and doubles their tolerated LL wait.                                                                                                                                                                |
| Little Mermaid (DHS)                      | 2.3, no `avgWait` | 4.0                                | Large-capacity show ranked above Alien Swirling Saucers (3.0, 28 min). Both sources rank Alien higher. Upstream already demoted it once; not far enough.                                                                                                                                          |
| Zootopia (AK)                             | none              | ~3.2                               | Real Multi Pass option sorting last. Rank below Everest, above Kali for a cold-weather trip.                                                                                                                                                                                                      |
| **New RnRC Muppets**                      | —                 | 1.1, `avgWait` ~59                 | Thrill Data: sells out 3:18pm / 59 min vs Runaway Railway 6:10pm / 47 min.                                                                                                                                                                                                                        |
| **New Soarin' Across America**            | —                 | 1.3                                | #1 Tier 2 in all of WDW. Must outrank Mission: SPACE (2.0 → 2.1).                                                                                                                                                                                                                                 |
| **New Disney Jr. Clubhouse**              | —                 | unranked                           | Sorts last; its value is as a passkey, not a rank.                                                                                                                                                                                                                                                |

**As shipped, 2026-09-12.** All three new facility ids from §1 are present.
Landed as asked: Big Thunder at priority 1 with `avgWait` 33, Buzz Lightyear at
1.2 with `avgWait` 37, Winnie the Pooh at 1.3, Expedition Everest at 3.1. Fixed
today, having been reverted by the upstream data merge: Kilimanjaro Safaris to 3
from 4, and Zootopia to 3.2 from no rank at all. Kali River Rapids moved today
to 3.3, so that both Animal Kingdom headliners outrank it. Shipped differently
from what the table asks: Little Mermaid is unranked rather than 4.0, the new
Rock 'n' Roller Coaster Muppets id sits at 1.2 with `avgWait` 61 rather than
1.1, and the new Soarin' id at 2 rather than 1.3, holding the value the ride
already had. Peter Pan's Flight is at 2.1 rather than the 1.2 proposed here: the
tie the renumbering existed to break was removed another way, by Jingle Cruise
going to 1.1 while Big Thunder took 1.

### 3.3 Land corrections — a real bug

`Zootopia: Better Zoogether` (`412430582`) and `Moana (Character Landing)`
(`411921961`) both use `land: discovery` — **EPCOT's** World Discovery — instead
of `discIsland`. A scripted scan of every entry against its section comment
found exactly these two mismatches.

The tipboard corrects `park` on the way through, so listing is unaffected. But
`Itinerary.experienceData()` does not: a held Zootopia LL carries `park =
EPCOT`, which flows into `useUpdateParkFromPlans`, so on a fresh open whose only
LLMP plan is Zootopia, **autopilot polls EPCOT's tipboard on an Animal Kingdom
day.**

### 3.4 Drop-time corrections

- Add `14:47` to Expedition Everest alongside `15:47` (sources disagree; an
  extra burst is cheap, a missed CL10 December drop is not).
- Keep Test Track `17:47` despite being single-sourced, same reasoning.
- **Do not seed Big Thunder drop times** from pre-closure 2024 evidence. Every
  current source says "no predictable drop times" post-reopening, and
  `park.dropTimes` is the union of every experience's — fabricated entries make
  the poller burst at 1.2s when nothing drops. _They had been seeded anyway:
  `['08:47','13:47']` arrived with the same upstream data merge, and on top of
  the wasted burst gave Big Thunder an "upcoming drop" that had
  `shouldHoldTierSlot` decline an offered Tiana's or Jingle Cruise to keep the
  Tier 1 slot free for it. Removed 2026-09-12. The prohibition is now enforced
  rather than conventional: a comment in `api/data/wdw.ts` says why the field is
  absent, and the test `Big Thunder drop times, as shipped`
  (`autopilot/priority.test.ts:464`) asserts it stays absent._
- The nine existing entries are correct. Keep rejecting the viral "1:02 PM mega
  drop," which traces to a single tweet.

### 3.5 Tests worth adding

- Section-consistency scan: for each `// <Park> - <Type>` block, every entry's
  `land.park.name` matches. This is the scan that caught §3.3.
- A startup check logging tipboard IDs absent from `wdw.ts` (§1).
- **Do not** add "every `tier: 1` has a numeric priority and `avgWait`" — it
  fails on Big Thunder's missing `avgWait`, would force a fabricated number,
  and forbids upstream's deliberate removal of Space Mountain's priority.
  _Half of this was overridden on 2026-09-12; see §9.11 for the reasoning. The
  priority half now ships as a test (`api/resortData.test.ts:80`). The `avgWait`
  half is still refused._

---

## 4. Phase 1 — Correctness fixes, in dependency order

**P1.1 · Return-time window UI.** `WatchTarget.after`/`before` are declared,
persisted, revived, and gate **four** paths — `matchWatchList` itself (so
alerts), `offerIsAcceptable`, `shouldModify` and its post-offer re-check, and
`attemptAutoSwap`. But the app's only `addTarget` call passes `{ experienceId }`
and the context exposes no setter, so the only way to set one is hand-editing
localStorage. In practice `inWindow` always returns true and the
`offer-outside-window` skip reason is unreachable. README:58 tells the user to
do something the UI cannot do.

Add `setTargetWindow` to the context, implement beside `toggleFlag`, render two
`<input type="time">` per watched row. `parseBound` is module-private and needs
exporting. Apply the window to _actions_ but keep alerts wider, or an
out-of-window offer goes silently unmentioned.

_Correction to an earlier claim:_ `bookThenMove` is **not** a no-op without
this. It implies both booking and moving, so with empty windows it equals
autoBook + autoModify. What is inert is its distinguishing relax-then-retighten
mechanism. _Effort: small. Unblocks P4.1, P5.2._

**P1.2 · Slot accounting.** `heldMPToday` filters only `isLLMP && same park
day`. `itinerary.ts` drops guests with `redemptionsRemaining === 0` but keeps
the booking, so a fully-redeemed LL survives with `guests: []` and still counts
toward `MAX_HELD_MP`. After your first tap-in bg1 believes the party is full and
**swaps away a reservation it did not need to** instead of booking into the free
slot — inverting the comment at the top of `autoswap.ts`. `LLTracker.update`
already uses `cancellable` as its slot signal, so the two paths disagree about
what "held" means.

Count only bookings that occupy a slot: `isLLMP` + same day + `cancellable` +
`guests.length > 0` + not an MEP. _Verified by direct code read. Effort: small._

**P1.3 · Overlap check on the autopilot path.** Every offer carries `itinerary`
with an `Overlap`; `OverlappingPlans.tsx` uses it to warn before a manual
confirm. The autopilot never looks. For December this is how a slot gets spent
on top of a Candlelight Processional dining package.

Three corrections from verification: (a) build the check from **plans**, not
the offer, so it is a pre-offer guard that works in dry run and saves a doomed
offerset round trip mid-drop; (b) **union** the offer's itinerary with plans
rather than intersecting — a booking made minutes ago may be in one and not the
other; (c) a hard skip is stricter than the warning it models, so
`allowOverlap` is required, not optional. The strongest case is `bookThenMove`,
which strips the window entirely, and the fact that `after`/`before` is one
contiguous interval — two dining reservations in a day cannot be excluded by
hand at all. _Effort: small._

**P1.4 · Expiry counts as ridden.** `resolveBook` releases a booking lock after
two consecutive absences from plans, treating absence as "cancelled, therefore
rebookable." An **expired** pass also leaves plans, and Disney will refuse to
rebook it. Gate the release on `LLTracker`'s `experienced` flag being false too.
_Effort: small._

**P1.5 · Use every `flexEligibilityWindows` entry.** `ll.ts` sorts and keeps
`[0]`. The field is plural because a party can have several slots freeing at
different times; each discarded entry is a moment Disney has told you inventory
opens. Change to `nextBookTimes: ParkTime[]` (keep a `nextBookTime` getter) and
pass the array into `cadence()` — the target loop already handles a list. The
array length is also a live count of imminent free slots. _Effort: small._

**P1.6 · Two kinds of ineligibility in the prewarm cache.** `staleAfter:
earliestEligibleAfter(guests)` is right only for `TOO_EARLY`-style reasons. A
guest blocked by `REDEMPTION_NEEDED` / `TIER_LIMIT_REACHED` /
`TOO_EARLY_FOR_NEXT_PARK` has no expiry and today gets `staleAfter: undefined`,
which either pins a stale entry or forces refetches. Invalidate those on an
observed tap-in. _Effort: small._

**P1.7 · Multiple Experiences Pass handling.** bg1 parses the shape but treats
an MEP as an ordinary held pass. Exclude from `heldMPToday` and from
`chooseSwapVictim` (giving up an anytime pass for a timed one is a downgrade);
when one appears, clear the prewarm cache and force a burst poll — the
ineligibility timer just vanished. _Effort: small._

**P1.8 · A budget that survives a day.** The three-action cap is shared across
all three action kinds and hard-coded (`new AutoBookLedger()` with no argument;
no settings field). It does **not** cap the day at three — re-arming refills it
— but the refill is manual, undiscoverable, and bundled with a state wipe that
also clears the guest cache and the drop-detection baseline, so the first poll
after every re-arm provably cannot detect a drop.

Worse, discoverability is nil: the `break` on `remaining <= 0` sits _ahead_ of
every call site that returns the `session-cap` skip reason, so that label is
dead code and "Why nothing was booked" never mentions the budget. And
`bookingsRemaining` renders only under `anyAutoBook`, so a user running only
book-then-move or swap sees no count at all.

Make it a per-day allowance in settings, add a ledger-only refill action, and
add a `budget-exhausted` state to `StatusRow`. _Effort: small._

---

## 5. Phase 2 — Cadence and drop intelligence

**P2.1 · Widen the burst lead.** `BURST_LEAD_S = 30` starts bursting at :46:30
against a drop landing anywhere from :45 to :49 — bg1 is in 6-second approach
mode for the first half of the band. Raise to ~120 for drop targets; keep
`nextBookTime` targets tight since those are exact. `CLUSTER_TOLERANCE_MIN = 2`
in `observe.ts` already encodes the right band, so the constants are
inconsistent today. _Effort: small._

**P2.2 · Refill windows as a target kind.** `cadence()` models only
instantaneous targets, so bg1 idles at 45s from park open until its first
hardcoded burst — missing the morning re-release window entirely. Add a target
kind with a start and end returning `approach` (6s) across the span. Seed with
park-open+90min for Test Track, Slinky, Tower, Toy Story Mania and Na'vi, and
midday windows for Peter Pan's, Jungle/Jingle Cruise and Runaway Railway — four
of bg1's highest-ranked targets, all currently treated as never dropping. Do
not paste these as `dropTimes`; a 3.5-hour window is not a burst target.
_Effort: medium. Highest-value structural gap found._

**P2.3 · Demote drops that stop firing.** `mergeDropTimes` only ever appends;
there is no negative evidence. Thrill Data publishes only times that fired on
25%+ of the last 30 days, and currently shows _zero_ reliable pop-ups for five
of bg1's nine attractions. Add demotion using the `ScheduledDropCheck` plumbing
that already exists in `observe.ts`. This is what makes the crowd-level and
party-night problems self-correcting without a crowd feed. _Effort: medium._

**P2.4 · Day-before cadence.** README says drops are "a day-of phenomenon" so
future dates poll at idle. Thrill Data shows Slinky with 34 distinct
earlier-return release times at 1 day out, Soarin' with 57. Use approach cadence
during daytime when the watched date is tomorrow. _Effort: small._

**P2.5 · Party nights.** Mickey's Very Merry Christmas Party: Dec 1, 3, 4, 6, 8,
10, 11, 13, 15, 17, 18, 20, 22 (MK closes to day guests at 6pm). Jollywood
Nights: Dec 5, 7, 12, 14, 19, 21, 23. Hardcode both lists and use them to
truncate the park's drop list and the `TimeBanner` label, which will otherwise
advertise 5:47/7:47/9:47pm drops that cannot occur.

The real defect here is in `hasUpcomingDrop`, a bare `+time >= +now` over the
static list: at 4pm on a party day Tiana's still "has an upcoming drop" at
17:47/19:47/21:47, and since Tiana's is the only MK Tier 1 with drop times, the
hold it triggers **never releases for the rest of the day**. _Note: the related
proposal to reject post-close offers was refuted — Disney does not sell LL
return times past close, so that guard is a no-op. The `hasUpcomingDrop` half
stands and is unverified; confirm in park._ _Effort: small._

**P2.6 · Crowd-gated drops.** All five AK drop times carry a CL 4+/7+
qualifier. For December this is good news — AK will be CL 7–10 and they all
fire. Carry the qualifier in the data and gate on a "busy day" toggle so an
off-season user is not burst-polling five dead times. _Effort: small._

**P2.7 · Pop-up vs earlier-time.** Thrill Data separates "a sold-out LL coming
back" from "one that jumps ≥1 hour earlier"; they have different schedules per
attraction, and Flight of Passage and Kali show _only_ earlier-time events.
bg1's `dropTimes` is an undifferentiated union. Tag each entry so `automodify`
can burst on earlier-time targets for attractions it already holds.
_Effort: medium._

**P2.8 · Ride-down detection.** A ride going down and reopening produces a burst
of near-term returns — a drop-class event no schedule predicts. The tipboard
carries standby status beside `flex.nextAvailableTime` and `observe.ts` already
snapshots per poll. Feed the **alert** path only. _Effort: small._

**P2.9 · Faster learning within a trip.** `LEARNED_MIN_DAYS = 2` needs two
distinct park days; a 4–6 day trip barely gets there. Allow the second
observation from the same day at a different hour when the minute-of-hour
matches — that is the actual recurrence pattern. _Effort: small._

---

## 6. Phase 3 — Strategy

**P3.1 · Passkey role and tap-in detector.** Every guide leads with the same
move: book an easy early Tier 2, tap in at rope drop, and the rest of the day is
untiered and cross-park. bg1 has no mechanism for it.

Add a `passkey` role that, before any redemption, books the earliest-returning
eligible non-Tier-1 regardless of rank. Add a detector that, the moment the
party's tap is observed, drops the Tier 1 hold, widens the watchlist to Tier 1
and other parks, clears the prewarm cache and forces one burst poll. Banner:
_"Tap in to Haunted Mansion before 10:15 to lift the Tier 1 limit."_

**Do not derive this from `plans[].guests[].redemptions`** — the itinerary
filters out guests with `redemptionsRemaining === 0` _before_ assigning that
field, so it is structurally incapable of ever being 0. The authoritative
signal is `TIER_LIMIT_REACHED` disappearing from the eligibility response bg1
already fetches via `GuestCache`. Because the gate is per-guest, release only
when every party member has tapped — reuse the whole-party guard's
least-advanced-member logic. _Effort: medium._

_Partly landed, 2026-09-12._ The detector half is built on exactly that signal
(`autopilot/passkey.ts`, wired at `providers/AutopilotProvider.tsx:1418-1493`).
The role half is not: the user marks one target as the passkey by hand, and
`orderByPriority(hits, passkeyFirst)` only moves that target to the front of
hits which already matched the watch list (`autopilot/priority.ts:52-54`).
Nothing selects the earliest-returning eligible non-Tier-1 on its own.

**P3.2 · Surface the timing (not a cascade model).** My draft proposed a
`cascade.ts` scoring offers by how much they delay the next booking. **That was
refuted and should not be built:** the gate is 120 minutes from booking, not a
function of the return time you hold, so a late first booking delays nothing.
A further reason it was wrong: bg1 already sends `targetedTime:
nextAvailableTime` on every offer and calls `changeOfferTime()` when the result
comes back >10 minutes later, so "nothing prefers an earlier return time" is
false.

_A second such reason was given here and was wrong about the code; withdrawn
2026-09-12._ `ll.times()` is not switched off at WDW. `rules.timeSelect = false`
is only the abstract base default (`api/ll.ts:268`); `LLClientWDW` overrides it
to `true` (`api/ll/wdw.ts:141`) and `times()` is fully implemented
(`api/ll/wdw.ts:384-407`) — it is what the NextLL time search runs on. The
refutation stands on the 120-minute gate and on `targetedTime` /
`changeOfferTime`.

What survives is display: show `nextBookTime` as _"you can book your next
Lightning Lane at 11:52 AM"_ on Home and Autopilot. It is authoritative, bg1
already has it, and it turns the whole start-vs-end debate into a non-question.
_Effort: small._

**P3.3 · Expiry rescue.** Letting a pass expire unredeemed counts as riding it.
When a held LL's window plus grace is about to lapse unredeemed, modify it to a
low-demand always-available filler so the good attraction stays rebookable.
Reuses `automodify.ts` wholesale — only the trigger and target differ. Nobody
else offers this. _Effort: medium._

**P3.4 · Park-hop codes handled distinctly.** `TOO_EARLY_FOR_PARK_HOPPING`
carries `eligibleAfter` → schedule a poll target. `TOO_EARLY_FOR_NEXT_PARK` has
no timer → suppress cross-park targets until the tap-in detector fires, and
label it _"tap in at Magic Kingdom first."_ Lets bg1 pre-stage a second-park
watchlist and arm it the instant the tap is seen. _Effort: small–medium._

**P3.5 · Live tier membership.** `LLClientWDW.experiences()` has `return exps;`
on its second line, making the block below unreachable — a block that already
calls `/ea-vas/planning/api/v1/experiences/availability/bundles/experiences` and
destructures a `tiers[]` response. Disney publishes current tier grouping per
park per date. The static flags are correct _today_, but tiers moved twice in
the last twelve months (Big Thunder returned May 2026; Rock 'n' Roller Coaster
left Tier 1 in March and returned in May under a new ID). December is three
months out. Delete the dead return, read tier membership live, keep the static
flag as a fallback that warns on divergence. _Effort: medium._

_Built differently, 2026-09-12._ The dead return is gone, the bundle is fetched
and cached per park and date, and the divergence warning exists — reported, not
applied (`api/ll/wdw.ts:246-265`). But the fetch is gated on
`(date > parkDate() || exps.length === 0)` (`api/ll/wdw.ts:176`), deliberately,
because on a day-of poll the bundle appends closed attractions and the drop
learner files a ride simply opening for the day as a drop. The consequence is
that no bundle is fetched on an ordinary day-of poll, so the tier-divergence
warning cannot fire in the park: live tiers are consulted when planning a future
date, not on the day. If December tiers move, this will not be what tells you.

**P3.6 · Reclaimability for swap victims.** `chooseSwapVictim` assumes Tier 2 is
always cheap to give up. Thrill Data shows Kali selectable for 10h 28m of the
day and Everest 10h 43m — genuinely reclaimable — while some Tier 2s sell out by
9am. A per-attraction "typically gone by HH:MM" lets autoswap surrender the
genuinely cheapest slot. _Effort: small._

---

## 7. Phase 4 — Planning and visibility

**P4.1 · A plan for the day.** `WatchTarget` has no date, park, rank or role,
and one un-keyed array (stored with `kvdb.get`/`set`, not the daily helpers)
applies to every park and every date and survives indefinitely. The strongest
consequence is not the missing screen: the static `priority` is the sole input
to both `orderByPriority` **and** `shouldHoldTierSlot`, so a guest whose
preferred Tier 1 ranks lower in `wdw.ts` has the tool actively pass on it to
protect one they want less. A per-user `rank` feeding both is a
booking-correctness fix, not just UX.

Two secondary hazards: an armed entry for another park is invisible in the
Autopilot screen while you are elsewhere and silently re-arms on return; and
the only ordering lever, `paused`, requires manual intervention during a drop —
exactly when a human cannot intervene.

Introduce `DayPlan { date, parkId, entries: { experienceId, rank, after?,
before?, role }[] }` stored per date. Build the Plan screen from `wdw.ts`
directly rather than a live tipboard call, since watch entries can currently
only be added from a loaded tipboard — that is the real blocker to planning
offline, not the date picker. _Effort: large._

**P4.2 · Auto-book on future dates.** Neither paid competitor makes new bookings
before the park day. bg1 already supports future dates for auto-_move_, and the
offer/book path is date-agnostic. The scenario it wins: you buy Multi Pass at
the 7-day window with one selection because your headliners were gone, and bg1
fills slots 2 and 3 overnight from cancellations. **This is the feature that
would beat both paid tools outright.** _Effort: small–medium._

**P4.3 · Booking-window guidance.** Thrill Data's 7 AM Drop data shows booking
earlier in your window buys dramatically earlier return times (Na'vi: 8:48am at
8 days out, 10:29am at 7, 1:58pm at 1 day). Surface a compact table on
`BookingDateSelect` answering the 7:00am question: which three to grab first,
which are safe to leave. **Use bg1's own observations or attributed public
data — do not scrape Thrill Data's paid tables into the repo.** _Effort: medium._

**P4.4 · Plain-English reasons.** bg1 already computes every reason it acted or
skipped. Extend log entries to _"booked Slinky Dog Dash for 11:05 AM — top-ranked
armed attraction, whole party eligible, inside your 10:00–13:00 window,"_ and add
the counterfactual on holds. UX over data that already exists. _Effort: small._

**P4.5 · Make the timing legible.** A "next drop in 4:12" countdown in the
header and an audible pre-drop chime at T−60s (the AudioContext is already
unlocked). bg1's advantage is being the one looking in the first two seconds;
this converts its foregrounding constraint into a ritual. _Effort: small._

**P4.6 · Show the grace expiry.** A muted _"usable until 7:49 PM"_ beside the
one-hour window. _Effort: small._

**P4.7 · Holiday overlays.** Jingle Cruise (`412010035`) and Jungle Cruise
(`80010153`) are two IDs for one ride; same for Glimmering Greenhouses and
Living with the Land. Both overlay IDs _are_ in `wdw.ts` — confirmed — and both
were absent from Disney's live September data, exactly as expected for a
seasonal overlay. A watch list built now matches nothing once the swap happens,
and the failure is unexplained rather than silent: the header reads "Watching
(5)" while the list shows fewer rows.

The cheap half is the durable fix and should be built first: render watched
targets absent from today's tipboard as a distinct **"not on today's list"**
group. That catches any ID drift, including drift nobody thought to alias.
An alias table is a best-effort convenience — and note commit `f1f022a`
reassigned three holiday IDs last November, so the current overlay IDs need
re-verifying against a live December tipboard. _Effort: small._

**P4.8 · Per-target guest subset.** Both competitors treat "which guests" as a
per-search field; bg1 has one global whole-party flag. _Effort: medium._

**P4.9 · A picture of the day.** Held reservations, windows, grace expiries and
the next booking window on one screen. _Effort: medium._

---

## 8. Phase 5 — Live data (optional)

**Live standby in the ranking.** Replace the hardcoded `avgWait` tiebreak with
today's standby wait from themeparks.wiki. On a December CL10 day the gap
between a 40-minute average and a 110-minute actual is the whole decision. Note
`livedata.ts` currently calls `bg1.joelface.com`, not themeparks.wiki directly,
so this is a new dependency rather than a second call to an existing one. None
of the free feeds carry Multi Pass availability — Disney's tipboard stays the
only source for what bg1 books. _Effort: medium._

---

## 9. Refuted — do not rebuild these

Nineteen findings were adversarially refuted. The most consequential:

1. **A cascade scoring model.** The gate is 120 minutes from booking, not the
   return time you hold. bg1 also already targets the earliest time and
   self-corrects via `changeOfferTime`. See P3.2.
2. **Rejecting post-close offers.** Disney does not sell LL return times past
   close, and LL is unavailable during party hours. The guard is a no-op.
3. **Deleting DINOSAUR.** The tipboard never returns it, so its priority
   influences nothing — the static table is a lookup keyed by API results, never
   a source list. Optional hygiene at most, and the repo convention is
   `id: null`, not deletion.
4. **Removing TRON's priority.** Single Pass rides have no `flex` block and are
   filtered out of the list, the watch picker, `matchWatchList` and autoswap.
   The field is inert on every path.
5. **Giving Space Mountain and Millennium Falcon priorities.** Upstream
   _deliberately removed_ Space Mountain's in commit `1dac5d7`. Worse, Millennium
   Falcon at 2.1 would make `shouldHoldTierSlot` decline an offered Rock 'n'
   Roller Coaster to hold the slot for a weaker attraction.

   **Overridden for the Falcon, 2026-09-12, with reasons.** This item weighed
   only one of the two hazards. An unranked Tier 1 reads as `Infinity` to
   `comparePriority`, so it is attempted last, is never worth a Tier 1 hold, and
   is the preferred thing to surrender in a swap — and that hazard grew the same
   day, because `chooseSwapVictim` no longer protects attractions the data
   leaves unranked: it now excludes only facilities the data does not know at
   all, which `Itinerary` synthesises and flags `unlisted`
   (`autopilot/autoswap.ts:112`). The Falcon is therefore ranked, at 3.1, and
   deliberately **below** Mickey & Minnie's Runaway Railway (3, and the harder
   get at 41 minutes average against 37), so the specific harm this item named —
   declining a better attraction to hold the slot for a weaker one — cannot
   occur. Two tests over the shipped table pin both directions
   (`autopilot/priority.test.ts:414-458`). Space Mountain's 3.1 arrived with the
   same upstream merge and is left alone; this item's objection to inventing one
   for it is untouched.
6. **Swapping Frozen Ever After and Remy.** Three of four post-refurbishment
   sources put Remy at or ahead of Frozen, and bg1's own `avgWait` agrees. The
   December argument does not discriminate — both are in World Showcase.

   **The data ships the swap anyway, and it was not re-litigated on
   2026-09-12.** `wdw.ts` has Frozen at 1.1 with `avgWait: 51` and Remy at 1.2
   with 46; at this plan's baseline it was Remy 1.1/56 and Frozen 1.2/53. The
   upstream merge replaced both ranks and both averages together, which takes
   away half of this item's grounds: bg1's own `avgWait` no longer agrees, it
   now makes Frozen the harder get. Both are EPCOT Tier 1, so the order decides
   which one the Tier 1 hold protects. Left as it ships, on the current
   numbers, rather than flipped on sources this repository cannot re-check —
   but recorded here so the next reader knows the shipped order contradicts
   this item rather than predating it.
7. **Swapping Tower of Terror and Toy Story Mania.** Sources call it a tie
   ("mostly academic"); bg1's own `avgWait` favours Toy Story Mania. Only the
   Little Mermaid demotion survives.
8. **Re-ranking Glimmering Greenhouses to 3.0.** It would tie Soarin' and win
   the `avgWait` tiebreak, putting an always-available greenhouse boat ride
   ahead of the scarcest Tier 2.
9. **Demoting Jingle Cruise to 2.2.** Self-contradictory (2.2 is _worse_ than
   base Jungle Cruise at 1.3), and it would subordinate Jingle Cruise to a
   Tiana's hold all day in the month Tiana's demand is weakest.
10. **Feeding learned drop times into the Tier 1 hold.** `detectDropEvents`
    fires on cancellation flicker; a false positive that costs a wasted request
    in the cadence would cost a forfeited Tier 1 in the hold.
11. **A "every tier:1 has priority and avgWait" test.** Fails on Big Thunder,
    forces a fabricated number, and fights upstream data merges.

    **Half overridden, 2026-09-12, with reasons.** The priority half is now a
    deliberate exception and ships as a test: `api/resortData.test.ts:80`
    asserts every Tier 1 experience has a `priority`. It guards the hazard in
    §9.5 — an unranked Tier 1 sorts last of everything, is never held, and is
    surrendered first, which is exactly how the Falcon shipped. The `avgWait`
    half stays refused, for the reason given here: there is no honest number to
    put there and inventing one is worse than the gap. The first objection above
    no longer applies either way — Big Thunder now carries `avgWait` 33, adopted
    from upstream's own measurement rather than invented.

---

## 10. Open questions to settle in park

Instrument these; do not model them from folklore.

1. **Does an expired, never-tapped first LL free its slot?** One well-cited
   DISboards report says no until you tap into something else. Log the
   ineligible reason at the moment a window lapses. Until settled, treat an
   expected free slot as a hypothesis — try one offer, back off on
   `REDEMPTION_NEEDED` rather than burning the budget.
2. **Is tier release per-guest, and does it need a Tier 1 redemption?**
   Consensus says per-guest and any redemption. Log `TIER_LIMIT_REACHED` before
   and after the first tap, ideally with a split-party tap-in.
3. **Big Thunder's post-reopening drop schedule.** Unmeasured. Let the learner
   run at approach cadence.
4. **Do the December overlay IDs still resolve?** Re-verify `412010035` and
   `412010036` against a live tipboard once the overlays start.

---

## 11. December specifics

- **Party nights** truncate MK on 13 dates and HS on 7. On those MK dates
  daytime crowds are low and the 6pm close kills evening drops; on non-party
  dates crowds are displaced and drops run late.
- **Live overlays:** Jingle Cruise (whole trip), Glimmering Greenhouses
  (Nov 27 – Dec 30).
- **Animal Kingdom** will be CL 7–10, so all five gated drop times fire. Kali
  River Rapids closes on cold days and took an accelerated refurbishment in late
  2025 — check whether it operates at all.
- **Book at the earliest moment your window opens.** The 7 AM data is
  unambiguous: a week out buys morning return times that are gone by three days
  out. On-site, that 7:00am moment is the most important minute of the trip.

---

## 12. Suggested schedule

_Revised 2026-09-12._ §1, Phase 0 and Phase 1 are done, as is most of Phases 2
and 4; the original rows for the weeks of Sept 8 and Sept 15–26 are spent. What
follows is only what is still outstanding, in the order it is worth doing. The
item list under "Status" is the authority on which items those are.

| When            | What                                                                                 | Gate                                                                                          |
| --------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Sept 15 – Oct 3 | Record drop coverage per scheduled drop time, then turn P2.3's `DEMOTION_ENABLED` on | A demotion appears on the Activity screen over real evidence, and no firing drop time is lost |
| Sept 15 – Oct 3 | P2.6 crowd-gated drops; P2.7 pop-up vs earlier-time                                  | AK's five gated times carry their qualifier; earlier-time bursts run only for held targets    |
| Oct 6 – Oct 30  | P3.3 expiry rescue; P3.4 park-hop codes handled distinctly                           | A pass about to lapse is modified to a filler; each code schedules or suppresses, not both    |
| Nov 2 – Nov 20  | P4.8 per-target guest subset; P3.6 reclaimability for swap victims                   | A target books for a subset; autoswap gives up the genuinely cheapest slot, not merely Tier 2 |
| Nov 23 – Dec 5  | P4.3 booking-window guidance; P2.9 faster learning within a trip                     | The 7:00am screen answers "which three first"; a second same-hour observation counts          |
| Dec 6 – trip    | Freeze. Full-day dry runs. Instrument §10.                                           | No code changes in the final two weeks                                                        |

§8's live standby ranking is the only Phase 5 item and stays optional. It is the
largest remaining accuracy gain on a CL10 December day and also a new external
dependency, so it is the first thing to cut and should not be started after
early November. If more slips, cut P4.3, then P3.6.

Two halves of partly-landed items are deliberately unscheduled: P3.1's passkey
selector, which the hand-marked flag substitutes for, and P3.5's day-of tier
check, which is gated off on purpose. Both are explained in §6.
