# Performance — POST /transfers on ECS Fargate (us-east-1), k6 `load/transfers.js`

Script: ramping arrival rate 5 → 20 → 50 rps over 80 s, up to 100 VUs, a repeating mix of ALLOW / DENY / REQUIRE_APPROVAL amounts against one funded synthetic account pair created in `setup()`; run from a workstation in Toronto (~20–30 ms RTT). Same RDS db.t4g.micro throughout. Every k6 state check passed on every run (DENIED / POSTED / HELD as expected); 0 HTTP errors on every run.

| Build | Task | Run | Sustained rps | median | p90 | p95 | p99 | max | errors | ECS CPU avg/max | ECS mem |
| untuned (9ec2a3b: default JVM flags, Hikari 10, no policy cache) | 0.25 vCPU / 0.5 GB | cold JVM (first traffic after deploy) | 7.1 (566 req) | 13.88 s | 16.81 s | 16.98 s | 17.35 s | 24.0 s | 0 | 65/100, 99/100 | 75% |
| untuned | 0.25 vCPU / 0.5 GB | warm JVM (second run) | 15.1 (1,270 req) | 4.86 s | 8.04 s | 8.66 s | 9.12 s | 9.49 s | 0 | 99/100 | 78% |
RDS during both: CPU ≤ 7%, 10 connections, write IOPS ≤ 32 — database idle; task CPU-bound.
All k6 state checks passed on both runs (DENIED/POSTED/HELD as expected).
| untuned | 0.5 vCPU / 1 GB | cold JVM | 18.4 (1,555 req) | 3.98 s | 5.48 s | 5.97 s | 6.49 s | 9.0 s | 0 | 99/100 | 37% |
| tuned (aa1b54c: SerialGC + TieredStopAtLevel=1, Hikari 5, policy cache, 12 statements/transfer) | 0.5 vCPU / 1 GB | cold JVM | 34.3 (2,787 req; profile max) | 76 ms | 243 ms | 447 ms | 792 ms | 1.0 s | 0 | 70/81 | 28% |
| tuned | 0.25 vCPU / 0.5 GB | cold JVM | 24.3 (2,053 req) | 2.89 s | 3.41 s | 3.61 s | 3.77 s | 6.38 s | 0 | 99/99 | 59% |

Reading: a transfer does far more than a Gate decision — policy evaluation, row-locked account updates, balanced entries, reservation bookkeeping, audit and outbox rows in one transaction — so the untuned quarter-core task sustained only ~7 rps cold (~15 rps once the JIT warmed). The same tuning that fixed Gate (SerialGC + first-tier JIT on a quarter core, Hikari sized to the core, an in-memory policy cache, and trimming the transfer path to 12 prepared statements measured with Hibernate statistics) lifted the half-core task to the profile's maximum (34.3 rps) with a 76 ms median, and the quarter-core task to ~24 rps. The database never exceeded 7% CPU in any run; the task was CPU-bound every time. The before-tuning statement count was not measured on a database and is not claimed.
