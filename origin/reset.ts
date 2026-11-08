import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises';
import { openSync, closeSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { seed } from './seed.ts';
import { SAMPLE } from '../packages/sample.ts';
import { signRequest } from '../packages/signing.ts';
const root = await realpath(new URL('..', import.meta.url).pathname);
if (await realpath(process.cwd()) !== root) throw new Error('Reset must run at repository root');
const pg = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin';
const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD, PGHOST: '127.0.0.1', PGPORT: '55432', PGUSER: 'tcd_owner', PGDATABASE: 'postgres' };
function sql(query: string) { return execFileSync(`${pg}/psql`, ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { env, encoding: 'utf8' }).trim(); }
async function atomic(path: string, data: unknown) {
  await writeFile(path + '.next', JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); await rename(path + '.next', path);
}
async function stop(name: 'teller' | 'origin') {
  const path = `.data/${name}.pid`;
  if (!existsSync(path)) return;
  const pid = Number(await readFile(path, 'utf8'));
  if (!Number.isInteger(pid) || pid < 2) throw new Error('Invalid process record');
  let command: string;
  try { command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim(); }
  catch { await rm(path); return; }
  const expected = name === 'teller' ? `${root}/vendor/teller/target/teller-0.0.1-SNAPSHOT.jar` : `${root}/origin/server.ts`;
  if (!command.includes(expected)) throw new Error('Process ownership mismatch; reset refused');
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { await rm(path, { force: true }); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // An unconfirmed stop never permits database replacement.
  throw new Error('Process has not stopped; maintenance retained');
}
async function portFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}
function start(name: 'teller' | 'origin') {
  const fd = openSync(`.data/logs/${name}.log`, 'a', 0o600);
  const child = spawn(`${root}/scripts/${name}-start.sh`, [], { cwd: root, detached: true, stdio: ['ignore', fd, fd], env: process.env });
  child.unref(); closeSync(fd);
}
function workerReset(stage: 'maintenance' | 'activate' | 'quiesced') {
  if (existsSync('scripts/worker-state.ts')) execFileSync(process.execPath, ['--import', 'tsx', 'scripts/worker-state.ts', stage], { stdio: 'inherit', env: process.env });
}
await mkdir('.data/reset.lock');
try {
  if (sql('SHOW data_directory') !== `${root}/.data/pg`) throw new Error('Dedicated cluster path mismatch');
  await atomic('.data/origin-state.json', { ...SAMPLE, maintenance: true, writesEnabled: false });
  workerReset('maintenance');
  await stop('origin'); await stop('teller');
  await portFree(18080); await portFree(18081);
  if (sql("SELECT count(*) FROM pg_stat_activity WHERE datname='teller_demo'") !== '0') throw new Error('Database connections remain; reset refused');
  workerReset('quiesced');
  execFileSync(`${pg}/dropdb`, ['--if-exists', 'teller_demo'], { env });
  execFileSync(`${pg}/createdb`, ['teller_demo'], { env });
  start('teller');
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try { healthy = (await fetch('http://127.0.0.1:18080/actuator/health', { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!healthy) throw new Error('Teller startup failed; maintenance retained');
  const pool = await seed();
  await atomic('.data/pool.json', pool);
  await atomic('.data/origin-state.json', { ...SAMPLE, maintenance: false, writesEnabled: true, epoch: pool.epoch });
  start('origin');
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { ready = (await fetch(await signRequest('http://127.0.0.1:18081/v1/pools/001/accounts/operating', process.env.ORIGIN_SIGNING_SECRET!, pool.epoch))).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Origin startup failed; maintenance retained');
  if(process.env.TCD_RESET_DEFER_ACTIVATE!=='1')workerReset('activate');
  console.log(`Reset complete: ${pool.pools.length} verified pairs, POSTED and HELD fixtures, new epoch. ${SAMPLE.notice}`);
} catch (error) {
  await atomic('.data/origin-state.json', { ...SAMPLE, maintenance: true, writesEnabled: false });
  throw error;
} finally { await rm('.data/reset.lock', { recursive: true }); }
