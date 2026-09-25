# Roadmap

Rewritten 2026-09-23 against `main` at `49a4ef6`, version 1.2.8. It replaces the
revision of 2026-09-19: the goal, the calendar, the themes and the ordering are
new, and the item analyses are carried forward under their old numbers.

**The trip dates are not in this repository, and must not be.** Nothing personal
belongs on GitHub. The dates, and the calendar worked out from them, are in the
owner's private notes — `TRIPS.md`, one folder up, outside every repository. This
file speaks relatively instead: *the rehearsal* is the short first trip, *the
main trip* is the one it rehearses, a trip's *booking morning* is 7:00am ET seven
days before its check-in, and its *freeze* is the week up to that morning.

**There are two trips: the main trip, and a shorter rehearsal before it.** The
owner's framing, recorded 2026-09-23: whatever happens on the rehearsal, the goal
is a main trip that works. Every item is ranked by what it does for the main
trip. The rehearsal is where things get tried, measured and — where it teaches
something — allowed to go wrong.

**The app is not built for these trips.** The trip dates decide *when* work
lands and *when* an assumption can be replaced by a measurement. They must not
decide what the app does. Every item here is written for "a future park date",
"a held pass", "a reservation in doubt" — never for one particular date, and never
for Walt Disney World in one particular week. If an item can only be stated in terms
of a specific date, it is data maintenance (item 7) or it does not belong here.

**How to read it.** Each item says what it is, why it earns time now, what could
go wrong, and — the part that matters — what "done" observably means. Sizes are
honest rather than encouraging: _small_ is an evening, _medium_ is a session or
two with tests, _large_ is a week and a decision. Numbers are stable identifiers,
referenced from `docs/` and from commit messages; they are not priority order.

**Nothing in this file is required.** The tool is usable today and has booked for
real. This is what would make the main trip better, in the order it is worth doing.

---

## What changed since the last revision

- **A pocketed phone became something to rely on.** 1.1.0 through 1.2.8 added
  Pocket mode, a working alert channel, and live sound and screen-wake status on
  Today and on the shield. iOS Guided Access covers the one thing a web page
  cannot: Safari's own toolbar. The alert channel had been silently dead since it
  was written — `resume()` alone does not unlock WebKit audio — and is now
  verified on the phone, on a real find.
- **AutoLL-4 is synced** to 1.2.8 with its own sensor path intact, and verified
  on the phone.
- **The documents were cut back.** Both READMEs are introductions. Building,
  verifying and releasing live in `docs/RELEASING.md`; limitations and Guided
  Access live in the user guide.
- **The first trip became a rehearsal**, which changes what its freeze and its
  park days are for.
- **A silent loss turned up in a place nobody had looked** — between the trips.
  See theme 1.

## The calendar

The dates themselves are kept privately (see the top of this file); every step
here is fixed relative to a trip. The arithmetic is the part worth keeping in
writing: the booking-date picker offers today plus twenty-one days
(`NUM_BOOKING_DAYS = 22`), so a park day becomes selectable twenty-one days
before it.

| When | What happens | What it is for |
|---|---|---|
| **Now → the rehearsal's freeze** | Test and tweak against live Disney data | Items 12, 3, 8's honesty half, 13, 14 — and start the learner |
| **21 days before the rehearsal** | Its first day appears in the date picker | A free reading that decides item 6 |
| **The rehearsal's freeze** | The week up to its booking morning | Rehearsing the main trip's freeze is part of rehearsing the main trip |
| **Early in that freeze** | AutoLL-3 → AutoLL-4 merge | `docs/SYNC.md`: not on an AutoLL-3 deploy day |
| **The rehearsal's booking morning, 7:00** | The first real booking morning | Write down what was hard: it is item 15's specification |
| **Booking morning → check-in** | The gap before the trip | Fixes from the booking morning; item 4 if not already in |
| **The rehearsal** | Its park days | Watch, record, and let it fail usefully |
| **Within a week of it** | **Export** (item 12) — or at least open the app | Before iOS's seven-day storage cap can take the rehearsal's learning |
| **Between the trips** | Build the main trip on what the rehearsal showed | Retrospective; item 15; item 6 if the picker reading said so; item 7 once the holiday overlays start; item 17 |
| **The three weeks before the main trip** | Its days enter the picker, one a day | Build the main plan |
| **A week before its booking morning** | Last change | Freeze from then through the trip |
| **Its booking morning, 7:00** | The booking morning that matters | Every day of the stay, in one morning, from home |
| **The main trip** | The trip | |

So the main plan can be built in the picker, day by day, in the three weeks
before the trip; its last day arrives about a day before the freeze. It works,
with almost no slack.

## Three moments, and the tool is tuned for one

| Moment | Where | Stakes | How well served |
|---|---|---|---|
| **Booking morning** | a desk, at 7:00 | The highest of the year. A pass for the wrong day cannot be moved, only cancelled into inventory that is already gone | Least. Item 15 is the first work aimed at it |
| **Park day** | a pocket | Recoverable | Most. It is what 1.1–1.2.8 built |
| **Between trips** | nowhere | What the rehearsal teaches either compounds into the main trip or is lost | Not at all, until item 12 |

Inside a park the loop is already good: the shield is a status display, so
checking on the engine is take the phone out, glance, put it back — no taps. What
is still slow and easy to get wrong is the **start** of each day, and that is
where items 13 and 14 are aimed.

## The themes

**1. Never lose something silently — including between trips.** This used to mean
the screen in your hand. It now has to mean the months between the trips as well.
Every piece of AutoLL-3's state — the party, the watch list, the booking log and
the learner's drop observations — lives in `localStorage` on Disney's origin
(`src/kvdb.ts` wraps it directly), and nothing in `src/` can get any of it off the
phone. WebKit deletes "all of a website's script-writable storage after seven
days of Safari use without user interaction on the site"
([WebKit, 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)),
naming LocalStorage. The rehearsal manufactures the learned drop times —
`LEARNED_MIN_DAYS = 2`, and it is the first trip long enough to meet it — and the
main trip is when they are used, weeks later. A phone that goes about a
week of Safari use without opening AutoLL-3 in between loses them, and the plan
with them, and nothing says so. Item 12.

