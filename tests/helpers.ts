import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
export const base = 'http://localhost:8787';
export function sql(query: string) {
  const path = `.data/test-${crypto.randomUUID()}.sql`;
  writeFileSync(path, query, { mode: 0o600 });
  try { return JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--persist-to', '.data/wrangler', '--file', path, '--json'], { encoding: 'utf8' })); }
  finally { unlinkSync(path); }
}
export function cookies(response: Response): string {
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
export async function register(redirect = 'http://localhost:9876/callback') {
  const response = await fetch(base + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Sample test client', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  assert.equal(response.status, 201);
  return { ...await response.json() as { client_id: string }, redirect };
}
export async function begin(scopes = 'sample:read sample:request', redirect?: string) {
  const client = await register(redirect);
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const url = new URL(base + '/authorize');
  url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect, response_type: 'code', scope: scopes, state: 'sample-state', code_challenge: challenge, code_challenge_method: 'S256', resource: base + '/mcp' }).toString();
  const response = await fetch(url, { redirect: 'manual' });
  const html = await response.text();
  return { client, verifier, url, response, html, cookie: cookies(response), handle: /name="handle" value="([^"]+)"/.exec(html)?.[1], scopes };
}
export async function approve(flow: Awaited<ReturnType<typeof begin>>, options: { cookie?: string; origin?: string; ip?: string } = {}) {
  const body = new URLSearchParams({ handle: flow.handle!, decision: 'approve' });
  for (const scope of flow.scopes.split(' ')) body.append('scope', scope);
  return fetch(base + '/authorize', { method: 'POST', redirect: 'manual', headers: { Cookie: options.cookie ?? flow.cookie, Origin: options.origin ?? base, 'CF-Connecting-IP': options.ip ?? crypto.randomUUID() }, body });
}
export async function exchange(flow: Awaited<ReturnType<typeof begin>>, approval: Response, verifier = flow.verifier, resource = base + '/mcp') {
  const redirect = new URL(approval.headers.get('Location')!);
  return fetch(base + '/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: flow.client.client_id, redirect_uri: flow.client.redirect, code: redirect.searchParams.get('code')!, code_verifier: verifier, resource }) });
}
export async function session(scopes?: string) {
  const flow = await begin(scopes); assert.equal(flow.response.status, 200);
  const approval = await approve(flow); assert.equal(approval.status, 302);
  const token = await exchange(flow, approval); assert.equal(token.status, 200);
  return { flow, approval, cookie: cookies(approval), tokens: await token.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string } };
}
export async function mcp(token?: string, method = 'initialize', params: unknown = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }) {
  return fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
}
export async function decisionForm(url:string,cookie:string){
 const response=await fetch(url,{headers:{Cookie:cookie}}),html=await response.text();
 assert.equal(response.status,200);
 return {csrf:/name="csrf" value="([^"]+)"/.exec(html)?.[1]??'',bodyHash:/name="bodyHash" value="([^"]+)"/.exec(html)?.[1]??'',html};
}
