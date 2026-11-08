// Teller demo load profile. It creates synthetic accounts and ledger entries only.
// Usage:
//   BASE_URL=http://<host>:8080 API_KEY=... CONFIRM_DEMO_TARGET=true k6 run load/transfers.js
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';

const transferLatency = new Trend('transfer_latency_ms', true);
const baseUrl = (__ENV.BASE_URL || '').replace(/\/$/, '');
const apiKey = __ENV.API_KEY || '';
const jsonHeaders = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

export const options = {
  scenarios: {
    mixed_transfers: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 20, duration: '20s' },
        { target: 50, duration: '30s' },
        { target: 50, duration: '30s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    transfer_latency_ms: ['p(99)<1000'],
  },
};

export function setup() {
  if (!baseUrl || !apiKey) {
    fail('BASE_URL and API_KEY are required');
  }
  if (__ENV.CONFIRM_DEMO_TARGET !== 'true') {
    fail('Set CONFIRM_DEMO_TARGET=true only for an isolated Teller demo environment');
  }

  const runId = `${Date.now()}`;
  const policy = postJson('/policies', { name: `k6-transfer-${runId}`, version: 1 });
  postJson(`/policies/${policy.id}/rules`, {
    toolNameGlob: 'ledger.transfer', amountMin: 10001, currency: 'USD', effect: 'DENY', precedence: 10,
  });
  postJson(`/policies/${policy.id}/rules`, {
    toolNameGlob: 'ledger.transfer', fourEyesAbove: 5000, currency: 'USD',
    effect: 'REQUIRE_APPROVAL', precedence: 20,
  });
  postJson(`/policies/${policy.id}/rules`, {
    toolNameGlob: 'ledger.transfer', amountMax: 5000, currency: 'USD', effect: 'ALLOW', precedence: 30,
  });

  const source = postJson('/accounts', { currency: 'USD' });
  const destination = postJson('/accounts', { currency: 'USD' });
  postJson(`/accounts/${source.id}/deposits`, {
    amountMinor: Number(__ENV.FUNDING_MINOR || 50000000),
  });
  return { runId, sourceId: source.id, destinationId: destination.id };
}

export default function (data) {
  const cases = [
    { amountMinor: 4000, expected: 'POSTED' },
    { amountMinor: 6000, expected: 'HELD' },
    { amountMinor: 12000, expected: 'DENIED' },
  ];
  const selected = cases[(__VU + __ITER) % cases.length];
  const response = http.post(
    `${baseUrl}/transfers`,
    JSON.stringify({
      fromAccountId: data.sourceId,
      toAccountId: data.destinationId,
      amountMinor: selected.amountMinor,
      currency: 'USD',
      initiatedBy: `k6-maker-${__VU}`,
    }),
    {
      headers: {
        ...jsonHeaders,
        'Idempotency-Key': `k6-${data.runId}-${__VU}-${__ITER}-${Date.now()}`,
      },
    },
  );
  transferLatency.add(response.timings.duration);
  check(response, {
    'transfer created': (result) => result.status === 201,
    [`state is ${selected.expected}`]: (result) => result.json('state') === selected.expected,
  });
}

function postJson(path, body) {
  const response = http.post(`${baseUrl}${path}`, JSON.stringify(body), { headers: jsonHeaders });
  if (response.status !== 200 && response.status !== 201) {
    fail(`setup request ${path} failed with ${response.status}: ${response.body}`);
  }
  return response.json();
}