**2. Learn from every live day, not only the trip days.** The learner does not
need a park. It runs whenever the booking date is today, for every attraction on
the watch list, and it is gated on neither dry run nor location — Disney's tip
board is the same from a sofa. So the rehearsal does not have to wait for its
first park day: every ordinary day from now to the main trip is a day of real
drop observations, available from home. See *Learn from home*, below.

**3. Make the start of the day fast and hard to get wrong.** Two mornings. On the
booking morning the failure is a pass for the wrong day. On each park morning the
checks that decide whether the day will work sit in four places, and the park
resets itself overnight. Items 13, 14 and 15.

---

## The plan

### Now → the rehearsal's freeze: test and tweak against live data

Every morning until the freeze has live Lightning Lanes. In order:

1. **Item 12 — back up the plan and what the learner has seen.** Export first: it
   is small, and it is the piece everything meant to carry forward depends on.
   The narrow restore follows.
2. **Learn from home** (below). No code. It can start today.
3. **Item 3 — warn before a held pass lapses.** Promoted; see its note.
4. **Item 8, its honesty half only** — stop Today naming a "Next drop" for a date
   the engine will never burst for. It is what Today shows on a booking morning.
5. **Items 13 and 14** — a park-morning preflight, and a Today that points at the
   park the plan is for.
6. **Item 4** — name the Tier 1 blocker. Medium; if it does not fit, it takes the
   gap between the rehearsal's booking morning and its check-in.

Two readings, both free:

- **Twenty-one days before the rehearsal.** Its first day appears in the date
  picker. Open Configure for it. Whether Disney's tip board returns usable rows
  twenty-one days out settles item 6: if it does not, the main plan cannot be
  built in the picker either, and item 6's parts (b) and (c) come back before the
  main trip.
- **Any morning.** Move the picker three and seven days out and read
  `ll.nextBookTimes`. It settles item 1's design.

**The honest limit on this list.** Last week put eight releases through one file,
`alert.ts`, and each of the last three fixed a defect the one before had
introduced. `alert.ts` is frozen for the trip unless a phone shows a live defect.
Every item above is aimed elsewhere, and should stay aimed elsewhere.

### Learn from home

Pick a park each day. Arm the attractions you want on the main trip at that park, turn
on **Dry run**, and leave Autopilot running on a plugged-in phone with the screen
on. The learner records real drops for everything on the watch list, and the
Activity screen shows what it has learned. Rotate the parks across days. By the
main trip there can be weeks of observations instead of a rehearsal's few days.

Three things to know. Drops learned weeks ahead may not be the trip's drops —
and that is safe rather than harmful, because learned times are merged into the
schedule instead of replacing it (`mergeDropTimes` only appends), so a stale one
costs a burst at a minute that no longer drops, never a missed drop. It is real
traffic to Disney at a park day's cadence, so run it during park hours, not around
the clock. And it makes item 12 more urgent, not less: the more a phone has
learned, the more the seven-day cap can take.

### The rehearsal's freeze

The freeze is on **pushes to `main`**, and the rule is sharper than this file used
to say. `deploy.yml` now carries `paths-ignore: ['**.md']`, so a markdown-only push
does not republish the bundle. But `docs/user-guide.html` is not markdown, and it
ships as the live guide: an edit to it rebuilds and republishes the exact bundle
the freeze exists to leave alone. **During a freeze, do not touch the guide's
HTML.** The previous revision said every push deploys, which aimed the one warning
this section carries at the wrong files.

Keep the freeze even for a rehearsal. The main trip's booking morning will sit
behind one, and finding out on the rehearsal that the freeze has a hole in it is
part of the point of rehearsing.

### The rehearsal's booking morning: the first real one

Write down what was hard, as it happens — which search, which screen, which date
change. That note *is* item 15's specification. A booking-morning screen designed
before this morning would be a guess; designed after it, it is a fix.

### The rehearsal's park days

What to watch, alongside using it:

- **Item 4** fires only in the first hours of a real park morning. This is the one
  chance to see it before the main trip.
- **The questions only a park can answer** (`FUTURE.md` §5): whether an expired,
  unredeemed pass frees its slot, and whether the Tier 1 release is per guest.
- **The morning routine itself** — how long from waking to a running, guarded,
  pocketed phone, and what went wrong on the way. That is what items 13 and 14 are
  for, and item 16 is where to write it down.

### After the rehearsal

Export within a week (item 12). Then build the main trip on what the rehearsal
showed: a retrospective, item 15, item 6 if the picker reading said so, and item 7
once the holiday overlays start. What waits until after the main trip is at the
end of this file.

---

## New items

### 12. Back up the plan and what the learner has seen — _small, then medium_

> **Status, 2026-09-23 — built: export in 1.3.0, restore in 1.4.0.** **Backup
> and Restore** in the Settings menu opens its own screen, because the menu runs
> its items fifty milliseconds after closing and iOS opens the share sheet only
> from a tap. **Back up now** shares one versioned JSON file, and a grey line in
> the menu says how long it has been since the last backup; enumeration lives in
> `kvdb` itself (`kvdb.entries()`), so the namespace filter sits at the storage
> boundary. **Restore** shows what a picked file holds before it writes
> anything, then writes an allowlist of seven keys: the plan is **replaced**, the
> owner's choice; the learning is **merged** under `observe.ts`'s own caps; and
> nothing else is written, including any key added later. A failed write puts
> every touched key back. It refuses while any engine runs — a Time Search under
> a pushed screen included, through `src/autopilot/running.ts` — and ends in a
> reload, because every open screen still holds the plan it loaded. Left: the
> on-phone round trip under *Done means*, and the port to AutoLL-4 by merge.

**Why.** Theme 1. Everything lives in `localStorage` on Disney's origin, iOS
deletes it after about a week of Safari use without a visit, and there is no way to
get any of it off the phone. The learned drop times that the rehearsal produces
are the ones the main trip uses.

**What.** An **Export** button that gathers everything under the `autoll3.*`
namespace into one versioned JSON file and hands it to the share sheet —
`navigator.share` with a file, from a user gesture — so it can go to Files,
AirDrop or a Mac. Then a **Restore** that reads one back.

