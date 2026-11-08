import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money } from '../apps/mcp/src/pages.ts';
test('approval pages format integer minor units as CAD dollars',()=>{
 assert.equal(money(1),'$0.01 CAD');assert.equal(money(125),'$1.25 CAD');assert.equal(money(10000),'$100.00 CAD');assert.equal(money(10001),'$100.01 CAD');
});
