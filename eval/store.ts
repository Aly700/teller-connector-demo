import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { hash } from '../packages/state.ts';
export function database(path=':memory:') {
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA busy_timeout=5000');
  const prepare = (query: string) => {
    let values: any[] = [];
    const statement = { bind(...args: any[]) { values = args; return statement; },
      async first() { return raw.prepare(query).get(...values) ?? null; },
      async all() { return { results: raw.prepare(query).all(...values) }; },
      async run() { const results = raw.prepare(query).all(...values); return { results, meta: { changes: Number(raw.prepare('SELECT changes() AS n').get()!.n) } }; },
    }; return statement;
  };
  const db = { prepare, async batch(statements: any[]) { raw.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); raw.exec('COMMIT'); return result; } catch(e) { raw.exec('ROLLBACK'); throw e; } } } as unknown as D1Database;
  return {db,raw};
}
export async function fixture(path=':memory:') {
  const {db,raw}=database(path);
  for(const name of ['0001','0002','0003','0004','0005'])raw.exec(readFileSync(`migrations/${name}.sql`,'utf8'));
  const now = Date.now(), epoch = crypto.randomUUID(), id = crypto.randomUUID(), cookie = crypto.randomUUID() + crypto.randomUUID();
  const visitor = { id, epoch, expires_at: now + 3600000, revoked: 0 };
  raw.prepare('INSERT INTO config VALUES(1,?,?,1,0,?,?)').run(epoch, now+3600000, JSON.stringify(Object.fromEntries(['request_transfer','list_accounts','get_account','get_transfer'].map(t=>[t,true]))), 'salt');
  raw.prepare('INSERT INTO visitors(id,epoch,session_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(id,epoch,await hash(cookie),now,now+3600000);
  const slots = Array.from({length:5},(_,i)=>({reference:`request-${i+1}`,requestKey:crypto.randomUUID(),used:false}));
  raw.prepare('INSERT INTO sample_registry VALUES(?,?,?,?,?,?)').run('001',epoch,id,JSON.stringify({operating:crypto.randomUUID(),reserve:crypto.randomUUID()}),JSON.stringify({'sample-posted':crypto.randomUUID(),'sample-held':crypto.randomUUID()}),JSON.stringify(slots));
  return { db, raw, visitor, props:{visitorId:id,epoch}, cookie, slots, now, input: {fromAccount:'operating',toAccount:'reserve',amountMinor:100,currency:'CAD',requestKey:slots[0].requestKey} };
}
