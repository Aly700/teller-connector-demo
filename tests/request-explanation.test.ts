import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './d1.ts';
import { createHold, type Hold } from '../packages/gate/holds.ts';
import { holdEvent } from '../packages/gate/events.ts';
import { POLICY_RULES } from '../packages/gate/policy.ts';
import { requestExplanation } from '../apps/mcp/src/request-explanation.ts';

async function savedHold() {
  const f = await fixture();
  return { ...f, hold: await createHold(f.db, f.props, f.input) };
}

function transition(h: Hold, changes: Partial<Hold>, type: string): Hold {
  const next = { ...h, ...changes, version: h.version + 1 };
  next.journal_json = JSON.stringify([...JSON.parse(h.journal_json), holdEvent(next, type)]);
  return next;
}

function journalChange(h: Hold, change: (events: any[]) => void): Hold {
  const events = JSON.parse(h.journal_json);
  change(events);
  return { ...h, journal_json: JSON.stringify(events) };
}

test('plain explanation describes the saved request and the actual ordered historical gate', async () => {
  const { hold } = await savedHold();
  const explanation = requestExplanation(hold);
  assert.match(explanation.paragraph, /\$1\.00 from Operating to Reserve/);
  assert.match(explanation.paragraph, /Transfers need your approval/);
  assert.match(explanation.paragraph, /approv.*send/i);
  assert.match(explanation.paragraph, /reject.*clos/i);
  assert.match(explanation.paragraph, /Teller has received nothing/);
  assert.equal(explanation.receipt, 'not-sent');
  assert.equal(explanation.decisionOpen, true);
  assert.equal(explanation.traceAvailable, true);
  assert.equal(explanation.traceUnavailableReason, null);
  assert.deepEqual(explanation.trace.map(({ rule, status }) => ({ rule, status })), [
    { rule: 'disabled-or-expired', status: 'checked' },
    { rule: 'disallowed-input', status: 'checked' },
    { rule: 'browser-approval', status: 'matched' },
    { rule: 'sample-read', status: 'skipped' },
    { rule: 'default-deny', status: 'skipped' },
  ]);
  assert.deepEqual(explanation.trace.map(row => row.description), POLICY_RULES.map(row => row.description));
  assert.ok(explanation.trace.every(row => row.reason.length > 0));
  assert.match(explanation.source, /Transfers need approval.*version 1/);
  assert.doesNotMatch(explanation.paragraph + explanation.source, /browser-approval|sample-gate|browser session|browser gate/);
  assert.equal(explanation.paragraph, 'The agent asked to move $1.00 from Operating to Reserve. Transfers need your approval, so it is waiting here. Approve to send it to Teller once, or reject to close it without sending. Teller has received nothing yet.');
});

test('explanations use the saved amount and both account directions', async () => {
  const f = await fixture();
  const hold = await createHold(f.db, f.props, { ...f.input, amountMinor: 10000, fromAccount: 'reserve', toAccount: 'operating' });
  assert.match(requestExplanation(hold).paragraph, /\$100\.00 from Reserve to Operating/);
});

test('historical gate is unchanged by later configuration, session, and time changes', async () => {
  const { hold, raw } = await savedHold();
  const before = requestExplanation(hold);
  raw.exec("UPDATE config SET enabled=0, maintenance=1, tools_json='{}'; UPDATE visitors SET revoked=1");
  const originalNow = Date.now;
  try {
    Date.now = () => hold.expires_at + 1000;
    assert.deepEqual(requestExplanation(hold), before);
  } finally { Date.now = originalNow; }
});

test('closed connector decisions never invite approval or rejection', async () => {
  const { hold } = await savedHold();
  for (const status of ['DENIED', 'EXPIRED']) {
    const explanation = requestExplanation(transition(hold, { status }, status));
    assert.equal(explanation.decisionOpen, false);
    assert.equal(explanation.receipt, 'not-sent');
    assert.match(explanation.paragraph, /Teller has received nothing/);
    assert.match(explanation.paragraph, /request is closed|cannot be approved/i);
    assert.doesNotMatch(explanation.paragraph, /approving (?:will |would )?send/i);
  }
});

