# ADR 0004: Reuse the policy gate

## Context

Teller was seeded from the simulated AgentOps Gate project. That code already supplied ordered policies, immutable decisions, approvals, audit records, idempotency, and an outbox. Replacing it with a second rule system would duplicate the same control flow and weaken the existing evidence trail.

## Decision

Reuse the Gate rules engine and extend its rule definition with money-aware matchers:

- inclusive minimum and maximum minor-unit amounts;
- ISO currency;
- transfer velocity per source account and time window;
- counterparty allow and deny lists; and
- a four-eyes threshold.

Evaluate active-policy rules in precedence order. The first matching rule decides the effect. If no rule matches, deny by default.

Map the effects onto the transfer state machine. `ALLOW` posts in the transfer transaction. `DENY` records a denied transfer without moving balances. `REQUIRE_APPROVAL` creates a `HELD` transfer, reserves its amount, and creates the approval and outbox row in the same transaction. The four-eyes matcher selects `REQUIRE_APPROVAL`; it is not a separate transfer path.

## Consequences

- Every simulated transfer retains a decision ID and the matched rule ID for audit and explanation.
- Existing approval, outbox, worker, and idempotency behavior remains shared with the generic gate API.
- Rule precedence is part of policy meaning; changing it can change outcomes.
- A missing catch-all rule is safe because the fallback is denial.
- Money matchers remain exact because they operate on minor-unit integers and explicit currencies.
