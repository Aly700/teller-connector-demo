#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
exec node --import tsx "$ROOT/scripts/stop-local.ts"