test('approved and uncertain states describe the open result without a new decision', async () => {
  const { hold } = await savedHold();
  for (const status of ['DISPATCHING', 'OUTCOME_UNKNOWN']) {
    const h = transition(hold, { status, approved_at: Date.now(), approver: hold.visitor_id, attempt_id: crypto.randomUUID() }, status === 'DISPATCHING' ? 'APPROVED' : 'OUTCOME_UNKNOWN');
    const explanation = requestExplanation(h);
    assert.equal(explanation.decisionOpen, false);
    assert.equal(explanation.receipt, 'uncertain');
    assert.match(explanation.paragraph, /receipt|received|reached/i);
    assert.match(explanation.paragraph, /not confirmed|uncertain/i);
    assert.doesNotMatch(explanation.paragraph, /received nothing|nothing was sent/i);
    assert.match(explanation.paragraph, /original request key/i);
  }
});

test('Teller outcomes distinguish posted, held, denied, and upstream rejection', async () => {
  const { hold } = await savedHold();
  const cases = [
    ['POSTED', 'posted', /posted.*ledger/i],
    ['TELLER_HELD', 'received', /Teller.*own.*approval/i],
    ['TELLER_DENIED', 'rejected', /Teller.*denied/i],
    ['UPSTREAM_REJECTED', 'rejected', /upstream.*rejected/i],
  ] as const;
  for (const [status, receipt, text] of cases) {
    const h = transition(hold, { status, send_started_at: Date.now(), teller_id: status === 'UPSTREAM_REJECTED' ? null : crypto.randomUUID() }, status === 'UPSTREAM_REJECTED' ? status : 'RESULT_SAVED');
    const explanation = requestExplanation(h);
    assert.equal(explanation.receipt, receipt);
    assert.equal(explanation.decisionOpen, false);
    assert.match(explanation.paragraph, text);
    assert.doesNotMatch(explanation.paragraph, /received nothing|nothing was sent/i);
    assert.match(explanation.paragraph, /request is closed|cannot be approved/i);
  }
});

test('a saved Teller receipt survives an uncertain final result', async () => {
  const { hold } = await savedHold();
  const h = transition(hold, { status: 'OUTCOME_UNKNOWN', teller_id: crypto.randomUUID() }, 'RESPONSE_SAVED');
  const explanation = requestExplanation(h);
  assert.equal(explanation.receipt, 'received');
  assert.match(explanation.paragraph, /Teller has received/);
  assert.match(explanation.paragraph, /final result.*not confirmed/i);
});

test('send evidence, recovery, or previous uncertain execution never becomes unsent', async () => {
  const { hold } = await savedHold();
  const sent = transition(hold, { status: 'DISPATCHING', send_started_at: Date.now() }, 'SEND_CLAIMED');
  const uncertain = transition(sent, { status: 'OUTCOME_UNKNOWN' }, 'OUTCOME_UNKNOWN');
  const cases = [
    { ...hold, send_started_at: Date.now() },
    { ...hold, replay_count: 1 },
    { ...hold, result_json: '{}' },
    { ...hold, attempt_id: crypto.randomUUID() },
    { ...hold, dispatch_at: Date.now() },
    { ...hold, approved_at: Date.now() },
    { ...hold, error_code: 'OUTCOME_UNKNOWN' },
    transition(sent, { status: 'HELD', send_started_at: null }, 'HELD'),
    transition(uncertain, { status: 'EXPIRED', send_started_at: null }, 'EXPIRED'),
    transition(uncertain, { status: 'DISPATCHING', send_started_at: null, replay_count: 1 }, 'REPLAY_APPROVED'),
    transition(uncertain, { status: 'OUTCOME_UNKNOWN', send_started_at: null, replay_count: 1 }, 'REPLAY_STOPPED_BEFORE_SEND'),
    transition(uncertain, { status: 'OUTCOME_UNKNOWN', send_started_at: null, replay_count: 1 }, 'REPLAY_REJECTED'),
  ];
  for (const h of cases) {
    const explanation = requestExplanation(h);
    assert.equal(explanation.receipt, 'uncertain');
    assert.doesNotMatch(explanation.paragraph, /received nothing|nothing was sent|has not received/i);
  }
});

test('a verified original attempt stopped before the network call can still be unsent', async () => {
  const { hold } = await savedHold();
  const approved = transition(hold, { status: 'DISPATCHING', attempt_id: crypto.randomUUID(), approved_at: Date.now(), approver: hold.visitor_id }, 'APPROVED');
  const claimed = transition(approved, { send_started_at: Date.now() }, 'SEND_CLAIMED');
  const stopped = transition(claimed, { status: 'HELD', attempt_id: null, approved_at: null, approver: null, send_started_at: null }, 'STOPPED_BEFORE_SEND');
  assert.equal(requestExplanation(stopped).receipt, 'not-sent');
});

