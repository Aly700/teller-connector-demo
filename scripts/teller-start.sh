#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
: "${TELLER_API_KEY:?Run scripts/init-local.sh first}"
printf '%s\n' "$$" > "$ROOT/.data/teller.pid"
exec java -Xms128m -Xmx512m -jar "$ROOT/vendor/teller/target/teller-0.0.1-SNAPSHOT.jar"
