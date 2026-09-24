# A park-day monitor, and a pre-trip drop refiner

Written 2026-09-17, against `main` at `76c13c7`, version 0.5.0.

This describes two small tools that are **not part of AutoLL-3 and should not
become part of it**. They are recorded here because every fact they rest on was
established by reading this repository, and because a design that depends on
this codebase's internals should say so where those internals live. Nothing in
this document changes the app.

Neither tool books anything. Neither sends a sensor-data payload. One of them
never contacts Disney at all.

---

## 1. Why two tools rather than one

They answer different questions, on different days, from different sources, and
they fail in different ways. Building them as one thing would mean the park-day
half inheriting the pre-trip half's Disney session, which is the single most
fragile part of either design.

| | **A. Park-day monitor** | **B. Pre-trip drop refiner** |
|---|---|---|
| When | Days you are in a park | Weeks before the trip |
| Source | ThemeParks.wiki public API | Disney's tip board, via this app |
| Disney account | **None** | A secondary account |
| Sensor data | **None** | **None** — see §5 |
| Runs on | A server, or anything | A desktop Mac, in a browser |
| Output | Notifications to your phone | Observations for `learned.ts` |
| Worst failure | A late alert | It stops until someone signs in |

**The separation is the design.** A wants to run unattended for a week; B wants
a human at a browser every morning. A has no credentials to lose; B's whole
risk surface is a credential. Keeping them apart means A's uptime does not
depend on B's session, and B's account problems cannot silence A.

---

## 2. What the public feed actually carries

`https://api.themeparks.wiki/v1/entity/{parkId}/live` — free, no API key, no
account. Per attraction:

```json
{
  "name": "Space Mountain",
  "externalId": "80010190;entityType=Attraction",
  "status": "OPERATING",
  "queue": {
    "STANDBY":          { "waitTime": 35 },
    "RETURN_TIME":      { "state": "AVAILABLE",
                          "returnStart": "2026-09-17T14:20:00-04:00",
                          "returnEnd":   "2026-09-17T15:20:00-04:00" },
    "PAID_RETURN_TIME": { "state": "AVAILABLE", "price": { ... } }
  },
  "operatingHours": [ ... ],
  "lastUpdated": "2026-09-17T16:18:27.766Z"
}
```

`RETURN_TIME` is the Multi Pass availability this app's autopilot watches. It is
public.

**Measured 2026-09-17, mid-afternoon:**

| | |
|---|---|
| Attractions carrying `RETURN_TIME` | **50** — MK 18, HS 13, EPCOT 11, AK 8 |
| `status` values observed | `OPERATING` 189, `CLOSED` 27, `DOWN` 1, `REFURBISHMENT` 1 |
| `RETURN_TIME.state` observed | `AVAILABLE` 45, `FINISHED` 5 |
| Rate limit | `300 requests / 60 s` (`ratelimit-policy: 300;w=60`) |
| CDN cache | `cache-control: max-age=60, s-maxage=60` |
| Staleness of live rows | min 106 s, **median ~11 min**, p90 ~3.3 h |

Two consequences, and they set the whole shape of tool A:

- **Polling faster than once a minute returns the same bytes.** The response is
  Cloudflare-cached for 60 seconds. Four parks once a minute is 4 requests
  against a 300 budget.
- **It cannot catch a drop.** A scheduled drop is a two-second window; this feed
  reflects it minutes later. Do not design toward it. The phone in the park
  already does that job better than any server reading a lagged feed could.

### The IDs line up exactly

Every attraction's `externalId` is the Disney facility id this repository
already keys on. Checked against the 189 entries in `src/api/data/wdw.ts`:

```
public-feed attractions with RETURN_TIME: 50
  map straight onto a repo facility id:   50   (100%)
  unmapped:                                0
```

So `src/api/data/wdw.ts` can be read as a plain lookup table — names, lands,
tiers, priorities, average waits, drop times, refill windows — with no network
call and no Disney relationship. That file is the one piece of AutoLL-3 either
tool should reuse, and it should be **copied or vendored, not imported**: a
build-time dependency between the two projects is exactly the coupling this
design is avoiding.

---

## 3. Tool A — the park-day monitor

A poller, a state diff, and an agent that decides what is worth interrupting you
for. Two alert classes, requested in this order of value.

### 3.1 A ride went down, and came back

A four-state transition watcher on `status`.

- `DOWN` is the transient state worth alerting on.
- `CLOSED` is "not open today, or not open yet" — not an outage.
- `REFURBISHMENT` is long-term and should never produce an alert.

The ~11-minute lag bites asymmetrically, and the scoping should follow:

- **"X is down" survives being late.** The value is *do not walk across the
  park*, and that is still worth knowing eleven minutes old.
- **"X is back up" mostly does not.** Anyone with a faster source has already
  moved, and a short breakdown may never appear in the feed at all.

So: alert on down, footnote the recovery, and do not present either as a race
signal.

### 3.2 A ride you still want is running out

You cannot see inventory. You can see `returnStart` marching later, which is the
same information one derivative away.