test('unknown policy versions and mismatched policy rules do not invent gate checks', async () => {
  const { hold } = await savedHold();
  for (const [field, value] of [['policy_version', 'sample-gate-v0'], ['policy_rule', 'other-rule']] as const) {
    const changed = { ...hold, [field]: value };
    changed.journal_json = JSON.stringify([holdEvent(changed, 'HELD', changed.created_at)]);
    const explanation = requestExplanation(changed);
    assert.equal(explanation.traceAvailable, false);
    assert.deepEqual(explanation.trace, []);
    assert.ok(explanation.traceUnavailableReason);
    assert.match(explanation.source, /Unrecognized/);
    assert.ok(!explanation.source.includes(value));
    assert.match(explanation.paragraph, /cannot be verified.*history/i);
  }
});

test('missing, malformed, reordered, and inconsistent history makes the trace unavailable', async () => {
  const { hold } = await savedHold();
  const cases = [
    { ...hold, journal_json: '[]' },
    { ...hold, journal_json: '{' },
    { ...hold, journal_json: '{}' },
    { ...hold, journal_json: '[null]' },
    journalChange(hold, events => { events[0].type = 'APPROVED'; }),
    journalChange(hold, events => { events[0].sequence = 2; }),
    journalChange(hold, events => { events[0].holdId = crypto.randomUUID(); }),
    journalChange(hold, events => { events[0].visitorId = crypto.randomUUID(); }),
    journalChange(hold, events => { events[0].epoch = 'another-epoch'; }),
    journalChange(hold, events => { events[0].requestKey = crypto.randomUUID(); }),
    journalChange(hold, events => { events[0].argumentHash = 'changed'; }),
    journalChange(hold, events => { events[0].policyVersion = 'other'; }),
    journalChange(hold, events => { events[0].policyRule = 'default-deny'; }),
    journalChange(hold, events => { events[0].policyEffect = 'ALLOW'; }),
    journalChange(hold, events => { events[0].tool = 'get_account'; }),
    journalChange(hold, events => { events[0].holdState = 'POSTED'; }),
  ];
  for (const h of cases) {
    const explanation = requestExplanation(h);
    assert.equal(explanation.traceAvailable, false, h.journal_json);
    assert.deepEqual(explanation.trace, []);
    assert.ok(explanation.traceUnavailableReason);
  }
});

test('altered saved arguments and later journal arguments invalidate historical claims', async () => {
  const { hold } = await savedHold();
  const args = JSON.parse(hold.arguments_json);
  const approved = transition(hold, { status: 'DISPATCHING' }, 'APPROVED');
  const cases = [
    { ...hold, arguments_json: JSON.stringify({ ...args, amountMinor: 99 }) },
    { ...hold, arguments_json: JSON.stringify({ ...args, fromAccount: 'reserve', toAccount: 'operating' }) },
    { ...hold, arguments_json: JSON.stringify({ ...args, requestKey: crypto.randomUUID() }) },
    { ...hold, arguments_json: JSON.stringify({ ...args, extra: 'unrecorded' }) },
    { ...hold, arguments_json: '{' },
    journalChange(hold, events => { events[0].arguments.amountMinor = 99; }),
    journalChange(approved, events => { events[1].arguments.amountMinor = 99; }),
  ];
  for (const h of cases) {
    const explanation = requestExplanation(h);
    assert.equal(explanation.traceAvailable, false);
    assert.deepEqual(explanation.trace, []);
    assert.ok(explanation.traceUnavailableReason);
  }
});

test('JSON object ordering does not change the saved request meaning', async () => {
  const { hold } = await savedHold();
  const reordered = Object.fromEntries(Object.entries(JSON.parse(hold.arguments_json)).reverse());
  assert.deepEqual(requestExplanation({ ...hold, arguments_json: JSON.stringify(reordered) }), requestExplanation(hold));
});

test('missing execution history is uncertain rather than evidence that nothing was sent', async () => {
  const { hold } = await savedHold();
  for (const journal_json of ['[]', '{', '[null]']) {
    const explanation = requestExplanation({ ...hold, journal_json });
    assert.equal(explanation.receipt, 'uncertain');
    assert.doesNotMatch(explanation.paragraph, /received nothing|nothing was sent/);
  }
});

test('a mismatched journal receipt cannot invent confirmed Teller receipt', async () => {
  const { hold } = await savedHold();
  const received = transition(hold, { status: 'OUTCOME_UNKNOWN', teller_id: crypto.randomUUID() }, 'RESPONSE_SAVED');
  const damaged = journalChange(received, events => { events[1].arguments.amountMinor = 999; });
  damaged.teller_id = null;
  assert.equal(requestExplanation(damaged).receipt, 'uncertain');
});
