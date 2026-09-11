# Fork notes

Built on [joelface/bg1](https://github.com/joelface/bg1) and
[jgeurts/bg1](https://github.com/jgeurts/bg1), both GPL-3.0-only.
Deployed to <https://mbs1234.github.io/AutoLL-3/>.

## Why a plain `mickey` build does not work

Three separate gaps, worth understanding before touching the build:

1. **`src/api/diu` is never published.** `.gitignore` excludes it, and
   upstream's build script is `rm -f src/api/diu.ts && vite build` — it
   deletes the public shim so a private implementation resolves instead.
   A clean clone cannot resolve `import('../diu')` in `src/api/ll/dlr.ts`,
   so `vite build` fails outright. Only the Disneyland client imported it.
   This fork carried a stub returning `{}` until it dropped Disneyland
   support altogether (see "Scope" below); now nothing here imports `diu`.

2. **The build emits only the app bundle.** `rollupOptions.input` in
   `vite.config.mts` is exactly `src/bg1.tsx`, `src/bg1.css`,
   `src/responder.html`. No `index.html`, `start.html`, `news.html`,
   `contact.html`, `autoloader.user.js`, `icon.png` or `index.css` — so
   there is nothing to install or launch the bookmarklet from.

3. **Those static pages exist only on the `goofy` branch**, upstream's
   published Pages output. `goofy` is an orphan branch with no shared
   history with `mickey`; it is not a stale build, it is the only copy of
   the surrounding site.

## How this fork resolves them

`.github/workflows/deploy.yml` builds `main`, overlays the static pages from
`mbs1234/AutoLL-2@goofy` and the runtime module from `mbs1234/AutoLL-2@gh-pages`,
rewrites upstream URLs, and deploys to Pages. Both are separate public
repositories, which is why the default `GITHUB_TOKEN` can read them:

```
main (source) ──► npm run build ──► dist/
goofy  (static) ──► overlay index/start/news/contact/autoloader/icon/css
                    (never overwriting freshly built bg1.js, bg1.css,
                     responder.html or their chunks)
                 ──► brand URLs and labels for mbs1234.github.io/AutoLL-3
                 ──► GitHub Pages
```

## Booking

Lightning Lane booking at Walt Disney World works in this build, and it is
worth understanding why, because the reason is inherited rather than written
here.

**The history.** Upstream diagnosed the November 2025 breakage in its issue
#25: "The breakage is due to use of Akamai Bot Manager in the LL API." Commit
`6c069e3` (2025-11-12) then set `rules.book = false` for WDW — "This will be
reverted if it becomes possible for BG1 to book LLs again." That is the last
commit on upstream's `mickey`, and the state this work originally branched
from.

Upstream restored booking three weeks later, on its deploy branch only, by
sending an `x-acf-sensor-data` header alongside an `x-app-id`. Ten months of
subsequent work — that fix plus monthly data refreshes — exists solely as built
output on `goofy`; there is no source to merge.

**What this repository does about it.** Nothing directly. The base here is
[jgeurts/bg1](https://github.com/jgeurts/bg1), which implements that header in
TypeScript on its `mickey` branch (`a4383d0`, "Add sensor data support"). It is
inherited wholesale and is **not maintained here**. `src/api/sensor-data.ts`
and the header construction in `ApiClient.request` belong to that base. A
booking from this build was confirmed working on 2026-09-05.

**One deployment trap, already sprung once.** `sensor-data.js` is loaded by
dynamic import at runtime and is *not* a rollup input, so `vite build` does not
emit it — it has to be copied into `dist/` by the deploy workflow, from
`gh-pages` rather than `goofy` (both branches carry that filename and they are
different vintages). When it is missing the import rejects with an error
carrying no HTTP status, so `useDataLoader` shows "Unknown error occurred" and
every booking fails without naming a cause. The overlay step now fails the
build rather than warning, so this cannot recur silently.

If Disney changes the scheme again, that repair is not part of this project.
Disney has moved four times in ten months — off in November 2025, worked around
in December, apparently open again by March 2026, re-invested in during August —
so treat booking as a capability that can vanish, and keep the official app as
the fallback.

**How to tell if it has stopped.** Book one Lightning Lane by hand and read the
banner at the bottom of the screen. `useDataLoader` names the status and the
endpoint, so a refusal reads as `Network request failed (403 guests)` rather
than as a bare word. `403` is the filter; `no response` is the eight-second
client timeout, not a block. A refusal lands on *eligibility*, one step before
an offer exists — so autopilot keeps polling, alerting and learning drops while
never acting, which is the failure mode to watch for.

**What does not depend on it.** Watching, alerting, drop learning, the
return-time windows, the priority ordering and the corrected attraction data
all work regardless, and are the bulk of what this repository adds.

## Changes against upstream

| Change | Files | Why |
| --- | --- | --- |
| Disneyland and virtual queues removed | `src/api/ll/dlr.ts`, `src/api/data/dlr.ts`, `src/api/diu.ts`, `src/api/vq.ts`, `src/components/vq/`, `App.tsx`, `ClientsContext.ts` | One resort, one product; see "Scope" below. With the Disneyland client gone nothing imports `diu`, so the stub, the obfuscator plugin and the `build:fork` split went with it. `npm run build` is plain `vite build`. |
| Pages URL repointed | `App.tsx`, `LoginForm.tsx`, `screens/News.tsx` + both `.test.tsx` | `LoginForm.tsx` is the critical one — it is the OneID `responderPage`. Wrong value breaks login entirely. |
| Usage ping disabled | `src/ping.ts`, `src/ping.test.ts` | No reason for a personal build to phone home. `PING_ENABLED = false`. |
| `repository` field | `package.json` | Points at this fork. |
| Deploy workflow added | `.github/workflows/deploy.yml` | Upstream has no CI; it builds and commits to `goofy` by hand. |

## Verified

Login works from this fork's own origin (confirmed on device 2026-09-04).
Disney's OneID does **not** allowlist the `responderPage` redirect URI, so
`https://mbs1234.github.io/AutoLL-3/responder.html` authenticates normally. This was
the main risk in forking at all -- had OneID validated redirect URIs against a
registered allowlist, no amount of build fixing would have produced a working
fork.

Deliberately left pointing at upstream infrastructure:

- `src/timesync.ts` → `bg1.joelface.com/t` — reads a server `Date` header to
  correct client clock drift. Genuinely useful for hitting drop times
  precisely; replace only if you want zero third-party dependency.
- `src/api/livedata.ts` → `bg1.joelface.com/livedata/*.json` — show times
  sourced from ThemeParks.wiki, not available via Disney's tipboard.
- `github.com/joelface/bg1` source links in `start.html` / `index.html` —
  GPL-3.0 attribution, kept intentionally.

Not copied from `goofy`: `diu.js` and `dlr.js` (upstream's Disneyland
modules; nothing in this build loads them), `sensor-data.js` (bot-detection
payload, referenced by no page), `google*.html` (upstream's site-verification
token).

## Testing

Upstream shipped a **red test suite**, and this section used to describe living
with it: eight suites excluded from CI, four of them genuinely failing, and a
`npm test` that was expected to report 27 failures. None of that is true any
more. The excluded suites were either repaired or removed outright with the
Disneyland and virtual-queue code, `jest.ci.config.js` had emptied out to the
point where it excluded nothing, and both commands ran the same tests. It has
been deleted; `test:ci` is now `jest --ci` over everything.

That mattered more than bookkeeping. A maintainer hitting a red suite on a park
morning would have read this page, found that `npm test` legitimately fails and
that the suite in question was one of the known-broken ones, and dispatched with
`skip_checks: true` over a real regression.

| Command | Scope | Status |
| --- | --- | --- |
| `npm run test:ci` | everything, CI reporter | **green** (107 suites / 1241 tests) |
| `npm test` | the same tests | **green** |
| `npm run lint` | | green |
| `npm run typecheck` | | green |
| `npm run build` | | green |

There is one suite and one number. If it is red, something is broken.

**Seeing a screen.** The bundle only runs injected into a logged-in Disney
page, so until 2026-09-07 a screen could be seen in a park or in a jest render
and nowhere else. `npm run harness` now serves the real screens over fake
clients (`harness/`, `vite.harness.config.mts`) with a scenario picker; see the
README. The fakes never send a request, and the harness's own Vite config is
what keeps it out of the bundle the bookmarklet loads.

**What gates a publish.** `deploy.yml` runs `npm run typecheck` and
`npm run test:ci` in its own build job, before the bundle is built, and its
`deploy` job is `needs: build` — so a failure there skips the publish and Pages
keeps serving what is already live. That gate is inside `deploy.yml` rather
than a dependency on the Check workflow, because nothing then has to fire, be
named, or stay wired for it to hold.

`vite build` is why it is needed: esbuild strips types without checking them,
so `tsc --noEmit` is the only typechecker either repo has, and until this was
added a type error reached the phone. `npm run lint` deliberately does not
gate — most red checks here have been formatting alone, and the bundle is fine
in every one of them. That reasoning was stronger when there was no local
toolchain and a prettier nit cost a push and a round trip; `npm run lint:fix`
now runs on the development machine.

Dispatching `deploy.yml` with `skip_checks: true` publishes without the gate.
It exists for a park morning with a red unrelated test and nothing else — and
now that no suite is expected to be red, reach for it correspondingly less.

## Scope

**Walt Disney World Lightning Lane only.** Disneyland and virtual-queue
support were removed on 2026-09-07 (see the changes table). The trip this
build exists for is at Walt Disney World, virtual queues were not in use, and
Disneyland booking never worked here: `LLClientDLR.book()` built its request
from `diu`, the one module upstream never publishes, so the stub this fork
shipped could only ever produce a request Disney would refuse. Rather than
carry a second resort that could watch but not book, and a second product
nobody used, both are gone — the Disneyland client and data file, the `diu`
stub, the virtual-queue client and its screens. The start page on `goofy`
offers one destination, and a bookmarklet run on any other Disney page is
sent back to it by `App.tsx`.

What stays: a boarding group already in the itinerary still renders in Plans
and Booking details. That is the itinerary parser's `'BG'` type — read-only
display of something joined in Disney's own app — not the virtual-queue
client.

AutoLL keeps both resorts and both products. Anything ported from here to
AutoLL must leave this removal behind.

## Local toolchain

Node 22 (`v22.23.2`, from the official darwin tarball rather than Homebrew)
has been on the development machine since 2026-09-07, so `npm run checkall`,
`npm test` and `npm run build` all run locally. CI still runs every step even
after one fails, so a single push reports everything at once — but it is no
longer the only feedback loop.

To prove a test bites, the habit is unchanged: a `verify/*` branch to show
the fix green, and a mutation branch with the fix reverted to show the test
red. `verify/full` and `verify/mutation` were used exactly that way and
deleted afterwards.

(Earlier versions of this section said Node came from Homebrew, which was
never true, and then that there was no local toolchain at all, which was true
until 2026-09-07.)

## Autopilot

Everything this fork adds beyond the build fixes lives under `src/autopilot/`,
wired in by `src/providers/AutopilotProvider.tsx` and surfaced on the Today tab
(`src/components/ll/screens/Today.tsx`), with `Configure.tsx`, `Activity.tsx`
and `Timeline.tsx` behind it. The README is the user-facing guide; this is the
map.

| Module | Role |
| --- | --- |
| `schedule.ts` | Pure cadence policy (idle / approach / burst) from drop times and every booking window, on the drift-corrected clock; backoff. |
| `usePoller.ts` | The single sequential polling loop. |
| `wakelock.ts` | Screen Wake Lock held while autopilot runs, re-acquired when the page becomes visible. Best-effort: unsupported or refused leaves prior behaviour. |
| `watchlist.ts` | Targets and their flags; matching; edge-triggered alert selection; persistence. |
| `alert.ts` | Chime, vibration, notification, each degrading independently. |
| `prewarm.ts` | Guest-eligibility cache, invalidated on `eligibleAfter`, on any booking, and whenever what the party holds changes — a tap-in, an expiry, or a booking or cancellation made by hand. |
| `priority.ts` | Priority ordering (same comparator as the LL list) and the Tier 1 hold. |
| `autobook.ts` / `automodify.ts` / `autoswap.ts` | The three actions, each guarded on the offer's *real* time; shared per-action ledger. |
| `party.ts` | Whole-party guard. |
| `overlap.ts` | Whether a return time clashes with an existing plan, using Disney's own window from `api/ll/wdw.ts`. |
| `observe.ts` / `learned.ts` | Drop-time learning: detection, coverage, clustering, and merging learned times into the cadence. |
| `storage.ts` | Persisted settings, the day-scoped activity log, and the day-scoped action budget. |

Design rules that hold throughout, and that a future change should keep:

- **Pure core, thin shell.** Every decision is a pure function with its own
  tests; the provider only sequences them. Almost all of the ~620 tests in
  `test:ci` are on these.
- **Never commit an offer without re-checking its real time.** The tipboard
  time you matched on and the offer Disney returns can differ; booking, moving
  and swapping all re-verify before committing, and moving additionally refuses
  ever to trade down. What counts as "the offer" is everything Disney returned,
  not just the time: the party it covers is re-checked against `requireWholeParty`
  here too, and a move measures its improvement against the reservation named in
  the offer's own itinerary rather than the plans snapshot the tick began with.
- **Mark attempts before the request goes out.** A timed-out request may have
  succeeded server-side; retrying is the dangerous option.
- **Only a literal `true` arms anything** when reading persisted flags. The one
  exception is `avoidOverlaps`, which defaults on and so needs a literal
  `false` -- the asymmetry follows the cost of guessing wrong.
- **Resort data is checked, not assumed.** `src/api/resortData.test.ts` scans
  each entry against both halves of the `// <Park> - <Type>` section it is
  declared under, pins the facility ids that went stale in 2026, requires every
  Tier 1 entry to carry a `priority`, and requires one ride served under several
  facility ids to rank the same under each. The last two exist because
  `comparePriority` reads a missing priority as Infinity: Millennium Falcon
  shipped without one and was therefore offered up as the preferred swap victim,
  and Soarin's three film ids disagreed, so the same queue ranked a band lower on
  two days out of three. It lives outside `src/api/data/` on purpose:
  `loadResort` dynamic-imports `./data/${id}.ts` with a variable, so Rollup
  bundles every `.ts` in that directory.
- **On/off never persists;** per-attraction arming does. That asymmetry is
  what makes persisted arming safe.

A structural limit worth knowing before anyone tries to fix it: background
operation via a service worker is impossible, not hard. BG1 runs injected into
a page on Disney's origin; a service worker must be same-origin with the page
it controls, and this fork's worker would live on `mbs1234.github.io`.

## Syncing upstream

```bash
git fetch upstream
git merge upstream/mickey
```

Conflicts should be limited to the one-line URL changes in the table above,
plus modify-versus-delete conflicts on the paths removed under "Scope"
(`src/api/ll/dlr.ts`, `src/api/data/dlr.ts`, `src/api/diu.ts`,
`src/api/vq.ts`, `src/components/vq/`) — resolve those by keeping the files
deleted. The URL is left hardcoded per-file rather than extracted to a shared
constant precisely so these conflicts stay trivial.
