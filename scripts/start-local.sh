#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
scripts/stop.sh
scripts/init-local.sh
source scripts/env.sh
scripts/build-teller.sh
scripts/pg-start.sh
scripts/reset.sh
exec scripts/dev.sh
