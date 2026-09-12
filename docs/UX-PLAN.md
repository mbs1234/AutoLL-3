# AutoLL-3 UI/UX plan

Written 2026-09-07 against AutoLL-2 `d390133`, carried forward into AutoLL-3
with the rest of the fork, and revised 2026-09-12 against the code as it
stands here. The repository it describes is AutoLL-3: `package.json` names
`autoll-3`, the storage namespace is `autoll3.*`, and the build is published
at <https://mbs1234.github.io/AutoLL-3>. Inputs: the Codex UI/UX review of
2026-09-07 (twelve suggestions), a line-by-line read of every screen it names,
the 2026-09-07 session handoff, and the owner's decision of the same day to
drop Disneyland and virtual-queue support. Phase 0a, the narrowing, landed the
same day as `39b12b5`; Phase 0b, the harness and the shared primitives,
followed it; Phase 1a, the cards and the colour policy inside the existing
Autopilot screen, after that; and Phase 1b, the split into Today, Configure,
Activity and Timeline with Today as a fifth tab, after that. Phases 2, 3, 4
and 5 have landed since, each with gaps against what it proposed; every phase
below ends with a dated note recording what actually shipped. What the
2026-09-12 review found still outstanding is in §9.

## 0. Summary

Codex's diagnosis holds: the features are there, and the cost now is cognitive
load on a park day. Of its twelve items, nine survive contact with the code as
written, two need reshaping to fit how the app is built, and one rests on a
premise the code contradicts. The plan adopts them in five phases, adds what
the code read turned up that the review did not see, and puts a local preview
harness first, because until one exists every visual change is still verified
by reading a jest render.

Order: narrow the app to Walt Disney World Lightning Lane, then the harness
and primitives, then the Autopilot restructure (Today, Configure, target
cards, colour policy), then Plan Check and the Timeline made navigable, then
Time Search recovery plus a shared status row, then the pre-trip checklist and
polish, then the review gate. The narrowing goes first because every later
phase is smaller without a second resort and a second product to carry, and
the harness then needs exactly one fake client.

## 1. The twelve items, checked against the code

| #   | Codex item                                          | Verdict                                    | What the code says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | A default "Today" dashboard                         | Adopt                                      | `DaySummary.tsx` already holds most of it (date, next LL, held passes, active plan, passkey, timeline) but sits two taps deep behind the Autopilot screen. Status, on/off, budget and the latest event live on `Autopilot.tsx`. Merging them into one landing screen is a reorganisation, not new data.                                                                                                                                                                                                                  |
| 2   | Split Autopilot into Overview and Configure         | Adopt                                      | `Autopilot.tsx` is 941 lines on one scroll: on/off, status, three global toggles with explanatory paragraphs, per-target editing, an add list, learned drops, skip counts and the activity log.                                                                                                                                                                                                                                                                                                                           |
| 3   | Collapsible target cards                            | Adopt                                      | Each watched target renders a name row, five toggle chips wrapping onto two lines, a two-input window row and a rank row: about seven rows per target. Every field a one-line summary needs is already on `WatchTarget`.                                                                                                                                                                                                                                                                                                  |
| 4   | Stop using red for "enabled"                        | Adopt, with a written rule                 | `bg-red-700` marks the on-state of Auto-book, Auto-move, Book then move, Swap in, Whole party only and Avoid clashes, and also "Turn off autopilot" and "Stop looking". The LL-tab header button already uses green/yellow/red for running/dry-run/stopped, so there is a policy to extend rather than invent.                                                                                                                                                                                                             |
| 5   | Make Plan Check actionable                          | Adopt                                      | `PlanCheckItem` is `{ level, text }` with no subject; the screen keys rows by their text and offers no route to the target or setting an item names. `checkPlan` is pure and tested, so a `subject` field is additive.                                                                                                                                                                                                                                                                                                    |
| 6   | Make Day Timeline interactive                       | Adopt the navigation, defer the advice     | `DayTimeline` is documented as deliberately read-only and takes every colour from `windowClash`, the booker's own predicate. Tapping a bar to _navigate_ keeps that contract. Editing in place, or a "suggest a safe window" feature, would put a second opinion beside the engine's. `clashWindow()` already yields each held plan's protected span, so drawing it is cheap.                                                                                                                                             |
| 7   | Sticky active-search banner across screens          | Correct the premise                        | NextLL's engine _is_ its tab: `NextLLTab` mounts its own `AutopilotProvider`, and leaving the tab unmounts it, stops the search and records a pending goal to resume (`nextll.ts`, covered by tests). Time Search is a pushed screen with no onward navigation. Neither can be running while the user is elsewhere, so a banner would describe something that cannot happen. The real gap is the top-level Autopilot: it runs everywhere and only the LL tab's header shows it. A status row in the shared tab footer fixes that. Hoisting NextLL's provider so a search survives a tab switch is possible and is listed as its own decision (§6). |
| 8   | Improve Time Search recovery UI                     | Adopt, with one small engine change        | `TimeSearchState` exposes running/held/pending/unresolved/stop/cycles/moves. The settle wait (committed, Plans has not agreed yet) is visible only on the mutable `guard` ref, which does not re-render. After an `unconfirmed` stop the start buttons reappear, and a restart silently resumes the settle wait. Exposing the guard's phase in state lets the screen say what it is doing.                                                                                                                                  |
| 9   | Fewer explanatory paragraphs in active workflows    | Adopt                                      | Ten conditional paragraphs on `Autopilot.tsx` explain toggles that are already labelled. `Disclosure` exists for exactly this. State alerts (dry run, refusals, stopped, budget gone, unknown IDs) stay visible; explanations fold.                                                                                                                                                                                                                                                                                       |
| 10  | Pre-trip setup checklist                            | Adopt, as Today's second mode              | For a future `bookingDate` there is no live state to show. Every checklist fact is already in a context: saved party (`PARTY_IDS_KEY`), targets for that park and date, armed actions, windows, `notifications`, `unknownExperienceIds`, and `checkPlan`. One screen, two modes keyed on `bookingDate === parkDate()`.                                                                                                                                                                                                    |
| 11  | Surface the latest meaningful event                 | Adopt, with one provider addition          | `bookingLog` carries actions with times; `lastHit` the last find; `status` the mode and next drop. Skips are counted in `skipCounts` without a time or a name, by design (they are the common case, and the log is capped and persisted). A non-persisted `lastSkip` on the provider is enough for "11:43 skipped Tower of Terror: outside your window".                                                                                                                                                                 |
| 12  | Keep park, date, party and dry run visible          | Adopt                                      | Pushed screens show at most a title and a date. `Screen` already takes a `subhead` and `HeaderBar` styles it. The party count must be read without `useSavedParty`, which re-applies the party to the client on mount.                                                                                                                                                                                                                                                                                                   |

