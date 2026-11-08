# Chaos capture — Teller on AWS (2026-08-29, 07:22–07:35 UTC)

Tuned image `aa1b54c`, task 0.25 vCPU / 0.5 GB; real SQS queues `teller-approvals` / `teller-approvals-dlq`
(redrive after 5 receives, visibility 60 s). Timestamps UTC.

## 1. Kill the task with held transfers

| Time | Event |
|---|---|
| 07:23:08 | new account pair funded; policy with one rule: `REQUIRE_APPROVAL` above 1 (four-eyes for everything); 20 `POST /transfers` with distinct `Idempotency-Key`s → 20 `HELD` transfers, 20 approvals, 20 outbox rows |
| 07:23:12 | `aws ecs stop-task` |
| 07:25:06 | replacement task healthy (new public IP) after **114 s** |
| 07:25:xx | `POST /approvals/{id}/approve` on all 20 ids against the replacement: **20/20 → 200, APPROVED**, transfers posted |

The transfer, its reservation, the approval and the outbox row are one transaction, so a process death
between commit and publish loses nothing; the replacement's relay drains whatever was unsent.

## 2. Poison message → dead-letter queue → replay

| Time | Event |
|---|---|
| 07:26:19 | `{"not":"an approval message"` sent to `teller-approvals` |
| +30 s … +285 s | main queue 0 visible / **1 in flight** — the worker receives it, decoding fails, the message is left for redrive; one `approval_queue_message_failed` WARN line in the task log |
| **+300 s** | dead-letter queue: 1 visible (exactly 5 receives × 60 s) |
| 07:33 | `POST /admin/dlq/replay?max=10` → `{"replayed":1}`; audit row `DLQ_REPLAYED`; DLQ 0, main 0 visible / 1 in flight (the message will cycle back to the DLQ after five more receives — expected) |

## 3. Expiry at scale (incidental)

The load tests left hundreds of `HELD` transfers whose 30-minute approvals lapsed while the deployment
stayed up. The audit log for the window shows **1,028 `APPROVAL_EXPIRED` and 1,028 `TRANSFER_REVERSED`**
— every expired hold was reversed and its reservation released by the expiry worker, with no manual action.

## Driver mistakes worth recording

The first chaos run's queue lookup used a name filter that did not match Teller's `teller-*` queue names,
and the replay was sent to the pre-kill task IP; both were corrected and the runs above are the corrected
ones. Raw outputs stayed in the session scratchpad.
