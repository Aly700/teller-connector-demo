# Local verification — Compose stack (2026-08-29, 06:24–06:40 UTC)

Stack: `docker compose up --build -d --wait` (app + PostgreSQL 16 + LocalStack 3). All synthetic data.

## API walkthrough (scripted, with assertions)

| Step | Result |
|---|---|
| `GET /actuator/health` | `UP` |
| `GET /console/` | 200 (React console served by the API) |
| `POST /accounts` ×2, `POST /accounts/{id}/deposits` 30,000 | ledger 30,000 / available 30,000 |
| Policy: DENY > 10,000 · REQUIRE_APPROVAL > 5,000 (four-eyes) · ALLOW ≤ 5,000 | 3 rules |
| `POST /transfers` 4,000 | `POSTED` |
| `POST /transfers` 12,000 | `DENIED`, reason `POLICY_DENIED` |
| `POST /transfers` 6,000 | `HELD`, approval created |
| Source while held | ledger 26,000 / **available 20,000** (6,000 reserved) |
| `GET /approvals/{id}/transfer` (console join) | amount, accounts, state, decision, matched rule |
| `POST /approvals/{id}/approve` with reason | `APPROVED`; transfer → `POSTED` |
| Balances after | source 20,000 / 20,000 · destination 10,000 / 10,000 |
| `POST /transfers/{id}/reverse` (`reasonCode`) on the 4,000 | `REVERSED`; source ledger 24,000 |
| Same `Idempotency-Key` + same body twice | same transfer id both times |
| `POST /admin/exports/daily?date=today` | entries + audit objects written (LocalStack S3), per-currency debit/credit row totals |
| `POST /admin/reconciliation?date=today` → `GET /admin/reconciliation/latest` | `matched: true`, database rows = exported rows, no mismatches |

## Console (real browser)

Signed in with a reviewer identity and the API key (held in memory only); queue showed two held
transfers ($75.00 and $120.00 rendered from minor units) with from/to, age, matched rule, a required
decision reason, and approve/deny buttons disabled until a reason is entered; approving one dropped the
queue to one and posted the transfer. Screenshot: [console-queue.png](console-queue.png).

Demo recording of the API flow: [demo.gif](demo.gif).
