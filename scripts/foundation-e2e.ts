import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { tools } from '../apps/mcp/src/tools.ts';
import { cookies } from '../tests/helpers.ts';
const base = 'http://localhost:8787';
const transcript: string[] = [`Demo data. No real money.`, `Run: ${new Date().toISOString()}`, 'Official MCP TypeScript SDK 1.32.2; local Wrangler 4.158.0; local D1/KV, signed origin, real Teller and Postgres.', 'Credentials, auth codes, PKCE verifier and cookies are omitted.'];
function log(value: string) { transcript.push(value); console.log(value); }
let clientInfo: OAuthClientInformationMixed | undefined, tokens: OAuthTokens | undefined, verifier = '', authorization: URL | undefined;
const state = crypto.randomUUID();
const provider: OAuthClientProvider = {
  redirectUrl: base.replace('8787', '9876') + '/callback',
  clientMetadata: { client_name: 'Sample SDK client', redirect_uris: ['http://localhost:9876/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'sample:read sample:request' },
  state: () => state,
  clientInformation: () => clientInfo, saveClientInformation: value => { clientInfo = value; },
  tokens: () => tokens, saveTokens: value => { tokens = value; },
  saveCodeVerifier: value => { verifier = value; }, codeVerifier: () => verifier,
  redirectToAuthorization: url => { authorization = url; },
};
const firstClient = new Client({ name: 'foundation-e2e', version: '1.0.0' });
const firstTransport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), { authProvider: provider });
try { await firstClient.connect(firstTransport); assert.fail('Expected authorization'); }
catch (error) { assert.ok(error instanceof UnauthorizedError); }
assert.ok(authorization); assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authorization.searchParams.get('resource'), base + '/mcp');
log('PASS 401 challenge -> protected-resource metadata -> authorization-server metadata -> dynamic registration -> S256 PKCE authorization.');
const consent = await fetch(authorization, { redirect: 'manual' }); assert.equal(consent.status, 200);
const html = await consent.text(); assert.ok(html.includes('Start demo session'));
const handle = /name="handle" value="([^"]+)"/.exec(html)![1];
const form = new URLSearchParams({ handle, decision: 'approve' });
for (const match of html.matchAll(/name="scope" value="([^"]+)"/g)) form.append('scope', match[1]);
const approved = await fetch(base + '/authorize', { method: 'POST', redirect: 'manual', headers: { Origin: base, Cookie: cookies(consent), 'CF-Connecting-IP': crypto.randomUUID() }, body: form });
assert.equal(approved.status, 302);
const callback = new URL(approved.headers.get('Location')!);
assert.equal(callback.origin + callback.pathname, 'http://localhost:9876/callback');
assert.equal(callback.searchParams.get('state'), state); assert.equal(callback.searchParams.get('iss'), base);
await firstTransport.finishAuth(callback.searchParams.get('code')!);
assert.ok(tokens?.access_token); assert.ok(tokens.refresh_token);
assert.ok(tokens.scope!.split(' ').every(s => ['sample:read', 'sample:request'].includes(s)));
log(`PASS pseudonymous consent -> validated localhost callback -> SDK code exchange. Token scopes: ${tokens.scope}. No approval scope.`);
const cookie = approved.headers.getSetCookie().find(c => c.startsWith('__Host-sample-session='))!;
assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/); assert.ok(!cookie.includes('Domain='));
log('PASS browser cookie: host-only; HttpOnly; Secure; SameSite=Lax; Path=/.');
await firstClient.close();
const client = new Client({ name: 'foundation-e2e', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), { authProvider: provider });
await client.connect(transport);
assert.equal(transport.protocolVersion, '2025-11-25');
log(`PASS negotiated protocol ${transport.protocolVersion}; Streamable HTTP, JSON responses.`);
const listed = await client.listTools(); assert.deepEqual(listed.tools, tools);
log('tools/list: ' + JSON.stringify(listed, null, 2));
const list = await client.callTool({ name: 'list_accounts', arguments: {} }, CallToolResultSchema) as CallToolResult; assert.ok(!list.isError);
log('list_accounts: ' + JSON.stringify(list.structuredContent, null, 2));
const records = list.structuredContent!.accounts as any[];
assert.equal(records[0].ledgerBalanceMinor, 99900); assert.equal(records[0].availableBalanceMinor, 89899);
assert.equal(records[1].ledgerBalanceMinor, 100100); assert.equal(records[1].availableBalanceMinor, 100100);
assert.equal((list.structuredContent!.requestSlots as any[]).length, 5);
const account = await client.callTool({ name: 'get_account', arguments: { account: 'operating' } }, CallToolResultSchema) as CallToolResult;
assert.ok(!account.isError); assert.deepEqual(account.structuredContent, records[0]);
log('get_account: ' + JSON.stringify(account.structuredContent, null, 2));
for (const reference of ['sample-posted', 'sample-held']) {
  const transfer = await client.callTool({ name: 'get_transfer', arguments: { reference } }, CallToolResultSchema) as CallToolResult; assert.ok(!transfer.isError);
  assert.equal(transfer.structuredContent!.status, reference === 'sample-held' ? 'TELLER_HELD' : 'POSTED');
  log(`get_transfer(${reference}): ` + JSON.stringify(transfer.structuredContent, null, 2));
}
const invalid = await client.callTool({ name: 'get_account', arguments: { account: 'operating', approved: true } }, CallToolResultSchema) as CallToolResult;
assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent!.code, 'INVALID_INPUT');
log('PASS extra input refused: INVALID_INPUT.');
const approval = await fetch(base + '/approvals/example/approve', { method: 'POST', headers: { Authorization: 'Bearer ' + tokens.access_token } });
assert.equal(approval.status, 404); log('PASS bearer token cannot reach approval route: 404; no approval tool exists.');
await client.close();
log('PASS local OAuth and read flow.');
await mkdir('.data/logs', { recursive: true });
await writeFile('.data/logs/foundation-e2e.txt', transcript.join('\n') + '\n');
