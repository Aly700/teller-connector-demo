import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ACCOUNTS, type AccountAlias } from '../../../packages/sample.ts';
import type { Registry, SessionProps } from '../../../packages/state.ts';
import { transferInput, type Hold } from '../../../packages/gate/holds.ts';
import { TOOL_DAY_LIMIT, TOOL_DAY_MS, TOOL_MINUTE_LIMIT, TOOL_MINUTE_MS } from '../../../packages/limits.ts';
import { accountSchema, transferSchema } from './teller.ts';

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identitiesSchema = z.strictObject({ operating: z.uuid(), reserve: z.uuid() }).refine(a => a.operating !== a.reserve);
const observationSchema = z.strictObject({
  account: z.enum(ACCOUNTS), id: z.uuid(), currency: z.literal('CAD'),
  ledgerBalanceMinor: money, availableBalanceMinor: money, version: money,
}).refine(a => a.availableBalanceMinor <= a.ledgerBalanceMinor);
const observedTimeSchema = z.iso.datetime({ offset: true });
const requestBodySchema = z.strictObject({
  fromAccountId: z.uuid(), toAccountId: z.uuid(),
  amountMinor: money.positive().max(10000), currency: z.literal('CAD'), initiatedBy: z.string(),
});
const accountRead = (name: string) => name === 'list_sample_accounts' || name === 'get_sample_account';
type AccountIdentities = z.infer<typeof identitiesSchema>;

export type AccountObservation = z.infer<typeof observationSchema>;
export interface ObservedBalance extends AccountObservation { eventId: string; occurredAt: string }
export interface PostedTransferMarker {
  id: string; holdId: string; reference: string; occurredAt: string;
  fromAccount: AccountAlias; toAccount: AccountAlias; amountMinor: number; currency: 'CAD';
}
export interface AccountTransferMarker extends PostedTransferMarker { direction: 'in' | 'out'; deltaMinor: number }
export interface AccountInsights {
  account: AccountAlias; id: string | null; currency: 'CAD';
  source: 'audit_account_observations';
  observations: ObservedBalance[]; markers: AccountTransferMarker[];
  latest: ObservedBalance | null; observationCount: number;
  historyState: 'empty' | 'single' | 'multiple';
  firstObservedAt: string | null; latestObservedAt: string | null;
  gaps: { beforeFirstObservation: boolean; betweenObservations: boolean; afterLatestObservation: boolean };
}
export interface RequestCounts {
  total: number; awaitingApproval: number; dispatching: number; outcomeUnknown: number;
  posted: number; denied: number; tellerHeld: number; tellerDenied: number;
  upstreamRejected: number; expired: number; other: number;
}
export interface ToolBudgetWindow { used: number; limit: number; remaining: number; resetsAt: string }
export interface ToolBudget { asOf: string; visitorMinute: ToolBudgetWindow; sharedUtcDay: ToolBudgetWindow }
export interface SessionInsights {
  asOf: string; accounts: AccountInsights[]; postedTransfers: PostedTransferMarker[];
  requestCounts: RequestCounts; budget: ToolBudget;
  sources: { auditEvents: number; observedEvents: number; legacyReadEvents: number; invalidObservationEvents: number; invalidPostedTransfers: number };
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function identities(registry: Registry | null, props: SessionProps): AccountIdentities | null {
  if (!registry || registry.visitor_id !== props.visitorId || registry.epoch !== props.epoch) return null;
  const parsed = identitiesSchema.safeParse(parseJson(registry.accounts_json));
  return parsed.success ? parsed.data : null;
}

/** Whitelist only validated balances; the containing audit event owns their observed time. */
export function extractAccountObservations(
  name: string, result: CallToolResult, registry: Registry | null, props: SessionProps,
): AccountObservation[] {
  const ids = identities(registry, props);
  if (!ids || result.isError || !accountRead(name) || !object(result.structuredContent)) return [];
  const values = name === 'list_sample_accounts' ? result.structuredContent.accounts : [result.structuredContent];
  if (!Array.isArray(values) || values.length !== (name === 'list_sample_accounts' ? 2 : 1)) return [];
  const observations: AccountObservation[] = [];
  for (const value of values) {
    if (!object(value)) return [];
    const parsed = accountSchema.safeParse({
      id: value.id, currency: value.currency, status: value.status,
      ledgerBalanceMinor: value.ledgerBalanceMinor, availableBalanceMinor: value.availableBalanceMinor,
      version: value.version, createdAt: value.createdAt,
    });
    const alias = z.enum(ACCOUNTS).safeParse(value.account);
    if (!parsed.success || !alias.success || parsed.data.id !== ids[alias.data] || observations.some(a => a.account === alias.data)) return [];
    observations.push({ account: alias.data, id: parsed.data.id, currency: parsed.data.currency,
      ledgerBalanceMinor: parsed.data.ledgerBalanceMinor, availableBalanceMinor: parsed.data.availableBalanceMinor, version: parsed.data.version });
  }
  return observations;
}

/** Reads the same windows and scopes used by consumeTool; viewing this data consumes no calls. */
export async function getToolBudget(db: D1Database, props: SessionProps, now = Date.now()): Promise<ToolBudget> {
  const minute = Math.floor(now / TOOL_MINUTE_MS), day = Math.floor(now / TOOL_DAY_MS);
  const scope = `visitor:${props.epoch}:${props.visitorId}`;
  const rows = await db.prepare("SELECT scope,count FROM tool_limits WHERE (scope=? AND window=?) OR (scope='global' AND window=?)")
    .bind(scope, minute, day).all<{ scope: string; count: number }>();
  const window = (key: string, limit: number, resetsAt: number): ToolBudgetWindow => {
    const used = rows.results.find(row => row.scope === key)?.count ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used), resetsAt: new Date(resetsAt).toISOString() };
  };
  return { asOf: new Date(now).toISOString(),
    visitorMinute: window(scope, TOOL_MINUTE_LIMIT, (minute + 1) * TOOL_MINUTE_MS),
    sharedUtcDay: window('global', TOOL_DAY_LIMIT, (day + 1) * TOOL_DAY_MS) };
}

