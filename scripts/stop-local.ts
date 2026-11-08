import { readFile, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = await realpath(new URL('..', import.meta.url).pathname);
for (const name of ['worker', 'origin', 'teller']) {
  const path = `${root}/.data/${name}.pid`;
  if (!existsSync(path)) continue;
  const pid = Number(await readFile(path, 'utf8'));
  if (!Number.isInteger(pid) || pid < 2) throw new Error('Invalid process record');
  let command: string;
  try { command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }); }
  catch { await rm(path); continue; }
  const expected = name === 'teller' ? `${root}/vendor/teller/target/teller-0.0.1-SNAPSHOT.jar` : name === 'origin' ? `${root}/origin/server.ts` : `${root}/node_modules/wrangler/bin/wrangler.js`;
  if (!command.includes(expected)) throw new Error('Process ownership mismatch; stop refused');
  process.kill(pid, 'SIGTERM');
  let stopped = false;
  for (let i = 0; i < 150; i++) {
    try { process.kill(pid, 0); } catch { stopped = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!stopped) throw new Error('Process did not stop');
  await rm(path, { force: true });
}
const pg = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin';
if (existsSync(`${root}/.data/pg/postmaster.pid`)) execFileSync(`${pg}/pg_ctl`, ['-D', `${root}/.data/pg`, '-m', 'fast', '-w', 'stop'], { stdio: 'inherit' });
console.log('Repository-owned local services stopped.');
