#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
const result = await fetch('http://127.0.0.1:18080/actuator/health');
assert.equal(result.status, 200);
assert.equal((await result.json()).status, 'UP');
console.log('Teller health UP. Native Postgres, base profile, AWS disabled.');
JS
