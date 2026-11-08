import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture } from "./d1.ts";
import { productPage } from "../apps/mcp/src/product.ts";
import { detailPage } from "../apps/mcp/src/pages.ts";
import { consoleIndex } from "../apps/mcp/src/console-data.ts";
import { emptyEvent, saveEvent } from "../apps/mcp/src/audit.ts";
import { evaluationCatalog } from "../apps/mcp/src/catalog.ts";
import { reportPage } from "../eval/report.ts";
import { tools } from "../apps/mcp/src/tools.ts";
import { createHold, mutate } from "../packages/gate/holds.ts";
import { escapeHtml } from "../packages/http.ts";
import type { ConnectionMetadata, Env } from "../apps/mcp/src/auth.ts";

const origin = "http://localhost:8787";
const sections = [
  "overview",
  "policies",
  "tools",
  "connection",
  "settings",
  "settings/connection",
  "settings/preferences",
  "search",
];
const request = (cookie: string, path: string) =>
  new Request(origin + path, {
    headers: { Cookie: "__Host-sample-session=" + cookie },
  });
const envFor = (db: D1Database, metadata: ConnectionMetadata | null = null) =>
  ({
    DB: db,
    PUBLIC_ORIGIN: origin,
    AUTH_SERVER: {
      async getConnectionMetadata() {
        return metadata;
      },
    },
  }) as unknown as Env;

test("every product route requires the current browser session, not a bearer or stale cookie", async () => {
  const f = await fixture();
  try {
    const env = envFor(f.db);
    env.AUTH_SERVER.getConnectionMetadata = async () => {
      assert.fail("Unauthenticated pages must not inspect connection metadata");
    };
    for (const section of sections) {
      const credentials: Record<string, string>[] = [
        {},
        { Authorization: "Bearer " + f.cookie },
        { Cookie: "__Host-sample-session=invalid" },
      ];
      for (const headers of credentials) {
        const response = await productPage(
          new Request(origin + "/" + section, { headers }),
          env,
          section,
        );
        assert.equal(response.status, 401, section);
        assert.match(await response.text(), /Open your sample session/);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
      }
    }
    for (const mutation of [
      "UPDATE visitors SET revoked=1",
      "UPDATE visitors SET revoked=0,expires_at=0",
    ]) {
      f.raw.exec(mutation);
      for (const section of sections)
        assert.equal(
          (await productPage(request(f.cookie, "/" + section), env, section))
            .status,
          401,
          section,
        );
    }
  } finally {
    f.raw.close();
  }
});

test("settings and developer routes have working secondary navigation and honest session details", async () => {
  const f = await fixture();
  try {
    for (const section of [
      "settings",
      "settings/preferences",
      "settings/connection",
      "tools",
      "connection",
    ]) {
      const response = await productPage(
        request(f.cookie, "/" + section),
        envFor(f.db),
        section,
      );
      const html = await response.text();
      assert.equal(response.status, 200, section);
      assert.equal(
        (html.match(/Sample data\. No real money\./g) ?? []).length,
        1,
      );
      const links = section.startsWith("settings")
        ? ["/settings", "/settings/connection", "/settings/preferences"]
        : ["/tools", "/connection"];
      for (const link of links)
        assert.ok(html.includes(`href="${link}"`), `${section}: ${link}`);
      assert.ok(
        html.includes(`href="/${section}" aria-current="page"`),
        section,
      );
      if (section === "settings") {
        assert.match(html, /<h1>General<\/h1>/);
        assert.match(html, /Danger zone/);
        assert.match(html, /href="\/session\/end"/);
        assert.ok(html.includes(f.visitor.id));
        assert.ok(html.includes(new Date(f.now).toISOString()));
      }
      if (section === "settings/preferences") {
        assert.match(html, /aria-label="Theme"/);
        assert.match(html, /aria-label="Time display"/);
        for (const value of ["system", "dark", "light", "local", "utc"])
          assert.ok(html.includes(`value="${value}"`));
      }
    }
    assert.equal(
      f.raw.prepare("SELECT count(*) AS n FROM audit_events").get()!.n,
      0,
    );
  } finally {
    f.raw.close();
  }
});