**Never in a backup: `auth` and `auth.persistence`.** They hold a live Disney OneID
token. `SECURITY.md` already says not to share "browser storage exports" for
exactly this reason, and a file on a share sheet can end up in iCloud, Mail or
Messages. A test must fail if either key ever appears in an export.

**Restore is deliberately narrower than export.**

| Restored | Never restored |
|---|---|
| The plan: `autopilot.watchlist`, `nextll.watchlist`, `genie.partyIds`, `genie.tipBoard.starred` | `auth`, `auth.persistence` |
| The learning: `autopilot.dropEvents`, `autopilot.coverage`, `autopilot.watched-days` — **merged** with what the phone already holds, never replacing it | Engine state: `autopilot.leases`, `autopilot.leases.mutex`, `autopilot.locks`, `autopilot.unresolved`, `autopilot.commits`, `nextll.pending` |
| | `autopilot.planCheckReview` — scoped to one reviewed plan, meaningless anywhere else |
| | **Dry run**, and the rest of `autopilot.settings` |

Engine state describes reservations at one instant. Written back into a live run it
could make the engine refuse a reservation that is free, or act on one that no
longer exists — the class of failure leases and quarantines were built to prevent.
Dry run is excluded for a sharper reason: restoring it is silent and wrong in both
directions. Off makes a rehearsal book for real; on makes the main trip book
nothing.
The phone keeps its own setting.

**Risk.** A backup from a newer build, an older schema, or the other build. The
file carries a schema version, `APP_NAME`, `BUILD_REV` and the export time, and
restore refuses a newer schema or a different `APP_NAME` with a message rather
than guessing. Sharing learned drops between AutoLL-3 and AutoLL-4 would be useful
— AutoLL-4 can observe from a desktop — and is deliberately out of scope:
`docs/SYNC.md` keeps the two stores apart, and loosening that is a decision, not a
side effect.

**It answers item 9(a)'s open question.** Item 9 left open whether reading new
instrumentation back "over a cable" was acceptable. With an export, it no longer
has to be.

**Where.** A pure module — collect, serialize, validate, merge — beside
`src/autopilot/storage.ts`, and a button on Settings. `navigator.share` with a
file must be proved on the phone; fall back to a download or the clipboard where
it is refused.

**Done means.** Tests that fail on HEAD, where no export exists: an export never
contains `auth` or `auth.persistence`; a restore never writes an engine-state key
or changes dry run; learned data merges, so the union survives and nothing is
lost; a plan round-trips; a newer schema or a different `APP_NAME` is refused.
Each one mutation-proven. And on the phone: export, clear the site's data,
restore, and see the plan and Activity's learned drops come back.

### 13. A park-morning preflight on Today — _small_

**Why.** The pre-trip checklist disappears the moment the booking date is today
(user guide §8) — the morning it would help most. On a park morning the checks
that decide whether the day will work sit in four places: the night-before list in
the guide, the dry-run banner, the Test sound row and the session-expiry line.

**What.** When the booking date is today and Autopilot is off, one go/no-go block
near the top of Today: the park has targets (item 14), dry run's state, the
session lasts past 5 p.m., and sound — with Test sound inside the block. Its last
lines are **Turn on autopilot**, then **Pocket it**.

**Risk.** Item 5's lesson: a checklist that claims a readiness it never verified
is worse than none. Every row reads a real signal, and a row that cannot know says
so rather than ticking. A single "start the park day" tap — on, test sound, pocket
— is tempting and deliberately left out of the first version: pocketing in the
same tap means never seeing the first poll come back.

**Done means.** A Today test at date = today with Autopilot off renders the block,
each row reflects its own signal, and the block is gone once Autopilot is on.

### 14. Point Today at the park the plan is for — _small_

**Why.** The park is saved with `kvdb.setDaily` (`src/providers/ParkProvider.tsx:30`),
so it resets overnight. On a morning whose plan is at another park, Today reads
"Nothing watched at Magic Kingdom on this date" while the whole plan sits at
EPCOT — and only Configure says so ("{N} more saved for another park or date").

**What.** When today's targets are at a park other than the header's, Today says
which, with how many, and offers to switch.

**Risk.** Never switch on its own: an unannounced park change is a silent change
of its own. If targets exist at two parks on one date, name both rather than
choose.

**Done means.** A Today test with targets at EPCOT today and the header on Magic
Kingdom shows the nudge; with nothing saved elsewhere, it shows nothing.

### 15. A booking-morning screen — _medium, after the rehearsal's booking morning_

**Why.** The booking morning is the highest-stakes moment of the year and the
least served. The failure that cannot be undone is a pass booked for the wrong
day, and the morning is nine or more sequential searches with the date picker
changed between them, on a different screen.

**What.** Specified by the rehearsal's booking morning, not before it. The likely
shape: the date being
booked in large type, what is already held for each day of the stay, and what is
next.

**Deliberately not:** Autopilot booking every day of a stay on its own. The engine
is built around one booking date — 111 non-test references across 23 files, per
item 6 — and rebuilding that before the main trip would repeat last week's pattern on
the most dangerous code in the project.

### 16. Field notes — _small, optional_

**Why.** Asked what the parks might show that the code does not, the owner's
answer was "not sure" — which is what a rehearsal is for — and memory after a park
day is poor.

**What.** A note box on Activity. Each note is stamped with park time and the
current park and date, kept beside the activity log it refers to, and carried in
item 12's backup: "Tiana's dropped at 9:44, not 9:47." "The shield lifted in my
pocket."

**Risk.** Storage growth on a phone. Cap it, as `observe.ts` caps its events.

### 17. Notice a new build, and move to it — _medium_

**Why.** After a deploy the phone keeps running the old bundle. GitHub Pages
sends `Cache-Control: max-age=600`, and the bookmarklet and the userscript load
`bg1.js` from one fixed URL, so Safari reuses its copy for up to ten minutes —
and an app that is already open never looks again at all. 1.4.0 was live and
byte-verified while the phone still ran 1.3.0. On a park day that gap is the
difference between an emergency fix reaching the pocket and not.

