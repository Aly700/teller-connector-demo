#!/usr/bin/env bash
source "$(dirname "$0")/../scripts/env.sh"
node --import tsx --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {signRequest} from './packages/signing.ts';
const pool=JSON.parse(await readFile('.data/pool.json','utf8'));
if(pool.expiresAt<=Date.now())throw new Error('Missed reset. Origin must remain unavailable.');
const response=await fetch(await signRequest('http://127.0.0.1:18081/v1/pools/001/accounts/operating',process.env.ORIGIN_SIGNING_SECRET,pool.epoch),{signal:AbortSignal.timeout(3000)});
if(!response.ok)throw new Error('Signed origin not ready');
const account=await response.json();if(account.id!==pool.pools[0].accounts.operating)throw new Error('Epoch mismatch');
console.log('PASS current epoch, signed origin and Teller account. Demo data. No real money.');
JS
