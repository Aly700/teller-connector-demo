#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
# This command is intentionally never part of scripts/ci.sh.
[[ "${EVAL_DATASET:-}" == isolated ]] || { echo 'Set EVAL_DATASET=isolated in a dedicated checkout. This command replaces its demo database.'; exit 1; }
[[ ! -f .data/ops-enabled ]] || { echo 'Refusing eval setup in the supervised demo checkout.'; exit 1; }
trap 'scripts/stop.sh' EXIT
scripts/stop.sh
scripts/init-local.sh
source scripts/env.sh
scripts/build-teller.sh
scripts/pg-start.sh
scripts/reset.sh
node --import tsx eval/cli.ts