## 2. What the code read adds

- **A preview harness comes first.** `vite.config.mts` has `root: 'src'`, no
  `index.html`, and the bundle only runs injected into a logged-in Disney page.
  Today a screen can be seen in the park or in a jest render, nowhere else.
  Every item above is visual; none can be judged without a harness. Phase 0.
- **Removing a target is a one-tap accident.** The star button on each watched
  row removes the target at once, window and rank included, with no undo. In
  the card design, Remove moves into the expanded body and gets a three-second
  undo flash (`useFlash` exists).
- **One `Toggle` component instead of eight inline colour ternaries.** The
  same on/off chip is written out eight times in `Autopilot.tsx` and once in
  `NextLL.tsx`. One component with a `variant` carries the colour policy from
  item 4 and shrinks the screen.
- **Refresh where you are.** Configure says "Close this and refresh the LL list
  first" when the tipboard is empty; Plan Check's tipboard item says "Refresh
  the LL list and check again". Both should offer the refresh in place. Each
  tap spends the shared `RateLimit(5)`, the same budget the poller draws on, so
  the button calls the throttled `refreshExperiences`, never a new poll.
- **Say how fresh the data is.** Neither `ExperiencesProvider` nor
  `PlansProvider` records when it last fetched. "Updated 2 min ago" on Today
  needs a `lastUpdated` value in each context: one state, one set.
- **Keep new UI in new files.** `Autopilot.tsx` already differs from AutoLL's
  copy by 196 diff lines. The v1.1 port is far easier if Today, Configure, the
  cards and the strip are new files and `Autopilot.tsx` shrinks rather than
  grows.
- **Memoise what re-renders every tick.** `status` updates every 1.2 s in
  burst, and `NavProvider` keeps Today and Configure mounted under whatever is
  pushed on top, so both re-render on every tick. `DayTimeline` recomputes
  `dayTimeline()` on every render; wrap it in `useMemo`. Card summaries are
  cheap strings and need nothing.
- **Tap targets.** Small chips are about 28 px tall; the timeline's minimum
  bar is 3% of 480 px, about 14 px. Card summary rows should be full-width tap
  targets. Timeline bars get an enlarged invisible hit area rather than a
  taller minimum bar, so the geometry stays honest.
- **Today should also surface an interrupted NextLL search.**
  `loadPendingSearch()` already knows about it; one line and a link to the
  NextLL tab.
- **Tab-bar capacity is the one hard layout limit.** Four tabs at `px-4` with
  a 48 px icon well come to 320 px, and the `aLL-2` build label sits absolutely
  at the left edge. A fifth tab needs `px-2.5` (340 px) and the label moved.
  The harness settles this at 360 px before anything is committed to.

## 3. Constraints every change respects

From the handoff and from the code, none of them negotiable here:

- Phone-first, light-only, `xs` at 360 px is the floor. `html` is
  `overflow-hidden`; screens are `fixed inset-0` with their own scroll pane.
- No new polling anywhere. UI reads contexts. A user tap and the engine share
  one `RateLimit(5)` that throws rather than queues.
