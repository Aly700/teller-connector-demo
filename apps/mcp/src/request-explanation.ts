import type { Hold } from '../../../packages/gate/holds.ts';
import { POLICY_RULES, POLICY_VERSION } from '../../../packages/gate/policy.ts';
import { policyVersionLabel, ruleTitle } from './policy-display.ts';

export interface RequestExplanation {
  paragraph: string;
  source: string;
  trace: { rule: string; description: string; status: 'checked' | 'matched' | 'skipped'; reason: string }[];
  traceAvailable: boolean;
  traceUnavailableReason: string | null;
  receipt: 'not-sent' | 'uncertain' | 'received' | 'posted' | 'rejected';
  decisionOpen: boolean;
}

type RecordValue = Record<string, unknown>;
type Arguments = { fromAccount: string; toAccount: string; amountMinor: number; currency: 'CAD'; requestKey: string };

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function argumentsOf(value: unknown): Arguments | null {
  if (!record(value) || Object.keys(value).length !== 5 ||
    !['operating', 'reserve'].includes(String(value.fromAccount)) ||
    !['operating', 'reserve'].includes(String(value.toAccount)) ||
    value.fromAccount === value.toAccount || value.currency !== 'CAD' ||
    typeof value.amountMinor !== 'number' || !Number.isInteger(value.amountMinor) ||
    value.amountMinor < 1 || value.amountMinor > 10000 || typeof value.requestKey !== 'string') return null;
  return value as Arguments;
}

function sameArguments(value: unknown, args: Arguments): boolean {
  const saved = argumentsOf(value);
  return saved !== null && (Object.keys(args) as (keyof Arguments)[]).every(key => saved[key] === args[key]);
}

// The version and ordered rule fingerprint pin the semantics used to infer the
// historical first-match path. A new policy must be explicitly reviewed here.
// No current configuration or evaluate() call can recreate a historical decision.
const historicalPolicyKnown = POLICY_VERSION === 'sample-gate-v1' &&
  POLICY_RULES.map(rule => `${rule.precedence}:${rule.rule}:${rule.effect}`).join('|') ===
  '10:disabled-or-expired:DENY|20:disallowed-input:DENY|30:browser-approval:REQUIRE_APPROVAL|40:sample-read:ALLOW|50:default-deny:DENY';

function historicalEvidence(h: Hold, args: Arguments | null, events: RecordValue[] | null): string | null {
  if (!args || args.requestKey !== h.request_key) return 'The saved request arguments are missing or inconsistent.';
  const body = parse(h.body_json);
  if (!record(body) || body.amountMinor !== args.amountMinor || body.currency !== args.currency ||
    body.initiatedBy !== `sample:${h.visitor_id}` || typeof body.fromAccountId !== 'string' ||
    typeof body.toAccountId !== 'string' || body.fromAccountId === body.toAccountId) {
    return 'The saved transfer body does not match the request arguments.';
  }
  if (!events?.length) return 'The original HELD event is missing or unreadable.';
  const first = events[0];
  if (first.type !== 'HELD' || first.holdState !== 'HELD' || first.sequence !== 1 ||
    first.approver !== null || first.approvedAt !== null || first.attemptId !== null ||
    first.replayCount !== 0 || first.tellerTransferId !== null) return 'The first recorded event is not a valid original HELD event.';
  if (events.length !== h.version + 1 || events.at(-1)?.holdState !== h.status) {
    return 'The recorded history does not match the saved request state.';
  }
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1 || event.holdId !== h.id || event.visitorId !== h.visitor_id ||
      event.epoch !== h.epoch || event.requestKey !== h.request_key || event.argumentHash !== h.body_hash ||
      event.policyVersion !== h.policy_version || event.policyRule !== h.policy_rule ||
      event.policyEffect !== 'REQUIRE_APPROVAL' || event.tool !== 'request_transfer' ||
      !sameArguments(event.arguments, args)) return 'The recorded history does not match the saved request, arguments, or policy.';
  }
  return null;
}

