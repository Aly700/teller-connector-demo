import { hash } from './state.ts';
const enc = new TextEncoder();
async function key(secret: string) {
  if (secret.length < 32) throw new Error('Signing configuration unavailable');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function message(request: Request, epoch: string, timestamp: string) {
  const url = new URL(request.url);
  return enc.encode(['tcd-v2', request.method, url.pathname + url.search, epoch, timestamp, await hash(await request.clone().text()), ...['Idempotency-Key','X-Demo-Approval','X-Demo-Until'].map(k=>request.headers.get(k)??'')].join('\n'));
}
export async function signRequest(url: string, secret: string, epoch: string, method = 'GET', body?:string, authority:Record<string,string>={}): Promise<Request> {
  const timestamp = String(Date.now());
  const request = new Request(url, { method, body, headers:authority });
  const signature = await crypto.subtle.sign('HMAC', await key(secret), await message(request, epoch, timestamp));
  request.headers.set('X-Demo-Epoch', epoch);
  request.headers.set('X-Demo-Time', timestamp);
  request.headers.set('X-Demo-Signature', Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join(''));
  return request;
}
export async function verifyRequest(request: Request, secret: string, epoch: string, now = Date.now()): Promise<boolean> {
  const timestamp = request.headers.get('X-Demo-Time') ?? '';
  const signature = request.headers.get('X-Demo-Signature') ?? '';
  if (request.headers.get('X-Demo-Epoch') !== epoch || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60_000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return crypto.subtle.verify('HMAC', await key(secret), Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16)), await message(request, epoch, timestamp));
}
