# ADR 0002: Balanced entries through deferred triggers

## Context

Every simulated transfer posting must conserve value: its credits minus its debits must equal zero. A service check can catch mistakes on the normal path, but it cannot protect against a later code path, a faulty batch, or direct SQL that bypasses the service. Checking each inserted row immediately would also reject the temporary imbalance that exists while a multi-row posting is being assembled.

## Decision

Keep the service-side balanced-entry construction and add PostgreSQL constraint triggers as the final guard. The triggers are `DEFERRABLE INITIALLY DEFERRED`, so they evaluate the complete transaction at commit. For each transfer touched by an entry or state change, the database sums credits as positive and debits as negative. A nonzero total aborts the transaction. A `POSTED` transfer must also have at least two entries.

The integration test posts a valid transfer, then uses SQL to add an unmatched one-unit debit. The write is allowed while the transaction is open, but commit fails. This proves the database rejects an imbalance even when the application service is bypassed. It does not merely prove that the service usually creates pairs.

## Consequences

- A transaction may insert the debit and credit in either order, provided the final state is balanced.
- An invalid transfer cannot commit partially balanced entries or a posted state without a complete pair.
- Failures surface at transaction commit, so callers must treat commit exceptions as operation failures.
- Transfer-linked entries have the database guarantee. Synthetic deposit postings have no transfer ID, so their pairing is also checked by the service and simulation invariants.
