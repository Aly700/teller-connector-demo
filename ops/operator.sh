#!/usr/bin/env bash
source "$(dirname "$0")/../scripts/env.sh"
[[ -f .data/ops-enabled && -f .data/operator.env ]] || { echo 'Operator setup is required.'; exit 1; }
set -a
source .data/operator.env
set +a
export TCD_TARGET=production
: "${CLOUDFLARE_API_TOKEN:?Scoped operator token required}"
: "${CLOUDFLARE_ACCOUNT_ID:?Cloudflare account ID required}"
case "${1:-}" in
  reset) export TCD_RESET_DEFER_ACTIVATE=1; exec scripts/reset.sh;;
  activate) exec node --import tsx scripts/worker-state.ts activate;;
  stop-services) exec node --import tsx ops/stop-services.ts;;
  *) exec node --import tsx ops/control.ts "$@";;
esac