The naive reading is wrong: return times slide later simply **because time
passes**. At 2pm the earliest available return is necessarily later than it was
at noon. The signal is slip measured *against the clock*:

```
depletion = Δ(returnStart) / Δ(wall clock)
```

| ratio | meaning |
|---|---|
| ≈ 1.0 | holding steady — inventory replacing itself as fast as it goes |
| > 1.0 | depleting; the higher, the faster |
| < 1.0 | inventory being **added** — a drop, or a refill window |

Extrapolating the ratio to park close gives the alert asked for: *"Peter Pan's
is depleting at 1.6×; at this rate it is gone by 16:40; you have not done it;
you are at Magic Kingdom today."*

The same statistic detects a drop from the other side — a sharp dip below 1.0
**is** a drop, arriving late. That is not useful for acting on, but it is useful
for confirming one happened, which matters to tool B.

**Measured, two samples 40 minutes apart on 2026-09-17:**

```
42 of ~50 attractions moved — 38 later, 4 earlier

Space Mountain            12:40 → 14:20   +100m
Tower of Terror           17:45 → 18:45    +60m
Buzz Lightyear            19:00 → 19:50    +50m
Tiana's Bayou Adventure   19:55 → 20:40    +45m
```

Typical slip was +45–60 minutes against 40 minutes elapsed — a ratio of roughly
1.1–1.5×, which is what an ordinary weekday afternoon should look like.

**Do not alert off a single diff.** A two-sample comparison mixes real slip with
update jitter, because rows refresh at different times: the −170 m reading on
Na'vi River Journey in that sample is either a genuine refill-window return or a
stale row catching up, and two points cannot tell you which. Sample every
minute and fit a trend over ~30 minutes.

### 3.3 The itinerary has to come from you

There is no Disney account on this path, so there is no way to read what you
hold. The plan is an input, not something the tool can discover.

The agreed shape: **you give the agent the day's plan, and update it as the day
goes** — rides done, plans changed. It does not need to be precise; "these six,
roughly this order, Space Mountain already done" is enough to drive both alert
classes. Replying to a notification is the natural way to mark something done.

AutoLL-3 on your phone already knows all of this — watch list, held passes,
what has been experienced. **It is deliberately not the source here.** Wiring
the two together would mean adding a sync path to an app whose whole design is
that it runs in one tab and stores everything locally, and that complexity is
not worth what it saves. A list you type is fine.

### 3.4 What tool A must not claim to do

- Catch a drop. Stated twice on purpose.
- Know what you hold.
- Book, modify or cancel anything.
- Be right about a single diff.

---

## 4. Tool B — refining the drop table before the trip

`src/api/data/wdw.ts` ships a table of drop minutes, and
`src/autopilot/observe.ts` and `learned.ts` already know how to check it against
what actually happens. What they lack is days. `LEARNED_MIN_DAYS = 2`
(`learned.ts:15`) means nothing is learned on a single park day, and a trip of a
few days barely clears the bar.

A desktop watching an ordinary Tuesday, every Tuesday, clears it easily.

### 4.1 The path is clean, and by design

The tip board read carries no sensor payload. `LLClient.experiences` builds
`GET /tipboard-vas/planning/v1/parks/{parkId}/experiences/` with no
`sensorData` flag (`src/api/ll.ts:320-327`).

The WDW subclass adds a second call — but only sometimes
(`src/api/ll/wdw.ts:177`):

```js
if ((date > parkDate() || exps.length === 0) && (!cached || retryDue)) {
```

That availability-bundle POST sets no sensor header itself, but reaches
`primaryGuestId()` → `guests()`, which does. So it is **transitively sensored**,
and it fires only on a future date or an empty board. The comment above it says
so plainly: *"Not on an ordinary day-of poll."*

Drop learning only ever runs for **today's** date, for the same reason the
comment gives — a ride opening for the day would otherwise be mislearned as a
drop. So the pre-trip refiner polls today, takes the clean path, and never
touches the sensored call. The design already lines up with the requirement.

### 4.2 Why a desktop browser, not a server

Every obstacle here is the session, not the sensor:

- **No refresh token.** `AuthData` stores swid, accessToken, expires, resortId,
  version, receivedAt and nothing else (`src/api/auth.ts:13-22`).
- **Browser-only login.** Disney's OneID SDK is injected from
  `cdn.registerdisney.go.com` and driven through a postMessage bridge to a
  responder page (`src/components/LoginForm.tsx:54-99`). There is no headless
  path, and automating the sheet would mean driving Disney's password and MFA
  UI — which `SECURITY.md` says this app never does.
- **The 5pm rule is destructive.** A token expiring today before 17:00 Eastern
  is not merely declined; `getData()` calls `invalidate()` and wipes it
  (`src/api/auth.ts:106-120`).
- **One 401 ends the run.** The stored token is deleted (`client.ts:145-147`),
  and the poller gives up after 8 consecutive failures.

Running it as a tab on a desktop Mac that stays on sidesteps three unknowns at
once — no headless login, no CORS question, no datacenter-IP-with-non-browser-
TLS question — because it is exactly what the app already does. The cost is a
sign-in each morning, which is a glance at a tab rather than a pager.

