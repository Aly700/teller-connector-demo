#!/usr/bin/env bash
# Root LaunchDaemon for scheduled resets. Never invoked by CI or local development.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SERVICE_USER="${1:?Supply the dedicated macOS short user name}"
[[ "$(id -u)" == 0 && "$SERVICE_USER" != root && -f .data/ops-enabled ]] || exit 1
# Keep scheduled and manual resets from crossing bootout/bootstrap boundaries.
mkdir .data/managed-reset.lock || exit 1
trap 'rmdir .data/managed-reset.lock' EXIT
as_service_user() { /usr/bin/sudo -u "$SERVICE_USER" -H /bin/bash "$ROOT/ops/operator.sh" "$@"; }
as_service_user maintenance
for service in origin teller; do
  if /bin/launchctl print "system/local.tcd.$service" >/dev/null 2>&1; then
    /bin/launchctl bootout "system/local.tcd.$service"
  fi
done
# Reset verifies process exit, closed ports and zero database connections before replacement.
as_service_user reset
# The reset's temporary processes have not opened the cloud dataset to visitors.
as_service_user stop-services
for service in teller origin; do
  /bin/launchctl bootstrap system "/Library/LaunchDaemons/local.tcd.$service.plist"
done
# Signed readiness must pass before old grants are removed and the new epoch is activated.
for ((i=0;i<90;i++)); do
  if /usr/bin/sudo -u "$SERVICE_USER" -H /bin/bash "$ROOT/ops/check.sh" >/dev/null 2>&1; then
    as_service_user activate
    echo 'Managed reset complete. New epoch active. Demo data. No real money.'
    exit 0
  fi
  sleep 1
done
echo 'Readiness failed. Worker maintenance remains on.' >&2
exit 1