interface AuditRow { id: string; occurred_at: number; visitor_id: string; epoch: string; tool: string | null; code: string; event_json: string | null }
function persistedObservations(row: AuditRow, event: Record<string, unknown>, ids: AccountIdentities | null, props: SessionProps, now: number): ObservedBalance[] | null {
  if (!ids || event.visitorId !== props.visitorId || event.epoch !== props.epoch ||
      row.visitor_id !== props.visitorId || row.epoch !== props.epoch ||
      !z.uuid().safeParse(event.eventId).success || event.eventId !== row.id ||
      event.type !== 'READ_OK' || row.code !== 'READ_OK' || event.tool !== row.tool || !accountRead(String(event.tool)) ||
      !observedTimeSchema.safeParse(event.occurredAt).success) return null;
  const occurredAt = event.occurredAt as string, time = Date.parse(occurredAt);
  if (!Number.isFinite(time) || time !== row.occurred_at || time > now) return null;
  const values = event.accountObservations;
  if (!Array.isArray(values) || values.length !== (event.tool === 'list_sample_accounts' ? 2 : 1)) return null;
  const observations: ObservedBalance[] = [];
  for (const value of values) {
    const parsed = observationSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== ids[parsed.data.account] || observations.some(a => a.account === parsed.data.account)) return null;
    observations.push({ ...parsed.data, eventId: row.id, occurredAt });
  }
  return observations;
}

function postedMarker(h: Hold, registry: Registry | null, ids: AccountIdentities | null, props: SessionProps, now: number): PostedTransferMarker | null {
  if (!registry || !ids || h.visitor_id !== props.visitorId || h.epoch !== props.epoch || h.pool_id !== registry.pool_id || h.status !== 'POSTED') return null;
  const result = transferSchema.safeParse(parseJson(h.result_json));
  const body = requestBodySchema.safeParse(parseJson(h.body_json));
  const args = transferInput.safeParse(parseJson(h.arguments_json));
  if (!result.success || !body.success || !args.success || !z.uuid().safeParse(h.id).success || !/^request-[1-5]$/.test(h.reference)) return null;
  const value = result.data, request = body.data, input = args.data;
  if (value.state !== 'POSTED' || value.id !== h.teller_id || value.postedAt === null || value.reversedAt !== null ||
      value.fromAccountId !== request.fromAccountId || value.toAccountId !== request.toAccountId ||
      value.amountMinor !== request.amountMinor || value.currency !== request.currency ||
      request.fromAccountId !== ids[input.fromAccount] || request.toAccountId !== ids[input.toAccount] ||
      request.amountMinor !== input.amountMinor || request.currency !== input.currency ||
      request.initiatedBy !== `sample:${props.visitorId}` || input.requestKey !== h.request_key ||
      Date.parse(value.postedAt) < Date.parse(value.createdAt) || Date.parse(value.postedAt) > now) return null;
  return { id: value.id, holdId: h.id, reference: h.reference, occurredAt: value.postedAt,
    fromAccount: input.fromAccount, toAccount: input.toAccount, amountMinor: value.amountMinor, currency: value.currency };
}

const statusBuckets: Record<string, Exclude<keyof RequestCounts, 'total'>> = {
  HELD: 'awaitingApproval', DISPATCHING: 'dispatching', OUTCOME_UNKNOWN: 'outcomeUnknown',
  POSTED: 'posted', DENIED: 'denied', TELLER_HELD: 'tellerHeld', TELLER_DENIED: 'tellerDenied',
  UPSTREAM_REJECTED: 'upstreamRejected', EXPIRED: 'expired',
};

