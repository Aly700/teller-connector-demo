import { test } from "node:test";
import assert from "node:assert/strict";
import { page } from "../packages/http.ts";
import * as policy from "../packages/gate/policy.ts";

test("every console page has job navigation, workspace search and breadcrumbs", async () => {
  const html = await page(
    "<h1>Requests</h1>",
    200,
    new Headers(),
    undefined,
    "queue",
  ).text();
  for (const label of [
    "Operate",
    "Overview",
    "Requests",
    "Accounts",
    "Govern",
    "Policies",
    "Audit trail",
    "Quality",
    "Evaluation",
    "Developers",
    "Tools",
    "Connection",
    "Settings",
    "Search this session",
    "Breadcrumb",
  ])
    assert.ok(html.includes(label), label);
  assert.equal((html.match(/Sample data\. No real money\./g) || []).length, 1);
  assert.ok(html.includes('aria-current="page"'));
});

test("policy catalog is the exact ordered first-match gate including default deny", () => {
  const rules = (policy as any).POLICY_RULES;
  assert.ok(Array.isArray(rules));
  assert.deepEqual(
    rules.map((r: any) => r.rule),
    [
      "disabled-or-expired",
      "disallowed-input",
      "browser-approval",
      "sample-read",
      "default-deny",
    ],
  );
  for (const [tool, enabled, allowed, currentEpoch, expected] of [
    ["request_sample_transfer", false, true, true, "disabled-or-expired"],
    ["request_sample_transfer", true, false, true, "disallowed-input"],
    ["request_sample_transfer", true, true, true, "browser-approval"],
    ["get_sample_account", true, true, true, "sample-read"],
    ["unknown", true, true, true, "default-deny"],
  ] as const)
    assert.equal(
      policy.evaluate(tool, enabled, allowed, currentEpoch).rule,
      expected,
    );
});
