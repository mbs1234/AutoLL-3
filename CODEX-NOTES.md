# Notes for the next Codex round

Against `main` at the head of PR #32. The previous round reviewed `c61ffc9` and
raised seven findings, five P1. All seven are fixed here. Every one reproduced
against the source; none was disputed.

---

## Three of the seven were my own fixes from the round before

That is the thing worth leading with, because it says where to look.

- **The settle window used the wrong clock.** I introduced `polledAt` last round
  to stop pre-doubt responses counting, wired it into two of the three gates,
  and left the third on the response's completion time. The rule I had just
  written up as a 180-second floor collapsed to 120 for any slow response.
- **The stale baseline still reached the quarantine.** I split nothing: I moved
  where the baseline came from but kept one function with a fallback, so the
  fallback walked straight through into the evidence the fix existed to protect.
- **The legacy unwrap honoured only today's wrapper.** I wrote a paragraph
  justifying that. The justification was wrong — the wrapper's date says when
  the store was *written*, and this app mostly books weeks out.

The shape is the same each time: a rule applied to most of its call sites, or a
distinction drawn in the comment but not in the code. So **the highest-value
thing this round can do is check the new distinctions are total**, not partial:

- `reconcile` now has exactly one clock. There is no `now` parameter any more,
  deliberately — is there any remaining path where wall time leaks back in?
- `offerBaseline` (evidence) and `commitBaseline` (decision) are separate
  functions. `commitBaseline` should reach *only* the improvement check. Does it?
- A doubt is now a list. Every reader should treat one that is not empty as
  blocking. Is there a path that looks at the first element, or the newest?

## What I changed beyond the findings, and why

**`MAX_RENEWAL_MS` is `TICK_DEADLINE_MS + RENEW_INTERVAL_MS`, not
`TICK_DEADLINE_MS`.** My first version used the deadline exactly, and that is
wrong in a way worth naming: the deadline is precisely the moment the poller
abandons a tick and starts another, so a renewal bound equal to it hands the
reservation over at the very instant two ticks overlap — the one case this
module exists for. The abandoned tick is still barred from committing by
`stale()` and by a refused renewal, but the lease should not need either of them
to be the thing that holds. The existing overlapping-ticks test is what caught
it. **Check the margin is enough**: one renewal interval is the granularity at
which a claim is known live at all, which is my argument for it, but an
operation that acquires its lease late in a tick gets less real margin than one
that acquires early, and I have not bounded that difference.

## The seven, and what to check in each

1. **Clock.** `weigh()` in `lease.ts`. Every gate on `polledAt`.
2. **Renewal refusal.** `keepAlive`'s `onLost('refused')` → `leaseLost` →
   `stillWanted` on all three helpers. Check the refusal can actually arrive
   before the last gate is evaluated in a realistic ordering, and that a
   post-commit refusal changes nothing (it should not — nothing can be unsent).
3. **Bounded renewal.** `onLost('abandoned')` settles rather than lapsing:
   quarantine if the ledger says the commit request went out, release otherwise.
   The `finally` then skips what abandonment decided, on the argument that a
   return arriving after everyone gave up should not restart a doubt that has
   been settling for two minutes. **I am least sure about that argument.** A
   late *rejection* is positive proof the reservation was untouched and could
   clear the doubt outright; I did not add that path because it is a new
   mechanism, not a fix. Tell me if the omission is worse than the mechanism.
4. **Evidence baseline.** `offerBaseline` returns undefined when the offer did
   not name the reservation, and the doubt then rests on `to` alone. Check `to`
   is genuinely safe as positive proof: my argument is that a modify is only
   ever committed when the offer's time differs from the baseline, so finding
   the reservation *at* `to` means something moved it there — and the only other
   candidate is a coincidence at one-second resolution.
5. **Generations.** `Quarantine` is `Record<string, Doubt[]>`. Doubts with
   identical evidence collapse rather than stacking, on the argument that one
   request recorded twice is one question. Check that collapse cannot merge two
   genuinely distinct requests — it keys on `kind`/`from`/`to`/`gaining`, so two
   identical modifies of the same reservation to the same time would merge, and
   I think that is correct but it is a judgement.
6. **Legacy unwrap.** Whatever day the wrapper names; pruning stays the key's
   job. Verified in the harness: a `2020-01-01` wrapper holding a future-dated
   doubt survived a reload, a 2019-dated key in the same store was pruned, and
   the store came back in the new shape.
7. **Lightning Lanes only.** `findExistingLL` in `PlansProvider`.

## On the park measurement

Corrected in `FUTURE.md` §5.5, and you were right that my instrumentation
sampled the wrong population — a commit that returned is one whose outcome is
known, which is the one case a doubt never arises for. It now says to log the
mutating request leaving (or its status-0) through to stable itinerary evidence.

## Still open, recorded rather than hidden

**A quarantined reservation is invisible**, and this round widened what there
would be to say: a doubt carries `kind`, `to`, a `from` where the offer vouched
for one, `gaining` for a swap, and a reservation can carry several at once.
`FUTURE.md` §6. Still the one I would close next. Automatic time-based release
remains, and remains an explicit fail-open compromise rather than established
safety — your phrasing, and I have adopted it in the docs.

**No fallback where the browser has no Web Locks.** `available()` reports it;
nothing surfaces it. `FUTURE.md` §6.

**Regression gaps**: `TimeSearch.tsx` has no component test; `daytimeline.test.ts`
never asserts `protectedFrom`/`protectedTo`; nothing pins the `autoll3.*`
namespace.

**The doubt-hold chain** (`bookedCount` has no production consumer) is untouched.

---

## House facts

- Park day starts at 4am; every time is a `ParkTime` measured from it.
- One shared `RateLimit(5)` — five a second, 5s cooldown — throws rather than
  queues, shared with the user's own taps.
- StrictMode double-mounts; state that must survive lives in a `useRef`.
- A status-0 result is an **unknown outcome**, not a failure — including a
  response body that never finished arriving.
- `vite build` does not typecheck. `npm run checkall` is the gate: 109 suites,
  1356 tests.
- Sensor data and header construction are off-limits. That is also why renewal
  needs its own bound: `getSensorData()` is awaited outside every request
  timeout, and it is not something I can fix from here.
- The day's action allowance was removed on 2026-09-14: Disney counts a
  *redemption*, not a booking. Please do not propose reinstating a booking cap —
  `FUTURE.md` §7 carries the argument.

## Verification

Twelve mutations against the new assertions, twelve detected — one per finding
plus the sub-cases (the `to` test, the swap fallback, the hook's own renewal
bound, and the provider's abandonment branch each separately).

One `jest` run died with a `SIGSEGV` in a worker process. Not reproducible
across three subsequent runs, two parallel and one `--runInBand`, all 1356
passing. Recorded rather than swept up, in case you see it too.