function receiptOf(h: Hold, events: RecordValue[] | null, historyValid: boolean): RequestExplanation['receipt'] {
  if (h.status === 'POSTED') return 'posted';
  if (h.status === 'TELLER_DENIED' || h.status === 'UPSTREAM_REJECTED') return 'rejected';
  if (h.teller_id || h.status === 'TELLER_HELD') return 'received';
  // A receipt remains evidence even if a later attempt clears the send marker.
  if (historyValid && events?.some(event => event.holdId === h.id && event.requestKey === h.request_key &&
    event.argumentHash === h.body_hash && typeof event.tellerTransferId === 'string' &&
    event.tellerTransferId.length > 0 && ['RESPONSE_SAVED', 'RESULT_SAVED'].includes(String(event.type)))) return 'received';
  if (!historyValid || h.send_started_at !== null || h.replay_count > 0 || h.result_json !== null ||
    h.attempt_id !== null || h.dispatch_at !== null || h.approved_at !== null || h.approver !== null ||
    h.error_code === 'OUTCOME_UNKNOWN' ||
    !['HELD', 'DENIED', 'EXPIRED'].includes(h.status)) return 'uncertain';
  let claimed = false;
  let earlierOutcomeUncertain = false;
  for (const event of events ?? []) {
    if (event.type === 'SEND_CLAIMED') claimed = true;
    else if (event.type === 'STOPPED_BEFORE_SEND' && event.replayCount === 0 &&
      event.attemptId === null && ['HELD', 'EXPIRED'].includes(String(event.holdState))) {
      // Dispatch records this only when the original invocation never called
      // upstream. It cannot erase an earlier uncertain result or a replay.
      claimed = false;
    } else if (!['HELD', 'APPROVED', 'DENIED', 'EXPIRED', 'SESSION_REPLACED'].includes(String(event.type))) {
      earlierOutcomeUncertain = true;
    }
  }
  return claimed || earlierOutcomeUncertain ? 'uncertain' : 'not-sent';
}

function receiptWords(h: Hold, receipt: RequestExplanation['receipt']): string {
  switch (receipt) {
    case 'not-sent': return 'Teller has received nothing yet.';
    case 'posted': return 'Teller received the transfer and posted it in its ledger.';
    case 'rejected': return h.status === 'TELLER_DENIED'
      ? 'Teller received the transfer and denied it under its own policy; it was not posted.'
      : 'The upstream boundary rejected this request. No successful transfer is confirmed, and it will not retry automatically.';
    case 'received': return h.status === 'TELLER_HELD'
      ? 'Teller has received the transfer and is waiting for its own payment-policy approval; it has not been confirmed as posted.'
      : 'Teller has received the transfer, but its final result is not confirmed. Keep the original request key when checking the result.';
    case 'uncertain': return 'Teller receipt is not confirmed; an earlier attempt may have reached Teller. Keep the original request key when checking the result.';
  }
}

/** Plain text only; callers must escape it when rendering HTML. */
export function requestExplanation(h: Hold): RequestExplanation {
  const args = argumentsOf(parse(h.arguments_json));
  const journal = parse(h.journal_json);
  const events = Array.isArray(journal) && journal.every(record) ? journal : null;
  const historyError = historicalEvidence(h, args, events);
  const traceUnavailableReason = historyError ??
    (!historicalPolicyKnown || h.policy_version !== 'sample-gate-v1'
      ? 'The ordered rules for this saved policy version are not available.'
      : h.policy_rule !== 'browser-approval'
        ? 'The saved rule does not match the approval rule in this policy version.' : null);
  const trace: RequestExplanation['trace'] = traceUnavailableReason ? [] : POLICY_RULES.map(rule => ({
    rule: rule.rule,
    description: rule.description,
    status: rule.precedence < 30 ? 'checked' : rule.precedence === 30 ? 'matched' : 'skipped',
    reason: rule.precedence < 30
      ? rule.precedence === 10
        ? 'The connection and this session were active.'
        : 'The saved amount, accounts and request key were allowed.'
      : rule.precedence === 30
        ? 'Matched. This transfer needed your approval before it could be sent.'
        : 'Skipped. The approval rule had already matched, so no later rules were checked.',
  }));
  const receipt = receiptOf(h, events, historyError === null);
  const decisionOpen = h.status === 'HELD' && receipt === 'not-sent';
  const request = args
    ? `The agent asked to move $${(args.amountMinor / 100).toFixed(2)} from ${args.fromAccount === 'operating' ? 'Operating' : 'Reserve'} to ${args.toAccount === 'operating' ? 'Operating' : 'Reserve'}.`
    : 'The saved request amount and accounts cannot be read reliably.';
  const why = traceUnavailableReason
    ? 'The reason for the saved hold cannot be verified from its history.'
    : decisionOpen
      ? 'Transfers need your approval, so it is waiting here.'
      : 'Transfers need your approval, so it waited for your decision.';
  const decision = decisionOpen
    ? 'Approve to send it to Teller once, or reject to close it without sending.'
    : h.status === 'HELD'
      ? 'The hold is still marked open, but the earlier execution evidence needs review before a new approval or rejection.'
      : h.status === 'DENIED'
        ? 'You rejected it. This request is closed.'
        : h.status === 'EXPIRED'
          ? 'Approval expired. This request is closed.'
          : h.approved_at && historyError === null
            ? 'You approved it. This request cannot be approved again.'
            : 'This request cannot be approved or rejected again.';
  return {
    paragraph: `${request} ${why} ${decision} ${receiptWords(h, receipt)}`,
    source: `Source: saved request · ${ruleTitle(h.policy_rule)}, ${policyVersionLabel(h.policy_version)}.`,
    trace, traceAvailable: traceUnavailableReason === null, traceUnavailableReason, receipt, decisionOpen,
  };
}
