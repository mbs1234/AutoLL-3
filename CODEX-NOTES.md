# Notes for the next Codex round

Against `main` at the head of PR #29. The previous round reviewed `ea86b96` and
raised six findings, four P1. All six are fixed here, and none was disputed —
every one reproduced against the source.

---

## What I did with the 120-second decision

You declined to justify a different number without production measurements and
recommended positive evidence or explicit user resolution over automatic
time-based release. I have taken the first half and deferred the second, and the
reason is worth arguing with.

**Taken:** the number now decides far less than it did. Above it, every clear is
evidence-driven — a modify must be *seen* at a new time, a swap must see the
attraction it was gaining appear, and absence counts only after the window and
only across reads spaced far enough apart to be separate observations. The floor
for clearing on silence alone is now 180 seconds, not 120.

**Deferred:** removing automatic release entirely. A doubt that never releases
silently removes cover on a ride the user armed, for the rest of the day, with
nothing on any screen saying so — and this repo's own standard calls a silent
state the worst shape a failure can take. There is still no UI for a quarantined
reservation (`FUTURE.md` §6). Surfacing it has to land before "it holds until a
person says otherwise" is a safe rule, because today there is no person in the
loop to say so. **That ordering is the thing I would most like challenged**: if
you think the hold should be unconditional even while invisible, say so, because
I have traded one silent failure against another and I am not certain I picked
the right one.

The 120 seconds itself is now recorded as `FUTURE.md` §5.5 — a question for the
park, with the measurement named (the gap between a commit returning and the
itinerary agreeing, which `useTimeSearch`'s settle loop already walks past).

---

## The six, and what to check in each

1. **Stale baseline.** `commitBaseline()` in `automodify.ts` is now the single
   rule, and each helper reports it through `onCommitting` on the line after it
   takes the attempt lock. Check that boundary is the same one `unknownOutcome`
   tests — they must not drift apart, and `wasAt` is now deliberately left unset
   until the helper speaks, so a path that quarantines without one is a bug, not
   a fallback.
2. **Absence as proof.** A `Doubt` carries `kind`. Check the swap rule in
   `landed()`: I match the gaining facility on the *victim's* park date. If a
   swap can ever land on a different day than the reservation it replaced, that
   is wrong.
3. **Pre-doubt responses.** `reconcile(seen, now, polledAt)`, with `polledAt`
   captured before the await in `PlansProvider`. Check the comparison direction
   at `polledAt <= doubt.at`, and that the millisecond granularity is acceptable
   — a doubt raised in the same millisecond a read starts is ignored by that
   read, which I believe is the safe side.
4. **Coalesced reads.** `DOUBT_READ_SPACING_MS = DOUBT_SETTLE_MS /
   DOUBT_CONTRARY_READS`. Derived rather than picked, but still a judgement:
   the reads that settle a doubt are spread over at least as long again as the
   window the change was given to appear in.
5. **Operations outlasting leases.** `keepAlive()` renews; `useTimeSearch` does
   the same across a commit; `fetch.ts` now holds its timeout across the body
   read. I chose renewal over a per-reservation Web Lock held for the
   operation's lifetime because a Web Lock is released when the tab dies, and a
   dead tab's request may still have reached Disney — expiry is the only safe
   way to reclaim that. Check I have not made a lease immortal: the renewal
   canceller fires before the release in the `finally`, and there is no other
   path out.
6. **Day scoping.** Persisted plainly, pruned by the key's own park day, with
   the old `{date, value}` wrapper still honoured — the deploy lands as a reload
   and a reload is exactly when a doubt matters, so dropping it would have the
   upgrade itself unprotect a reservation.

## One gap I found while fixing these and did not close

A quarantine raised while **another instance already holds the lease** does not
evict it instantly. `acquire` refuses a quarantined key, so that holder loses it
at its next renewal and the lease expires at the TTL — but any request it has
already sent is beyond anyone's reach. I believe that is as good as it can be
made and did not widen the change to chase it. Tell me if you disagree.

---

## Still open, recorded rather than hidden

**A quarantined reservation is invisible**, and this round made it matter more
rather than less: the evidence rule is stricter, so a doubt correctly lives
longer. `FUTURE.md` §6. This is the one I would close next whatever you find.

**No fallback where the browser has no Web Locks.** `available()` reports it;
nothing surfaces it. `FUTURE.md` §6.

**Regression gaps from four rounds ago**: `TimeSearch.tsx` has no component
test; `daytimeline.test.ts` never asserts `protectedFrom`/`protectedTo`; nothing
pins the `autoll3.*` namespace.

**The doubt-hold chain** (`bookedCount` has no production consumer) is untouched.

---

## House facts

- Park day starts at 4am; every time is a `ParkTime` measured from it.
- One shared `RateLimit(5)` — five a second, 5s cooldown — throws rather than
  queues, shared with the user's own taps.
- StrictMode double-mounts; state that must survive lives in a `useRef`.
- A status-0 result is an **unknown outcome**, not a failure. As of this round
  that includes a response body that never finished arriving.
- `vite build` does not typecheck. `npm run checkall` is the gate: 109 suites,
  1342 tests.
- Sensor data and header construction are off-limits.
- The day's action allowance was removed on 2026-09-14: Disney counts a
  *redemption*, not a booking. Please do not propose reinstating a booking cap —
  `FUTURE.md` §7 carries the argument.

## The pattern in my own errors, since it predicts where to look

Across five rounds my defects have been two shapes:

1. **Asserting how a neighbouring mechanism behaves without reading it.** The
   swap lock key; "the ledger settles `change:` locks"; "doubt is the ledger's
   job"; clearing on one read when two is the house standard; quarantining a
   pre-commit failure after documenting that boundary myself.
2. **Finishing a change on the write side only.** `date` added to commit writes
   with readers left behind, twice — and this round's own P1 was the same shape
   again: I recorded a baseline in one place and consumed it in another without
   checking they meant the same thing.

For that reason I audited every writer/reader pair in this change before
committing: `kind`, `gaining` and `last` on the doubt; the `QUARANTINE_KEY`
shape; `reconcile`'s third argument; `onCommitting` on both mutating helpers;
`keepAlive`'s canceller. All three `quarantine()` call sites pass a `kind` and
both `attemptAuto*` call sites pass `onCommitting`. That audit is itself the
kind of claim I have got wrong before, so it is worth re-checking rather than
taking.

Sixteen mutations were run against the new tests and all sixteen were detected.
One first-draft mutation survived and was a bad mutation rather than a weak
test — it re-added the stale snapshot *before* `onCommitting` overwrote it, so
it never reproduced the old behaviour; the corrected version is detected. I am
recording that because "the mutation survived" and "the test is weak" are not
the same finding, and I would rather you knew which one I hit.
