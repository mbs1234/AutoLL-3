# Notes for the next Codex round

Against `main` at `01fbb5b`. The previous round reviewed `1d8f594` and raised six
findings, four P1; all six are fixed in `01fbb5b` (PR #27).

`git diff 1d8f594..01fbb5b` touches 8 files. The new concept is the quarantine in
`src/autopilot/lease.ts`.

---

## You were right about the thing I asked you to challenge

Releasing the lease on a status-0 was defended in the last set of notes on the
grounds that doubt is the ledger's job. It is not: the ledger's lock is keyed
`<kind>:<attraction>`, the foreground does not consult it at all any more, and a
swap for a *different* incoming attraction can target the reservation in doubt.
That refutation was exact and it changed the design.

There are now three concepts with three lifetimes, and keeping them apart is the
thing most worth checking:

| | Answers | Scope | Ends when |
| --- | --- | --- | --- |
| Attempt lock (`autobook.ts`) | has this been done today | action + attraction | session, or evidence for `book:` |
| Lease (`lease.ts`) | is anybody changing this now | reservation + date | released, or TTL |
| Quarantine (`lease.ts`) | did the last change apply | reservation + date | a plans read that *started* after it |

**If any of the three is being read as evidence for another's question, that is
the finding worth having.**

---

## The judgement calls in this round

**The quarantine's clearing rule.** `clearQuarantinedBefore(plansPolledAt)` lifts
every doubt raised before the read *started*. The argument: the engine settles
what it holds from that same read, so whatever it shows, the outcome is now
determined; a doubt raised while that read was in flight is not settled by it and
stays for the next one. If this is wrong the failure is a reservation stuck until
the 4am rollover, which is the failure mode this whole subsystem keeps producing.

**Victim-first swap leasing.** The provider now calls `chooseSwapVictim` before
acquiring, and `attemptAutoSwap` calls it again inside `shouldSwap` a moment
later. It is pure and both calls see the same `allHeldToday` array in the same
tick, so I believe they cannot disagree — but if they can, the lease is on the
wrong reservation and the swap proceeds anyway. Worth a second pair of eyes.

**Per-operation owners, stable owner for the foreground.** Engine attempts take
`${instance}#${n}`; a foreground search keeps one stable owner for its run
because it needs re-entrant renewal. Check there is no third caller that wants
one and gets the other.

**Renewal in the `awaiting` branch** is fire-and-forget (`void claimLock()`). If
the renewal is refused — somebody else took the lease after it expired — nothing
notices. Is that reachable, and should it surface?

---

## Fixed, with what to check in each

- **1, quarantine.** Raised by the provider's `finally` on an unknown outcome and
  by `useTimeSearch` when its guard goes `unknown`. Refuses everyone including
  the raiser. Day-scoped through `kvdb.setDaily`.
- **2, bulk release withdrawn.** No `releaseAll` any more; each attempt returns
  its own lease in its own `finally`, expiry behind that. Check nothing else
  releases in bulk.
- **3, per-operation owner.** Check the `finally` releases under the same owner
  that acquired — both are now hoisted above the `try` for exactly that reason.
- **4, renewal and `cancelled`.** `if (!runningRef.current || cancelled)` on the
  rejection path. Check the unmount path and `reset()` again.
- **5, commit dates.** `activeCommits(Date.now(), date)` on the read side, the
  `forToday` gate removed from both read and expiry, `date` on every write, and
  expiry skips records for other dates. Legacy records without `date` still read
  as belonging to the day they are stored under.
- **6, one lease per swap.** The victim only.

---

## Not done, recorded rather than hidden

- **No fallback where the browser has no Web Locks.** `available()` reports it;
  nothing surfaces it. `FUTURE.md` §6.
- **A quarantine is invisible.** Nothing on screen says a reservation is in
  doubt or why nothing is acting on it — the last silent state in this
  subsystem. `FUTURE.md` §6.
- **The regression gaps from two rounds ago are still open**: `TimeSearch.tsx`
  has no component test, `daytimeline.test.ts` never asserts
  `protectedFrom`/`protectedTo`, and nothing pins the `autoll3.*` namespace —
  now four keys wider than when that was first raised.
- **The doubt-hold chain** (`bookedCount` has no production consumer) is
  untouched and still a live suggestion.

---

## House facts

- Park day starts at 4am; every time is a `ParkTime` measured from it.
- One shared `RateLimit(5)` — five a second, 5s cooldown — throws rather than
  queues, shared with the user's own taps.
- StrictMode double-mounts; state that must survive lives in a `useRef`.
- A status-0 result is an **unknown outcome**, not a failure.
- `vite build` does not typecheck. `npm run checkall` is the gate: 109 suites,
  1311 tests.
- Sensor data and header construction are off-limits.
- The day's action allowance was removed on 2026-09-14: Disney counts a
  *redemption*, not a booking. Please do not propose reinstating a booking cap —
  `FUTURE.md` §7 carries the argument.

## A method note

Every fix landed with a test run against a reverted fix. This round that caught
one that mattered: mutating the per-operation owner back to per-provider **passed
the entire suite**, so finding 3 would have been "fixed" with nothing testing it.
It needed a test driving two genuinely overlapping ticks — an offer held open
past `TICK_DEADLINE_MS` so the poller abandons and restarts — and that one does
fail without the fix.

That is five tests this week that passed with the bug still present. If a finding
here rests on a test that looks like coverage, it is worth asking whether that
test can actually fail.
