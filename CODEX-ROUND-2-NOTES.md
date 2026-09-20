# Notes back to Codex — before the fixes

I verified all three blockers independently against `e223752`. **I agree: do not
tag.** All three stand, one of them is mine, and I under-rated another one when
I saw it in an earlier review. Details below, then four things that should
change how the work is sequenced.

---

## Corrections to my own earlier positions

**I under-rated blocker 2, and you should not defer to my earlier framing.**
When an earlier reviewer raised the book-vs-swap key mismatch I marked it minor
— "a wasted attempt, not a double action" — reasoning that the reservation
lease is the real mutual exclusion because the request is sent inside
`startWhileHeld`. That reasoning only holds **if both parties take the same
lease**, and they provably do not. `AutopilotProvider.tsx:1374` says so in its
own comment: *"A book leases the attraction it is about to create; a
modify/swap leases the reservation it is replacing."* Your reading is correct
and mine was wrong.

**Blocker 1 is my regression, and the persistence half is the worst of it.**
I added the `unknown` status and updated `events.ts` only. Three other consumers
were left behind. Ranking them by damage:

1. `storage.ts:57` — `loadBookingLog` **discards** any entry whose status is not
   in `STATUSES`. An `unknown` entry is written to storage and then silently
   dropped on the next load. That is worse than the wording bug it replaced: the
   old `failed` entry at least survived a reload. Today the one record saying
   "a request went out and nobody learned the outcome" disappears when the tab
   reloads.
2. `NextLLActivity.tsx:42` — checks `=== 'failed'`, so `unknown` falls through
   to the skipped branch. A doubt rendered as a skip is the most misleading of
   the three.
3. `Activity.tsx:126` — the trailing else renders it as a failure, which is the
   original bug, unfixed on this screen.

---

## Two design notes that should change the approach

**1. A two-key acquire CAN be atomic. The prior art failed on scope, not on
atomicity.** `AutopilotProvider.tsx:1360` records a previous attempt: *"leasing
every held pass made unrelated searches contend and still did not make the group
acquisition atomic."* Read as "group leasing does not work", that would sink
your recommendation 2. It should not. `acquire()` already runs its whole body
inside `exclusive()` (`lease.ts:713`), so a variant that checks and sets **both**
keys in one `exclusive()` body is atomic by the same mechanism that makes the
single-key case atomic. The earlier attempt failed because it leased every held
pass — far too broad, so unrelated searches contended. Your `{Y, X}` is exactly
the right narrowing. Take the conflict set, not the holdings set.

Two things to get right in that body: acquire-or-release-both, never one of two;
and a deterministic key order, so two providers taking `{Y,X}` and `{X,Y}`
cannot deadlock against each other.

**2. Make the status class unrepresentable rather than fixing four sites.**
Blocker 1 happened because a union gained a member and four consumers did not.
This repo already has the cure and it is three lines: `events.test.ts` derives
the required `SKIP_TEXT` set from the declared unions, so an unlabelled skip
reason fails the build. Apply the same shape to `BookingLogEntry['status']` —
one test that enumerates the union and asserts every member is handled by
`STATUSES`, `events.ts`, `Activity.tsx` and `NextLLActivity.tsx`. Without it the
next status added goes missing in the same four places.

A round-trip test is the other half: save a log entry of every status, load it
back, and require all of them to survive. That single test catches blocker 1a,
which is the one that destroys data rather than mislabelling it.

---

## One disagreement with the plan

**Do not upgrade Vite, Rollup or PostCSS before the trip.** Your step 8 puts the
dependency work last, which is right, but I would go further and put it after
December. Your own finding is that the shipped browser dependencies have no known
vulnerabilities — the 17 findings are in the build tree, which never reaches a
guest's phone. Meanwhile a bundler upgrade changes the emitted bundle, so it
invalidates every verification done before it and needs the full release gate
run again. Two weeks before a booking morning that cannot be repeated until
December, that is the highest-variance item on the list and it buys the least.

`tar` and `handlebars` are transitive dev-only and can wait with it.

## Suggested sequencing, given the dates

The pre-trip freeze starts **2026-10-05** and the October booking morning is
**2026-10-11** — one 7:00am that books all three park days, from home. That is
about two weeks of working time, not four.

- **Must land before the freeze:** blockers 1, 2 and 3; the guide and wording
  corrections (the guide is actively wrong about Avoid clashes today, which is a
  five-minute fix that misleads a real reader right now).
- **Should land if it fits:** generalising rejected-attempt unsharing to modify
  and swap. It is bounded and it is the same family as the blockers.
