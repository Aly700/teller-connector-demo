import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { holdEvent } from '../packages/gate/events.ts';
import type { Hold } from '../packages/gate/holds.ts';
import { WRITE_TOOL } from '../packages/gate/policy.ts';
import { READ_TOOLS } from '../packages/state.ts';
import type { Pool } from '../packages/sample.ts';
const cli = 'node_modules/wrangler/bin/wrangler.js';
const remote=process.env.TCD_TARGET==='production';
if(remote&&(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID))throw new Error('Scoped operator credentials required; interactive login is disabled');
const common = remote?['--remote','--env','production']:['--local', '--persist-to', '.data/wrangler'];
const run = (args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
async function sql(value: string) {
  await writeFile('.data/state.sql', value, { mode: 0o600 });
  try { run(['d1', 'execute', 'DB', ...common, '--file', '.data/state.sql']); }
  finally { await rm('.data/state.sql', { force: true }); }
}
run(['d1', 'migrations', 'apply', 'DB', ...common]);
if (process.argv[2] === 'maintenance') {
  await sql('UPDATE config SET maintenance=1 WHERE id=1;');
  const rows=JSON.parse(run(['d1','execute','DB',...common,'--command',"SELECT * FROM holds WHERE status='HELD'",'--json']))[0].results as Hold[];
  for(const h of rows){const next={...h,status:'EXPIRED',csrf_hash:null};const journal=JSON.parse(h.journal_json);journal.push(holdEvent(next,'RESET_EXPIRED'));await sql(`UPDATE holds SET status='EXPIRED',csrf_hash=NULL,version=version+1,journal_json=${quote(JSON.stringify(journal))} WHERE id=${quote(h.id)} AND version=${h.version} AND status='HELD';`);}
  console.log('Worker maintenance enabled; pending holds expired.');
} else if(process.argv[2]==='quiesced') {
  const rows=JSON.parse(run(['d1','execute','DB',...common,'--command',"SELECT * FROM holds WHERE status='DISPATCHING'",'--json']))[0].results as Hold[];
  for(const h of rows){const next={...h,status:'OUTCOME_UNKNOWN',error_code:'OUTCOME_UNKNOWN'};const journal=JSON.parse(h.journal_json);journal.push(holdEvent(next,'RESET_QUIESCED'));await sql(`UPDATE holds SET status='OUTCOME_UNKNOWN',error_code='OUTCOME_UNKNOWN',version=version+1,journal_json=${quote(JSON.stringify(journal))} WHERE id=${quote(h.id)} AND version=${h.version} AND status='DISPATCHING';`);}
  console.log('Dispatches quiesced: dedicated processes stopped and database connections closed.');
} else if (process.argv[2] === 'activate') {
  const pool: Pool = JSON.parse(await readFile('.data/pool.json', 'utf8'));
  if (pool.pools.length !== 100 || pool.expiresAt <= Date.now()) throw new Error('Invalid sample pool');
  const keys = JSON.parse(run(['kv', 'key', 'list', '--binding', 'OAUTH_KV', '-c', 'apps/auth/wrangler.jsonc', ...common])) as { name: string }[];
  if (keys.length) {
    await writeFile('.data/kv-delete.json', JSON.stringify(keys.map(k => k.name)), { mode: 0o600 });
    try { run(['kv', 'bulk', 'delete', '.data/kv-delete.json', '--binding', 'OAUTH_KV', '-c', 'apps/auth/wrangler.jsonc', ...common, '--force']); }
    finally { await rm('.data/kv-delete.json', { force: true }); }
  }
  const statements = ['DELETE FROM session_end_tokens;', 'DELETE FROM holds;', 'DELETE FROM audit_events;', 'DELETE FROM visitors;', 'DELETE FROM sample_registry;', 'DELETE FROM consent_limits;', 'DELETE FROM config;'];
  for (const entry of pool.pools) statements.push(`INSERT INTO sample_registry(pool_id,epoch,accounts_json,transfers_json) VALUES(${quote(entry.poolId)},${quote(pool.epoch)},${quote(JSON.stringify(entry.accounts))},${quote(JSON.stringify(entry.transfers))});`);
  statements.push(`INSERT INTO config VALUES(1,${quote(pool.epoch)},${pool.expiresAt},1,0,${quote(JSON.stringify(Object.fromEntries([...READ_TOOLS,WRITE_TOOL].map(t => [t, true]))))},${quote(crypto.randomUUID())});`);
  await sql(statements.join('\n'));
  console.log('D1 registry activated; old visitors and OAuth KV records removed.');
} else throw new Error('Expected maintenance or activate');
