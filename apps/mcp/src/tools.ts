import { z } from 'zod';
import { heldResult, type Hold } from '../../../packages/gate/holds.ts';
import { WRITE_TOOL, WRITE_ANNOTATIONS } from '../../../packages/gate/policy.ts';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { SAMPLE, ACCOUNTS, REFERENCES, type AccountAlias } from '../../../packages/sample.ts';
import type { Registry } from '../../../packages/state.ts';
import { accountSchema, transferSchema, TellerClient, UpstreamError } from './teller.ts';
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const tools: Tool[] = [
  { name: 'list_accounts', title: 'List accounts', description: "List the two accounts in this session, their balances, known transfer references and unused request keys.", annotations,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_account', title: 'Read an account', description: 'Read the ledger and available balance of the selected account in CAD minor units.', annotations,
    inputSchema: { type: 'object', properties: { account: { type: 'string', enum: [...ACCOUNTS] } }, required: ['account'], additionalProperties: false } },
  { name: 'get_transfer', title: 'Read a transfer', description: 'Read the state of a known transfer. A connector request without a Teller transfer is still waiting for your decision.', annotations,
    inputSchema: { type: 'object', properties: { reference: { type: 'string', enum: [...REFERENCES] } }, required: ['reference'], additionalProperties: false } },
];
tools.push({ name: WRITE_TOOL, title: 'Request a transfer', description: 'Request a transfer between Operating and Reserve in CAD. It waits for your approval before anything is sent to Teller. Reusing the same request key returns the existing request.', annotations: WRITE_ANNOTATIONS, inputSchema: { type:'object', properties: { fromAccount:{type:'string',enum:[...ACCOUNTS]}, toAccount:{type:'string',enum:[...ACCOUNTS]}, amountMinor:{type:'integer',minimum:1,maximum:10000}, currency:{type:'string',const:'CAD'}, requestKey:{type:'string',format:'uuid'} }, required:['fromAccount','toAccount','amountMinor','currency','requestKey'], additionalProperties:false } });
const inputs: z.ZodType[] = [z.strictObject({}), z.strictObject({ account: z.enum(ACCOUNTS) }), z.strictObject({ reference: z.enum(REFERENCES) })];
export function acceptedArguments(name:string,args:unknown):Record<string,unknown>|null{const index=tools.findIndex(t=>t.name===name);if(index<0||index>2)return null;const parsed=inputs[index].safeParse(args??{});return parsed.success?parsed.data as Record<string,unknown>:null;}
const invalid = ['This read takes no inputs.', 'Choose operating or reserve.', 'Choose a transfer reference from the guide.'];
const messages: Record<number, [string, string[]]> = {
  400: ['UPSTREAM_CONTRACT', ['Teller rejected the account read. The demo needs repair.', 'Teller rejected this account read. The demo needs repair.', 'Teller rejected this transfer read. The demo needs repair.']],
  404: ['SAMPLE_RESET', ['Accounts changed. Start a new demo session.', 'This account is unavailable. Start a new demo session.', 'No transfer exists for that reference. Check the demo queue.']],
  401: ['UPSTREAM_AUTH', ['Accounts are unavailable while the demo connection is repaired.', 'This account is unavailable while the demo connection is repaired.', 'This transfer is unavailable while the demo connection is repaired.']],
  409: ['UPSTREAM_CONFLICT', ['Accounts could not be read consistently. Try again.', 'This account could not be read consistently. Try again.', 'This transfer could not be read consistently. Check the queue.']],
  0: ['UPSTREAM_UNAVAILABLE', ['Accounts are unavailable. Try again later.', 'This account is unavailable. Try again later.', 'This transfer is unavailable. Check the queue or try again later.']],
};
export function failure(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }], structuredContent: { code, ...SAMPLE } };
}
export const unavailable = () => failure('DEMO_UNAVAILABLE', 'The demo is unavailable. Try again later.');
export function success(record: Record<string, unknown>): CallToolResult {
  const data = { ...record, ...SAMPLE };
  const text = JSON.stringify(data);
  if (new TextEncoder().encode(JSON.stringify({ content: [{type:'text',text}], structuredContent:data })).length > 32700) throw new UpstreamError(0,200);
  return { content: [{ type: 'text', text }], structuredContent: data };
}
export async function readTool(name: string, args: unknown, registry: Registry, teller: TellerClient, holds:Hold[]=[], origin='http://localhost:8787'): Promise<CallToolResult> {
  const readSuccess=(record:Record<string,unknown>):CallToolResult=>({...success(record),_meta:{upstreamStatus:200}});
  const index = tools.findIndex(t => t.name === name);
  if (index < 0 || index > 2) return failure('INVALID_INPUT', 'Choose a listed read.');
  const parsed = inputs[index].safeParse(args ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', invalid[index]);
  try {
    const accounts = z.strictObject({ operating: z.uuid(), reserve: z.uuid() }).parse(JSON.parse(registry.accounts_json));
    const transfers = z.strictObject({ 'sample-posted': z.uuid(), 'sample-held': z.uuid() }).parse(JSON.parse(registry.transfers_json));
    const readAccount = async (alias: AccountAlias) => {
      const data = await teller.get(`/v1/pools/${registry.pool_id}/accounts/${alias}`, accountSchema);
      if (data.id !== accounts[alias]) throw new UpstreamError(0,200);
      return { ...data, account: alias, ...SAMPLE };
    };
    if (index === 0) {
      const values = await Promise.all(ACCOUNTS.map(readAccount));
      const slots = z.array(z.object({ reference: z.enum(REFERENCES), requestKey: z.uuid(), used: z.boolean() })).length(5).parse(JSON.parse(registry.request_slots_json));
      return readSuccess({ accounts: values, transferReferences: ['sample-posted', 'sample-held'].map(reference => ({ reference, ...SAMPLE })), requestSlots: slots.filter(s => !s.used).map(s => ({ ...s, ...SAMPLE })) });
    }
    if (index === 1) return readSuccess(await readAccount((parsed.data as { account: AccountAlias }).account));
    const reference = (parsed.data as { reference: string }).reference;
    const hold=holds.find(h=>h.reference===reference);
    if(reference.startsWith('request-')&&!hold)throw new UpstreamError(404,null);
    if(hold&&!hold.teller_id)return success(heldResult(hold,origin));
    const data = await teller.get(hold?`/v1/pools/${registry.pool_id}/requests/${hold.teller_id}`:`/v1/pools/${registry.pool_id}/transfers/${reference}`, transferSchema);
    if(hold){const body=JSON.parse(hold.body_json);if(data.fromAccountId!==body.fromAccountId||data.toAccountId!==body.toAccountId||data.amountMinor!==body.amountMinor||data.currency!==body.currency)throw new UpstreamError(0,200);}
    if (data.id !== (hold?.teller_id ?? transfers[reference as keyof typeof transfers]) || !Object.values(accounts).includes(data.fromAccountId) || !Object.values(accounts).includes(data.toAccountId)) throw new UpstreamError(0,200);
    return readSuccess({ ...data, reference, fromAccount: ACCOUNTS.find(a => accounts[a] === data.fromAccountId), toAccount: ACCOUNTS.find(a => accounts[a] === data.toAccountId), status: data.state === 'HELD' ? 'TELLER_HELD' : data.state === 'DENIED' ? 'TELLER_DENIED' : data.state });
  } catch (error) {
    if (!(error instanceof UpstreamError)) return unavailable();
    const [code, text] = messages[error.status === 403 ? 401 : error.status] ?? messages[0];
    return {...failure(error.status === 404 && index === 2 ? 'NOT_FOUND' : code, text[index]),_meta:{upstreamStatus:error.upstreamStatus}};
  }
}
