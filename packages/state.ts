import { SAMPLE } from './sample.ts';
export const SCOPES = ['sample:read', 'sample:request'];
export const READ_TOOLS = ['list_accounts', 'get_account', 'get_transfer'];
export interface Config { epoch: string; expires_at: number; enabled: number; maintenance: number; tools_json: string; ip_salt: string }
export interface SessionProps { visitorId: string; epoch: string }
export interface Visitor { id: string; epoch: string; expires_at: number; revoked: number }
export interface Registry { pool_id: string; epoch: string; visitor_id: string; accounts_json: string; transfers_json: string; request_slots_json: string }
export async function config(db: D1Database): Promise<Config> {
  const value = await db.prepare('SELECT * FROM config WHERE id=1').first<Config>();
  if (!value || !value.enabled || value.maintenance || value.expires_at <= Date.now()) throw new Error('DEMO_UNAVAILABLE');
  return value;
}
export async function validSession(db: D1Database, props: SessionProps): Promise<Visitor | null> {
  const c = await config(db);
  if (!props || typeof props.visitorId !== 'string' || props.epoch !== c.epoch) return null;
  const visitor = await db.prepare('SELECT id, epoch, expires_at, revoked FROM visitors WHERE id=? AND epoch=? AND revoked=0 AND expires_at>?').bind(props.visitorId, c.epoch, Date.now()).first<Visitor>();
  return visitor;
}
export async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function allocate(db: D1Database, ip: string) {
  const c = await config(db);
  if (c.expires_at - Date.now() < 60000) throw new Error('DEMO_UNAVAILABLE');
  const visitorId = crypto.randomUUID(), session = crypto.randomUUID() + crypto.randomUUID();
  const ipHash = await hash(c.ip_salt + ':' + ip), window = Math.floor(Date.now() / 3600000);
  const slots = Array.from({ length: 5 }, (_, i) => ({ ...SAMPLE, reference: `request-${i + 1}`, requestKey: crypto.randomUUID(), used: false }));
  const now = Date.now();
  // D1 batch is transactional. A single guarded UPDATE claims a pool before the visitor exists.
  const results = await db.batch([
    db.prepare(`UPDATE sample_registry SET visitor_id=?, request_slots_json=?
      WHERE pool_id=(SELECT pool_id FROM sample_registry WHERE visitor_id IS NULL AND epoch=? ORDER BY pool_id LIMIT 1)
      AND (SELECT COUNT(*) FROM visitors WHERE epoch=?) < 100
      AND COALESCE((SELECT count FROM daily_visitors WHERE day=?),0)<100
      AND COALESCE((SELECT count FROM consent_limits WHERE ip_hash=? AND window=?),0) < 5
      AND EXISTS(SELECT 1 FROM config WHERE id=1 AND epoch=? AND maintenance=0 AND enabled=1 AND expires_at>?) RETURNING *`)
      .bind(visitorId, JSON.stringify(slots), c.epoch, c.epoch, Math.floor(now/86400000), ipHash, window, c.epoch, now + 60000),
    db.prepare(`INSERT INTO visitors(id,epoch,session_hash,created_at,expires_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sample_registry WHERE visitor_id=?)`)
      .bind(visitorId, c.epoch, await hash(session), now, c.expires_at, visitorId),
    db.prepare(`INSERT INTO consent_limits(ip_hash,window,count) SELECT ?,?,1 WHERE EXISTS(SELECT 1 FROM visitors WHERE id=?)
      ON CONFLICT(ip_hash,window) DO UPDATE SET count=count+1`).bind(ipHash, window, visitorId),
    db.prepare('INSERT INTO daily_visitors(day,count) SELECT ?,1 WHERE EXISTS(SELECT 1 FROM visitors WHERE id=?) ON CONFLICT(day) DO UPDATE SET count=count+1').bind(Math.floor(now/86400000),visitorId),
    db.prepare('DELETE FROM consent_limits WHERE window<?').bind(window - 23),
  ]);
  if (!results[0].results.length) throw new Error('SESSION_LIMIT');
  return { visitorId, epoch: c.epoch, session, expiresAt: c.expires_at, registry: results[0].results[0] as unknown as Registry };
}
export function browserCookie(value: string, expiresAt: number): string {
  return `__Host-sample-session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`;
}
export async function browserSession(db: D1Database, request: Request): Promise<Visitor | null> {
  const value = /(?:^|;\s*)__Host-sample-session=([a-f0-9-]{72})(?:;|$)/.exec(request.headers.get('Cookie') ?? '')?.[1];
  if (!value) return null;
  const c = await config(db);
  return db.prepare('SELECT id,epoch,expires_at,revoked FROM visitors WHERE session_hash=? AND epoch=? AND revoked=0 AND expires_at>?').bind(await hash(value), c.epoch, Date.now()).first<Visitor>();
}