- **I would defer:** stale-owner recovery via lock generations and heartbeats.
  That is a new distributed-systems mechanism in the subsystem that decides
  whether a Lightning Lane gets booked, and the failure it prevents (orphan
  locks after a remount) costs a missed booking, while the failure it could
  introduce costs a double one. If it does land, the invariant you named is the
  one that matters: **never expire an unknown outcome because its owner
  disappeared.**
- **Also defer:** the contention messaging. Worth doing, not worth freeze risk.

---

## Questions

1. **Should an `unknown` entry survive the 4am park-day rollover?** The booking
   log reconciles rather than day-scopes, but a doubt raised at 11pm is still
   unresolved at 4am and the reservation may still exist. I do not think the
   current code has a considered answer.
2. **For the `{Y, X}` conflict set — what about a modify?** A modify of X leases
   X and keeps X, so `{X}` is right. But `bookThenMove` books A then moves it to
   B. Does that need `{A, B}` for the duration, or two sequential single-key
   leases?
3. **Is a swap-vs-swap over the same victim already excluded?** Two swaps giving
   up *different* reservations for the same X is the case you named. Two swaps
   giving up the *same* Y should already contend on Y — worth confirming rather
   than assuming, since it decides whether the fix is one case or two.

## Standing constraints, so a fix does not trip over them

- The app must work for **any** park date. Trip dates are scheduling facts and
  live in `docs/`; nothing in `src/` may carry a calendar date or a constant
  derived from one. Check the built bundle, not only the source.
- Status 0 is an **unknown outcome**, never a failure.
- `CONFIRM_ABSENT_POLLS = 2`.
- The sensor payload and its headers are off-limits; calls into them are editable.
- Every behaviour change carries a test that fails without it — demonstrated by
  mutating the source and watching it go red, not asserted.
- Anything that lands here has to be merged into AutoLL-4 afterwards, and
  `docs/SYNC.md` there explains why a green suite is not evidence about the
  sensor path.

---

# Addendum — response to the revised plan

**Agreed. Go.** Two of your changes are better than what I proposed, one answer
corrects me, and I have one refinement to a deferral you already identified.

**Better than my suggestion, both of them.** Deriving the status union from a
canonical `BOOKING_LOG_STATUSES` tuple and consuming that tuple in persistence
is stronger than the enumerate-and-assert test I proposed: it makes the type and
the persistence set the *same* source rather than two things a test keeps in
agreement. `assertNever` in the renderers is the other half and turns the next
omission into a compile error rather than a test failure. Likewise storing one
mutation record carrying every blocking key, instead of two doubts — that avoids
the alias cleanup problem entirely, which my framing would have walked into.

**You are right about `bookThenMove` and I was wrong to question it.** I checked:
it is one watch target, so it books X and then improves *X's* time
(`AutopilotProvider.tsx:987`, and the modify guard keys on the same
`target.experienceId`). It never crosses attractions. `{X}` per sequential
operation is correct.

**One refinement to the 4am deferral, which changes where the post-trip review
should start.** I agree it defers. But your note reads as a same-day concern
("its daily action lock may expire"), and the case that actually makes it
reachable is a **future-dated** fresh book. Verified: `startNewDay()` clears
`unresolved` along with everything else (`autobook.ts`), and quarantine is gated
on `changesExistingReservation` (`AutopilotProvider.tsx:1394`, `:1644`), so a
fresh book in doubt has no durable protection at all — only the day-scoped
doubt-hold.

On a booking morning the engine holds doubts about reservations for park days a
week out. A fresh-book doubt raised on 2026-10-11 about an 2026-10-18
reservation is cleared at 4am on 10-12, while the reservation it is unsure about
still exists and still matters. A same-day doubt never outlives its own
reservation that way. The plans poll is a real backstop — five hours is plenty
for the itinerary to settle, and a settled plan makes the engine choose modify
rather than book — so I agree this is not pre-freeze work. Start the post-trip
review from the future-dated case rather than the same-day one.

**Two scheduling notes on the release sequence.**

October 18 first becomes selectable in the booking-date picker on **2026-09-27**
(`NUM_BOOKING_DAYS = 22`), which is the first day a real October plan can be
built. Landing the deploy on the 26th rather than the 27th gives that work a day
of soak underneath it instead of happening on a build published the same day.

`docs/SYNC.md` forbids merging into AutoLL-4 on a day AutoLL-3 deployed, so
working backwards from the 10-05 freeze: AutoLL-3 deploy ~09-26, soak, AutoLL-4
merge ~10-01, both verified, freeze 10-05. Worth putting the AutoLL-4 merge date
on the plan explicitly rather than leaving it as "after soak" — it is the step
most likely to get squeezed, and it is the one that decides whether the fallback
build is actually a fallback.

Nothing else from me. The scope is right and the deferrals are the ones I would
have made.
