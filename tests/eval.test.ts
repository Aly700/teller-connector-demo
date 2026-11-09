import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCases, exact, parseSelection, runEval } from "../eval/run.ts";
import { StubProvider } from "./stub-provider.ts";
import { fixtureRuntime } from "../eval/runtime.ts";
import { reserveRun, publishReport, reportPage } from "../eval/report.ts";
import { fixture } from "./d1.ts";

test("frozen corpus has the exact family, fault and post-hold allocations", () => {
  const cases = loadCases();
  assert.equal(cases.length, 80);
  assert.equal(new Set(cases.map((c) => c.id)).size, 80);
  const counts = cases.reduce(
    (a, c) => {
      const k = c.family + ":" + c.kind;
      a[k] = (a[k] ?? 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  );
  assert.deepEqual(counts, {
    "list_accounts:read": 12,
    "list_accounts:refuse": 4,
    "get_account:read": 12,
    "get_account:refuse": 4,
    "get_transfer:read": 10,
    "get_transfer:refuse": 6,
    "request_transfer:refuse": 12,
    "request_transfer:hold": 20,
  });
  assert.equal(cases.filter((c) => c.fault).length, 6);
  assert.deepEqual(
    cases
      .filter((c) => c.kind === "hold")
      .reduce(
        (a, c) => {
          a[c.after!] = (a[c.after!] ?? 0) + 1;
          return a;
        },
        {} as Record<string, number>,
      ),
    { approve: 6, deny: 4, expire: 4, race: 3, failure: 3 },
  );
});
test("exact matching rejects types, extra keys, multiple tools, malformed and missing output", () => {
  assert.ok(exact({ b: 2, a: 1 }, { a: 1, b: 2 }));
  assert.ok(!exact({ a: 1 }, { a: "1" }));
  assert.ok(!exact({ a: 1 }, { a: 1, b: 2 }));
  for (const content of [
    [],
    [{ type: "tool_use", name: "unknown", input: {} }],
    [{ type: "text", text: "no" }],
    [{ type: "text", text: '{"refusal":"X","extra":1}' }],
    [
      { type: "tool_use", name: "get_account", input: {} },
      { type: "tool_use", name: "get_account", input: {} },
    ],
  ])
    assert.equal(parseSelection(content).valid, false);
  assert.deepEqual(
    parseSelection([{ type: "text", text: '{"refusal":"REAL_DATA"}' }])
      .selection,
    { refusal: "REAL_DATA" },
  );
});
test("test-only provider exercises full corpus, failures and invalid output without a publishable score", async () => {
  const cases = loadCases(),
    provider = new StubProvider();
  const report = await runEval(cases, provider, fixtureRuntime(), {
    revision: "0".repeat(40),
    trigger: "manual",
  });
  assert.equal(report.kind, "stub");
  assert.equal(report.results.length, 80);
  assert.equal(report.results.filter((r) => r.pass).length, 80);
  const bad = await runEval(
    cases,
    new StubProvider({
      "list-01": "wrong",
      "list-02": "invalid",
      "list-03": "rejection",
    }),
    fixtureRuntime(),
    { revision: "0".repeat(40), trigger: "manual" },
  );
  assert.equal(bad.results.filter((r) => r.pass).length, 77);
  assert.equal(bad.results.filter((r) => r.invalid).length, 2);
  const f = await fixture();
  await assert.rejects(publishReport(f.db, bad), /REAL_RUN_REQUIRED/);
  const html = await (await reportPage(f.db)).text();
  assert.match(html, /Not run yet/);
  assert.doesNotMatch(html, /77\/80|100%/);
});
test("spend reservation is atomic, monthly capped, and failures keep their reservation", async () => {
  const f = await fixture();
  for (let i = 0; i < 20; i++) await reserveRun(f.db, "model-test", "manual");
  await assert.rejects(reserveRun(f.db, "model-test", "manual"), /MONTHLY_CAP/);
  assert.equal(
    f.raw.prepare("SELECT SUM(reserved_microusd) n FROM eval_runs").get()!.n,
    2000000,
  );
});
test("reports are empty before real evidence, stale after 36 hours, retained 30 days, and cannot fabricate a completion", async () => {
  const f = await fixture();
  assert.match(await (await reportPage(f.db)).text(), /Not run yet/);
  const r = await runEval(loadCases(), new StubProvider(), fixtureRuntime(), {
    revision: "0".repeat(40),
    trigger: "scheduled",
  });
  await assert.rejects(
    publishReport(f.db, { ...r, kind: "model" }),
    /RESERVATION_REQUIRED/,
  );
  const reservation = await reserveRun(
    f.db,
    "model-test",
    "scheduled",
    Date.now() - 37 * 3600000,
  );
  await publishReport(f.db, {
    ...r,
    kind: "model",
    runtime: "local-real-teller",
    id: reservation.id,
    startedAt: reservation.startedAt,
    model: "model-test",
    completedAt: reservation.startedAt,
  });
  const html = await (
    await reportPage(
      f.db,
      false,
      Date.now(),
      "<section>Frozen case catalog</section>",
    )
  ).text();
  assert.match(html, /Frozen case catalog/);
  assert.match(html, /Stale/);
  assert.match(html, /80\/80/);
  await assert.rejects(
    publishReport(f.db, {
      ...r,
      kind: "model",
      runtime: "local-real-teller",
      id: reservation.id,
      startedAt: reservation.startedAt,
      model: "model-test",
      completedAt: reservation.startedAt,
    }),
    /IMMUTABLE_REPORT/,
  );
  assert.ok(await reserveRun(f.db, "model-test", "manual"));
  const { retainReports } = await import("../eval/report.ts");
  await retainReports(f.db, Date.now() + 31 * 86400000);
  assert.match(
    await (await reportPage(f.db, false, Date.now() + 31 * 86400000)).text(),
    /Not run yet/,
  );
});
