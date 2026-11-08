#!/usr/bin/env bash
source "$(dirname "$0")/../scripts/env.sh"
umask 077
case "${1:-}" in
  postgres)
    [[ -f .data/pg/PG_VERSION ]] || { echo 'Initialize the dedicated cluster first.'; exit 1; }
    exec "$PG_BIN/postgres" -D "$ROOT/.data/pg"
    ;;
  teller)
    for ((i=0;i<60;i++)); do
      if "$PG_BIN/pg_isready" -h 127.0.0.1 -p 55432 >/dev/null; then exec scripts/teller-start.sh; fi
      sleep 1
    done
    exit 1
    ;;
  origin)
    for ((i=0;i<60;i++)); do
      if curl --silent --fail http://127.0.0.1:18080/actuator/health >/dev/null; then exec scripts/origin-start.sh; fi
      sleep 1
    done
    exit 1
    ;;
  cloudflared)
    [[ -f .data/tunnel.yml && -f .data/tunnel-credentials.json ]] || exit 1
    exec /opt/homebrew/bin/cloudflared tunnel --config "$ROOT/.data/tunnel.yml" run
    ;;
  *) echo 'Expected postgres, teller, origin or cloudflared.'; exit 1;;
esac
