import {
  page,
  escapeHtml as e,
  icon,
  safeHttp,
} from "../../../packages/http.ts";
import {
  browserSession,
  config,
  type Registry,
  type Visitor,
} from "../../../packages/state.ts";
import {
  expireHold,
  getHold,
  issueCsrf,
  type Hold,
} from "../../../packages/gate/holds.ts";
import { inspectReplay } from "../../../packages/gate/replay.ts";
import { recordCall } from "./audit.ts";
import { consumeTool } from "../../../packages/limits.ts";
import { holdErrors } from "../../../packages/gate/errors.ts";
import { readTool } from "./tools.ts";
import { TellerClient } from "./teller.ts";
import type { Env } from "./auth.ts";
import {
  states,
  money,
  amount,
  time,
  fact,
  badge,
  heading,
  download,
  accountRoute,
  holdTable,
  timeline,
  copyValue,
} from "./view.ts";
import { consoleIndex } from "./console-data.ts";
import { requestStream, ledger } from "./stream.ts";
import { tableControls, pagination, info } from "./catalog.ts";
export { states, money } from "./view.ts";
export function pageError(title: string, message: string, status: number) {
  return page(
    `<section class="error-page">${icon("lock")}<h1>${e(title)}</h1><p class="intro">${e(message)}</p><div class="buttons"><a class="button secondary" href="/queue">Return to your queue ${icon("arrow")}</a><a class="text-link" href="/">Connection guide</a></div><p class="error-code">HTTP ${status}</p></section>`,
    status,
  );
}
export async function sessionHolds(env: Env, visitor: Visitor) {
  const rows = await env.DB.prepare(
    "SELECT * FROM holds WHERE visitor_id=? AND epoch=? ORDER BY created_at DESC,id",
  )
    .bind(visitor.id, visitor.epoch)
    .all<Hold>();
  return Promise.all(rows.results.map((h) => expireHold(env.DB, h)));
}
function queueMarkup(holds: Hold[]) {
  return `<section class="panel" data-table><div class="toolbar"><div class="filters" aria-label="Filter requests"><button class="filter" type="button" data-filter="all" aria-pressed="true">All requests</button><button class="filter" type="button" data-filter="HELD" aria-pressed="false">Needs approval</button><button class="filter" type="button" data-filter="closed" aria-pressed="false">Resolved</button></div><span class="live-status"><span class="sample-dot" aria-hidden="true"></span><span data-sync-status>Updates every 15s</span></span></div>${tableControls("requests", `<label class="select-field"><span>State</span><select data-field-filter="state" aria-label="Filter requests by state"><option value="all">All states</option>${["HELD", "POSTED", "DENIED", "EXPIRED", "DISPATCHING", "OUTCOME_UNKNOWN", "TELLER_HELD", "TELLER_DENIED", "UPSTREAM_REJECTED"].map((state) => `<option value="${state}">${({ HELD: "Needs approval", POSTED: "Posted", DENIED: "Rejected", EXPIRED: "Expired", DISPATCHING: "Confirming result", OUTCOME_UNKNOWN: "Uncertain result", TELLER_HELD: "Teller-held", TELLER_DENIED: "Teller denied", UPSTREAM_REJECTED: "Upstream rejected" } as Record<string, string>)[state]}</option>`).join("")}</select></label>`, holds.length, `<label class="select-field"><span>Sort</span><select data-sort aria-label="Sort requests"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount-desc">Amount: high to low</option><option value="amount-asc">Amount: low to high</option></select></label>`)}${holdTable(holds)}<p class="filter-empty empty" hidden>No requests in this view.</p>${pagination}</section>`;
}
export async function queuePage(
  request: Request,
  env: Env,
  snapshot = false,
): Promise<Response> {
  const visitor = await browserSession(env.DB, request);
  if (!visitor)
    return snapshot
      ? safeHttp("SESSION_REQUIRED", 401)
      : pageError(
          "Open your sample session",
          "Use the browser where you started the connection. A copied link or MCP token cannot open another session.",
          401,
        );
  if (
    snapshot &&
    !(await consumeTool(
      env.DB,
      { visitorId: visitor.id, epoch: visitor.epoch },
      "queue_snapshot",
    ))
  )
    return safeHttp("RATE_LIMIT", 429);
  const holds = await sessionHolds(env, visitor),
    revision = holds.map((h) => `${h.id}:${h.version}:${h.status}`).join("|");
  if (snapshot)
    return Response.json(
      {
        revision,
        html: queueMarkup(holds),
        index: await consoleIndex(request, env, visitor),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  return page(
    `${heading("Requests", "Your sample queue. Every transfer waits for your browser approval.", `<a class="button secondary" href="/accounts">${icon("accounts")}View accounts</a>`)}<div data-live-queue data-revision="${e(revision)}">${queueMarkup(holds)}</div><div class="section-heading"><div><h2>Prepared examples</h2><p>Seeded before your session. Separate from your requests.</p></div><a class="text-link" href="/guide">Sample guide ${icon("arrow")}</a></div><section class="panel"><table class="table"><caption class="sr-only">Prepared sample transfers</caption><thead><tr><th>Reference</th><th>Status</th><th class="numeric">Amount</th><th class="arrow-cell"></th></tr></thead><tbody><tr><td><a href="/queue/sample-held">sample-held</a></td><td class="status-cell">${badge("TELLER_HELD")}</td><td class="numeric">${money(10001)}</td><td class="arrow-cell">${icon("arrow")}</td></tr><tr><td><a href="/queue/sample-posted">sample-posted</a></td><td class="status-cell">${badge("POSTED")}</td><td class="numeric">${money(100)}</td><td class="arrow-cell">${icon("arrow")}</td></tr></tbody></table></section>`,
    200,
    new Headers(),
    undefined,
    "queue",
  );
}
export async function detailPage(
  request: Request,
  env: Env,
  id: string,
  error?: string,
  status = 200,
): Promise<Response> {
  const visitor = await browserSession(env.DB, request);
  if (!visitor)
    return pageError(
      "Open your sample session",
      "Return to the browser where you started this sample session. An MCP token cannot approve a request.",
      401,
    );
  let h = await getHold(env.DB, visitor, id);
  if (!h)
    return pageError(
      "Request not found",
      "This request is not part of your current sample session.",
      404,
    );
  h = await expireHold(env.DB, h);
  const a = JSON.parse(h.arguments_json),
    [title, description] = states[h.status] ?? states.OUTCOME_UNKNOWN;
  const requestedTab = new URL(request.url).searchParams.get("tab") ?? "stream";
  const tab = ["stream", "details", "events", "raw"].includes(requestedTab)
    ? requestedTab
    : "stream";
  const controls =
    tab === "stream" ? await decisionControls(env, h, error) : "";
  const history = await inspectReplay(h);
  const read = await browserRead(
    request,
    env,
    "list_sample_accounts",
    {},
  ).catch(() => ({ data: undefined }));
  const tabs = `<nav class="resource-tabs" aria-label="Request views">${["stream", "details", "events", "raw"].map((key) => `<a href="/queue/${h.id}?tab=${key}"${tab === key ? ' aria-current="page"' : ""}>${key[0].toUpperCase() + key.slice(1)}</a>`).join("")}</nav>`;
  const detailFacts = `<section class="panel"><div class="panel-head"><h2>Saved instruction</h2>${badge(h.status)}</div><dl class="detail-fields">${fact("Amount", money(a.amountMinor))}${fact("Currency", e(a.currency))}${fact("From account", e(a.fromAccount))}${fact("To account", e(a.toAccount))}${fact("Created", time(h.created_at))}${fact("Approval expires", time(h.expires_at))}${fact("Request ID", copyValue(h.id, "request ID"), true)}${fact("Saved request hash", copyValue(h.body_hash, "saved request hash"), true)}${fact("Held by policy", `<code>${e(h.policy_rule)}</code>`)}${fact("Policy version", `<code>${e(h.policy_version)}</code>`)}</dl></section>`;
  const raw = `<section class="panel"><div class="panel-head"><h2>Exact tool call</h2><span class="badge">Saved input</span></div><div class="panel-body"><pre>${e(JSON.stringify({ name: "request_sample_transfer", arguments: a }, null, 2))}</pre><h3 class="section-space">Teller response</h3><pre>${e(h.result_json ? JSON.stringify(JSON.parse(h.result_json), null, 2) : "No saved response from Teller.")}</pre></div></section>`;
  const content =
    tab === "details"
      ? detailFacts
      : tab === "events"
        ? timeline(h, history.events)
        : tab === "raw"
          ? raw
          : requestStream(h, controls) +
            `<details class="metadata section-space"><summary>Event timeline <span class="muted">${history.events.length} recorded events</span></summary>${timeline(h, history.events)}</details>`;
  return page(
    `<section data-state="${h.status === "HELD" ? "CONNECTOR_HELD" : e(h.status)}">${heading(title, description, `<a class="button secondary" href="/queue">${icon("back")}All requests</a>`)}</section>${error ? `<p class="alert" role="alert">${e(holdErrors[error] ?? "This action could not be completed. Review the current state below.")}</p>` : ""}${tabs}<div class="request-layout"><div>${content}</div><aside class="request-aside">${ledger(read.data?.accounts)}<section class="request-properties"><div class="section-heading"><h2>This request</h2>${icon("lock")}</div><dl class="facts">${fact("Request ID", copyValue(h.id, "request ID"), true)}${fact("Idempotency key", copyValue(h.request_key, "idempotency key") + info("Idempotency key", "Reusing this key returns the same saved request. It does not authorize another transfer."), true)}${fact("Policy version", `<a href="/policies"><code>${e(h.policy_version)}</code></a>`, true)}</dl><details class="metadata"><summary>Saved request hash</summary>${copyValue(h.body_hash, "saved request hash")}<p class="small muted">${history.currentPolicyMatches ? "Matches the current policy." : "A different policy is now active."}</p></details><a class="text-link" href="/audit?view=transfers">Inspect the audit trail ${icon("arrow")}</a></section></aside></div>`,
    status,
    new Headers(),
    undefined,
    "queue",
  );
}
export async function decisionControls(env: Env, h: Hold, error?: string) {
  const a = JSON.parse(h.arguments_json);
  let controls = "";
  if (h.status === "HELD" && !error) {
    const csrf = await issueCsrf(env.DB, h);
    controls = `<section class="actions"><h2>Your decision</h2><p>Only approval sends this saved request to Teller. Teller may apply its own policy.</p><form method="post" action="/queue/${h.id}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="bodyHash" value="${h.body_hash}"><div class="buttons"><details class="approval-review"><summary class="button"><span class="when-closed">Review approval ${icon("arrow")}</span><span class="when-open">Go back ${icon("back")}</span></summary><div class="confirmation"><div class="confirmation-heading"><strong>Confirm your approval</strong><span>Step 2 of 2</span></div><p id="confirm-${h.id}">Send <strong>${money(a.amountMinor)}</strong> from <strong>${e(a.fromAccount)}</strong> to <strong>${e(a.toAccount)}</strong>.</p><button name="action" value="approve" aria-label="Approve sample transfer" aria-describedby="confirm-${h.id}">Approve sample transfer ${icon("arrow")}</button></div></details><button class="secondary danger" name="action" value="deny">Reject request ${icon("cross")}</button></div></form><p class="deadline">Approval closes ${time(h.expires_at)}.</p></section>`;
  } else if (
    !error &&
    ["OUTCOME_UNKNOWN", "TELLER_HELD"].includes(h.status) &&
    h.expires_at > Date.now() &&
    h.replay_count < 3
  ) {
    const csrf = await issueCsrf(env.DB, h);
    controls = `<section class="actions"><h2>Check the original request</h2><p>This checks a known transfer first. If the transfer ID was lost, it sends the saved request with the same key. It does not create a new request.</p><form method="post" action="/queue/${h.id}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="bodyHash" value="${h.body_hash}"><div class="confirmation"><label><input type="checkbox" name="confirmed" value="yes" required><span>I understand the original transfer may already have happened.</span></label></div><div class="buttons"><button name="action" value="replay">Check/retry this approved request</button></div></form><p class="deadline">${3 - h.replay_count} checks remain before ${time(h.expires_at)}.</p></section>`;
  } else if (h.status === "DISPATCHING")
    controls = `<section class="actions"><h2>Waiting for confirmation</h2><p>The saved approval cannot be submitted again.</p><div class="buttons"><a class="button secondary" href="/queue/${h.id}">Refresh the result</a></div></section>`;
  else if (h.status === "OUTCOME_UNKNOWN")
    controls =
      '<p class="alert">Recovery is closed for this request. Its result remains uncertain. You can inspect and export its history.</p>';
  if (error)
    controls = `<p><a class="button secondary" href="/queue/${h.id}">Review the current request again</a></p>`;
  return controls;
}

export async function browserRead(
  request: Request,
  env: Env,
  name: string,
  args: Record<string, unknown>,
) {
  const visitor = await browserSession(env.DB, request);
  if (!visitor)
    return {
      error: pageError(
        "Open your sample session",
        "Start the connection from your MCP client first.",
        401,
      ),
    };
  if (
    !(await consumeTool(
      env.DB,
      { visitorId: visitor.id, epoch: visitor.epoch },
      name,
    ))
  )
    return {
      error: pageError(
        "Sample call limit reached",
        "Try again in a minute. Your requests remain saved.",
        429,
      ),
    };
  const registry = await env.DB.prepare(
    "SELECT * FROM sample_registry WHERE visitor_id=? AND epoch=?",
  )
    .bind(visitor.id, visitor.epoch)
    .first<Registry>();
  if (!registry)
    return {
      error: pageError(
        "Sample unavailable",
        "Start a fresh sample session.",
        404,
      ),
    };
  const settings = await config(env.DB);
  if (JSON.parse(settings.tools_json)[name] !== true)
    return {
      error: pageError(
        "Sample read unavailable",
        "This read is currently disabled. Your saved requests remain in the queue.",
        503,
      ),
    };
  const started = Date.now(),
    result = await readTool(
      name,
      args,
      registry,
      new TellerClient(
        env.ORIGIN_URL,
        env.ORIGIN_SIGNING_SECRET,
        visitor.epoch,
      ),
    );
  await recordCall(
    env.DB,
    { visitorId: visitor.id, epoch: visitor.epoch },
    name,
    args,
    result,
    started,
  );
  if (result.isError)
    return {
      error: pageError(
        "Sample unavailable",
        String((result.content[0] as any).text),
        503,
      ),
    };
  return { data: result.structuredContent as any, visitor };
}
export async function seededPage(
  request: Request,
  env: Env,
  reference: string,
): Promise<Response> {
  const read = await browserRead(request, env, "get_sample_transfer", {
    reference,
  });
  if (read.error) return read.error;
  const t = read.data,
    [title, description] = states[t.status] ?? states.OUTCOME_UNKNOWN;
  return page(
    `<div class="detail-breadcrumb"><a class="back" href="/queue">${icon("back")}Back to your queue</a><span class="mobile-request-ref mono">${e(reference)}</span></div><section data-state="${e(t.status)}">${heading(title, description, `<span class="request-ref">${e(reference)} · Prepared example</span>`)}</section><div class="detail-layout"><section class="panel"><div class="panel-head"><h2>Transfer details</h2>${badge(t.status)}</div><div class="transfer-value"><p>Transfer amount</p><div class="amount">${amount(t.amountMinor)} <small>CAD</small></div>${accountRoute(t.fromAccount, t.toAccount)}</div><div class="boundary">${icon(t.status === "POSTED" ? "check" : "clock")}<div><strong>${t.status === "POSTED" ? "Confirmed in Teller’s ledger" : "Teller policy approval required"}</strong><p>${t.status === "POSTED" ? "Ledger" : "Transfer"} reference: ${copyValue(t.id, "Teller transfer ID")}</p></div></div><div class="panel-body"><dl class="facts">${fact("Source", "Prepared sample data")}${fact("Created", time(t.createdAt))}${t.postedAt ? fact("Posted at", time(t.postedAt), true) : ""}</dl></div><div class="session-note">This example was prepared before your session. Teller’s separate approval controls are unavailable here.</div></section><section class="panel"><div class="panel-head"><h2>Event timeline</h2><small>Seeded in Teller</small></div><ol class="timeline"><li class="done"><strong>Sample transfer prepared</strong><p>Created before your browser session.</p>${time(t.createdAt)}</li><li class="current"><strong>${title}</strong>${t.postedAt ? time(t.postedAt) : "<p>Current state read from Teller. The hold timestamp is not supplied by this read.</p>"}</li></ol><div class="timeline-foot">No connector approval was involved in this prepared example.</div></section></div>`,
    200,
    new Headers(),
    undefined,
    "queue",
  );
}
export async function accountsPage(
  request: Request,
  env: Env,
): Promise<Response> {
  const read = await browserRead(request, env, "list_sample_accounts", {});
  if (read.error) return read.error;
  const accounts = read.data.accounts,
    holds = await sessionHolds(env, read.visitor!);
  const selected = new URL(request.url).searchParams.get("account");
  const recent =
    selected && ["operating", "reserve"].includes(selected)
      ? holds.filter((h) => {
          const a = JSON.parse(h.arguments_json);
          return a.fromAccount === selected || a.toAccount === selected;
        })
      : holds;
  return page(
    `${heading("Sample accounts", "Balances read directly from Teller for this browser’s sample accounts.", `<a class="button secondary" href="/accounts">Refresh balances</a>`)}<div class="account-grid">${accounts.map((a: any) => `<section class="panel account-card" id="${e(a.account)}"><div class="panel-head"><h2>${e(a.account === "operating" ? "Operating" : "Reserve")}</h2><span class="badge">${e(a.status === "ACTIVE" ? "Active" : a.status)}</span></div><div class="panel-body"><div class="balance-label">Available balance ${info("Available balance", "The amount Teller currently reports as available to spend.")}</div><p class="account-balance"><span data-balance="${e(a.id)}" data-value="${a.availableBalanceMinor}">${amount(a.availableBalanceMinor)}</span> <small>CAD</small></p><div class="balance-detail"><span class="muted">Ledger balance ${info("Ledger balance", "The total recorded in Teller’s ledger, including funds reserved by Teller.")}</span><strong>${money(a.ledgerBalanceMinor)}</strong></div><div class="balance-detail"><span class="muted">Reserved by Teller ${info("Reserved by Teller", "Ledger balance minus available balance. A connector hold does not reserve these funds.")}</span><strong>${money(a.ledgerBalanceMinor - a.availableBalanceMinor)}</strong></div></div><div class="account-id">${copyValue(a.id, a.account + " account ID")}</div><a class="account-transfers" href="/accounts?account=${e(a.account)}#recent">Recent transfers ${icon("arrow")}</a></section>`).join("")}</div><p class="small muted prose">Read ${time(Date.now())}. Connector holds do not reserve funds in Teller.</p><div class="section-heading"><div><h2 id="recent">Recent transfers${selected ? " · " + e(selected) : ""}</h2><p>Your session’s transfer requests and their recorded outcomes.</p></div><a class="text-link" href="/queue">Open queue ${icon("arrow")}</a></div><section class="panel"><nav class="toolbar filters" aria-label="Filter transfers by account"><a class="filter" href="/accounts#recent"${!selected ? ' aria-current="page"' : ""}>Both accounts</a><a class="filter" href="/accounts?account=operating#recent"${selected === "operating" ? ' aria-current="page"' : ""}>Operating</a><a class="filter" href="/accounts?account=reserve#recent"${selected === "reserve" ? ' aria-current="page"' : ""}>Reserve</a></nav>${holdTable(recent)}</section><div class="section-heading"><div><h2>Prepared transfers</h2><p>Inspect the sample records already in Teller.</p></div></div><div class="buttons"><a class="button secondary" href="/queue/sample-posted">sample-posted ${icon("arrow")}</a><a class="button secondary" href="/queue/sample-held">sample-held ${icon("arrow")}</a></div>`,
    200,
    new Headers(),
    undefined,
    "accounts",
  );
}