test("connection views use exact stored scope and expiry metadata and never estimate missing fields", async () => {
  const f = await fixture();
  try {
    const expiresAt = f.now + 123456;
    const metadata: ConnectionMetadata = {
      grantedScopes: ["sample:read"],
      tokenMetadataAvailable: true,
      accessTokens: [{ scopes: ["sample:read"], issuedAt: f.now, expiresAt }],
    };
    const env = envFor(f.db, metadata);
    env.AUTH_SERVER.getConnectionMetadata = async (props) => {
      assert.deepEqual(props, f.props);
      return metadata;
    };
    for (const section of ["connection", "settings/connection"]) {
      const html = await (
        await productPage(request(f.cookie, "/" + section), env, section)
      ).text();
      assert.match(html, /<code class="scope-chip">sample:read<\/code>/);
      assert.ok(
        !html.includes('<code class="scope-chip">sample:request</code>'),
      );
      assert.ok(html.includes(new Date(expiresAt).toISOString()));
      assert.ok(html.includes(origin + "/mcp"));
    }
    for (const unavailable of [
      null,
      {
        grantedScopes: ["sample:read"],
        tokenMetadataAvailable: false,
        accessTokens: [],
      },
      { grantedScopes: [], tokenMetadataAvailable: true, accessTokens: [] },
    ] satisfies (ConnectionMetadata | null)[]) {
      const html = await (
        await productPage(
          request(f.cookie, "/connection"),
          envFor(f.db, unavailable),
          "connection",
        )
      ).text();
      assert.ok(!html.includes(new Date(expiresAt).toISOString()));
      assert.match(
        html,
        unavailable?.tokenMetadataAvailable
          ? /No active access token found/
          : /Token expiry is unavailable/,
      );
      if (!unavailable)
        assert.match(html, /Connection metadata is unavailable/);
      if (unavailable?.grantedScopes.length === 0)
        assert.match(html, /No active grants/);
    }
    env.AUTH_SERVER.getConnectionMetadata = async () => {
      throw new Error("private-auth-service-error");
    };
    const failure = await (
      await productPage(request(f.cookie, "/connection"), env, "connection")
    ).text();
    assert.match(failure, /Connection metadata is unavailable/);
    assert.ok(!failure.includes("private-auth-service-error"));
  } finally {
    f.raw.close();
  }
});

test("tool directory exposes the exact four tool schemas and actual annotations", async () => {
  const f = await fixture();
  try {
    const html = await (
      await productPage(request(f.cookie, "/tools"), envFor(f.db), "tools")
    ).text();
    assert.equal((html.match(/class="panel tool-card"/g) ?? []).length, 4);
    for (const tool of tools) {
      assert.ok(html.includes(`id="${tool.name}"`));
      assert.ok(
        html.includes(escapeHtml(JSON.stringify(tool.inputSchema, null, 2))),
      );
      for (const [key, value] of Object.entries(tool.annotations ?? {}).filter(
        ([key]) => key.endsWith("Hint"),
      )) {
        assert.ok(html.includes(`<code>${key}</code></dt><dd>${value}</dd>`));
      }
    }
    assert.equal((html.match(/>Requires approval<\/span>/g) ?? []).length, 1);
    assert.equal((html.match(/>Read only<\/span>/g) ?? []).length, 3);
  } finally {
    f.raw.close();
  }
});

