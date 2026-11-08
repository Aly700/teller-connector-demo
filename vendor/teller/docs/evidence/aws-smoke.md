# Live smoke — Teller on AWS (2026-08-29, 06:42 UTC)

Deployed by hand with `cdk deploy` (six stacks: Budget, Network, Queue, Bucket, Data, Service) into a
personal account, us-east-1; image `teller:9ec2a3b…` (linux/amd64, built from the workstation-built jar
with the Dockerfile's runtime stage). The same scripted walkthrough as the local run, against the task's
public IP, the real SQS queues and the real S3 bucket; API key read from Secrets Manager `teller-api-key`.

| Step | Result |
|---|---|
| health / console | `UP`; `GET /console/` 200 |
| two accounts, deposit 30,000 | ledger = available = 30,000 |
| policy DENY > 10,000 · four-eyes > 5,000 · ALLOW ≤ 5,000 | 3 rules |
| transfer 4,000 / 12,000 / 6,000 | `POSTED` / `DENIED` / `HELD` (approval created, message through the outbox to SQS) |
| approve with reason | `APPROVED`; transfer `POSTED`; balances 20,000 / 20,000 and 10,000 / 10,000 |
| reverse the 4,000 | `REVERSED`; source ledger 24,000 |
| same Idempotency-Key twice | same transfer id |
| export + reconciliation | entries + audit JSONL objects in the bucket; reconciliation `matched: true`, 10 database rows = 10 exported rows |
| `aws s3 ls` | `entries/dt=2026-08-29/…jsonl` (2,883 B) and `audit/dt=2026-08-29/…jsonl` (5,907 B) |
