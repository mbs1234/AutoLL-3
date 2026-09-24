# Review notes for Codex — AutoLL-3 at `e223752`

Two commits landed after your `6084ed9` (PR #47). This is what changed, why,
and what I would most like a second pair of eyes on.

State: 114 suites / 1540 tests, lint and typecheck clean, deployed and live.
`autoll3-release.json` reads `sourceRevision: e223752`.

---

## First, what #47 got right

Worth saying plainly, because the two defects below are narrow and the commit
as a whole is not.

- **The fresh-booking lease is the strongest part.** I traced every exit from
  the leased region — acquisition failure, the post-lease blocker, the helper's
  own returns, a throw to the catch, abandonment — and they all reach the
  `finally`. I could not construct a leak, a deadlock, or a double booking.
  It works without Web Locks because `acquire()`'s critical section is
  synchronous. The post-lease `adoptAttempted(loadLocks())` + second
  `attemptBlocker()` is the necessary second half, and it is the difference
  between preventing a race and merely serialising one.
- **Keeping fresh bookings out of quarantine** is right, and the gate on
  `changesExistingReservation` is in the correct place.
- **Pinning both AutoLL-2 inputs** to immutable SHAs is the change that makes an
  old build reproducible rather than merely re-runnable. I verified both pins
  resolve, match the current `goofy`/`gh-pages` heads, and match the live
  manifest — so it shipped as a behavioural no-op, which is how that kind of
  change should land.

---

## Defect 1 — the id join would have refused every move in a park

`offerBaseline` (`src/autopilot/automodify.ts`) compares three ids that arrive
in three different shapes:

| id | shape on arrival |
|---|---|
| the booking's own `id` | stripped of `;entityType=` — `itinerary.ts:289,334` |
| a guest's `entitlementId` | raw — `itinerary.ts:325` |
| the offerset's `EXISTING_ITEM.id` | raw — `ll/wdw.ts:330` |

#47 compared them untouched, and the matcher is **fail-closed**: an id that is
present but does not match refuses rather than falling back. So a decorated id
on Disney's side means every auto-modify and every bookThenMove skips as
`ambiguous-existing-booking`, silently, for the rest of the day.

Nothing in the suite could see it. The fixture covering that path uses the
invented bare id `'ent-split-party'` (`ll.test.ts:386`), while
`itinerary.test.ts:33` has a helper that builds Disney's real shape and
fixtures like `411504498;entityType=Attraction`.

**Fix:** `typelessId` is now exported from `itinerary.ts` and applied to both
sides. New test `matches an offer item whose id still carries its entity type`.
Mutation-proved: reverting the normalisation turns its expected
`offer-not-an-improvement` into `ambiguous-existing-booking`.

One detail worth knowing: the ids are filtered before stripping. A swap victim
reaches that code with guests carrying **no** `entitlementId`, and the Set this
replaced tolerated `undefined` because it never touched what it held. The
modify suite alone did not catch that; the full suite did.

## Defect 2 — an unknown outcome was rendered as a failure

`fetch.ts:78` collapses a dropped request and a refused one to status 0, in its
own words, because *"the request may have been acted on and the outcome is
unknown"*. The engine honours that — it holds the reservation in doubt rather
than retrying. The activity log was the last place still rendering it as
`Failed on X`, which is the reading that gets a guest to try again on a
reservation Disney may already hold.

**Fix:** `BookingLogEntry.status` gains `'unknown'`. The provider already
computed the predicate for quarantine (`current.dispatched && !outcome.rejected`);
it is now hoisted above the `if (lease)` branch so a fresh booking reaches it
too, stamped on the outcome, and rendered as
`No answer for X -- check Disney Plans` at `warn`. Mutation-proved.

---

## Other changes in `4531fd5`

- **`paths-ignore: ['**.md']`** on the deploy push trigger. Nothing markdown
  reaches the published site (the guide ships as `user-guide.html` plus
  images), so a prose commit cannot change the artifact and should not rebuild
  it. This matters most during the planned pre-trip freeze, where
  correcting a roadmap would otherwise republish the exact bundle the freeze
  exists to leave alone. YAML validated; 16 build steps intact.
- **Two comments repaired** that the `goofy` → pinned-revision rename cut in
  half: `deploy.yml:9` lost *"only place the"* mid-sentence, and the sensor
  overlay comment lost the start of *"Taken from the runtime pin…"*.
- **21 iCloud conflict copies** deleted from `docs/user-guide/`.
- **A build stamp.** `vite.config.mts` injects the short commit via `define`;
  `BUILD_REV` in `appIdentity.ts` reads it with a `dev` fallback for jest and
  the harness; Settings renders `AutoLL-3 · <rev>`. The point is that
  *"is this the build we tested?"* becomes answerable on the phone rather than
  from a laptop and the release manifest. Verified present in the live bundle.

## The change in `e223752` — Avoid clashes now defaults off

Owner request. It needed **two** edits, and either alone would have been a
no-op that still read as a deliberate decision in the diff: `DEFAULT_SETTINGS`
said `true`, but `loadSettings` read the stored value as `!== false`, so
absence meant on regardless of the default. It now reads `=== true`, like every
other persisted flag, and `FORK.md` no longer lists it as the exception.

Six existing tests passed **only** because the default happened to arm the
behaviour they were written to test — the flip would have turned them green
while deleting their subject. They now set `avoidOverlaps: true` themselves.

Behaviour on an existing install is unchanged by design: settings are persisted
in an effect that runs on mount, so any phone that has opened Autopilot has a
value stored whether or not anyone chose it. The new default reaches new
installs and cleared storage only.

---

## What I would most like you to look at

1. **The fresh-booking lease key.** A book leases `${date}:${experience.id}`
   while a swap gaining the same attraction leases `${date}:${victim.facilityId}`,
   and their attempt-lock keys differ by kind. So a fresh booking of X and a
   swap gaining X contend through neither. Is that reachable in practice, and
   is it worth closing before the freeze?
2. **Rapid versus background contention.** NextLL's provider polls at 600ms and
   the app's at 45s. With the lease in place, can the user-facing search lose an
   attraction to the background engine for up to `MAX_MUTATION_MS`, reported as
   `already attempted`? If so, should the rapid provider preempt, or at least
   say something truer?
3. **A doubt now blocks a fresh booking.** `acquire()` refuses a quarantined key
   and a fresh booking now uses that key, so a doubt raised by a modify or swap
   blocks a *new* booking of that attraction for the rest of the park day. That
   is defensible, but it is not what `ROADMAP.md` says, and Today's banner
   describes only the blocked change.
4. **My `unknown` stamping site.** I hoisted the predicate above `if (lease)`.
   Please check I did not change when quarantine is written — that was not the
   intent.

## Open questions I cannot answer from here

- **Does Disney's `EXISTING_ITEM.id` actually carry the `;entityType=` suffix?**
  The normalisation is correct either way, but it decides whether #47 was a
  latent bug or an active one. One captured offerset response settles it, and
  nobody has one.
- **Is the three-at-a-time Multi Pass cap per park date or global?** Every input
  to `slotsAreFull()` is scoped to the selected booking date. If Disney enforces
  it globally, the fourth booking fails as a rejection — and the engine has no
  idea why. The owner books every park day of a stay in one sitting on a booking
  morning, which is the first time this can matter.
- **Are `modify:` / `swap:` orphan locks from an unmounted NextLL provider ever
  released?** `book:` orphans heal in two polls. I believe the other two do not,
  and `saveLocks` removal is owner-scoped so nobody else can withdraw them.

## Standing constraints, so a fix does not trip over them

- The app must work for **any** park date. Trip dates are scheduling facts and
  live in `docs/`; nothing in `src/` may carry a calendar date or a constant
  derived from one. I check the built bundle, not just the source.
- Status 0 is an **unknown outcome**, never a failure.
- `CONFIRM_ABSENT_POLLS = 2`.
- The sensor payload and its headers are off-limits; calls into them are
  editable.
- Every behaviour change carries a test that fails without it — demonstrated by
  mutating the source and watching it go red, not asserted.
