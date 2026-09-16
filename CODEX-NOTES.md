# Notes for the next Codex round

Against `main` at `1d8f594`. The previous round reviewed `cfd01c6` and raised
five findings; all five are addressed in `061f52a`'s successor, PR #26 — but not
one at a time, and the reason matters for reviewing it.

`git diff cfd01c6..1d8f594` touches 12 files. The new module is
`src/autopilot/lease.ts`.

---

## What changed in kind, not just in detail

Every finding across both rounds traced to one design mistake: **mutual
exclusion was being expressed with the ledger's attempt locks, which cannot
carry it.** An attempt lock is anti-thrash — session-scoped, shared as a union,
never given back for a modify — so it answers "has this been done today". Each
attempt to make it answer "is anybody doing this now" introduced a new defect:
first a search deferring to work finished hours earlier, then a foreground claim
able to take over another provider's live operation, then a retained lock
holding a ride until the 4am rollover.

So exclusion now lives in `lease.ts` and the attempt locks are left alone. The
`change:` lock kind is withdrawn entirely, along with its guards in
`shouldModify` and `shouldSwap`.

**The most useful thing this round would be to say whether that separation is
actually clean** — whether anything still reads an attempt lock as evidence
about the present, or reads a lease as evidence about the past.

---

## The judgement calls, which are the likeliest place to find something

**A lease is released in the `finally` on every path, including an unknown
outcome.** The argument: the lease means "somebody is changing this right now",
and once the request has returned — however it returned — nobody is. Doubt about
what landed is the ledger's job and it keeps its own lock for exactly that; a
lease retained for doubt is what produced the last round's finding 3. The
counter-argument is that an unknown outcome is precisely when a second engine
acting is worst. **This is the decision most likely to be wrong, and I would
rather have it challenged than confirmed.**

**A swap leases every held pass for the length of the attempt.** The victim is
chosen inside `attemptAutoSwap`, so the provider cannot know which one to lease.
Broader than necessary, deliberately. The previous round found no permanent
starvation from the equivalent construct; worth re-checking now that the window
is a lease with a TTL rather than an in-memory set.

**`LEASE_TTL_MS` is 120s**, above the poller's 90-second request deadline so a
lease cannot expire under a request that is still legitimately outstanding. A
foreground search renews on each commit. Is there a path that holds a lease
across a gap longer than the TTL without renewing — and would the consequence be
a lease expiring under live work?

**Reload no longer inherits anything.** Ownership is per provider instance, and a
dead instance's leases are reclaimed only by expiry. That was your argument and I
took it; the cost is up to 120 seconds where a reloaded tab is refused a
reservation nobody is actually working on. Confirm that is the right side.

---

## Fixed, with the specific thing to check in each

- **Finding 1, acquisition.** `acquire` serialises through
  `navigator.locks.request` on a single mutex name. Check the critical section
  really covers the read *and* the write, and that `release`/`releaseAll` are
  inside it too.
- **Finding 2, identity.** Per provider instance (`lockOwnerRef`), and a
  foreground search owns its lease separately again (`searchOwner` in
  `TimeSearch.tsx` / `SwapAttractionSearch.tsx`). The hole was that a lease is
  re-entrant for its holder, so a shared id turned a refusal into a grant. Check
  no path still shares one — particularly the nested NextLL provider.
- **Finding 3, retained locks.** `change:` is gone. A definite rejection
  arriving after Stop now releases (`useTimeSearch`'s catch, `!runningRef.current`).
  Check the unmount path and `reset()` for a lease that can outlive its work.
- **Finding 4, commit date.** `CommittedReturn.date`; `activeCommits` and
  `clearCommit` filter on it; the screens pass `parkDate(booking.start)`. Records
  written by an older build have no `date` and are read as belonging to the day
  they are stored under — check that fallback is right rather than merely safe.
- **Finding 5, log cap.** Ordered newest-first before the slice. Check the cap
  cannot still drop an unseen newer row.

---

## Not done, and recorded rather than hidden

**No fallback where the browser has no Web Locks.** `available()` reports it and
nothing surfaces it. The alternatives are a visible warning or failing closed,
and failing closed is worse than the exposure on a park day. `FUTURE.md` §6.

**The regression gaps you listed last round are still open**, and I did not close
them: `TimeSearch.tsx` has no component test; `daytimeline.test.ts` never asserts
`protectedFrom`/`protectedTo`; nothing pins the `autoll3.*` storage namespace —
and `lease.ts` adds a key to that surface. All in `FUTURE.md` §6.

**The doubt-hold chain is still in place.** You observed that `bookedCount` has
no production consumer and the `unresolved` set mainly maintains it. Still true,
still a live suggestion, still deliberately not mixed into a correctness change.

---

## House facts

- Park day starts at 4am; every time is a `ParkTime` measured from it.
- One shared `RateLimit(5)` — five a second, 5s cooldown — throws rather than
  queues, shared with the user's own taps.
- StrictMode double-mounts; state that must survive lives in a `useRef`.
- A status-0 result is an **unknown outcome**, not a failure.
- `vite build` does not typecheck. `npm run checkall` is the gate: 109 suites,
  1303 tests.
- Sensor data and header construction are off-limits.
- The day's action allowance was removed on 2026-09-14: Disney counts a
  *redemption*, not a booking, so booking and cancelling is free. Please do not
  propose reinstating a booking cap — `FUTURE.md` §7 carries the argument.

## A method note, now with a fourth example

Every fix this week landed with a test, and each test was run against a reverted
fix to prove it fails without it. That check has now caught **four** tests that
passed with the bug still present. The newest: a lease test asserting "two racing
callers, one wins" passed with the mutex removed, because jsdom has one
JavaScript context and same-context synchronous bodies never interleave. It now
asserts the browser mutex is used, which is the part a unit test can prove.

If a finding here rests on a test that looks like coverage, it is worth asking
whether that test can actually fail.