- Every time is a `ParkTime` measured from the 4 am park-day start. Sorting
  and formatting go through it and through `<Time>`.
- `NavProvider` keeps screens below the top mounted; effects keep running.
  Nothing may assume unmount-on-navigate.
- `bg1.tsx` wraps the app in `StrictMode`: state that must survive a double
  mount lives in a `useRef`.
- A status-0 result is an unknown outcome, not a failure. No UI reports it as
  a clean failure.
- Prettier is an eslint error. Nested ternaries in JSX go into maps or small
  components. `npm run lint:fix` before every commit.
- `vite build` does not typecheck; `npm run checkall` is the gate.
- AutoLL-3 is a Walt Disney World Lightning Lane client. No Disneyland, no
  virtual queues, one destination on the start page. AutoLL keeps both.
- All work lands in AutoLL-3. AutoLL-2 is the stable base and has to stay
  where it is: `deploy.yml` checks out `mbs1234/AutoLL-2` at `goofy` for the
  installer pages and at `gh-pages` for the runtime module, rewriting the
  AutoLL-2 name in the copied assets, so that repository must keep existing
  for AutoLL-3 to deploy at all. AutoLL is frozen. The settled constraints in
  the handoff (sensor integration, Thrill Data tables, entitlement rules, git
  identity, release gate) are untouched by anything here.

## 4. Target structure

**Before.** Home tabs: LL, Times, Plans, NextLL. LL header button opens
Autopilot (everything on one screen), which links to Day summary (with the
timeline at its foot) and Plan check. Plans opens Booking details, then Change,
then Select return time, which offers Time Search.

**After.**

- **Home tabs: Today, LL, Times, Plans, NextLL.** The saved-tab mechanism
  already lands the user on the last tab used, so a park day opens on Today.
  The LL header button opens Today as well, so the old route still works.
  Fallback if five tabs fail the 360 px check in the harness: Today is the
  header button's destination only.
- **Today, live mode** (`bookingDate` is today): context strip (park, date,
  party size, DRY RUN); Autopilot on/off with one status line and the latest
  event; held Lightning Lanes; next Book and Drop times; plan summary (how many
  armed, how many paused, the top three by rank); actions left with the refill
  button; buttons to Configure, Plan check, Timeline, Activity. State alerts
  only: refusals, stopped, budget gone, unknown attraction IDs as a one-liner,
  notifications blocked, an interrupted NextLL search.
- **Today, pre-trip mode** (a future date): the checklist from item 10, each
  step linking to where it is fixed.
- **Configure:** target cards, collapsed to one line each; expanded to action
  chips, passkey, window, rank, pause, remove. Then the add-attraction list
  with a filter box. Then a Settings section: Dry run, Whole party only, Avoid
  clashes, actions per day, each with a "Why?" disclosure.
- **Timeline:** `DayTimeline` on its own screen at full height, with each held
  plan's protected span drawn behind its bar. Tapping a target opens its card;
  tapping a held pass opens Booking details.
- **Activity:** the booking log, skip counts and learned drop times. Either its
  own screen or three disclosures at the foot of Today; decide in the harness.
