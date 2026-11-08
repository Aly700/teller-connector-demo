#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ -f .data/runtime.env ]]; then
  set -a
  source .data/runtime.env
  set +a
fi
export PATH="${NODE_BIN:+$NODE_BIN:}${JAVA_HOME:+$JAVA_HOME/bin:}$PATH"
mkdir -p .data/tmp .data/logs .data/maven .data/m2 .data/npm .data/config
export TMPDIR="$ROOT/.data/tmp"
export MAVEN_USER_HOME="$ROOT/.data/maven"
export npm_config_cache="$ROOT/.data/npm"
export XDG_CONFIG_HOME="$ROOT/.data/config"
export WRANGLER_SEND_METRICS=false
export WRANGLER_LOG_PATH="$ROOT/.data/logs/wrangler.log"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=tcd_owner PGDATABASE=teller_demo
export DB_URL=jdbc:postgresql://127.0.0.1:55432/teller_demo DB_USERNAME=tcd_owner
export TELLER_AWS_ENABLED=false AUDIT_EXPORT_ENABLED=false APPROVAL_WORKER_ENABLED=false
export APPROVAL_TTL=PT48H IDEMPOTENCY_TTL=PT48H
export SERVER_ADDRESS=127.0.0.1 SERVER_PORT=18080
unset SPRING_PROFILES_ACTIVE
if [[ -f .data/local.env ]]; then
  set -a
  source .data/local.env
  set +a
fi
