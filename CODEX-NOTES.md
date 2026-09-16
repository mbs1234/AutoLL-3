# Notes for the next Codex round

Against `main` at `cfd01c6`. The previous round reviewed `d62aa02` and raised
six findings plus two smaller ones; all eight were addressed in `061f52a`
(PR #25). This is what changed, what was deliberately **not** changed, and where
a second pass is most likely to find something.

`git diff d62aa02..cfd01c6` is 14 files, +539 / −70.

---

## Deliberately not fixed — please confirm the judgement rather than re-report

**Lock acquisition is still not atomic.** The previous round asked for an owner
lease acquired atomically through Web Locks or an IndexedDB transaction. Only
half of that was built: every lock is now stored against its holder and a
release takes effect only for the holder (`saveLocks` in
`src/autopilot/storage.ts`). Acquisition remains a read-modify-write on
`localStorage`, so two instances can still interleave and lose an update. The
mitigation is that every holder re-publishes what it owns on each poll, so a
lost key returns within a tick rather than lasting the park day.

The reason for deferring: Web Locks is async, and `saveLocks` is called from the
ledger's synchronous `onAttemptChange` callback. Making it async ripples into
the ledger's contract, the provider's tick loop and the tests. The trip is in
December and this is the booking path.

Recorded as outstanding in `docs/FUTURE.md` §6. **What would be useful: whether
the per-tick republish actually closes the window in practice, or whether there
is a sequence where a lost update persists long enough for two engines to act.**

**The doubt-hold chain was left in place.** The previous round observed that
`bookedCount` has no production consumer and that `unresolved` now exists mainly
to maintain it, and recommended removing the whole chain. That is a removal
rather than a repair, and mixing it into a correctness fix seemed wrong. It is
untouched and still a live suggestion.

---

## What changed, and the specific thing to check in each

### The reservation-scoped lock (`CHANGE`) — the largest new concept

`src/autopilot/autobook.ts` gains `LockKind = ActionKind | 'change'` and the
`CHANGE` constant. The per-action locks (`book:`/`modify:`/`swap:<attraction>`)
keep their anti-thrash role; `change:<facilityId>` is the new
reservation-scoped one, taken by:

- `attemptAutoModify` on `allowed.existing.facilityId`
- `attemptAutoSwap` on `victim.facilityId` — the pass being surrendered
- both foreground searches on `booking.facilityId`

Guards were added to `shouldModify` and `shouldSwap` to consult it.

**Worth checking:** the release rules. `CHANGE` is released (a) in each helper's
`catch` when `actionWasRejected(error)`, and (b) in the provider alongside the
`modify` lock under `repeatMoves`. Is there a path where it is taken and never
released — leaving an attraction locked for the session? The success path for
non-`repeatMoves` deliberately keeps it; confirm that is right rather than a
leak. Also whether adding a guard to `shouldSwap` that consults the victim's
lock can deadlock against `chooseSwapVictim`'s selection.

### In-flight tracking now marks two keys

`actingRef` in `AutopilotProvider` previously keyed on `${kind}:${experience.id}`
only, which meant a foreground claim on `change:<reservation>` would never see a
live request. It now marks both. **For a swap the victim is chosen inside the
helper, so every held pass is marked for the length of the attempt** — broader
than necessary and deliberately so. Check whether that over-broad window can
starve a foreground search on a busy day, and whether the `finally` closes
exactly what the `try` opened on every path.

### Lock ownership is per browser tab

`lockOwnerId()` stores an id in `sessionStorage` under `autoll3.autopilot.lockOwner`.
Per tab rather than per mount, so a reload can reclaim what the previous
instance in that tab left behind. **Check the reasoning holds:** is a reloaded
tab always safe to reclaim its predecessor's locks, or is there a case where the
previous instance's request is still in flight when the new one mounts?

Also: the fallback when `sessionStorage` throws (private window, blocked
storage) is a per-mount id, which degrades to the old behaviour. Is silent
degradation right, or should it refuse to take over anything?

### Stop and unmount release only when idle

`useTimeSearch`'s `stop()` and the effect cleanup both now require
`phase === 'idle' && !commitInFlightRef.current`. **Check for the opposite
failure:** a lock that is now never released because the guard never returns to
idle — for example after `MAX_SETTLE_CYCLES` stops the search as `unconfirmed`,
or after an `unknown` outcome. Those keep the lock by design; confirm the day's
rollover or the engine's own settling actually reclaims them.

### Foreground commits publish

`publishCommit` on the Autopilot context; `onCommitted` on `useTimeSearch`,
called after each successful commit at both commit sites. Check both sites fire
it, and that a swap publishes the incoming facility rather than the surrendered
one.

### Activity log merge

`saveBookingLog` now reconciles rather than preferring the caller: it keeps the
larger `repeated` and the later `at` of the two copies. Check the 20-row cap
still cannot push an unseen newer row out, and that `reason` — newly persisted —
round-trips.

---

## Areas the previous round did not reach

- **`useTimeSearch` has no component test.** The hook is well covered
  (`useTimeSearch.test.ts`, including the lock), but `TimeSearch.tsx` itself has
  none. `docs/FUTURE.md` §6 lists it as an outstanding deliverable.
- **`daytimeline.test.ts` never asserts `protectedFrom`/`protectedTo`** on the
  pure lane data, though the component test now covers the band.
- **The storage namespace is unenforced.** Every `autoll3.*` key is a literal;
  nothing pins the prefix, and three builds share Disney's origin. `FUTURE.md`
  §6. `lockOwnerId` adds one more key to that surface.

## House facts worth having

- Park day starts at 4am; every time is a `ParkTime` measured from it.
- One shared `RateLimit(5)` — five requests a second, 5s cooldown — throws
  rather than queues, and is shared with the user's own taps.
- StrictMode double-mounts; state that must survive lives in a `useRef`.
- A status-0 result is an **unknown outcome**, not a failure.
- `vite build` does not typecheck. `npm run checkall` is the gate: 108 suites,
  1287 tests.
- Sensor data and header construction are off-limits.
- The day's action allowance was removed on 2026-09-14 — Disney counts a
  *redemption*, not a booking, so booking and cancelling is free. Please do not
  propose reinstating a booking cap; see `docs/FUTURE.md` §7.

## A method note

Every fix in this round landed with a test, and each test was run against a
reverted fix to prove it fails without it. That check has caught three tests
this week that passed with the bug still present — including one that "clicked
through" an overlay, which jsdom cannot fail because it does no hit-testing. If
a finding here rests on a test that looks like it covers something, it is worth
asking whether that test can actually fail.
