# AutoLL-3

AutoLL-3 books Walt Disney World Lightning Lane Multi Passes from the phone in
your pocket, while you are in the park. You tell it which attractions you want,
in what order, and between which times; it watches Disney's tip board and takes
what appears, including in the two-second window when a scheduled drop lands.

It is the current development line of
[AutoLL](https://github.com/mbs1234/AutoLL), which is frozen at v1.0, by way of
[AutoLL-2](https://github.com/mbs1234/AutoLL-2). This README says what AutoLL-3
does for you that v1.0 did not, and what it still does badly. Both builds
descend from [joelface/bg1](https://github.com/joelface/bg1) and
[jgeurts/bg1](https://github.com/jgeurts/bg1), which is the work that made
booking possible at all.

AutoLL-3 is unofficial, experimental software. It is not affiliated with or
endorsed by Disney, it can stop working the day Disney changes an endpoint, and
it comes with no warranty. Keep Disney's own app as the source of truth for what
you actually hold.

## Install

Open the [setup page](https://mbs1234.github.io/AutoLL-3/) on the phone you will
use in the park and install either the bookmarklet or the userscript.

The [user guide](https://mbs1234.github.io/AutoLL-3/guide.html) walks through
setup, the park day and what to do when something breaks;
[docs/USER-GUIDE.md](docs/USER-GUIDE.md) is the same text in this repository.

Three things worth knowing before you do:

- **It installs alongside v1.0 without touching it.** AutoLL-3 keeps its
  browser storage under `autoll3.*`, tags its notifications `autoll3-*`, names
  the browser tab "AutoLL-3" and uses a flask favicon where v1.0 uses a bolt.
  Your v1.0 party, watch list, budget and booking tracking are untouched.
- **Nothing carries over.** Because the namespaces are separate, AutoLL-3
  starts from an empty store: re-pick your party and rebuild your watch list.
  Do it before the trip, not at the gate.
- **Install one userscript, not two.** Both builds' autoloaders match
  `disneyworld.disney.go.com/vas/`, so with both installed they will fight over
  the page. The bookmarklets are fine — those only run when you tap one.

## What AutoLL-3 does that v1.0 did not

### Before the trip

**A plan belongs to a park and a day.** Every watched attraction now carries
the park and date it was made for, plus your own rank within that day. Set up
Tuesday at Magic Kingdom and Thursday at Epcot weeks ahead and leave both
saved: on Tuesday, nothing Epcot-shaped can spend an action. Your rank decides
the order attractions are attempted in and which one the Tier 1 slot is held
for, ahead of the built-in table. In v1.0 one un-keyed list applied to every
park and every date at once.

**A pre-trip checklist.** When the day on screen is not today, the Today tab
becomes a readiness list — party saved, at least one target, an action actually
armed, notifications allowed, Plan Check reviewed — with a button on each item
that opens the screen that fixes it. The mistakes that cost you a December
morning get made in November.

**Plan Check, a preflight that makes no requests.** It reads the plan already
on screen and returns blockers first: an impossible return window, a target
that is not on today's tip board, a window sitting entirely inside the
protected time around a pass you already hold, dry run still on. Every item that
names something fixable carries a button that goes there — or, for a stale tip
board, refreshes it inline. In v1.0 the equivalent information arrived after the
fact, as a tally of skip counts.

**A preview harness.** `npm run harness` runs the real screens against fake
Disney clients in a phone-sized frame, with seventeen scenarios wired up — a
drop burst, Disney refusing requests, every Time Search recovery state. It is how the failure cases get looked at in September rather
than in a queue in December.

### On the park day

**You land on the day, not in a menu.** AutoLL-3 opens on a Today tab that
answers the questions you actually ask: is it on, what did it just do, what do
I hold, what is it chasing, when is my next booking time and the next drop. The
on/off switch is on that screen. In v1.0 all of this lived behind a clock icon
in the LL tab's header.

**Autopilot is visible from every tab.** While it is running and you are
anywhere else, a thin strip above the tab bar says what it is doing —
"Checking rapidly · Dry run · 3 armed" — and tapping it opens
Today. It is navigation only, so a mis-tap can never change what gets booked.

**Each watched attraction is one line.** "Auto-book and move · 10:00 AM to
2:00 PM · Rank 1", unfolding to the controls. Colour means something now: blue
arms an action that can spend an entitlement, green is a safeguard, yellow is
the dry run, red is reserved for stopping. In v1.0 every armed action was the
same red as the Stop button, and four attractions filled the screen.

**A picture of the day.** The timeline draws your held passes beside the
windows autopilot may use, on one 4am-to-4am rail, with the protected time
around each hold shaded behind it. It is the one view that shows *why* a target
will never fire, and its colours come from the same predicate the booker uses,
so it cannot disagree with the engine.

**Half-typed input stays out of the engine.** Return-time bounds and ranks
commit when they are settled, not on every keystroke. Backspacing over 15:00 to
type 14:00 used to hand autopilot an unbounded window for as long as the field
was empty — and during a drop burst the poller ticks about once a second.

### Around a drop

**It starts two minutes early.** The burst lead went from 30 seconds to 120, so
it polls at 1.2 seconds from T−2:00 to T+2:00. Disney releases drop inventory
early often enough that arriving at the advertised minute is arriving late.

**It watches the hours when inventory actually trickles back.** Nine
attractions carry a declared refill span — Peter Pan's, Jungle and Jingle
Cruise and Runaway Railway over the middle of the day; Test Track, Slinky, Toy
Story Mania, Tower of Terror and Na'vi in the morning. Inside one, for an
attraction you armed, it polls every six seconds instead of idling at
forty-five. Outside the nine drop minutes, a return time appearing is somebody
cancelling, and forty-five seconds is how you miss it.

**Tomorrow has its own pace.** With tomorrow's date on screen it polls every
fifteen seconds between 7am and 10pm, because pre-arrival releases cluster
heavily on the day before.

**It knows when the Tier 1 limit lifts.** Mark one easy, high-availability
attraction as the day's passkey; autopilot books it first, and once Disney's
own tracker says that entitlement is spent, it asks the eligibility endpoint
whether the one-Tier-1 rule has actually lifted for everyone in your party. It
does not guess from the itinerary, which structurally cannot answer.

**A swap can no longer spend your Tier 1 selection by accident.** The hold that
keeps the slot free for a better-ranked Tier 1 with a drop coming now covers
swaps, not just fresh bookings.

**It stops giving up the Haunted Mansion to keep the Tiki Room.** Twenty-six
shipped attractions carry no rank on purpose. The old rule protected exactly
those from being swapped away, so a Big Thunder swap surrendered a headliner
and kept a five-minute show. Only facilities the data does not recognise at all
are protected now.

**Two engines stop booking on top of each other.** NextLL runs a second booking
engine inside the app's own, so two are routinely live. Action locks and
committed return times are now shared through the day's storage, so the same
attraction is not attempted twice in one drop and neither engine books a time
that lands on what the other just took.

**And a Time Search takes precedence.** Searching for a better return time runs
a third engine, against a reservation autopilot is still polling underneath the
screen — and its moves used to go out without taking any lock at all. It now
takes the same per-attraction lock as everything else and holds it for the run,
so nothing else can move that pass mid-search.

When they want the same reservation, whoever gets there first holds it, and the
other waits and says so on screen. The hold is a short lease on that one
booking, not a mark against the attraction: the browser hands it out to one
holder at a time, and it expires by itself, so a tab you close mid-move cannot
leave a ride locked for the rest of the day. It does not defer to autopilot's lock, because
that lock is never given back: it records that autopilot moved the ride at some
point since you switched it on, which may have been hours earlier. That matters
most in the case only the search can serve, since autopilot sees one return time
per check and can therefore only move a pass *earlier*, while a search can aim
at a particular time and move one later on purpose — for a dinner reservation.

**Nothing caps the day's bookings.** v1.0 and earlier AutoLL-3 releases rationed
autopilot to a set number of actions per park day. That cap rested on a
misreading of Disney's rules: what you spend once is a *redemption*, not a
booking, so an attraction can be booked, cancelled and rebooked all day without
costing you anything you could otherwise hold. What bounds the booker is what
should: one booking and one move per attraction per session, three Multi Pass
selections at a time, and a shared rate limiter. The count, the top-up button
and the "actions left" line are all gone, and a contested drop can no longer
ration you out of the booking you were waiting for.

### When something goes wrong

**A wedged check cannot stop the day silently.** Every poll has a 90-second
deadline. A request that neither succeeds nor fails used to park the loop
forever while the screen still read "Checking rapidly" — the worst state this
app can be in, because you believe it is working while you queue for a churro.

**A change whose outcome nobody learned now says so, and stops.** A booking
request can leave the phone and never come back: the park's wifi drops, the
response never arrives. It may have worked or it may not, and nothing arriving
later can tell you which. Retrying risks moving a reservation twice; forgetting
it leaves a pass unprotected while something else books over it.

That reservation is now held, and the hold is visible. Activity and Plan Check
both list it, naming the attraction and what the change was trying to do — "Move
Haunted Mansion from 7:15 PM to 11:40 AM on December 5" — including for
reservations weeks out and in other parks. Nothing touches that pass until
Disney's own itinerary shows the exact result the request asked for. If you would
rather decide yourself, there is a two-step release that asks you to check
Disney's Plans first: clearing protection is the one action here that can cost
you a reservation, so it is the one that asks twice.

If the browser cannot store that protection durably, the open page still enforces
it and says plainly that it will not survive a reload or reach another tab. And
Plan Check warns when the browser has no Web Locks, rather than quietly giving up
cross-tab exclusion.

**Sign-in you can get out of.** If Disney's sheet does not load, it gives up
after fifteen seconds and shows a card with a retry button. If you close the
sheet on purpose it stays closed. Both of v1.0's failure modes end in a blank
white screen.

**It says why it wants you to sign in again** — expired, ends before 5pm park
time, wrong resort, unreadable — and refuses a session that will die mid-
afternoon up front, so you re-sign-in at breakfast. Settings carries a live
session line and a session-only login option for a borrowed phone.

**Plain English about what it did and did not do.** The activity log names the
attraction and the reason; repeated failures collapse to one row with a count
instead of pushing the day's real bookings out of a twenty-row log; and failure
details are the status and endpoint rather than a raw response body that used
to carry guest names.

**It tells you when Disney lists something this build does not know**, on the
Today tab in the morning rather than by your noticing a ride missing from the
tip board.

### The data it books from

**Big Thunder no longer fakes a drop.** An upstream merge had given it two drop
times; every source since the 2026 reopening says it has no predictable
schedule. Because a park's drop list is the union of its attractions', that
entry put all of Magic Kingdom into a 1.2-second burst at 08:47 — and could
hand back a real Tiana's to wait for a drop that never comes.

**Animal Kingdom's best ride is attempted first.** Kilimanjaro Safaris and
Expedition Everest collide at the 12:47 drop, which is the same-tick case the
ordering decides. Safaris shipped ranked below Everest, below Kali River
Rapids, and below an attraction Disney never serves; it now outranks all
three, and a held Safaris is no longer the first thing offered up in a swap.

**One ride keeps one rank whichever film is showing.** Soarin' is served under
three facility ids as the film rotates, and they carried three different
priorities — so the same queue, with the same wait, ranked a band lower on two
mornings out of three. They are equal now, and a test enforces it for any ride
served under several ids.

These decisions are now pinned by tests over the shipped table — the previous
set was silently reverted by a data merge and nothing went red, because every
ranking test built its own numbers.

## What it does not do

**Walt Disney World Lightning Lane only.** Disneyland and virtual queues were
removed. v1.0 still carries both; if you need to join a boarding group, use
Disney's app. A boarding group already in your itinerary still displays here.

**It cannot get you more than Disney's rules allow.** Three Multi Pass
selections, one Tier 1 until somebody taps in, one booking per attraction per
day. This build is faster and more attentive than you are at 7:00:02. That is
the whole of its advantage.

**Known rough edges, as of 0.5.0:**

- The day timeline truncates every target name at 360 px, and its bars are
  14–20 px tall, which is a small tap target.
- Undoing two target removals in a row loses the first one's window and rank.
- A Plan Check item that names a setting opens Configure at the top of a long
  screen rather than at the setting.

These and everything else still outstanding are listed in
[docs/FUTURE.md](docs/FUTURE.md), with what each would cost to fix.
[ROADMAP.md](ROADMAP.md) is the shorter argument about what to do next, and in
what order, before the December freeze.

**It depends on the AutoLL-2 repository to publish.** The installer pages and
the runtime module both come from that repo at deploy time. AutoLL-2 must stay
public for AutoLL-3 to build a site.

## Verifying a build

Every deploy writes
[`autoll3-release.json`](https://mbs1234.github.io/AutoLL-3/autoll3-release.json)
and `autoll3-files.sha256` into the published site: the three source revisions
the site is assembled from, plus a SHA-256 of every file served. Point a
browser at it before a park day and confirm the build on your phone is the one
the repository says it is.

`main` is protected: a pull request, a passing `check` run, linear history, no
force-pushes. The deploy gates independently on typecheck and the full test
suite — 114 suites, 1428 tests — and if either fails, the publish is skipped and
Pages keeps serving the build already on your phone.

## Development

```bash
npm ci
npm run checkall     # tests, lint, typecheck
npm run harness      # the real screens against fake clients
npm run build
```

[FORK.md](FORK.md) explains why a plain upstream build does not run and how the
deploy assembles one. [docs/PLAN.md](docs/PLAN.md) is the booking-intelligence
roadmap and the record of what was decided;
[docs/UX-PLAN.md](docs/UX-PLAN.md) is the same for the screens;
[docs/FUTURE.md](docs/FUTURE.md) is what remains, and [ROADMAP.md](ROADMAP.md)
is what to do about it next.
[docs/USER-GUIDE.md](docs/USER-GUIDE.md) is the guide written for whoever is
holding the phone, rather than for whoever is changing the code.
[SECURITY.md](SECURITY.md) covers token handling.

## License

GPL-3.0-only, as a modified version of BG1 by Joel Bruick, with the booking
work from jgeurts/bg1. Copyright for the modifications in this repository rests
with its contributors. Distributed in the hope it is useful, without any
warranty — see [LICENSE.txt](LICENSE.txt).