test("policy match counts deduplicate held request events while counting each read", async () => {
  const f = await fixture();
  try {
    const held = await createHold(f.db, f.props, f.input);
    await createHold(f.db, f.props, f.input);
    await mutate(f.db, held, { status: "DENIED" }, "DENIED");
    await createHold(f.db, f.props, {
      ...f.input,
      requestKey: f.slots[1].requestKey,
    });
    for (let i = 0; i < 3; i++)
      await saveEvent(f.db, {
        ...emptyEvent(f.props, "READ_OK"),
        tool: "list_sample_accounts",
        policyRule: "sample-read",
        policyEffect: "ALLOW",
      });
    await saveEvent(f.db, {
      ...emptyEvent({ ...f.props, visitorId: "foreign-visitor" }, "READ_OK"),
      policyRule: "sample-read",
    });
    const html = await (
      await productPage(
        request(f.cookie, "/policies"),
        envFor(f.db),
        "policies",
      )
    ).text();
    assert.deepEqual(
      [
        ...html.matchAll(
          /data-label="Matched requests" class="numeric">(\d+)</g,
        ),
      ].map((match) => Number(match[1])),
      [0, 0, 2, 3, 0],
    );
    assert.match(html, /Repeated events for one held request count once/);
    assert.match(html, /A read call counts as one request/);
  } finally {
    f.raw.close();
  }
});

test("session search finds resource IDs, request keys and events without exposing other visitors", async () => {
  const f = await fixture();
  try {
    const held = await createHold(f.db, f.props, f.input);
    const foreign = {
      ...held,
      id: crypto.randomUUID(),
      visitor_id: "foreign-visitor",
      reference: "private-other-request",
      teller_key: held.teller_key + ":other",
      journal_json: "[]",
    };
    f.raw
      .prepare(
        `INSERT INTO holds(${Object.keys(foreign).join(",")}) VALUES(${Object.keys(
          foreign,
        )
          .map(() => "?")
          .join(",")})`,
      )
      .run(...Object.values(foreign));
    const event = {
      ...emptyEvent(f.props, "READ_OK"),
      tool: "get_sample_account",
    };
    await saveEvent(f.db, event);
    await saveEvent(f.db, {
      ...emptyEvent({ ...f.props, visitorId: "foreign-visitor" }, "READ_OK"),
      tool: "private-other-tool",
    });
    const index = await consoleIndex(
      request(f.cookie, "/search"),
      envFor(f.db),
      f.visitor,
    );
    assert.equal(index.pending, 1);
    assert.equal(index.sessionId, f.visitor.id);
    assert.ok(
      index.items.some(
        (item) => item.kind === "Request" && item.url === "/queue/" + held.id,
      ),
    );
    assert.equal(
      index.items.filter((item) => item.kind === "Account").length,
      2,
    );
    assert.ok(!JSON.stringify(index).includes(foreign.id));
    assert.ok(!JSON.stringify(index).includes("private-other"));
    for (const query of [held.id, held.request_key, event.eventId]) {
      const html = await (
        await productPage(
          request(f.cookie, "/search?q=" + encodeURIComponent(query)),
          envFor(f.db),
          "search",
        )
      ).text();
      assert.match(html, /class="search-page-results"/);
      assert.ok(!html.includes("private-other"));
    }
    const empty = await (
      await productPage(
        request(f.cookie, "/search?q=definitely-no-matching-record"),
        envFor(f.db),
        "search",
      )
    ).text();
    assert.match(empty, /No matching records/);
  } finally {
    f.raw.close();
  }
});

test("search escapes both user queries and stored result labels", async () => {
  const f = await fixture();
  try {
    const payload =
      "</template><script>window.consoleXss=true</script><img src=x onerror=alert(1)>";
    f.raw
      .prepare("UPDATE sample_registry SET request_slots_json=?")
      .run(
        JSON.stringify(
          f.slots.map((slot, index) =>
            index === 0 ? { ...slot, reference: payload } : slot,
          ),
        ),
      );
    const held = await createHold(f.db, f.props, f.input);
    const html = await (
      await productPage(
        request(f.cookie, "/search?q=" + encodeURIComponent(payload)),
        envFor(f.db),
        "search",
      )
    ).text();
    assert.ok(html.includes(escapeHtml(payload)));
    assert.ok(!html.includes(payload));
    assert.ok(!html.includes("<script>window.consoleXss"));
    assert.ok(html.includes("/queue/" + held.id));
  } finally {
    f.raw.close();
  }
});