**What.** The owner's choice (2026-09-23): reload on its own when it finds a new
version. Check the served manifest — `autoll3-release.json`, fetched with
`cache: 'no-store'`; Pages sends `access-control-allow-origin: *` — whenever the
app comes to the foreground, and every fifteen minutes while it is open. When
its `sourceRevision` is not this bundle's `BUILD_REV`, move to the new build **in
place**: do what the bookmarklet does, with the revision in the bundle's URL so
no cache can serve the old one. Not `location.reload()` — for the bookmarklet
that reloads Disney's page and leaves the app off until someone taps the
bookmark again. The bookmarklet itself never needs to change: it is a fixed URL
and one `script` tag, byte-identical across releases.

**Risk.** Moving mid-run. Never while any engine runs (`anyRunning()`, from item
12), while Pocket mode is up, or while a restore's reload notice is showing;
say instead that a new version is ready and loads once Autopilot is off, and
offer a tap. Second, version skew: the chunks (`wdw.js` among them) have fixed
names and are cached apart from `bg1.js`, so a fresh bundle can load a stale
chunk — already possible inside today's ten-minute window. Content-hashed chunk
names close that, and change what `autoll3-files.sha256` lists. Third, Disney's
page could refuse the fetch; then the check fails quietly and nothing changes.

**Done means.** With the manifest naming another revision: with nothing running,
the loader runs with that revision in the bundle's URL; with an engine running,
it does not, and the screen says a new version is waiting. On the phone: deploy,
leave the app open and idle, and watch the footer's revision change within
fifteen minutes, without a tap.

**When.** Between the trips. It changes how the app loads, which is the wrong
thing to change in the weeks before a freeze.

---

## Open items

**Every item below keeps the citations of the revision that wrote it.** The code
has moved a long way since — 1.1 through 1.2.8 rewrote large parts of
`AutopilotProvider.tsx`, `Today.tsx` and `alert.ts` — so re-verify every line
reference before acting on one. That is this file's own rule from 2026-09-19,
applied again. Each item opens with a status note written for this revision.

### 3. Warn before a held pass lapses — _small_

> **Status, 2026-09-23 — promoted.** This item said to build the Today countdown
> first and treat the notification as the addition, because the alert fires only
> while Autopilot runs. That ordering still holds for the countdown, which is the
> half that works with Autopilot off. What changed is what the notification is
> worth: through 1.2.4–1.2.8 the chime became a working channel that reaches a
> pocket, and for a pocketed phone it is the only half that does anything. Ship
> both halves together.


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
no Disney fact sits behind it and the rehearsal cannot observe it. The unmeasured fact
is the *grace period* past `end.time` — how late a turnstile still accepts a
pass — and it decides whether `end.time` is even the right anchor at all. That
one can only be observed by deliberately tapping in late at a real turnstile,
which is something to choose to do on the rehearsal, not something the trip
produces on its own. So: ship N as a named, explicitly-unverified constant now, and
record the grace-period observation as a separate rehearsal decision rather than as a reason to
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

### 8. Count down to the drop the engine is actually bursting for — _medium_

> **Status, 2026-09-23 — repriced: take the honesty half alone.** The countdown
> half rested on a countdown getting the phone out of a pocket before a drop.
> With the screen wake lock and Pocket mode the page stays foregrounded in the
> pocket, and Autopilot bursts without the phone coming out, so that premise no
> longer holds. The honesty half stands and is small: on a booking date that is
> not today, Today names a "Next drop" for a date the engine never bursts for —
> the last part of this item — and that is what Today shows on a booking morning.
> De-duplicating the two `Next drop:` lines described below belongs with it. Drop
> the countdown unless the rehearsal gives a reason for one.


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
lie, and the rehearsal is the first trip long enough to manufacture one. It is
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
shows on a booking morning — when the booking date is a week out and the real
work is happening on
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

### 4. Name the attraction the Tier 1 hold is waiting for — _medium_

> **Status, 2026-09-23 — build before the rehearsal.** It can only be seen in
> the first hours of a real park morning, so the rehearsal is the one sighting
> before the main trip. Build it against the fakes and treat the rehearsal as the
> sighting, not the test. Item 8's honesty half settles which drop time to print, which argues for
> doing that first.


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
first hours of a real park morning. The rehearsal is the one chance to see it
fire before the main trip. Build it against the fakes and treat the rehearsal as
the sighting, not the test.

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

### 1. Burst for a future date's booking window in the unattended engine — _medium_

> **Status, 2026-09-23 — unchanged, and still behind one reading.** Both booking
> mornings are attended, and a hand-started NextLL search already polls at 600 ms
> on any date. What remains is the unattended engine. Read `ll.nextBookTimes`
> three and seven days out before designing anything.


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
API-driven design is dead and the decision is made without waiting for the
rehearsal. `NUM_BOOKING_DAYS = 22` (`BookingDateProvider.tsx:24`) bounds what can
be looked at: the picker offers today and the twenty-one days after it, so a trip
day itself cannot be inspected until twenty-one days before it.

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

**This item is not served by the rehearsal, and the old text said it was.**
The gap is inert during its park days: on those days `bookingDate === parkDate()`,
`watchingToday` is true, and the poller already bursts. The trip cannot exercise
this at all. The date-pressured moment is the rehearsal's *booking* morning, from
home — 7:00am ET seven days before check-in for resort guests, or three days
before each park day for everyone else (`docs/PLAN.md:269-271`). Which of those
rule applies here was settled on 2026-09-19: on-site, so the morning is seven
days before check-in. This item does not turn on it — that morning is before the trip
either way, and the feature is about any future park date. The one observation no amount of effort buys early is what the
response looks like at the instant a window actually opens, which requires
watching on a morning one does.

### 6. Let a plan outlive the booking window — _large_

> **Status, 2026-09-23 — decided twenty-one days before the rehearsal.** That is
> the morning its first day appears in the picker. If Configure shows usable
> rows, the picker serves the main trip and this item waits until after it. If it
> does not, parts (b) and (c) are needed before the main trip's days enter the
> picker.


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
`targetApplies` refuses it on any later trip day. Nor does it lapse on its own:
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

