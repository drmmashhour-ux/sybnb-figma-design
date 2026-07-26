# Isolation contract

Every fixture and security check in this kit must be **isolated** — runnable in any order, in parallel with
others, and leaving the store exactly as it found it. A conformance suite you can't trust to clean up is
worse than no suite. These rules are what made SYBNB's suite stable across ~1200 tests.

## 1. Own your state, delete your state

- `setup()` creates ONLY what this fixture needs, with **unique** identifiers (unique emails, referral
  codes, and — critically — throwaway **jurisdiction/country codes** and rate rows) so two fixtures or two
  runs never collide on a shared key.
- `teardown(ctx)` deletes **everything** created, in FK-safe order (child rows before parents: payouts /
  payments / ledger entries / audit rows → orders → listings → users → policies). Wrap each delete so a
  missing row can't fail teardown (`.catch(() => {})`).
- Track created ids on `ctx` (e.g. `ctx.c7 = { orderId, listingId }`) so an invariant that creates extra
  rows mid-run can be cleaned in the same teardown.

## 2. Never mutate what you don't own (read-only fixtures)

- A fixture may assert against a **frozen** system it does not own (another team's vertical) — but then it
  is **read-only**: it makes no writes and a failing invariant is a documented FINDING, not a fix target.
- Declare such invariants `supports: false` with a `skipReason`, or implement them as pure reads. Do not
  let the kit's assertions drive changes into frozen code.

## 3. Throwaway economic config

- When an invariant needs a rate/policy change (C7 frozen-terms, C9 audit), create it under a **unique,
  inactive** jurisdiction so it can never affect real pricing or another test — then delete it in teardown.
  Use a per-run-unique code (derive it from a passed-in timestamp; don't rely on `Date.now()` inside a
  deterministic harness step).

## 4. Restore any process/global state

- If an invariant must set an env var (e.g. a production-mode or pilot flag), set it as late as possible,
  restore the previous value in a `finally` / `afterAll`, and default it OFF so the baseline is unchanged.
  Prefer a guard that takes `{ isProduction }` explicitly (see `security/secretNotInProd.mjs`) over mutating
  `process.env`, so a threads-pool runner can't leak the flag across files.

## 5. Concurrency truthfully

- C8 (no-double-book) is a REAL concurrency test: fire the two claims genuinely in parallel against a store
  whose lock (e.g. a DB advisory lock) actually serializes them. If your test store can't do that, assert
  the one-winner guarantee at the transaction level and **say so** — never simulate a pass.

## 6. Prove the checks have teeth

- Each static scan / guard test should be shown to FAIL when the property is broken: inject a probe (a stray
  audit `.delete`, a guard-after-response, a removed lock), watch the check go red, then revert. A green
  check that can never go red proves nothing.
