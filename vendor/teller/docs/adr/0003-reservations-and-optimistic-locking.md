# ADR 0003: Reservations and account concurrency

## Context

A simulated transfer awaiting approval must stop the same funds from being promised again, but it must not change the ledger before posting. Concurrent requests can both read the same starting balance unless account updates are coordinated.

## Decision

Keep two cached balances on each account. The ledger balance changes only when entries post. The available balance follows this invariant:

`available balance = ledger balance - sum of active HELD reservations`

Creating a hold subtracts its amount from available balance. Approval consumes the reservation while posting the debit; denial, expiry, or reversal releases it exactly once. Accounts, transfers, and approvals carry JPA `@Version` fields so stale entity updates are rejected.

Transfer transactions also lock both account rows in UUID order. The stable order prevents lock-order cycles, and the source lock makes a competing request re-read the updated available balance before it decides whether funds remain.

The concurrent-drain integration test starts two 8,000-unit requests together against one synthetic account holding 10,000 units. Exactly one transfer becomes `POSTED`; the other becomes `DENIED`. The source finishes at 2,000, and the two destinations receive 8,000 in total. This proves that both requests cannot post from the same starting balance.

## Consequences

- A hold changes spendable funds without creating ledger entries.
- Balance updates require one database transaction and the established lock order.
- `@Version` remains a backstop for stale writes, while row locks serialize the transfer path.
- Concurrency safety assumes all balance mutations use these transactional account paths.