- **Plan Check:** an outcome bar ("Ready", "Fix 2 blockers", "Review 3
  choices") and a button on every item that has a subject.
- **Time Search:** a visible settling state, Start disabled or relabelled
  while a commit is unsettled, and an "Open Plans" action.
- **Tab footer:** one row on every tab while Autopilot is on: mode, armed
  count, actions left; tap opens Today.

## 5. Phases

Each phase is one or more branches off `main`, each ending green on
`npm run checkall` and reviewed in the harness at 360 px and 390 px. Pure logic
lands with its tests first, and the verification habit from the handoff applies
where a rule is subtle: a `verify/*` branch to prove green and a mutation branch
with the rule reverted to prove the tests bite.

### Phase 0a: narrow to Walt Disney World Lightning Lane

Goal: one resort, one product, one button on the start page. Decided by the
owner on 2026-09-07: the December trip is at Walt Disney World, virtual queues
are not in use, and Disneyland booking never worked in this fork.

What goes, on `main`:

- Disneyland: `src/api/data/dlr.ts`, `src/api/ll/dlr.ts`,
  `src/api/ll.dlr.test.ts`, and the `LLClientDLR` block plus its `diu` mock in
  `src/api/ll.test.ts` (that suite is CI-excluded but still typechecked, so it
  must compile).
- The `diu` stub, `src/api/diu.ts`. Its only importer is the Disneyland
  client; Walt Disney World's booking path never touches it, and it is not the
  sensor-data module, which stays exactly as it is. With it go the obfuscator
  plugin in `vite.config.mts`, the `vite-plugin-javascript-obfuscator`
  dev-dependency, the `jest.mock('./diu')` lines in `ll.test.ts` and
  `llClosedExperiences.test.ts`, and the `build` / `build:fork` split in
  `package.json`: one `build` script, referenced by `check.yml` and
  `deploy.yml`. The deploy step that overlays `sensor-data.js` is not touched.
- Virtual queues: `src/api/vq.ts`, `src/api/vq.test.ts`,
  `src/__fixtures__/vq.ts`, all of `src/components/vq/`, the `vq` client in
  `ClientsContext`, and the `[VQClient, BGClient]` branch in `App.tsx`.
- Tests deleted outright: the Disneyland client suite, the VQ client suite and
  the five VQ screen suites, twenty-five tests in all. `App.test.tsx` loses the
  Disneyland-VQ case and its `BGClient` mock, and gains one: a Disneyland
  origin redirects to the start page like any other unsupported origin.

What changes:

- `App.tsx`: load the Walt Disney World resort when the origin matches, set
  the Eastern time zone, otherwise navigate to the start page. No loop.
- `api/resort.ts`: `Resort['id']` becomes `'WDW'`; `loadResort` imports
  `./data/wdw` statically, which also removes the reason `resortData.test.ts`
  had to live outside `src/api/data/` (a variable dynamic import made Rollup
  bundle every file in that directory).
- `api/client.ts`: `origins` keeps only Walt Disney World; `originToResortId`
  still throws `InvalidOrigin` for everything else.
- `api/itinerary.ts`: the itinerary API name and fallback experience maps keep
  their WDW entries only.
- `resortData.test.ts`: drops the `dlr.ts` import and table row.
  `data-freshness.yml` runs it unchanged.
- `__fixtures__/resort.tsx`: drops the `vq` export.
- `README.md`: the intro says Lightning Lane Multi Pass at Walt Disney World;
  the "Walt Disney World only, for booking" paragraph is replaced by one
  sentence of scope. `FORK.md`: the `diu` history and the Disneyland section
  become a short "Scope" note, the changes table gains one row for the removal,
  and "Syncing upstream" says that upstream changes under the deleted paths are
  dropped on merge.

What changes on `goofy`, the installer branch:

- `start.html`: the four buttons under two headings become one button,
  "Walt Disney World: Lightning Lane", pointing at
  `https://disneyworld.disney.go.com/vas/`. The reminder alert and the
  skip-reminder checkbox stay.
- `index.html`: the one sentence that says "and virtual queues at Disney theme
  parks in the United States" says Walt Disney World and Lightning Lane.
- `autoloader.user.js`: the four `@match` lines for Disneyland and both
  virtual-queue hosts go; `@version` bumps so userscript managers pick it up.
- The bookmarklet code in `index.html` is deliberately left alone. It matches
  any Disney origin, and on a Disneyland or virtual-queue page the app now
  redirects to the start page, so existing installs keep working with no
  re-copy.

What stays, deliberately: a boarding group that is already in the itinerary
still renders in Plans and Booking details. That is the itinerary parser's
`'BG'` type, not the virtual-queue client, and it is read-only display of
something joined in Disney's own app.

Verification: `npm run checkall` green; `npm test` unfiltered, with the test
count before and after recorded in the commit message; `npm run build`
emitting no `dlr.js` or `diu` chunk; the three `goofy` files reviewed in a
browser; then one dispatched deploy and a sign-in on the phone, since
`LoginForm` derives its OneID client id from the resort id and that path is
the one thing here a test cannot prove.

Two consequences to accept, both already implied by the decision: future
merges from upstream `bg1` will conflict as modify-versus-delete on the removed
paths, resolved by keeping them deleted; and the AutoLL v1.1 port must not
carry this removal, so it lands as its own commits.

Size: about one session, mostly the test edits and the two documents.

### Phase 0b: preview harness and shared primitives

Goal: see any screen in any state without a Disney session, and stop repeating
the same chip and strip markup.

Changes:

- `harness/index.html`, `harness/main.tsx`, `harness/scenarios.ts`,
  `harness/fakes/` (a Walt Disney World `LLClient`, an itinerary client and a
  live-data client built on `src/__fixtures__/ll.ts` and `resort.tsx`), and
  `vite.harness.config.mts` with `root: 'harness'` and the same `@/` alias,
  React and Tailwind plugins. Script: `npm run harness`. Plain http on
  localhost; the `tls/` certificate is only needed for injection. The harness
  is a separate config, so nothing from it can reach the production bundle.
- The harness renders `Merlock`'s provider tree under a fake `ClientsContext`
  and `ResortContext`, in `StrictMode` to match production. Scenarios are
  chosen by query string (`?scenario=live-running`) and override
  `AutopilotContext` with static values for screenshot states: off and empty,
  running in burst with three targets and two held passes, stopped after
  errors, budget exhausted, dry run, pre-trip date, plan-check blockers, and
  each Time Search state (running, later move pending, unresolved,
  unconfirmed). One scenario runs the real provider against the fake clients
  so the engine can be watched acting.
- `src/components/Toggle.tsx`: the on/off chip with `variant` in
  `action | safeguard | rehearsal | pause` carrying the colour policy below.
- `src/components/ll/ContextStrip.tsx`: park, date, party size and DRY RUN,
  for `Screen`'s `subhead`. Reads the party count from `kvdb` directly, or
  through a new read-only `useSavedPartyCount`, never through `useSavedParty`.
- `src/autopilot/describe.ts`: `describeTarget(target, name)` returns the
  card's summary parts (effective mode, window, rank, passkey, paused) as data,
  not markup. The effective mode collapses the flag combinations the engine
  already understands: Book then move implies booking and moving; Swap in
  implies booking when a slot is free; Paused overrides all of them.
- `src/autopilot/events.ts`: `latestEvent(...)` picks one line from refusals,
  a stopped poller, the newest log entry, the last skip, the last find and the
  current mode, in that order of importance, and returns `{ at, text }`.

Tests: `Toggle.test.tsx`, `ContextStrip.test.tsx`, `describe.test.ts`,
`events.test.ts`. Existing suites untouched.

Done when `npm run harness` shows every scenario, and Today's future screens
can be mocked up in it before Phase 1 writes them.

Size: about one session.

**Landed 2026-09-07.** Fifteen scenarios, a 360 px and a 390 px frame, and
Time Search running end to end against the fakes. Two things it showed at
once: the Avoid-clashes explanation carried an `&mdash;` inside a string
literal and rendered the entity (fixed with it), and the day timeline's three
target columns truncate every name at 360 px, which Phase 2 inherits.

### Phase 1: the Autopilot restructure

Split in two so the first half is useful on its own and low-risk.

**1a. Inside the existing screen.** Replace the eight inline chips with
`Toggle` (item 4). Replace each watched row with a `TargetCard`
(`src/components/ll/TargetCard.tsx`) whose collapsed line comes from
`describeTarget` (item 3). Move Remove into the expanded body with an undo
flash. Fold the ten explanatory paragraphs into `Disclosure`s titled "Why?"
beside the control they explain (item 9). Add `lastSkip` to `AutopilotState`
and the provider, set at the `bumpSkip` call sites, non-persisted (item 11).
Show `LatestEvent` at the top of the screen.

Tests: `TargetCard.test.tsx`; `Autopilot.test.tsx` updated where copy moves
behind a disclosure (the test helper `see` reads only the active screen, and
`<details>` content is in the DOM whether open or not, so most assertions hold
unchanged). Provider test for `lastSkip`.

**Landed 2026-09-07.** One correction to the paragraph above: `toBeVisible`
does see through a closed `<details>`, so every assertion on folded copy now
opens its disclosure first, and the Booking activity queries are scoped to
that list because the headline repeats its newest entry. The headline shows
activity only (an action, a skip, a find); the status row still reports the
cadence and the failures, so a stopped or refusing poller is not said twice.
Passkey uses the action colour, since it decides what gets booked first.

**1b. The split and the tab.** New `screens/Today.tsx` (live mode only, at
this stage), `screens/Configure.tsx` (the remainder of `Autopilot.tsx`: cards,
add list, settings), `screens/Timeline.tsx` (wraps `DayTimeline`),
`screens/Activity.tsx`. `Home.tsx` gains the Today tab; `TabButton` padding
tightens; the build label moves from the tab bar into the Settings menu.
`AutopilotButton` opens Today. `DaySummary.tsx` is retired once Today covers
it (§6, decision 4). `Autopilot.tsx` is deleted or left as a one-line
re-export of Configure.

Tests: `Autopilot.test.tsx` splits into `Today.test.tsx` and
`Configure.test.tsx`; move tests file by file and compare the count before and
after so nothing is lost. `Home.test.tsx` and `MultiPassList.test.tsx` are
excluded from CI as already-failing upstream suites, so the tab change is
verified with `npm test` unfiltered as well as `npm run test:ci`.

Done when the 360 px harness shows Today, Configure, Timeline and Activity
with no horizontal overflow, the tab bar fits, and every behaviour the old
Autopilot suite asserted still has a home.

Size: two to three sessions, most of it the test migration.

**Landed 2026-09-07.** Decisions taken as recommended: Today is the first and
default tab; Activity is its own screen; Day Summary is retired into Today and
Timeline; `Autopilot.tsx` is gone, with the header button switching to the
Today tab. The 81 tests of the old Autopilot suite are spread over
`Today.test.tsx`, `Configure.test.tsx` and `Activity.test.tsx` on a shared
`screenTestSetup.tsx`. Every Lightning Lane screen pushed from Today carries
the `ContextStrip` as its subhead.

### Phase 2: Plan Check acts, the Timeline navigates

Changes:

- `PlanCheckItem` gains
  `subject?: { kind: 'target'; experienceId } | { kind: 'setting'; setting } | { kind: 'tipboard' } | { kind: 'budget' }`,
  set by `checkPlan` where an item names one. Purely additive.
- `PlanCheck.tsx`: an outcome bar computed from the item levels; a button per
  item. A target opens Configure with that card expanded (`focus` prop). A
  setting opens Configure's Settings section. Budget offers "Add more for
  today" inline (`refillBudget` already exists). Tipboard offers "Refresh"
  inline (`refreshExperiences`). Inline actions only ever move in the safer or
  cheaper direction; widening a safeguard always goes through Configure.
- `daytimeline.ts`: each `TimelineLane` carries its protected span from
  `clashWindow()`. The harness shows three target columns truncating every
  name at 360 px; the bars need the name to survive, whether by wrapping,
  by a legend, or by fewer columns. `DayTimeline` draws it as a lighter band behind the bar and
  takes `onTargetTap` and `onLaneTap` callbacks; bars become buttons with
  labels and an enlarged hit area. `Timeline.tsx` wires them to Configure and
  Booking details.

Tests: `plancheck.test.ts` (subjects), `PlanCheck.test.tsx` (outcome bar,
navigation, inline refill and refresh), `daytimeline.test.ts` (protected
span), `DayTimeline.test.tsx` (taps call the handlers; band present).

Size: about one session.

**Landed 2026-09-10 (`c1870b9`, `aa83e10`), recorded here 2026-09-12, with
three things still open.** `PlanCheckItem.subject` carries five variants, not
the four above: `{ kind: 'targets' }` was added for "no saved targets for this
park and date", which names no single target. `PlanCheck.tsx` has the outcome
bar and a button on every item that has a subject. `TimelineLane` carries
`protectedFrom` and `protectedTo`, `DayTimeline` draws the span as a lighter
band behind the bar, both columns of bars are real buttons with names, and
`Timeline.tsx` wires a target tap to Configure and a lane tap to Booking
details.

Still open:

- The names still truncate. `DayTimeline` is a `3rem 1fr 1fr` grid and
  `pack()` splits the Targets column again for every simultaneous bar, so at
  360 px three full-day targets get about 50 px each and every name is cut.
  What landed instead of a fix is a `title` tooltip, which a touchscreen never
  shows, plus tap-through to the card. The Phase 0b finding this phase
  inherited is unfixed.
- No enlarged hit area. A bar's height is still its time extent floored by
  `MIN_HEIGHT = 3` percent of a 480 px rail: about 14 px for a half-hour hold
  and 20 px for an hour.
- A `setting` subject opens Configure but nothing focuses the Settings
  section. `Configure` accepts a `focus` prop of that kind and reads only
  `focus.kind === 'target'`.

Of the four test deliverables, only `plancheck.test.ts` gained anything, and
that is one assertion on the `targets` subject. `PlanCheck.test.tsx` exists
with nine cases, none of which touches the outcome bar, the per-item buttons
or the navigation; `daytimeline.test.ts` never asserts `protectedFrom` or
`protectedTo`; `DayTimeline.test.tsx` has no test for a tap or for the band.
All three remain outstanding work.

### Phase 3: Time Search recovery and the shared status row

Changes:

- `useTimeSearch`: expose the guard's `phase` in `TimeSearchState`, updated
  at every transition, so `settling` is `phase === 'awaiting'` and
  `startable` is `phase !== 'unknown'`. No behaviour change.
- `TimeSearch.tsx`: while running and settling, "Waiting for Plans to confirm
  the move to 2:40 PM" replaces "Checking". After an `unconfirmed` stop the
  primary action is "Open Plans" (`goBack` to Home with the Plans tab, the
  pattern Booking details already uses) and the secondary is "Keep waiting",
  which is `start()` resuming the settle wait; the fresh-search buttons stay
  hidden until the phase is idle. Unresolved also offers "Open Plans".
- `TimeSearch.test.tsx`, the component test the handoff lists as a known gap:
  starting, a pending later move and Take it, unresolved, unconfirmed, the
  settling copy, and Start hidden while unsettled.
- Shared status row. `AutopilotProvider` at the top of `Merlock` is mirrored
  into a second context (`TopAutopilotContext`) by a tiny component just below
  it, because on the NextLL tab the nearest `AutopilotContext` is NextLL's own
  nested provider. `Tab.tsx`'s footer renders `AutopilotStatusRow` from the
  mirror while it is enabled: mode, armed count, actions left; tap opens Today.

Tests: hook tests for the phase field (settling reported while Plans has not
confirmed; cleared when it agrees), `TimeSearch.test.tsx`,
`AutopilotStatusRow.test.tsx` including the NextLL-tab case.

Size: about one session.

**Landed 2026-09-10 (`516a29c`, `ea9ebc2`), recorded here 2026-09-12, with two
corrections.** `phase` is on `TimeSearchState`, the settling copy and the Open
Plans / Keep waiting recovery are on `TimeSearch.tsx`, and the mirror and the
footer row exist as `src/contexts/TopAutopilotContext.ts`,
`src/providers/TopAutopilotProvider.tsx` and
`src/components/ll/AutopilotStatusRow.tsx`, the last rendered by `Tab.tsx`.

First correction: the bullet above has `startable` wrong.
`CommitGuard.startable` in `src/autopilot/timesearch.ts` is
`idle || awaiting`, and excludes `committing` deliberately: an awaiting move
only needs Plans to catch up, but a committing request has left the device and
must settle before anything else is offered. `phase !== 'unknown'` would offer
Start while a modify request is in flight, which is the one thing the guard
exists to prevent. The screen is stricter again and shows the fresh-search
buttons only at `idle`.

Second correction: `TimeSearch.test.tsx` was never written, and none of the
scenarios listed for it has a component test. The hook tests for the phase
field and `AutopilotStatusRow.test.tsx` did land. The component test remains
outstanding, as it was in the handoff that first named it.

### Phase 4: pre-trip checklist and polish

Changes:

- `src/autopilot/checklist.ts`: pure. Steps for party saved, park and date
  chosen, at least one target for them, an action armed or watch-only
  acknowledged, windows set where wanted, notification permission,
  unrecognised attraction IDs, and Plan Check status, each with done/todo and a
  subject. Today renders it in pre-trip mode with links: party to
  `PartySelector`, targets and windows to Configure, notifications to a button
  that calls `requestAlertPermission` from the tap, Plan Check to Plan Check.
- `lastUpdated` in `ExperiencesContext` and `PlansContext`; "Updated 2 min
  ago" on Today.
- The add-attraction filter box on Configure.
- Any copy and spacing fixes the harness review of Phases 1 to 3 produced.

Tests: `checklist.test.ts`, `Today.test.tsx` (pre-trip mode), provider tests
for `lastUpdated`.

Size: about one session.

**Landed 2026-09-10 (`516a29c`, `aa83e10`), recorded here 2026-09-12, with four
deviations.** `src/autopilot/checklist.ts` is pure and tested, and Today
renders it under "Before your trip" whenever `bookingDate` is not the park
date. `lastUpdated` is on both `ExperiencesContext` and `PlansContext` with
provider tests, Today says how fresh the data is, and Configure has the filter
box. The deviations:

- Five of the eight listed steps shipped. Park and date chosen, windows set
  where wanted, and unrecognised attraction IDs are absent. The last of those
  is on Today as a standalone red paragraph outside the checklist, so it is
  visible but is not a step with a route to fix it.
- The action button renders only for a step that is not done, so a finished
  step has no route back to review what was set.
- The filter box filters the watched cards as well as the add list. On a
  360 px phone that is arguably the better behaviour, since a long watch list
  is what pushes the add list off the screen, but it is not what the plan
  describes.
- Pre-trip mode is the live screen plus a checklist, not a second mode. Only
  the checklist section is gated on the date, so a date days away still shows
  the status row, the latest-event line, held passes and next Book and Drop
  times.

### Phase 5: review gate and release

- Codex review round on the whole branch set, per the handoff: design review
  for concept bugs, Codex for wiring bugs. Fix, re-run, repeat until clean.
- Screenshots of every scenario at 360 px and 390 px, kept out of the repo.
- Bump `package.json` to 0.3.0, dispatch `deploy.yml` with `gh workflow run`,
  and use it on a park day before anything ports.
- Port to AutoLL v1.1 only after park use, and only the files that are new or
  self-contained: `Toggle`, `TargetCard`, `ContextStrip`, `describe.ts`,
  `events.ts`, `Today`, `Configure`. That is the reason Phase 1 keeps them out
  of `Autopilot.tsx`.

**Landed 2026-09-11, at a different version and over more rounds.** The
release went out at 0.4.0, not the 0.3.0 named above: 0.3.0 was spent by the
auth-hardening commit `c3f2542` before this work was ready, so the roadmap
merge `aa83e10` took 0.4.0. The review gate was not one round but several
Codex rounds, merged as PRs #14 through #19, each merge followed by a
successful `deploy.yml` run, the last of them on 2026-09-11. Park use waits on
the December trip, and the port to AutoLL v1.1 has not happened: none of
`Toggle`, `TargetCard`, `ContextStrip`, `describe.ts`, `events.ts`, `Today` or
`Configure` exists in that repository yet.

## 6. Decisions for the owner

Six of the seven are settled by what shipped. One is still open.

1. **Today as a fifth tab.** Adopted. `Home.tsx` lists five tabs and Today is
   the first of them, so it is the fifth tab added rather than the fifth in
   the bar; `HOME_TAB_KEY` makes it the default once it has been used, and the
   header button opens it too.
2. **Colour policy.** Adopted, and written down in
   `src/components/toggleColors.ts`: actions `bg-blue-700`, safeguards
   `bg-green-700`, dry run `bg-yellow-600`, paused `bg-amber-600`,
   `bg-gray-200` for off, and red left to Turn off, Stop, errors and blockers.
   Every chip still carries "on" or "off" in its text, so colour never carries
   state alone.
3. **Hoist NextLL's provider** to `Merlock` so a quick search survives a tab
   switch, which is what would make item 7's banner true. Still open, and more
   interesting than it was. The cost is no longer only two pollers drawing on
   one `RateLimit(5)`: `autobook.ts` now keeps a per-attraction action ledger
   whose locks are persisted, adopted from other instances and released under
   rules of their own, so a second running poller is something those locks
   would have to arbitrate rather than merely a second claim on the budget.
4. **Retire `DaySummary.tsx`.** Done. The file is gone and Today and Timeline
   cover what it showed.
5. **Activity** as its own screen. Done: `screens/Activity.tsx`.
6. **Boarding groups in Plans.** Kept, as recommended. `'BG'` is still an
   itinerary booking type and still renders read-only in `BookingListing.tsx`
   and `BookingDetails.tsx`.
7. **Start page wording.** One button and no heading, but worded "WDW -
   Lightning Lane" rather than either option offered here. It lives on
   AutoLL-2's `goofy` branch, and `deploy.yml` rewrites the AutoLL-2 name in
   the copied assets at deploy time.

## 7. Risks

Four of the risks first listed here have gone. `Autopilot.test.tsx` was split
in Phase 1b with its 81 tests re-homed across three suites and none lost. Five
tabs at 360 px was settled in the harness and shipped. The colour change
landed in Phase 1a with the chip wording unchanged and the December trip still
months off. And the CI exclusion is gone: `jest.ci.config.js` was deleted,
`npm run test:ci` is plain `jest --ci`, and it runs 108 suites and 1293 tests
with `Home.test.tsx` and `MultiPassList.test.tsx` among them and passing, so
`npm test` unfiltered and `npm run test:ci` now cover the same ground. What
remains:

- Any new effect-scoped state meets StrictMode's double mount; refs where it
  matters, as the provider and `useTimeSearch` already do.
- Re-render cost from a 1.2 s tick across Today, Configure and a timeline;
  memoised derivations, and the harness's live scenario is where to watch for
  jank. Partly addressed: `PlanCheck` memoises `checkPlan`, but `DayTimeline`
  still calls `dayTimeline()` on every render, which §2 asked for a `useMemo`
  around.
- The narrowing in Phase 0a widens the gap to upstream `bg1`. Every later
  upstream merge meets modify-versus-delete conflicts on the removed paths.
  Acceptable for an experimental WDW-only build, and documented in `FORK.md`
  so the resolution is mechanical.
- `LoginForm` builds its OneID client id from the resort id. Nothing in Phase
  0a changes that value for Walt Disney World, but sign-in is verified on a
  phone after the first deploy rather than assumed.

## 8. Out of scope

The settled constraints in the handoff; any new polling or any change to
cadence, budgets, guards or the booking path; anything in AutoLL; the
sensor-data module and header construction, which Phase 0a's deletions do not
touch; "suggest a safe window" on the timeline, deferred until the navigable
timeline has been used in a park. The Disneyland Plan Check wording
limitation formerly documented in `FORK.md#disneyland` is not fixed but
removed, along with Disneyland.

## 9. What the 2026-09-12 review found

The UI-side items that review left outstanding, recorded here so they are not
lost. They are candidates for a next phase, not decided work, and none of them
has been scoped or costed.

- **Names are cut off in the timeline.** Three target columns at 360 px leave
  about 50 px a bar, and the `title` tooltip standing in for the name is inert
  on a touchscreen. Carried from Phase 0b through Phase 2.
- **Timeline bars are 14 to 20 px tall.** `MIN_HEIGHT` is 3 percent of a
  480 px rail and the enlarged hit area Phase 2 proposed was never added.
- **Plan Check's "Refresh LL list" gives no feedback.** `actOn` calls
  `refreshExperiences()` and returns. The refresh does run through the
  Experiences provider's `loadData`, but that provider's spinner and error
  flash are rendered by `Today`, which `NavProvider` marks `hidden` while Plan
  Check sits on top, so a tap produces no spinner, no error and nothing
  visible until the item recomputes.
- **Today's freshness line over-claims.** "Plans and LL availability are
  current as of" is the older of the two `lastUpdated` values, but undefined
  values are filtered out before the comparison, so one loaded context and one
  that has never fetched reads as both being current.
- **Configure can contradict its own heading.** "Watching (4)" counts
  `targetsHere`, while the list under it is the watched targets intersected
  with the loaded tipboard. An empty or not-yet-loaded tipboard gives "Nothing
  selected yet. Pick attractions below." under a heading that says four.
- **A protected band can bury the hold underneath it.** The band is a
  full-width absolutely positioned div drawn per lane in start order, with no
  `pointer-events-none`, so a later hold's band paints over an earlier
  overlapping hold's button and takes its taps as well.
- **The undo flash holds one removal.** `removed` on Configure is a single
  state slot, so a second removal inside the undo window replaces the first
  and the first target's undo is gone.
- **The timeline's tooltips are in 24-hour time.** Every bar's `title` is
  built from `ParkTime.toString()`, so the string a screen reader takes as the
  description, and the only place the full name survives truncation, reads
  "20:15:00" where the bar itself shows "8:15 PM" through `<Time>`.