/** No upstream reads, synthetic anchors, balance reconstruction, or request state mutations. */
export async function getSessionInsights(db: D1Database, props: SessionProps, now = Date.now()): Promise<SessionInsights> {
  const [registry, audit, holds, budget] = await Promise.all([
    db.prepare('SELECT * FROM sample_registry WHERE visitor_id=? AND epoch=?').bind(props.visitorId, props.epoch).first<Registry>(),
    db.prepare('SELECT id,occurred_at,visitor_id,epoch,tool,code,event_json FROM audit_events WHERE visitor_id=? AND epoch=? AND occurred_at<=? ORDER BY occurred_at,id').bind(props.visitorId, props.epoch, now).all<AuditRow>(),
    db.prepare('SELECT * FROM holds WHERE visitor_id=? AND epoch=? ORDER BY created_at,id').bind(props.visitorId, props.epoch).all<Hold>(),
    getToolBudget(db, props, now),
  ]);
  const ids = identities(registry, props);
  const sources: SessionInsights['sources'] = { auditEvents: audit.results.length, observedEvents: 0, legacyReadEvents: 0, invalidObservationEvents: 0, invalidPostedTransfers: 0 };
  const observations: ObservedBalance[] = [];
  for (const row of audit.results) {
    const event = parseJson(row.event_json);
    if (!object(event)) {
      if (accountRead(row.tool ?? '') && row.code === 'READ_OK') {
        if (row.event_json === null) sources.legacyReadEvents++;
        else sources.invalidObservationEvents++;
      }
      continue;
    }
    if (event.accountObservations === undefined) {
      if (accountRead(row.tool ?? '') && row.code === 'READ_OK') sources.legacyReadEvents++;
      continue;
    }
    if (Array.isArray(event.accountObservations) && event.accountObservations.length === 0 && !(accountRead(row.tool ?? '') && row.code === 'READ_OK')) continue;
    const values = persistedObservations(row, event, ids, props, now);
    if (!values) sources.invalidObservationEvents++;
    else { sources.observedEvents++; observations.push(...values); }
  }
  const requestCounts: RequestCounts = { total: holds.results.length, awaitingApproval: 0, dispatching: 0, outcomeUnknown: 0, posted: 0, denied: 0, tellerHeld: 0, tellerDenied: 0, upstreamRejected: 0, expired: 0, other: 0 };
  const markers = new Map<string, { marker: PostedTransferMarker; count: number; conflict: boolean }>();
  for (const hold of holds.results) {
    requestCounts[statusBuckets[hold.status] ?? 'other']++;
    if (hold.status !== 'POSTED') continue;
    const marker = postedMarker(hold, registry, ids, props, now);
    if (!marker) sources.invalidPostedTransfers++;
    else {
      const existing = markers.get(marker.id);
      if (!existing) markers.set(marker.id, { marker, count: 1, conflict: false });
      else {
        existing.count++;
        const previous = existing.marker;
        existing.conflict ||= previous.fromAccount !== marker.fromAccount || previous.toAccount !== marker.toAccount ||
          previous.amountMinor !== marker.amountMinor || previous.currency !== marker.currency ||
          Date.parse(previous.occurredAt) !== Date.parse(marker.occurredAt);
      }
    }
  }
  const postedTransfers = [...markers.values()].flatMap(group => {
    if (group.conflict) { sources.invalidPostedTransfers += group.count; return []; }
    return [group.marker];
  }).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id));
  const accounts: AccountInsights[] = ACCOUNTS.map(account => {
    const points = observations.filter(point => point.account === account);
    const latest = points.at(-1) ?? null;
    return { account, id: ids?.[account] ?? null, currency: 'CAD', source: 'audit_account_observations',
      observations: points, latest, observationCount: points.length,
      historyState: points.length === 0 ? 'empty' : points.length === 1 ? 'single' : 'multiple',
      firstObservedAt: points[0]?.occurredAt ?? null, latestObservedAt: latest?.occurredAt ?? null,
      // Reads are discrete samples: none establish balances outside their own timestamps.
      gaps: { beforeFirstObservation: points.length > 0, betweenObservations: points.length > 1, afterLatestObservation: latest !== null && Date.parse(latest.occurredAt) < now },
      markers: postedTransfers.filter(marker => marker.fromAccount === account || marker.toAccount === account).map(marker => ({ ...marker, direction: marker.fromAccount === account ? 'out' : 'in', deltaMinor: marker.fromAccount === account ? -marker.amountMinor : marker.amountMinor })),
    };
  });
  return { asOf: new Date(now).toISOString(), accounts, postedTransfers, requestCounts, sources, budget };
}
