import { test } from 'node:test';
import assert from 'node:assert/strict';
import { begin, approve, sql } from './helpers.ts';
test('consent refuses the sixth session for a salted IP window before issuing a code', async () => {
  const ip = crypto.randomUUID();
  for (let i = 0; i < 6; i++) {
    const response = await approve(await begin(), { ip });
    assert.equal(response.status, i < 5 ? 302 : 503);
    if (i === 5) assert.equal(response.headers.has('Location'), false);
  }
});
test('an exhausted pool refuses consent before OAuth completion', async () => {
  sql("UPDATE sample_registry SET visitor_id='blocked-'||pool_id WHERE visitor_id IS NULL;");
  try {
    const response = await approve(await begin());
    assert.equal(response.status, 503); assert.equal(response.headers.has('Location'), false);
  } finally { sql("UPDATE sample_registry SET visitor_id=NULL WHERE visitor_id LIKE 'blocked-%';"); }
});
