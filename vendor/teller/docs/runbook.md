# Teller operations runbook

Teller is a simulated payments core that uses synthetic data and has no connection to external financial systems. For an isolated demo deployment, start with the `Teller` CloudWatch dashboard, then correlate the alarm window with the `teller-application` log group. Approval and ledger mutations are durable within the simulation, so diagnose the source before replaying or retrying work.

## HTTP 5xx alarm

The `teller-http-5xx` alarm fires after five structured HTTP 5xx log events in five minutes.

1. Check the dashboard's ECS CPU/memory, RDS CPU/connections, and approval DLQ depth for the same interval.
2. Inspect exceptions and PostgreSQL, SQS, or S3 failures in `teller-application`.
3. Check ECS deployment events and RDS health before restarting anything. The ECS deployment circuit breaker already rolls back an unhealthy deployment.
4. Query `/actuator/metrics/teller.transfers.terminal`, `/actuator/metrics/teller.reservations.active`, and `/actuator/metrics/teller.reconciliation.mismatch` with `X-API-Key` when the service is reachable.

## Approval DLQ-depth alarm

The `teller-approval-dlq-depth` alarm fires when `ApproximateNumberOfMessagesVisible >= 1`.

1. Receive one message without deleting it:

   ```bash
   aws sqs receive-message \
     --queue-url "$APPROVAL_DLQ_URL" \
     --max-number-of-messages 1 \
     --attribute-names All \
     --visibility-timeout 0
   ```

2. Correlate its stable `messageId`, `approvalId`, and `decisionId` with application logs and `GET /audit`.
3. Fix a malformed payload or the underlying service failure before replaying it. Never delete a DLQ message by hand.
4. Replay at most ten messages through the audited endpoint:

   ```bash
   curl --fail-with-body -X POST "$BASE_URL/admin/dlq/replay?limit=10" \
     -H "X-API-Key: $TELLER_API_KEY"
   ```

5. Confirm the DLQ returns to zero, the outbox/worker logs settle, and the audit stream contains `DLQ_REPLAYED`. A stable message ID already present in `processed_messages` has no second effect.

## Held reservations

If the `teller.reservations.active` count remains unexpectedly high:

1. Open `/console/` and inspect pending approvals and their ages.
2. Confirm the approval-expiry scheduler is running and compare `expiresAt` with current UTC time.
3. Query the linked transfer. A pending approval must have a `HELD` transfer and its source available balance must equal ledger balance minus active holds.
4. Do not edit balances or approval rows manually. Approve, deny, or allow expiry to use the transactional settlement path.

## Reconciliation mismatch

If `teller.reconciliation.mismatch` increments:

1. Read `GET /admin/reconciliation/latest` and the linked `RECONCILIATION_MISMATCH` audit row.
2. Preserve the referenced immutable S3 entry and audit objects.
3. Compare the reported account balances, row identities, row counts, and per-currency debit/credit totals.
4. Stop new demo load before investigation. Do not rewrite ledger entries; they are immutable and corrections require compensating postings.
5. After correcting the underlying application or export fault, run `POST /admin/reconciliation?date=YYYY-MM-DD` and retain both reconciliation runs as evidence.

## Local rehearsal

Use the README Compose walkthrough and synthetic accounts only. `load/transfers.js` refuses to start without `CONFIRM_DEMO_TARGET=true`; never point it at non-synthetic data.
