# Testing Standards

## Philosophy

Test behavior, not implementation. For PayPilot the non-negotiable rule is: **the financial rules in [[financial-rules]] must have automated tests** covering both the happy path and the edge cases that make money math go wrong. Coverage breadth elsewhere is secondary to depth on these rules.

## What must be tested (priority order)

1. **Financial invariants (R1–R6)** — required. Each rule has unit tests for its boundary and failure modes:
   - R1 paid bills → no reminder (incl. paid-after-scheduling)
   - R2 reminder idempotency → no double send for same (bill, due date, window), including retried/concurrent runs
   - R3 recurring generation idempotency → exactly one transaction per (bill, period) on re-run
   - R4 invoice assignment → on/after closing day, month rollover, short months
   - R5 installments → correct count, schedule, and rounding-remainder handling
   - R6 CSV dedup → date/amount/description match skipped; near-misses inserted
2. **Use-case integration** — features wired to a real Postgres (test DB or container) and the **fake provider**, verifying persistence-level guarantees (e.g. the DB uniqueness backing R2/R3).
3. **API/E2E** — only for critical journeys (auth, creating a bill, importing CSV).

## Organization

- Co-locate unit tests with the code under test: `invoice-assignment.ts` + `invoice-assignment.spec.ts`.
- Naming: `*.spec.ts`; suite names the unit, cases name the expected behavior.

## Structure (AAA)

```typescript
it("rolls a purchase to next cycle when made after the closing day", () => {
  // Arrange — fixed clock + card with known closing/due day
  // Act — assign purchase to invoice
  // Assert — lands in next cycle's invoice
});
```

## Determinism rules (critical for this domain)

- **Inject the clock and amounts.** Never call `Date.now()` inside rule code; tests pass a fixed `now`. See [[structure]].
- **No real external calls.** Use the fake/log provider ([[integrations]]); never hit WhatsApp in tests.
- Use factories/fixtures for entities; reset DB state between integration tests.

## CI

Suite runs in CI and blocks merges on failure. A spec touching financial rules is not complete until its R-tests pass. Lock concrete thresholds/tooling in the foundation spec.

---

_Focus on what to test and why. Tool config lives in the repo, not here._
