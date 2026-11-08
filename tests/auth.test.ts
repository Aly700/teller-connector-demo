import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base, begin, approve, exchange, session, mcp, sql, register } from './helpers.ts';
test('metadata publishes one resource, one issuer, S256, CIMD and only the two public-client scopes', async () => {
  const challenge = await mcp(); assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('WWW-Authenticate')!, /resource_metadata="http:\/\/localhost:8787\/\.well-known\/oauth-protected-resource\/mcp"/);
  const resource = await (await fetch(base + '/.well-known/oauth-protected-resource/mcp')).json() as any;
  assert.equal(resource.resource, base + '/mcp'); assert.deepEqual(resource.authorization_servers, [base]);
  const metadata = await (await fetch(base + '/.well-known/oauth-authorization-server')).json() as any;
  assert.deepEqual(metadata.scopes_supported, ['sample:read', 'sample:request']);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.equal(metadata.client_id_metadata_document_supported, true);
});
test('PKCE, host-only session cookie, guide ownership, refresh, and revocation work', async () => {
  const s = await session();
  assert.equal(s.tokens.expires_in, 900);
  const cookie = s.approval.headers.getSetCookie().find(c => c.startsWith('__Host-sample-session='))!;
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  assert.equal((await mcp(s.tokens.access_token)).status, 200);
  assert.equal((await fetch(base + '/guide', { headers: { Authorization: 'Bearer ' + s.tokens.access_token } })).status, 401);
  const guide = await fetch(base + '/guide', { headers: { Cookie: s.cookie } });
  assert.equal(guide.status, 200); assert.match(await guide.text(), /request-5/);
  const refresh = await fetch(base + '/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: s.flow.client.client_id, refresh_token: s.tokens.refresh_token, resource: base + '/mcp' }) });
  assert.equal(refresh.status, 200); const next = await refresh.json() as any;
  assert.notEqual(next.refresh_token, s.tokens.refresh_token);
  assert.equal((await mcp(next.access_token)).status, 200);
  const metadata = await (await fetch(base + '/.well-known/oauth-authorization-server')).json() as any;
  const revoke = await fetch(metadata.revocation_endpoint, { method: 'POST', body: new URLSearchParams({ token: next.refresh_token, client_id: s.flow.client.client_id }) });
  assert.equal(revoke.status, 200);
  assert.equal((await mcp(next.access_token)).status, 401);
});
test('bad PKCE and resource mismatch are refused without accepting a token', async () => {
  const flow = await begin(); const approval = await approve(flow); assert.equal(approval.status, 302);
  assert.equal((await exchange(flow, approval, flow.verifier, 'http://localhost:8787/other')).status, 400);
  assert.equal((await exchange(flow, approval, 'x'.repeat(64))).status, 400);
  const url = new URL(flow.url); url.searchParams.set('code_challenge_method', 'plain');
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 400);
});
test('consent is bound to a browser, origin and single use; unknown scope and metadata hosts fail', async () => {
  const flow = await begin();
  assert.equal((await approve(flow, { cookie: '' })).status, 400);
  const second = await begin();
  assert.equal((await approve(second, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await approve(second)).status, 302);
  assert.equal((await approve(second)).status, 400);
  assert.equal((await begin('sample:approve')).response.status, 400);
  const url = new URL(flow.url); url.searchParams.set('client_id', 'https://127.0.0.1/private');
  assert.equal((await fetch(url)).status, 400);
});
test('hosted client callback registers exactly and approval routes do not exist', async () => {
  const flow = await begin(undefined, 'https://claude.ai/api/mcp/auth_callback');
  assert.equal(flow.response.status, 200);
  const url = new URL(flow.url); url.searchParams.set('redirect_uri', 'https://claude.ai/api/mcp/auth_callback/evil');
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 400);
  const s = await session();
  for (const path of ['/approve', '/approvals/test/approve', '/queue/test/approve']) assert.equal((await fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer ' + s.tokens.access_token } })).status, 404);
  const readless = await session('sample:request'); assert.equal((await mcp(readless.tokens.access_token)).status, 403);
});
test('valid tokens cannot revive a revoked or missing visitor or a different epoch', async () => {
  for (const mutation of ['revoked', 'missing', 'epoch']) {
    const s = await session(); const visitorId = s.tokens.access_token.split(':')[0];
    assert.match(visitorId, /^[a-f0-9-]{36}$/);
    sql(mutation === 'missing' ? `DELETE FROM visitors WHERE id='${visitorId}';` : `UPDATE visitors SET ${mutation === 'revoked' ? 'revoked=1' : "epoch='old'"} WHERE id='${visitorId}';`);
    assert.equal((await mcp(s.tokens.access_token)).status, 401);
    const refreshed = await fetch(base + '/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: s.flow.client.client_id, refresh_token: s.tokens.refresh_token }) });
    assert.equal(refreshed.status, 400);
  }
});
test('invalid Origin and oversized bodies fail at the HTTP boundary', async () => {
  assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/mcp', { method: 'POST', body: 'x'.repeat(16385) })).status, 413);
});