**The demotion's missing half.** The 2026-09-17 demotion rests on the main
trip's days becoming selectable in the picker before the freeze. Selecting the date is
necessary but not sufficient. Configure's add list is
`experiences.filter((exp): exp is Experience => !!exp.flex)`
(`Configure.tsx:83-84`), and `experiences` comes only from
`await ll.experiences(park, bookingDate)`
(`src/providers/ExperiencesProvider.tsx:68`) — Disney's tip board for that one
date (`src/api/ll.ts:320-327`). Nobody here knows what that endpoint returns
for a park date twenty-one days out: rows with `flex`, rows without, or
nothing. If it returns nothing usable, `watchable` is empty the morning the main
trip's first day enters the picker, Configure renders "No attractions loaded
yet.", and the main plan cannot be built in the picker after all — which is `FUTURE.md` §3.2 exactly, and would
un-demote this item. **The roadmap treated that as settled; the code does not
settle it.**

What would settle it costs nothing and has a date on it. The same clamp that
blocks the main trip blocks the rehearsal right now: each of its days becomes
selectable only twenty-one days before it. That is not a problem — but it means
the "build it in the picker" workflow the demotion rests on gets its first
rehearsal twenty-one days before the rehearsal, and whoever opens Configure that
morning answers this question for free. One request
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
target arms on every park day — the main trip's plan booking on a morning weeks
before it. The opposite order merely makes targets vanish, which
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
`expect(targetApplies(scoped, 'mk', '2031-02-15')).toBe(false)` and passes
today, because it encodes the blocker rather than the fix — it will still pass
after this ships. The test that fails on HEAD belongs in
`src/providers/AutopilotProvider.test.tsx`, whose fixture already has what it
needs (`setBookingDate: (date: string) => view.rerender(<Tree date={date} />)`,
line 461): star an attraction while the plan date is a day beyond the window and
the booking date is still today, then assert the stored target carries that plan
date and that `isWatched` is true for it on that plan date.
Both halves fail now — `addTarget` has no input but `bookingDate`
(`AutopilotProvider.tsx:1910`), and `validDate` will not let `bookingDate` hold
such a day in the first place.

**Where.** `FUTURE.md` §3.2's _Where_ line cites
`src/components/ll/screens/Configure.tsx:87,275-300` and both halves have moved:
87 is now the `matchesFilter` helper and 275-300 the undo toast. The add list is
derived at `Configure.tsx:83-85` and rendered at `376-398`. Strike the old line
rather than leave it standing.

**Demoted 2026-09-17; moved here 2026-09-19.** The owner answer stands — skip
this cycle, revisit after the main trip — and the date blocker is still real and
still worth fixing on general grounds, because planning a trip should not
depend on being inside a twenty-two-day window. The trips do not need it: the
rehearsal cannot exercise it, and for the main trip the picker probably suffices.
But "probably" is the honest word, and it has a cheap test twenty-one days
before the rehearsal. If that morning's tip board for its first day comes back
without usable `flex` rows, the picker workflow will not serve the main trip
either, part (b) becomes
load-bearing rather than a convenience, and this item comes straight back to
_Before the trips_ in its (b)-and-(c) form.

### 9. Fix the gate, the test timeout and Dependabot in one evening — and stop calling the settle-time row a rehearsal item — _medium_

> **Status, 2026-09-23.** Item 12 answers (a)'s open owner question: with an
> export, new instrumentation no longer has to be read back over a cable. Which
> instrument (a) builds is still a decision. (b), (c) and (d) are still one
> behaviour-neutral evening, and Dependabot's branches are still open.


Three small diffs and one thing that is not a diff. (b), (c) and (d) are the evening: unblocked, behaviour-neutral, and untouched in both repos — `check.yml`, `jest.config.js`, `lease.ts` and `observe.ts` are byte-identical to AutoLL-4's copies. (a) is a session, and the reason it was promoted on 2026-09-17 does not survive contact with when doubts are actually raised.

**(a) Record how long a change takes to land.** Retract the rehearsal deadline as stated. The claim was that a park day without this is a park day spent; for the version described — one capped row the first time a doubt settles — the rehearsal's few park days will almost certainly write zero rows. A doubt exists only when the outcome is indeterminate: `AutopilotProvider.tsx:1431-1434` raises one only when `current.dispatched && outcome?.status === 'failed' && !outcome.rejected`, and every commit whose response comes back, success or definite rejection, takes the `else if (current.dispatched)` branch at `:1449` and calls `resolveDoubt` at `:1453`, creating nothing to settle. The only other source is the deadline, and `MAX_MUTATION_MS` (`mutation.ts:7`) is `TICK_DEADLINE_MS + RENEW_INTERVAL_MS`, 90s plus 40s: a mutation has to hang 130 seconds. So the instrument samples exactly the sub-population where the response was lost *and* Plans later proved the exact requested state.

That is also why this is not the measurement `FUTURE.md` §5.5 asks for, despite the item saying it is. §5.5 is explicit: log the send, log every subsequent plans read that does and does not show the change, and let the distribution of the ones that eventually appear set the window. That is a second store plus a hook in `PlansProvider`, and it is the version with a real claim on the rehearsal under this file's own rule that anything turning an assumption into a recorded fact should land before the test trip. The narrow row's honest deadline is **the main trip's freeze** — its park days are a better sample than the rehearsal's, and an instrument not in the build before the freeze cannot produce anything on the main trip either. Decide which of the two is being built before writing any of it; they are not the same size and only one of them has a rehearsal reason.

The mechanical claim about the code is nearly right and one word wrong. `Doubt.at` is the dispatch instant (`lease.ts:103`, written from `dispatchedAt` at the two `quarantine()` call sites, `AutopilotProvider.tsx:1440` and `:1223`), `reconcile()` takes `polledAt` (`lease.ts:613-619`), and `landed()` (`lease.ts:562`) is the only thing that counts as proof. But they do not pass through one function — they pass through one function in *two branches*: the volatile pass at `lease.ts:625`, outside `exclusive()`, and the durable pass at `:644`, inside it. A row written in one branch misses half the population, and the volatile half is precisely the case where durable storage has already failed.