test("request views are server rendered, retain saved input, and expose approval only in the stream", async () => {
  const f = await fixture();
  try {
    const held = await createHold(f.db, f.props, f.input);
    const views = {
      stream: "Your decision",
      details: "Saved instruction",
      events: "Event timeline",
      raw: "Exact tool call",
    };
    for (const [tab, expected] of Object.entries(views)) {
      const response = await detailPage(
        request(f.cookie, `/queue/${held.id}?tab=${tab}`),
        envFor(f.db),
        held.id,
      );
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(
        html.includes(
          `href="/queue/${held.id}?tab=${tab}" aria-current="page"`,
        ),
      );
      assert.ok(html.includes(expected));
      assert.equal(
        html.includes('name="action" value="approve"'),
        tab === "stream",
      );
      assert.ok(html.includes(held.request_key));
      assert.ok(!html.includes(held.teller_key));
      if (tab === "raw") {
        assert.ok(
          html.includes(
            escapeHtml(
              JSON.stringify(
                { name: "request_sample_transfer", arguments: f.input },
                null,
                2,
              ),
            ),
          ),
        );
        assert.match(html, /No saved response from Teller/);
      }
    }
    const fallback = await (
      await detailPage(
        request(f.cookie, `/queue/${held.id}?tab=unknown`),
        envFor(f.db),
        held.id,
      )
    ).text();
    assert.ok(
      fallback.includes(
        `href="/queue/${held.id}?tab=stream" aria-current="page"`,
      ),
    );
    assert.equal(
      (
        await detailPage(
          request(f.cookie, "/queue/" + crypto.randomUUID()),
          envFor(f.db),
          crypto.randomUUID(),
        )
      ).status,
      404,
    );
    assert.equal(
      f.raw.prepare("SELECT status FROM holds WHERE id=?").get(held.id)!.status,
      "HELD",
    );
  } finally {
    f.raw.close();
  }
});

test("overview keeps held requests actionable when ledger reads fail without inventing balances", async () => {
  const f = await fixture();
  try {
    const held = await createHold(f.db, f.props, f.input);
    const response = await productPage(
      request(f.cookie, "/overview"),
      envFor(f.db),
      "overview",
    );
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Balances unavailable/);
    assert.match(html, /A balance read did not succeed/);
    assert.match(html, /Your decision/);
    assert.ok(html.includes(`action="/queue/${held.id}"`));
    assert.ok(!html.includes("data-balance="));
    assert.match(html, /Session calls this minute/);
    assert.equal(
      f.raw.prepare("SELECT status FROM holds WHERE id=?").get(held.id)!.status,
      "HELD",
    );
  } finally {
    f.raw.close();
  }
});

test("evaluation exposes all 80 frozen cases and never turns fixtures into a model score", async () => {
  const f = await fixture();
  try {
    const raw = readFileSync("eval/cases.jsonl", "utf8");
    const cases = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const html = await (
      await reportPage(f.db, false, Date.now(), evaluationCatalog(raw))
    ).text();
    assert.equal(cases.length, 80);
    assert.equal((html.match(/data-table-row/g) ?? []).length, 80);
    assert.match(html, /Not run yet/);
    assert.match(html, /There is no score to report/);
    assert.match(html, /aria-label="Filter cases by tool"/);
    assert.match(html, /aria-label="Filter cases by outcome"/);
    for (const row of cases) {
      assert.ok(html.includes(escapeHtml(row.id)));
      assert.ok(
        html.includes(escapeHtml(JSON.stringify(row.expected, null, 2))),
      );
    }
  } finally {
    f.raw.close();
  }
});
