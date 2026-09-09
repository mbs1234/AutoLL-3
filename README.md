# AutoLL-3

AutoLL-3 is an experimental successor to **[AutoLL](https://github.com/mbs1234/AutoLL)** and **[AutoLL-2](https://github.com/mbs1234/AutoLL-2)** — an unofficial client for Lightning Lane Multi Pass at Walt Disney World, run as a bookmarklet or userscript from the phone you carry in the park.

It does everything AutoLL v1.0 does at Walt Disney World, with the same Autopilot engine, the same NextLL search, the same safety limits and the same corrected attraction data — and nothing else: Disneyland and virtual queues, which AutoLL still carries, are not here. **This README covers only what is different.** For how any of the base features work — installing, the LL/Times/Plans tabs, arming actions, return-time windows, the action budget, dry run, NextLL — read [AutoLL's README](https://github.com/mbs1234/AutoLL#readme). Everything there applies here unchanged unless a section below says otherwise.

**Important:** AutoLL-3 is unofficial, experimental software. It is not affiliated with or endorsed by Disney, may stop working at any time, and is provided without warranty. Keep the official Disney app as the source of truth for your plans and reservations.

**Walt Disney World, Lightning Lane only.** AutoLL-3 runs on `disneyworld.disney.go.com/vas/` and nowhere else. Run from a Disneyland or virtual-queue page, it returns you to the start page, which offers that one destination. Disneyland booking never worked in this fork and virtual queues were not in use, so both were removed rather than carried; see [FORK.md](FORK.md#scope).

## Install

Open the [AutoLL-3 setup page](https://mbs1234.github.io/AutoLL-3/) on your phone and follow it. The two install paths — bookmarklet and userscript — work exactly as AutoLL's do.

AutoLL-3 keeps its own `autoll3.*` browser storage and its own `autoll3-` notification tags, both separate from AutoLL-2, AutoLL and BG1. That means the builds can be installed side by side without overwriting each other's watch lists, budgets, booking tracking or alerts — and AutoLL-3 needs its own sign-in and setup. Nothing is imported from the other builds.

The settings menu names the build, so two builds open at once can be told apart.

## What AutoLL-3 adds

### Sign-in and session safety

AutoLL-3 signs in through Disney's OneID page. It stores only the resulting
Disney user identifier, access token, expiry, issuing resort and a schema
version; it does not handle a Disney password. Saved results are validated
before use, tied to the Walt Disney World client, and rejected when they
expire before 5:00 PM park time. The sign-in screen explains that early-expiry
case, provides a retry if OneID cannot load, and lets a dismissed Disney sheet
stay dismissed instead of immediately reopening.

By default the session is retained in browser storage for convenience. In
**Settings**, choose **Session-only login: On** to keep the current result only
in memory. You will need to sign in again after a reload or browser restart.
This is a privacy option, not protection against a malicious script already
running on the same browser origin. The Settings menu also shows session state.

Concurrent unauthorized responses are collapsed into one return to the
sign-in screen. Booking-capable calls always use that behavior; the sole
exception is the documented itinerary refresh path, where the response is
reported to its caller rather than logging out a healthy foreground session.

| Addition                         | What it is                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Passkey and tap-in strategy**  | Mark one easy non-Tier-1 attraction as the pass to spend first. Once that entitlement is established as gone, AutoLL-2 reports the day's Tier 1 restriction lifted. |
| **Day plans**                    | Watch targets carry a park, a date and a manual **rank**, so a watch list is a plan for one park day rather than a global list.                                     |
| **Plan check**                   | A preflight over the plan you have configured, run before turning Autopilot on. Makes no booking requests.                                                          |
| **Today, Configure, Activity**   | A Today tab that answers what Autopilot is doing and what is held; setup on its own Configure screen; the log and diagnostics on Activity.                            |
| **Timeline**                     | A read-only picture of the day: held Lightning Lanes beside the windows Autopilot may use.                                                                            |
| **More cadence modes**           | Refill windows, a longer drop-burst lead, and a bounded cadence for a next-day watch.                                                                               |
| **Reopening alerts**             | A watched attraction coming back from a temporary closure raises an alert — an alert only.                                                                          |
| **Live tier reporting**          | Where Disney labels a tier that disagrees with the curated table, the disagreement is reported rather than applied.                                                 |
| **Diagnostics**                  | Drop-demotion evidence, local poll timing, a published release manifest, and a weekly data audit.                                                                   |

Each is described below.

## Planning

### Plan check

**Plan check** is one tap from the Today tab. It reviews the plan already on screen and reports three levels: *Fix before enabling*, *Review*, and *Ready*.

It checks configuration only — targets that are not on the loaded tipboard, actions armed on a paused attraction, impossible return windows (earliest after latest), an exhausted action budget, return windows that overlap something you already hold, more than one Tier 1 armed, and the two global toggles that widen what Autopilot may do.

What it deliberately does not do is ask Disney anything. Every fact it reasons over is already on the screen. That is the point: eligibility, inventory and the offer's real return time are re-read immediately before every action anyway, so a preflight that made one more request would look more authoritative without being more accurate.

One optional button, **Check current party**, makes a single eligibility-only request, scoped to the park and date on screen. It cannot create an offer or spend an entitlement.

It reports **Dry run** rather than calling such a plan ready, and it asks the engine's own rules rather than re-deriving them — so it excludes the reservation an Auto-move target is trying to move, ignores a Multiple Experiences Pass the way the booker does, stays quiet about overlaps when Avoid clashes is off, and only raises the Tier 1 warning where a hold is actually possible. Blockers are listed above reviews.

### Day plans

A watch target records the park and date it was starred on, so a watch list is a plan for one park day rather than a global list. Only targets matching the loaded park and selected date are watched or acted on; the others are kept for the day they belong to. Targets saved before this existed carry no park or date and stay global.

Each target can also carry a **plan rank** — a number, lower tried first, overriding the built-in priority order for both ordering and swap decisions.

Targets are named when they are starred, so **Not on today's list** can name the ones Disney's tipboard has stopped listing — a seasonal version, or a changed attraction ID — rather than showing bare facility IDs. Autopilot cannot watch or book those, and each row has a button to remove it.

### Passkey and tap-in strategy

A **passkey** is an easy early Lightning Lane selected to help open up the rest of the day. Mark one non-Tier-1 target as Passkey, enable the action you want for it, and redeem it with the selected party. AutoLL-2 waits until the pass is spent, then checks Disney's eligibility response; it only reports the Tier 1 hold unlocked once both are true. Both halves are needed: Disney only reports the restriction to a party already holding a Tier 1, so on its own the eligibility check says nothing.

"Spent" is what can actually be established, and it covers a pass whose window lapsed unused as well as one that was tapped in — Disney counts both as ridden. That is the right test here, because the tier limit turns on the entitlement being gone rather than on how it went.

Passkey is optional. It never creates a booking authorization, bypasses an eligibility rule, or assumes a reservation was redeemed because it appears in Plans.

### Ordering

Where AutoLL orders same-tick candidates by the LL list's **Priority** sort alone, AutoLL-2 puts the lower plan rank first, then Priority. On the current day, before the party has redeemed anything, a passkey target sorts ahead of both.

## The day, at a glance

### Today

The first tab. The Autopilot switch, a headline saying what it last did ("7:17 PM — Moved Haunted Mansion from 8:29 PM to 7:49 PM"), its status, then buttons to Configure, Plan check, Timeline and Activity; below them the day's alerts, the next Lightning Lane and drop times, every Multi Pass held on the date in any park with its grace-scan window, and the plan for the loaded park in rank order with what each target is armed to do. Every Lightning Lane screen carries the same one-line context under its title: park, date, party size, and whether this is a dry run.

### Configure

Where a plan is set up: the three safeguards (dry run, whole party only, avoid clashes), a card per watched attraction that folds to one line and opens to its actions, return window and rank, and the list of attractions to add. Chips are coloured by what turning them on does — blue for an action that spends an entitlement, green for a safeguard, yellow for rehearsal, amber for paused — and red is kept for Stop and errors. Removing a target takes an open card and can be undone for a few seconds.

### Activity

The day's booking log, the counts of why nothing was booked, and the drop times Autopilot has learned.

### Timeline

A read-only picture of the park day: held Lightning Lanes in one column, the return windows Autopilot is allowed to use in the other, both on a 4am-to-4am rail. An amber target window crosses the protected time around a held reservation; a green one does not.

A target with no window is drawn across the day in grey and labelled "any time", because that is what it permits — not amber, since a full-day window necessarily crosses everything you hold. Red means the window is either wholly inside a protected span, so nothing it allows could be booked, or reversed. Bars are packed into columns, so simultaneous reservations sit side by side rather than on top of each other, and a held pass whose end time Disney did not send is marked rather than drawn as if the end were known.

## How Autopilot checks

Same coordinated polling loop as AutoLL, with three additions to the cadence table:

| Mode                  | When                                                                             | Interval |
| --------------------- | -------------------------------------------------------------------------------- | -------- |
| **Refill window**     | inside a span an attraction tends to refill over, rather than one instant        | ~6s      |
| **Watching tomorrow** | a watch on the next day, between 07:00 and 22:00                                 | ~15s     |
| **Checking rapidly**  | 2 minutes before to 2 minutes after a drop — where AutoLL uses 30 seconds before | ~1.2s    |

A refill window holds the approach rate for its whole duration; a real scheduled drop inside one still wins and uses the shorter burst interval. Refill windows are curated per attraction in `src/api/data/wdw.ts`.

Anything further out than tomorrow polls at the slow steady rate, as in AutoLL, since cancellations have no schedule.

### Reopening alerts

A watched attraction returning from a temporary closure raises an alert. Deliberately an alert only — a reopening often creates useful near-term inventory, but the ordinary watch and booking rules stay the sole authority for spending an entitlement.

### Learned drop times

Learning works as it does in AutoLL: a time observed on two or more distinct park days is added to the times Autopilot bursts for, and coverage is recorded so the panel can tell "seen 2 of 2 watched days" apart from "seen 0 of 3" and from "not watched yet".

AutoLL-2 additionally implements **demotion** — removing a scheduled time contradicted by local evidence — but it is **disabled**. Coverage is recorded per park day rather than per scheduled drop time, so "covered and never observed" does not yet mean "the drop did not fire": the two counts disagree on retention, span, subject and density. The evidence is gathered and shown; it does not act. See `DEMOTION_ENABLED` in `src/autopilot/learned.ts`.

## Diagnostics

- **Live tier reporting.** Where Disney labels an attraction's tier and that disagrees with the curated table, the disagreement is reported rather than applied. Acting on it would let the tipboard and a booking disagree about the same attraction, so one curated table stays in control.
- **Local timing.** While Autopilot is running, its status area shows how long the last cycle took and the average across the session. Measured in the browser, never transmitted, and it does not alter the cadence. It times a whole cycle — availability, plans, eligibility and any booking attempt — so a tick that acted is legitimately slower than one that only looked. Failed cycles are excluded, since the cheapest failure here is instant and averaging it in made the number look best when nothing was getting through.
- **Release manifest.** Each published build carries `autoll3-files.sha256`, a SHA-256 manifest of every deployed payload file, and `autoll3-release.json`, which names all three revisions it was assembled from — the bundle's, the installer pages' on `goofy`, and the runtime module's on `gh-pages`. Both are generated after every overlay and URL rewrite, so they describe what was actually published. The deploy fails if a file an install path needs by name is missing from the manifest.
- **Curated data invariants.** A weekly workflow re-runs the curated-data and ID-retirement suites, so a hand edit that breaks their invariants is caught without waiting for a push. Both suites are offline by design — they check the committed data against itself — so they cannot tell you Disney has changed an attraction ID. The unknown-attraction notice and live tier reporting in Autopilot are what surface that, from real tipboard responses.

## Development

```bash
npm ci
npm run checkall      # tests, lint, and typecheck
npm run test:ci       # CI test suite
npm run build         # production bundle
npm start             # development server
npm run harness       # the screens against fake data, no Disney session
```

The harness (`harness/`, `vite.harness.config.mts`) serves the real screens over fake clients at <http://localhost:5174>, with a scenario picker for the states worth seeing: the engine running against a fake tipboard, bursting at a drop, stopped after errors, the budget spent, Disney refusing requests, dry run, a future date, a Plan Check full of blockers, and each way a Time Search can end. It is a separate Vite config, so nothing in it can reach the production bundle.

As in AutoLL, `deploy.yml` runs typecheck and tests before it builds, and the deploy job depends on that — a failure serves the previous bundle rather than a broken one. `vite build` does not typecheck, which is why that is not redundant.

The source branch is `main`; inherited installer assets are read from AutoLL-2's `goofy` branch during deployment. GitHub Pages publishes the combined build at <https://mbs1234.github.io/AutoLL-3/>.

See [FORK.md](FORK.md) for project structure and upstream synchronization notes, and [docs/PLAN.md](docs/PLAN.md) for the feature roadmap and research notes.

## License and acknowledgments

AutoLL-3 is **GPL-3.0-only**. It is a modified version of **[BG1](https://github.com/joelface/bg1)** by Joel Bruick — the original project and the source of nearly everything underneath these builds — merged onto **[jgeurts/bg1](https://github.com/jgeurts/bg1)**, which restored Lightning Lane booking at Walt Disney World. AutoLL-3 forks **[AutoLL-2](https://github.com/mbs1234/AutoLL-2)**, which carries the fuller acknowledgments.

Thanks also to Len Testa and [TouringPlans](https://touringplans.com/), [ThemeParks.wiki](https://themeparks.wiki/), [Thrill Data](https://www.thrill-data.com/), WDWMagic's drop-tracking observers, BlogMickey, Arialvetica for the original logo, and [IcoMoon](https://icomoon.io/#icons-icomoon) for the icons.