**Risk, and it is not the one this item names.** The obvious place for the write is inside `exclusive()`'s body beside `if (changed) kvdb.set<Quarantine>(QUARANTINE_KEY, next)` (`lease.ts:649`), and `kvdb.set` is a bare `localStorage.setItem` with no try/catch (`kvdb.ts:19-21`). Put the measurement write before the quarantine write and a `QuotaExceededError` on a phone aborts the clear: the doubt is never removed, the `finally` at `:651-653` still fires `publishQuarantineChange()` so the UI repaints with the doubt still showing, and the throw lands in `PlansProvider.tsx:99`'s `.catch(error => console.error(error))`. The result is a reservation the engine refuses to touch for the rest of the trip, for a reason that exists only in a console nobody opens in a park. Which also disposes of the item's opening sentence: (a) is not behaviour-neutral, because it adds a storage write to the path that clears a quarantine. The measurement write goes *after* the quarantine write, in its own try/catch, in both branches.

**Not into the activity log** — that part stands, checked. `LOG_LIMIT` is 20 (`storage.ts:11`) and the log is written through `kvdb.setDaily` (`storage.ts:161-163`), so a park day's real bookings push the measurement out and the 4am rollover drops the rest; `storage.test.ts:84`, `is scoped to the park day`, asserts exactly that. `observe.ts` is the right home: plain `kvdb.set` (`:431`), not day-scoped by its own comment at `:412`, `MAX_EVENTS = 1000` (`:34`) and `MAX_COVERAGE_DAYS = 30` (`:38`). What the item never says is how the rows are read back. `observe.ts`'s data reaches a screen — `Activity.tsx:42` pulls `dropSummaries` out of the context — and a new store would not, so on a build that in practice runs only in a phone browser, reading it the day after the rehearsal means Web Inspector over a cable. Whether that is acceptable is an open owner question, and it is the difference between an evening and a weekend. Keep §5's warning in the comment either way: this must never become an automatic fail-open rule again.

**(b) Make the gate tell the truth.** Correct the count first: four steps carry `if: '!cancelled()'` — Tests, Lint, Typecheck, Build at `check.yml:44-62` — and `npm ci` at `:35` is unconditional. The consequence the item states is right and live: #30 and #31 are both red now, five red steps each from one unresolvable peer range. The form matters. A step `if` containing no status-check function is implicitly ANDed with `success()`, so `if: steps.install.outcome == 'success'` would restore fail-fast and destroy the report-everything-at-once property `check.yml:3-6` exists to defend; write `if: ${{ !cancelled() && steps.install.outcome == 'success' }}`. Do not rename the `check` job — it is the required status context on both protected mains.

**(c) Give the two slowest tests their own timeout.** The word is *tests*, not suites, and an implementer following "suites" edits the wrong files: Jest's `testTimeout` is per test, and `jest.config.js` sets none at all, so the 5000 ms default is in force everywhere. Measured here on a full `TZ=UTC npx jest --ci` at load average 2.4 — 1446 tests, 7.5 s wall — the two slowest individual tests in the entire run are `Home.test.tsx :: shows LL home screen` at 1714 ms and `MultiPassList.test.tsx :: shows LL availability` at 1508 ms, with third place `BookExperience.test.tsx :: performs successful booking` far back at 657 ms. The item named the right two. By *suite* wall clock the ranking is different — `AutopilotProvider.test.tsx` 5251 ms and `BookExperience.test.tsx` 4496 ms lead, with Home and MultiPassList third and fourth — which is the trap the old wording sets. Name the number and say what it is for.

