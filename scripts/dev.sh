#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
umask 077
printf 'ORIGIN_SIGNING_SECRET=%s\n' "$ORIGIN_SIGNING_SECRET" > .dev.vars
printf '%s\n' "$$" > .data/worker.pid
exec node "$ROOT/node_modules/wrangler/bin/wrangler.js" dev --config wrangler.jsonc --config apps/auth/wrangler.jsonc --local --persist-to .data/wrangler --show-interactive-dev-session=false
