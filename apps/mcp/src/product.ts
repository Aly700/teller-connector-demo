import {
  page,
  escapeHtml as e,
  icon,
  safeHttp,
} from "../../../packages/http.ts";
import { browserSession, config } from "../../../packages/state.ts";
import {
  POLICY_RULES,
  POLICY_VERSION,
  WRITE_TOOL,
} from "../../../packages/gate/policy.ts";
import { tools } from "./tools.ts";
import type { Env } from "./auth.ts";
import {
  pageError,
  sessionHolds,
  browserRead,
  decisionControls,
} from "./pages.ts";
import { sessionEvents, consoleIndex } from "./console-data.ts";
import { heading, badge, time, copyValue, eventTitle } from "./view.ts";
import { ledger, requestStream } from "./stream.ts";
import {
  tableControls,
  pagination,
  sectionNavigation,
  info,
} from "./catalog.ts";

export async function productPage(
  request: Request,
  env: Env,
  section: string,
): Promise<Response> {
  const visitor = await browserSession(env.DB, request);
  if (!visitor)
    return pageError(
      "Open your sample session",
      "Start the connection from your MCP client. Use this browser to review your requests.",
      401,
    );
  const settingSection = section.startsWith("settings");
  const render = (body: string) =>
    page(
      settingSection || ["tools", "connection"].includes(section)
        ? `<div class="section-layout">${sectionNavigation(settingSection ? "settings" : "developers", "/" + section)}<div class="section-content">${body}</div></div>`
        : body,
      200,
      new Headers(),
      undefined,
      settingSection ? "settings" : section,
    );
  if (section === "settings") {
    const record = await env.DB.prepare(
      "SELECT created_at FROM visitors WHERE id=? AND epoch=?",
    )
      .bind(visitor.id, visitor.epoch)
      .first<{ created_at: number }>();
    return render(
      `${heading("General", "Workspace details and the lifecycle of this sample session.")}<section class="panel settings-panel"><div class="panel-head"><h2>Sample workspace</h2><span class="badge">Only workspace</span></div><dl class="detail-fields">${[
        ["Workspace", "Sample workspace"],
        ["Session status", "Active"],
        ["Created", record ? time(record.created_at) : "Unavailable"],
        ["Session ends", time(visitor.expires_at)],
      ]
        .map(
          ([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`,
        )
        .join(
          "",
        )}<div class="span-all"><dt>Session ID</dt><dd class="id-field">${copyValue(visitor.id, "session ID")}</dd></div></dl></section><section class="panel danger-zone section-space"><div class="panel-head"><h2>Danger zone</h2></div><div class="setting-row"><div><h3>End session</h3><p>Revoke browser and connector access. Pending requests expire; transfers already sent cannot be undone.</p></div><a class="button secondary danger" href="/session/end">End session ${icon("end")}</a></div></section>`,
    );
  }
  if (section === "settings/preferences")
    return render(
      `${heading("Preferences", "Display settings saved only in this browser.")}<section class="panel settings-panel"><div class="setting-row"><div><h2>Appearance</h2><p>Choose light, dark, or follow your device.</p></div><label><span class="sr-only">Theme</span><select data-theme-select aria-label="Theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><div class="setting-row"><div><h2>Time display</h2><p>Exported event timestamps always use UTC.</p></div><label><span class="sr-only">Time display</span><select data-time-select aria-label="Time display"><option value="local">Local time</option><option value="utc">UTC</option></select></label></div></section><noscript><p class="alert">Theme and time preferences need JavaScript. Times use UTC. Session actions remain available.</p></noscript>`,
    );
  if (section === "tools")
    return render(
      `${heading("Tools", "Four tools. Three reads. Every write waits for your decision.")}<div class="tool-directory">${tools
        .map(
          (tool, index) =>
            `<section class="panel tool-card" id="${e(tool.name)}"><div class="tool-heading"><span class="tool-index mono">0${index + 1}</span><div><h2>${e(tool.title ?? tool.name)}</h2><code>${e(tool.name)}</code></div><span class="badge" data-status="${tool.annotations?.readOnlyHint ? "POSTED" : "HELD"}">${tool.annotations?.readOnlyHint ? "Read only" : "Requires approval"}</span></div><p>${e(tool.description ?? "")}</p><dl class="annotation-grid">${Object.entries(
              tool.annotations ?? {},
            )
              .filter(([key]) => key.endsWith("Hint"))
              .map(
                ([key, value]) =>
                  `<div><dt><code>${e(key)}</code></dt><dd>${value === true ? "true" : "false"}</dd></div>`,
              )
              .join(
                "",
              )}</dl><details class="schema"><summary>Input schema <span class="muted mono">JSON Schema</span></summary><pre>${e(JSON.stringify(tool.inputSchema, null, 2))}</pre></details></section>`,
        )
        .join("")}</div>`,
    );
  if (section === "connection" || section === "settings/connection") {
    let metadata;
    try {
      metadata = await env.AUTH_SERVER.getConnectionMetadata({
        visitorId: visitor.id,
        epoch: visitor.epoch,
      });
    } catch {}
    const latest = metadata?.accessTokens[0];
    return render(
      `${heading("Connection", "The connection and permissions belonging to this sample session.")}<section class="panel connection-panel"><div class="panel-head"><h2>MCP connection</h2><span class="badge">Browser session active</span></div><dl class="connection-facts"><div><dt>Endpoint</dt><dd>${copyValue(env.PUBLIC_ORIGIN + "/mcp", "MCP endpoint")}</dd></div><div><dt>Authentication</dt><dd>OAuth 2.1 · Authorization code with S256 PKCE<small>Public client · Bearer access token</small></dd></div><div><dt>Granted scopes</dt><dd>${metadata ? (metadata.grantedScopes.length ? metadata.grantedScopes.map((scope) => `<code class="scope-chip">${e(scope)}</code>`).join(" ") : "No active grants") : "Connection metadata is unavailable. Refresh to try again."}</dd></div><div><dt>Latest issued token expires</dt><dd>${latest ? time(latest.expiresAt) : metadata?.tokenMetadataAvailable ? "No active access token found" : "Token expiry is unavailable"}<small>Access tokens last up to 15 minutes and can be refreshed until the session ends.</small></dd></div><div><dt>Session ends</dt><dd>${time(visitor.expires_at)}</dd></div><div><dt>Session ID</dt><dd>${copyValue(visitor.id, "session ID")}</dd></div></dl><div class="session-note">The MCP token can request transfers. Only this browser can approve or reject them.</div></section><div class="section-heading"><h2>Use the connector</h2><a href="/guide">Open the sample guide ${icon("arrow")}</a></div><div class="connection-links"><a class="panel" href="/tools">${icon("tools")}<div><strong>Explore the four tools</strong><p>Titles, annotations and exact input schemas.</p></div>${icon("arrow")}</a><a class="panel" href="/guide">${icon("guide")}<div><strong>Find an unused request key</strong><p>Ready to use with your connected client.</p></div>${icon("arrow")}</a></div>`,
    );
  }
  const holds = await sessionHolds(env, visitor);
  if (section === "policies") {
    const events = await sessionEvents(request, env.DB);
    const matched = (rule: string) =>
      new Set(
        events
          .filter((ev) => ev.policyRule === rule)
          .map((ev) => ev.holdId ?? ev.eventId),
      ).size;
    return render(
      `${heading("Policies", "The connector evaluates these rules in order. The first matching rule decides.")}<div class="policy-banner"><div>${icon("lock")}<div><strong>Every transfer requires browser approval</strong><p>Agent instructions cannot change the gate.</p></div></div><span class="mono">${e(POLICY_VERSION)}</span></div><section class="panel"><div class="panel-head"><h2>Ordered rules</h2><span class="badge">Read only</span></div><table class="table policy-table"><caption class="sr-only">Current ordered gate rules</caption><thead><tr><th class="numeric">Order</th><th>Rule and condition</th><th>Decision</th><th class="numeric">Matched requests</th></tr></thead><tbody>${POLICY_RULES.map((rule) => `<tr><td data-label="Order" class="numeric rule-order">${rule.precedence}</td><td data-label="Rule"><code>${e(rule.rule)}</code><p>${e(rule.description)}</p></td><td data-label="Decision"><span class="badge" data-status="${rule.effect === "ALLOW" ? "POSTED" : rule.effect === "REQUIRE_APPROVAL" ? "HELD" : "DENIED"}">${rule.effect === "ALLOW" ? "Allow" : rule.effect === "REQUIRE_APPROVAL" ? "Require approval" : "Deny"}</span></td><td data-label="Matched requests" class="numeric">${matched(rule.rule)}</td></tr>`).join("")}</tbody></table><div class="session-note">Counts cover this session’s recorded tool requests. Repeated events for one held request count once. A read call counts as one request.</div></section><section class="policy-explanation"><h2>Two separate decisions</h2><div><p><strong>01 · Connector gate</strong><br>The browser approves a saved request before it is sent.</p><p><strong>02 · Teller policy</strong><br>Teller may post, hold, or deny the transfer under its own policy.</p></div></section>`,
    );
  }
  if (section === "search") {
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    const index = await consoleIndex(request, env, visitor);
    const matches = q
      ? index.items.filter((item) =>
          (item.title + " " + item.detail + " " + item.text)
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
      : [];
    return render(
      `${heading("Search this session", q ? `${matches.length} results for “${q}”` : "Find a request, account, resource ID or event.")}<form class="search-page-form" action="/search"><label class="sr-only" for="query">Search query</label><input id="query" name="q" type="search" value="${e(q)}" placeholder="Request, ID or event"><button>Search</button></form><section class="panel">${matches.length ? `<ul class="search-page-results">${matches.map((item) => `<li><a href="${e(item.url)}"><span class="eyebrow">${e(item.kind)}</span><strong>${e(item.title)}</strong><span>${e(item.detail)}</span>${icon("arrow")}</a></li>`).join("")}</ul>` : `<div class="empty"><h2>${q ? "No matching records" : "Start with a request or event"}</h2><p>${q ? "Try a shorter reference, a request key, or an event name." : "Search is limited to this browser session."}</p></div>`}</section>`,
    );
  }
  if (section !== "overview") return safeHttp("NOT_FOUND", 404);
  const read = await browserRead(
    request,
    env,
    "list_sample_accounts",
    {},
  ).catch(() => ({
    data: undefined,
    error: pageError(
      "Balances unavailable",
      "The account read did not succeed.",
      503,
    ),
  }));
  const settings = await config(env.DB);
  const budget = await env.DB.prepare(
    "SELECT count FROM tool_limits WHERE scope=? AND window=?",
  )
    .bind(
      `visitor:${visitor.epoch}:${visitor.id}`,
      Math.floor(Date.now() / 60000),
    )
    .first<{ count: number }>();
  const events = (await sessionEvents(request, env.DB)).slice(-5).reverse();
  const held = holds.filter((h) => h.status === "HELD"),
    newest = held[0];
  const controls = newest ? await decisionControls(env, newest) : "";
  const states: [string, string[], string][] = [
    ["Needs approval", ["HELD"], "HELD"],
    ["Posted", ["POSTED"], "POSTED"],
    ["Rejected", ["DENIED", "TELLER_DENIED", "UPSTREAM_REJECTED"], "DENIED"],
    ["Uncertain", ["OUTCOME_UNKNOWN", "DISPATCHING"], "OUTCOME_UNKNOWN"],
  ];
  return render(
    `${heading("Overview", "Your session, from the first request to the ledger.", `<a class="button secondary" href="/overview">Refresh ${icon("clock")}</a>`)}<dl class="session-counts">${states.map(([label, statuses, state]) => `<div><dt>${badge(state).replace(/>[^<>]+<\/span>$/, `>${label}</span>`)}</dt><dd>${holds.filter((h) => statuses.includes(h.status)).length}</dd></div>`).join("")}</dl><div class="overview-grid"><div><div class="section-heading"><div><h2>${held.length ? "Needs your attention" : "Ready for the next request"}</h2><p>${held.length ? `${held.length} ${held.length === 1 ? "request is" : "requests are"} waiting. Newest shown below.` : "Requests from your connected client will appear here."}</p></div><a href="/queue">All requests ${icon("arrow")}</a></div>${newest ? requestStream(newest, controls, true) : `<section class="empty live-empty"><div class="empty-signal" aria-hidden="true">A <span>→</span> C <span>→</span> Y <span>→</span> T</div><h2>The next move starts with you.</h2><p>Ask your client to request a sample transfer.<br>The connector will hold it here for your decision.</p><a class="button secondary" href="/guide">Get a request key ${icon("arrow")}</a></section>`}<section class="section-space"><div class="section-heading"><h2>Latest exchange events</h2><a href="/audit">Audit trail ${icon("arrow")}</a></div><ol class="recent-events">${events.length ? events.map((ev) => `<li>${time(ev.occurredAt, true)}<a href="/audit?event=${e(ev.eventId)}">${e(eventTitle(ev))}<small>${e(ev.tool ?? "Browser session")}</small></a>${icon("arrow")}</li>`).join("") : "<li>No events recorded yet.</li>"}</ol></section></div><aside class="overview-aside">${ledger(read.data?.accounts, read.error ? "A balance read did not succeed. Refresh to try again." : "", true)}<section class="health"><div class="section-heading"><h2>Connector health</h2>${icon("connection")}</div><dl><div><dt>Origin read</dt><dd><span class="status-dot ${read.data ? "healthy" : "unknown"}"></span>${read.data ? "Reachable" : "Unavailable"}</dd></div><div><dt>Write switch</dt><dd>${JSON.parse(settings.tools_json)[WRITE_TOOL] === true ? "Enabled" : "Disabled"}</dd></div><div><dt>Session calls this minute</dt><dd class="mono">${budget?.count ?? 0}<span class="muted"> / 30</span></dd></div></dl><p>Snapshot ${time(Date.now(), true)}. Calls include browser reads and refreshes.</p><a href="/connection">Connection details ${icon("arrow")}</a></section></aside></div>`,
  );
}
