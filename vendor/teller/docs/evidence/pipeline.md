# CI/CD pipeline — exercised (2026-08-29)

Repository: private GitHub repository `Aly700/teller` (not yet public). Trigger: `workflow_dispatch` — deploys
are deliberately manual so a documentation push can never start billable infrastructure.

| Step (GitHub Actions, ubuntu-latest) | Result |
|---|---|
| CI: Maven with Testcontainers PostgreSQL + LocalStack (97 tests); console Vitest (9) and build | green on every commit since the first push |
| Deploy: `aws-actions/configure-aws-credentials` with `role-to-assume` = the CDK-created role; no static keys | assumed via OIDC |
| Deploy: Maven build (console bundled into the jar), Docker build, push to ECR tagged with the commit SHA | image `fb79257…` |
| Deploy: `npx cdk deploy` of Budget, Network, Queue, Bucket, Data, Service stacks | all six ✅ (run 33264022788, 2026-08-29T16:49:54Z) |
| Assertion walkthrough against the pipeline-deployed task (accounts, policy, POSTED/DENIED/HELD, reservation math, approve, reverse, idempotent replay, export, reconciliation matched) | OK |
| `cdk destroy` of the app stacks afterwards | account back to budget alarms + OIDC roles + bootstrap |

The two runner-side gotchas hit on the way — GitHub's id-qualified OIDC `sub` claims and TypeScript 6's
platform-native packages — are described in the sibling project's evidence and fixed identically here
(`StringLike` trust on both subject forms; TypeScript 5 pinned in `infra/`).