### 4.3 Settle this before writing any code

**Does a secondary account with no park admission for that date get a
meaningful tip board, or an empty one?**

`INVALID_PARK_ADMISSION` exists as an eligibility reason, which hints the
eligibility half needs a ticket. Whether the *availability* half does is
unverified, and it is the entire premise of tool B. Signing the account in and
looking at the tip board answers it in five minutes. Nothing else here is worth
doing first.

If the answer is no, tool A is a weaker fallback for the same job: it sees
`RETURN_TIME` dips too, so across many days it can confirm *"a drop happened
around 12:47 on this date"* even though an ~11-minute lag cannot pin the minute.
Worse data, zero exposure, no account.

### 4.4 What would have to be shimmed

`kvdb` writes straight to `localStorage` (`src/kvdb.ts:9-39`), and
`observe.ts`, `watchlist.ts` and `LLTracker` all persist through it. In a
browser tab that is free. It is the reason a headless Node port is more work
than it looks, and another argument for the desktop tab.

---

## 5. Reference — which calls carry sensor data

Established by reading every `sensorData` usage in the repository. Six call
sites, all in `src/api/ll/wdw.ts`, all on the booking path.

| Call | Line | What it does |
|---|---|---|
| `guests` | 288 | who in the party is eligible |
| `offer` | 320 | ask Disney for a return time |
| `times` | 403 | the full return-time grid |
| `changeOfferTime` | 436 | move an offer to a different time |
| `book` | 471 | commit a booking |
| `modify` | 504 | change or swap a held pass |

Everything else is clean:

| Call | Notes |
|---|---|
| `LLClient.experiences` | **the tip board** — `GET /tipboard-vas/…` |
| `LLClient.cancelBooking` | cancelling needs no payload |
| `itinerary.plans` | the itinerary read |
| `DasClient.experiences` / `parties` / `book` / `cancelBooking` | all four |
| `livedata.shows` | third-party, unauthenticated |
| the availability-bundle POST | no header of its own, but **transitively sensored** via `primaryGuestId()` → `guests()` |

Two things this table does **not** say, and neither is knowable from this
repository:

- Whether Disney would serve any of these without an `Authorization` header.
  Nothing here probes an endpoint anonymously, and the client wipes its token on
  the first 401, so the app cannot be used to find out without losing the
  session.
- Whether a sensor-free read is refused in practice for reasons other than the
  header. `src/autopilot/refusal.ts` only tracks `eligibility | offer | book`;
  a refused tip board read would produce no instrumentation at all.

Note also that every Disney request is authenticated regardless:
`ApiClient.request` destructures `authStore.getData()` at `client.ts:103`
before any branching, and the tip board additionally appends `userId=<swid>` as
a query parameter (`ll.ts:465-474`). The guest is identified three ways on one
GET — bearer subject, `x-user-id`, and the query param.

---

## 6. Deliberately not doing

- **Catching drops from the public feed.** The latency makes it impossible, and
  a tool that appears to try will be trusted to.
- **A headless Disney login.** No refresh token exists, and automating the OneID
  sheet means handling credentials this project has always refused to handle.
- **Syncing AutoLL-3's watch list into the monitor.** The app stores everything
  in one tab's `localStorage` by design. A sync path is real complexity in the
  app to save typing a list.
- **Importing from this repository at build time.** Vendor
  `src/api/data/wdw.ts`; do not couple the two projects' builds.
- **Anything that books.** Both tools are read-only. The person in the park
  acts, using AutoLL-3.

---

## 7. Open questions

1. **Does a ticketless secondary account see tip board availability?** (§4.3.)
   Blocks tool B entirely. Five minutes to answer.
2. **What smoothing window makes the slip ratio stable?** ~30 minutes is a
   guess from one 40-minute sample; a day of minute-resolution data would
   settle it.
3. **How stale is too stale?** Rows carry `lastUpdated`; the monitor should
   probably decline to alert on a row older than some threshold rather than
   extrapolate from it. What threshold is unmeasured.
4. **Does ThemeParks.wiki publish acceptable-use terms** beyond the rate-limit
   headers? Four requests a minute is plainly modest, but the question was not
   answered.
5. **Could their collector be self-hosted** to beat the ~11-minute lag? There is
   no US Disney module in the public `parksapi` tree (only Paris, Tokyo,
   Shanghai) and no `x-acf-sensor-data` anywhere in it — but a GitHub code
   search was rate-limited partway, so this is unverified.

---

## 8. Related

- [FORK.md](../FORK.md) — why booking needs the sensor payload, and the history
  behind it
- [docs/USER-GUIDE.md](USER-GUIDE.md) — what the person in the park is using
- [ROADMAP.md](../ROADMAP.md) — what this project is doing before the main
  trip's freeze; neither tool here is on it
- `src/autopilot/observe.ts`, `learned.ts` — the drop-learning tool B feeds
- `src/api/data/wdw.ts` — the table both tools read
