#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
umask 077
if [[ ! -f .data/local.env ]]; then
  node --input-type=module <<'JS' > .data/local.env
import { randomBytes } from 'node:crypto';
for (const name of ['DB_PASSWORD', 'TELLER_API_KEY', 'ORIGIN_SIGNING_SECRET']) {
  console.log(`${name}=${randomBytes(32).toString('hex')}`);
}
JS
fi
echo 'Local secrets ready in .data/local.env (ignored).'
