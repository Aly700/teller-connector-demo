import { z } from 'zod';
import { signRequest } from '../../../packages/signing.ts';
import { limitedText } from '../../../packages/body.ts';
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const time = z.iso.datetime({ offset: true });
export const accountSchema = z.strictObject({
  id: z.uuid(), currency: z.literal('CAD'), status: z.enum(['ACTIVE', 'CLOSED']),
  ledgerBalanceMinor: money, availableBalanceMinor: money, version: money, createdAt: time,
}).refine(a => a.availableBalanceMinor <= a.ledgerBalanceMinor);
export const transferSchema = z.strictObject({
  id: z.uuid(), fromAccountId: z.uuid(), toAccountId: z.uuid(), amountMinor: money.positive(), currency: z.literal('CAD'),
  state: z.enum(['PENDING', 'AUTHORIZED', 'HELD', 'DENIED', 'POSTED', 'REVERSED']),
  reasonCode: z.enum(['POLICY_DENIED', 'INSUFFICIENT_FUNDS', 'APPROVAL_DENIED', 'APPROVAL_EXPIRED']).nullable(),
  decisionId: z.uuid().nullable(), approvalId: z.uuid().nullable(), createdAt: time,
  postedAt: time.nullable(), reversedAt: time.nullable(),
}).refine(t => t.fromAccountId !== t.toAccountId && (t.state !== 'HELD' || t.approvalId !== null) && (t.state !== 'POSTED' || t.postedAt !== null));
export class UpstreamError extends Error { constructor(public status: number,public upstreamStatus:number|null=status||null) { super('Upstream unavailable'); } }
interface Options { fetcher?: (request: Request) => Promise<Response>; now?: () => number; sleep?: (ms: number) => Promise<void> }
export class TellerClient {
  constructor(private origin: string, private secret: string, private epoch: string, private options: Options = {}) {
    const url = new URL(origin);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Invalid origin configuration');
  }
  async get<T>(path: string, schema: z.ZodType<T>, deadline?: number): Promise<T> {
    const now = this.options.now ?? Date.now;
    const end = deadline ?? now() + 10000;
    const sleep = this.options.sleep ?? (async ms => { await new Promise(resolve => setTimeout(resolve, ms)); });
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = end - now();
      if (remaining <= 0) throw new UpstreamError(0);
      let response: Response;
      try {
        const signed = await signRequest(this.origin + path, this.secret, this.epoch);
        response = await (this.options.fetcher ?? fetch)(new Request(signed, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.min(2500, remaining))) }));
      } catch {
        if (attempt === 2) throw new UpstreamError(0);
        const delay = [250, 1000][attempt];
        if (now() + delay >= end) throw new UpstreamError(0);
        await sleep(delay); continue;
      }
      if (response.headers.get('X-Demo-Failure') === 'invalid-data') throw new UpstreamError(0,response.status);
      if (response.status === 200) {
        try { return schema.parse(JSON.parse(await limitedText(response))); }
        catch { throw new UpstreamError(0,200); } // Invalid success data is never retried.
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) throw new UpstreamError(response.status);
      const retry = response.headers.get('Retry-After');
      const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 0;
      const delay = Math.max([250, 1000][attempt], Number.isFinite(seconds) ? seconds : 0);
      if (now() + delay >= end) throw new UpstreamError(response.status);
      await response.body?.cancel(); await sleep(delay);
    }
    throw new UpstreamError(0);
  }
}
