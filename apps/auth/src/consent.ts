import { securityEvent } from '../../../packages/limits.ts';
import { AuthorizationError, CimdFetchError, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { allocate, browserCookie, browserSession, config, SCOPES } from '../../../packages/state.ts';
import { retireBrowserSession } from '../../../packages/gate/holds.ts';
import { page, escapeHtml as e } from '../../../packages/http.ts';
export async function consent(request: Request, db: D1Database, oauth: OAuthHelpers, origin: string): Promise<Response> {
  try {
    await config(db);
    if (request.method === 'GET') {
      const clientId = new URL(request.url).searchParams.get('client_id') ?? '';
      if (clientId.includes(':') && !/^https:\/\/claude\.ai\/[^?#]+$/.test(clientId)) return page('<h1>Client not supported</h1>', 400);
      const parsed = await oauth.parseAuthRequest(request);
      if (parsed.codeChallengeMethod !== 'S256' || !parsed.codeChallenge) return page('<h1>S256 PKCE is required</h1>', 400);
      if (parsed.scope.some(scope => !SCOPES.includes(scope))) return page('<h1>Unsupported scope</h1>', 400);
      const details = await oauth.describeConsent(parsed);
      const transaction = await oauth.beginConsent(parsed);
      return page(`<h1>Start sample session</h1><p>Allow ${e(details.clientName)} to use this temporary sample session.</p>
        <p>${details.clientDomain ? 'Client domain: ' + e(details.clientDomain) : 'The client name is self-reported.'}</p>
        <p>Return address: ${e(details.redirectHost)}.</p>${details.redirectIsLoopback ? '<p>This sends access to an app on this computer. Continue only if you started this connection.</p>' : ''}
        <p>Scopes: ${parsed.scope.map(e).join(', ')}. Request access cannot approve a transfer.</p>
        <p>No email or password. The session ends at the next 03:00 Toronto reset.</p>
        <form method="post" action="/authorize"><input type="hidden" name="handle" value="${e(transaction.handle)}">
        ${parsed.scope.map(scope => `<input type="hidden" name="scope" value="${e(scope)}">`).join('')}
        <button name="decision" value="approve">Start sample session</button> <button name="decision" value="deny">Cancel</button></form>`, 200, transaction.headers, new URL(parsed.redirectUri).origin);
    }
    if (request.method !== 'POST') return page('<h1>Method not allowed</h1>', 405);
    if (request.headers.get('Origin') !== origin) return page('<h1>Session could not start</h1>', 403);
    const form = await request.formData(), handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const scopes = form.getAll('scope').map(String);
    if (!scopes.length || scopes.some(scope => !SCOPES.includes(scope))) return page('<h1>Unsupported scope</h1>', 400);
    const approved = await oauth.approveConsent(request, handle, { scope: scopes });
    const previous=await browserSession(db,request);
    const session = await allocate(db, request.headers.get('CF-Connecting-IP') ?? 'local-loopback');
    if(previous)await retireBrowserSession(db,previous);
    const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: session.visitorId, metadata: {}, scope: scopes, props: { visitorId: session.visitorId, epoch: session.epoch } });
    approved.headers.set('Location', redirectTo);
    approved.headers.append('Set-Cookie', browserCookie(session.session, session.expiresAt));
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    try{await securityEvent(db,error instanceof Error&&error.message==='SESSION_LIMIT'?'RATE_LIMIT':'AUTH_FAILURE');}catch{}
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) return page('<h1>Session could not start</h1><p>Restart the connection from your client.</p>', 400);
    return page('<h1>Sample sessions are unavailable</h1><p>Try again after the next reset.</p>', 503);
  }
}
