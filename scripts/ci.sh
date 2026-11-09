#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 26 ]] || { echo 'Node 26 required; set NODE_BIN.'; exit 1; }
[[ ! -f .data/ops-enabled ]] || { echo 'Use a separate checkout for CI.'; exit 1; }
echo 'Demo data. No real money. Connector CI uses local services only.'
npm ci
scripts/stop.sh
trap 'scripts/stop.sh' EXIT
scripts/init-local.sh
# Reload the secrets created on a clean checkout.
source scripts/env.sh
scripts/build-teller.sh
scripts/pg-start.sh
scripts/reset.sh
# Fresh local test budget. Operational resets preserve these counters.
node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --persist-to .data/wrangler --command "DELETE FROM daily_visitors; DELETE FROM tool_limits;" >/dev/null
scripts/dev.sh > .data/logs/worker.log 2>&1 &
node --input-type=module <<'JS'
let ready = false;
for (let i = 0; i < 120; i++) {
  try { ready = (await fetch('http://localhost:8787/.well-known/oauth-authorization-server', { signal: AbortSignal.timeout(500) })).ok; } catch {}
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!ready) throw new Error('Local Worker failed to start; see .data/logs/worker.log');
JS
npm run typecheck
npm test
node --import tsx scripts/foundation-e2e.ts
node --import tsx scripts/hold-e2e.ts
node --import tsx scripts/reset-check.ts
node --import tsx --test tests/eval-live.ts
npx wrangler deploy --dry-run --env production
npx wrangler deploy --dry-run --config apps/auth/wrangler.jsonc --env production
plutil -lint ops/launchd/*.plist
git diff --check
echo 'PASS connector CI: compile, typecheck, all tests, official SDK OAuth/read/hold/browser flow, crash ledger checks, in-flight reset, unscored eval report, test-only eval fixtures, abuse controls, Worker dry runs and plist lint.'