**(d) Pause Dependabot until January.** Nine stand open here (#1-#6, #8, #30, #31 — #7 was merged and #9 closed under `FUTURE.md` §6's plan), and two of them, the vite majors #30 and #31, cannot go green alone. The figure the item misses is AutoLL-4's own nine, all opened 2026-09-17, with two red of its own: #7, the TypeScript 7 bump this repo already investigated and closed, and #9 `eslint-plugin-react-hooks`. Eighteen across two repos, and `.github/dependabot.yml` is byte-identical in both, so pausing one leaves the other generating. Put the trade in the commit message rather than leaving it in a different document: `FUTURE.md` §6 records that Dependabot's *security* half is switched off for this repository, so pausing version updates removes the only Dependabot signal there is. The compensating control is real — `npm audit --omit=dev` is 0 and only `react` and `react-dom` ship — but it belongs where the pause is. Budget a rebased PR rather than a push: AutoLL-3's main is `strict: true` with `enforce_admins: true`, and the required context is `check`.

**Done means.** The item had none, which is part of why it drifted. Four, each failing on HEAD. (a): a `lease.test.ts` case that makes `localStorage.setItem` throw for the timing key only and asserts `reconcile()` still removes the doubt from *both* the volatile and the durable store — there is no timing instrumentation anywhere in `src` or `harness` today, so it fails now, and it is also the test that fails on the obvious implementation. Write it knowing `FUTURE.md` §6's warning that `volatileQuarantine` is module state `beforeEach` cannot reset, and that three cases already clean up by hand in a `finally` (`lease.test.ts:235`, `:267`, `:627`). (b): a branch with a deliberately broken lockfile reports one red step, not five. (c): `jest.config.js` carries a `testTimeout` with a comment naming the two tests and the margin. (d): `.github/dependabot.yml` is paused in both repos, in one PR each, with the security-half trade written into the message.

### 7. Run the late-November data check, and apply the correction it is named for — _small_

> **Status, 2026-09-23 — calendar-blocked until the overlays start, around
> November 27.** Unchanged, and its correction to `FUTURE.md` §3.3 is still
> unapplied in the three places listed below.


This corrects `FUTURE.md` §3.3, which still says re-verification "needs a live
tip board once the overlays are running, which is inside the freeze"
(`docs/FUTURE.md:189-192`). It does not. `docs/MONITOR.md:42-43` records the
mirror as "free, no API key, no account", `docs/MONITOR.md:87` establishes that
every attraction's `externalId` in that feed is the Disney facility id this
repository already keys on, and `docs/PLAN.md:241-242` records the repository
running exactly this check once already, on 2026-09-05. Both overlays also start
before the freeze: `docs/PLAN.md:887-888` dates Glimmering Greenhouses Nov 27 -
Dec 30, well ahead of the main trip's freeze (`docs/PLAN.md:879`). The correction holds — and it is still unapplied.
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
The check is still worth running — the banner tells you on the trip, and the
whole point of a desk session weeks ahead is to know before the freeze — but
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
the holiday season there is no row, no banner, no warning and no name. Widen the session
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

---

## Completed

Kept as records of the defect and the acceptance criteria each one closed.
Their line citations describe the tree before the fix.

### 18. Move the reservation that was asked for, when two people hold one attraction — _completed in 1.4.1_

Found from a friend's report. One person held an attraction at 9:10 and another
at 2:05, and asked to move the 2:05 earlier, every search set out to beat the
9:10: "the party's reservation" was `findExistingLL`, the *first* one for the
ride, and plans are sorted by time. Time Search re-read itself as the other
person's reservation on its first check; NextLL said it was already holding a
good enough time; Autopilot would have moved the wrong one.

**Shipped.** Time Search follows the reservation it was opened on
(`findSameReservation`, and `findHeld` is now required so no screen can fall back
to the ride-level match). NextLL, Autopilot and Plan Check use the saved party to
decide whose reservation it is (`findPartyLL`); when that does not pick out one,
the engine skips with `several-held`, NextLL lists who holds what, and Plan Check
warns ahead of time. The same report said a switch gave no sign the tap had
worked: the screen now says it is replacing from the moment of the tap, then that
it is waiting for Plans, then that it is done.

Found in the harness on the way: each screen kept the saved party it read when it
mounted, so after Party Selection saved a party of one, NextLL -- mounted
underneath -- kept warning. Saving now announces itself (`saveSavedPartyIds`),
and every screen that shows or uses the party follows at once.

### 10. Give the attempt lock a date, as every other store already has — _completed in `15b2985`_

Found 2026-09-19, while working out what the on-site booking rule changes. It
is not a refinement of anything above; it is a defect, and it is the only one
in this file that bites hardest on a morning nobody will be in a park.

**The asymmetry.** `AutoBookLedger` keys every action lock by kind and
experience and nothing else — `` `${kind}:${experienceId}` `` at
`autobook.ts:349` — and publishes that same date-less key to the shared
cross-instance store. The settle loop that releases those locks asks a
date-scoped question: `findExistingLL(settled, id, date)` at
`AutopilotProvider.tsx:815`. A date-less lock settled against a date-scoped
fact is the whole of it.

The contrast is inside this repository and is not subtle. `leaseKey` is
`` `${date}:${facilityId}` `` with a comment saying "Keyed by reservation and
the day it belongs to, not by action" (`lease.ts:657`). Commit records are
date-stamped, with a comment explaining that a second instance working the same
future date needs it. `PendingSearch` carries a `bookingDate`. The ledger is
the one store that missed the memo.

**What it does.** Book an attraction for one park day, move the picker to the
next, and that attraction is skipped as `already-attempted` — the lock says the
work is done while the evidence says the reservation is not held on that day.
In the ordinary case it self-heals after `CONFIRM_ABSENT_POLLS` = 2 plans
polls, which is about twelve seconds inside a rapid Time Search and about
fifteen minutes in the background engine on a future date.

In one case it never heals for the session. If the date is switched before a
plans poll has once seen the new reservation, the lock is owned but not yet
confirmed, and `resolveBook` returns at `autobook.ts:565`, on the early exit
for a lock this instance owns but has never seen held, before reaching the
absence counter that would clear it. That is the lost-response case, which is
exactly what a 7:00 a.m. rush produces.

Worse and simpler: `modify:` and `swap:` locks have no release path at all.
The settle loop sweeps `book:` locks only (`AutopilotProvider.tsx:823`). A move
performed for one park day blocks that action on that attraction for every other
day of the stay for the rest of the session.

**It does not reach the manual booking path, and that is the mitigation for
the rehearsal.** The ledger is confined to `src/autopilot/` and `AutopilotProvider`;
no screen imports it. Booking from the LL tab by hand takes none of these
locks. Until this is fixed, that is what to do on a booking morning, and it is
a better answer than the workaround that suggests itself — toggling autopilot
off and on calls `ledger.reset()`, but Time Search mounts a provider of its own
and `reset()` withdraws only locks that ledger *owns*, so with two ledgers
sharing one store it is not reliably the thing you want.

**Done means.** A test in `autobook.test.ts` that fails on HEAD: take a `book`
lock for an experience with one booking date, ask `hasAttempted` for the same
experience with a different date, and require `false`. It cannot be written
against today's signature at all, which is the point — `hasAttempted` takes no
date. The fix is to key by date the way `leaseKey` already does, and to give
`modify:` and `swap:` the release path `book:` has. Check what the shared store
does with old-shaped keys written by an instance that has not been updated.

**Where.** `src/autopilot/autobook.ts`, `src/providers/AutopilotProvider.tsx`,
`src/autopilot/storage.ts`.

### 2. Say on Today when the engine has stopped touching a reservation — and stop it saying the opposite — _completed 2026-09-19_

**Shipped.** Today subscribes to the unresolved-mutation store, renders an
all-date red count and explanation, and routes to Activity for the full details
and explicit resolution controls. The provider now reports `unresolved-change`
before the generic `already-attempted` explanation when quarantine refuses any
key in the attempted mutation's conflict set. Component and provider
regressions cover both the visible warning and the truthful skip reason. While
a doubt remains, automatic booking, moving and swapping are blocked for every
attraction the mutation could have affected. The diagnosis below is retained as
the pre-fix record.

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
it is a park day's worth of real doubts to look at, and the rehearsal is the
first chance to collect any. Until then, filter the count on `bookingDate` and give an
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

### 5. Stop the pre-trip checklist claiming a readiness it never verified — _completed 2026-09-19_

**Shipped.** Plan Check reports the result only after it renders. Today stores a
deterministic review identity containing the park, date, applicable targets,
settings and verdict; any relevant change invalidates the tick automatically.
A blocker can never produce a completed row, and a completed Plan Check remains
reopenable. The separate convenience idea of moving the unknown-attraction
warning into the checklist remains ordinary UX backlog, not part of this
correctness fix. The diagnosis below is retained as the pre-fix record.

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
this reason. Review Magic Kingdom on a trip day, change either control in the
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
days before the date it is about, so one made on a booking morning for the trip a
week later would evaporate at the next park-date rollover — the same silent un-tick on a
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

### 11. Retire a retry token when the lock it was minted for is given back — _completed 2026-09-19_

**Shipped.** `AutoBookLedger` already reports the exact keys it releases through
`onAttemptChange`; the provider now deletes the corresponding retry tokens in
that same callback. The end-to-end regression reproduces L1 rejection, plans
releasing L1, and an unknown L2 response, then proves the orphaned L1 token
cannot release L2 and send a third request. The diagnosis below is retained as
the pre-fix record.

Found 2026-09-19 while reviewing item 10. **It predates item 10**, and item 10
narrowed it rather than causing it: the same structure is on HEAD, where the
token key carries no date at all.

**The pairing that is only half enforced.** A retry token is a promise about one
particular attempt lock: NextLL mints one in `AutopilotProvider.tsx` when an
action is refused outright — Disney rejecting the call, or our own limiter never
sending it — and the next tick reads it back, finds the wait elapsed, and calls
`ledger.releaseAttempt(...)` to let the action be taken again. Token and lock are
minted together and are meant to die together. Only one half of that is written
down. `retryAtRef` is pruned when the token is consumed, and again on enable —
never when the lock it was paired with is released by anything *else*, and the
plans sweep releases locks on evidence all day.

**What it does.** A token minted for lock L1 survives L1's release. The
attraction is later locked again — L2, same date, same kind, same experience,
because that is the only shape a lock on one action can take — and this time the
request goes out and nothing comes back, which is the case the doubt-hold exists
for. The very next tick finds `hasAttempted` true, reads the leftover token,
sees a time long past, and calls `releaseAttempt`: the doubt-hold for L2 is
deleted and the action handed back. The attraction is then booked again on the
strength of a decision made about a request that had already been answered.

**Item 10 removed the cross-date half.** The token key is now
`lockKey(date, kind, experienceId)` rather than `` `${kind}:${experienceId}` ``,
so a token minted for one booking date can no longer release a live doubt-hold
on another — which was the wider and more likely case, and the one a booking
morning with nine searches across several park days would have produced. What is
left is same-key reuse after a release, which HEAD has identically. That is why
this is its own item and not a regression in item 10.

**Why it is _small_, and why it is still here.** The narrow fix is to drop the
token wherever its lock is dropped, which means the ledger has to say that a lock
was released — it already states releases to `onAttemptChange`, so the provider
can retire tokens from the same list rather than growing a second source of
truth. The reason it is not free is the direction of the error: a token that is
kept too long releases a doubt-hold, and a token dropped too eagerly only costs a
retry NextLL would have made anyway. Anything written here should be biased the
second way, and should say so in a comment.

**Done means.** A provider test that fails on HEAD *and* on today's tree: run
NextLL on one attraction with `autoBook` only; make the first booking come back a
410 so a token is minted; let the plans sweep release that lock on
`CONFIRM_ABSENT_POLLS` absent polls; then let the attraction be booked again with
the response lost, and assert `book` was called exactly twice across the whole
run. Today it is called three times.

**Where.** `src/providers/AutopilotProvider.tsx` (the token map, its mint site
and its read site), `src/autopilot/autobook.ts` (`releaseAttempt` and the release
branch of `resolveHeld`, which are the two places a lock is given back).

---

## After the main trip

Ordered loosely by value, not by effort. None of it is needed for either trip.

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
  the main trip: the fallback build's value is that it is proven, and porting
  unproven screens into it inverts that.
- **Stamp the season's Disney facts and their source dates into the documents** — _small_.

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

- **Running as a Home Screen web app.** It would dissolve three problems at once:
  notifications as a second alert channel, no Safari toolbar to guard, and storage
  exempt from the seven-day cap. It is not available. AutoLL-3 has to run on
  Disney's own origin to use the Disney session, and a Home Screen web app sends
  navigation outside its own scope back to Safari. Recorded so it is not
  rediscovered.
- **Autopilot booking a whole stay on its own, on the booking morning.** See
  item 15.
- **Restoring engine state, or dry run, from a backup.** See item 12.

---

## Questions only the owner can answer

**Answered.** On-site for both trips (2026-09-19), so each trip is booked in one
morning from home, seven days before check-in. The trip dates themselves
(2026-09-17; kept privately). What the first trip is for — a rehearsal for the
main one (2026-09-23). And whether to build backups — yes (2026-09-23), item 12.

**Field notes, item 16: build it?** Recommendation: yes. It is small, and it is
how the rehearsal answers the question of what the parks show that the code does
not.

**Item 9(a): which timing instrument?** The narrow row, or `FUTURE.md` §5.5's full
distribution. Item 12 has removed the cable problem; the choice of instrument
remains, and only the distribution has a rehearsal reason.

**Item 1: API-driven or clock-driven?** Let the `ll.nextBookTimes` reading decide.
Prefer API-driven if the instant is genuinely there.

**Expiry rescue: build it on an unverified assumption, or ship the warning and let
a park supply the fact?** Recommendation unchanged: the warning, item 3, and
the rehearsal is the park day that can supply the grace-period fact.

**Jingle Cruise and Jungle Cruise are two facility IDs for one ride.**
Recommendation unchanged: arm both by hand for the main trip, and if the overlay books,
pause the base-ID target so it does not try for a second pass on the same ride.

---

## How this relates to the other documents

`docs/PLAN.md` is the booking-intelligence reasoning and the record of what was
decided; the trip and booking dates are kept privately, not here. `docs/UX-PLAN.md` is the same
for the screens. `docs/FUTURE.md` is the complete standing list of what is not
done, including what this roadmap declines. `docs/RELEASING.md` is how a build is
made, verified, released and rolled back. The user guide carries what the tool
cannot do and how to guard a pocketed phone.

This file is only the plan, and it expires. Revisit it after the rehearsal, when it
has answered what it can, and again after the main trip.
