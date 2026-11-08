# ADR 0005: Simulation found a missing-entry bug

## Context

The seeded simulator checks cross-component money invariants after every scheduled step. One invariant reconstructs each account's ledger balance from its posted entries and compares that result with the cached ledger balance.

During development, a synthetic deposit increased `ledger_balance_minor` and `available_balance_minor` and appended an audit record, but it created no entries. The simulator reported the mismatch as `account ledger differs from entries`, with a nonzero cached ledger value and `entries=0` for the deposited account.

The focused unit tests missed this because they checked account arithmetic, transfer entries, and final transfer balances separately. None reconstructed the whole account balance from all entries immediately after a deposit.

## Decision

Make every synthetic deposit append a balanced posting under one posting ID:

- a credit to the simulated account; and
- an equal debit with no account ID, representing the external synthetic funding boundary.

Keep the simulator's account-reconstruction invariant and run it after every step, not only after transfers settle.

## Consequences

- A deposited account's cached ledger balance can be reconstructed from its immutable entry history.
- Global entry totals remain zero per currency.
- Export and reconciliation include the source of synthetic funds instead of observing a balance with no entries.
- The bug became a regression case for integration and simulation coverage.
- This decision models synthetic test funding only; it does not represent a connection to any external financial system.
