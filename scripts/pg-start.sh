#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
: "${DB_PASSWORD:?Run scripts/init-local.sh first}"
export PGPASSWORD="$DB_PASSWORD"
if [[ ! -f .data/pg/PG_VERSION ]]; then
  if "$PG_BIN/pg_isready" -h 127.0.0.1 -p 55432 >/dev/null; then
    echo 'Port 55432 is occupied. Refusing to touch an existing cluster.' >&2
    exit 1
  fi
  umask 077
  printf '%s\n' "$DB_PASSWORD" > .data/pg-password
  "$PG_BIN/initdb" -D "$ROOT/.data/pg" -U tcd_owner --pwfile="$ROOT/.data/pg-password" --auth=scram-sha-256 --encoding=UTF8 --locale=C > .data/logs/pg-init.log
  rm .data/pg-password
  cat >> .data/pg/postgresql.conf <<EOF
listen_addresses = '127.0.0.1'
port = 55432
unix_socket_directories = '$ROOT/.data'
EOF
fi
if ! "$PG_BIN/pg_ctl" -D "$ROOT/.data/pg" status >/dev/null; then
  "$PG_BIN/pg_ctl" -D "$ROOT/.data/pg" -l "$ROOT/.data/logs/postgres.log" -w start
fi
ACTUAL="$("$PG_BIN/psql" -d postgres -Atc 'show data_directory')"
[[ "$ACTUAL" == "$ROOT/.data/pg" ]] || { echo 'Cluster path mismatch'; exit 1; }
if [[ "$("$PG_BIN/psql" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'teller_demo'")" != 1 ]]; then
  "$PG_BIN/createdb" teller_demo
fi
echo 'Dedicated Postgres ready on 127.0.0.1:55432.'
