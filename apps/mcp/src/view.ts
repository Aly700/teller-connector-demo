import { ruleTitle } from './policy-display.ts';
import { escapeHtml as e, icon } from "../../../packages/http.ts";
import type { Hold } from "../../../packages/gate/holds.ts";
export const states: Record<string, [string, string]> = {
  HELD: [
    "Waiting for your approval",
    "Review the amount and accounts. Only this session can approve this request.",
  ],
  DENIED: [
    "Rejected by you",
    "This request is closed. Nothing was sent to Teller.",
  ],
  EXPIRED: [
    "Approval expired",
    "The approval window has closed. Nothing was sent to Teller. Use a different unused request key for a new transfer.",
  ],
  DISPATCHING: [
    "Result not confirmed yet",
    "Your approval is saved. Teller may be processing this request. Do not create another request.",
  ],
  OUTCOME_UNKNOWN: [
    "Result not confirmed",
    "Teller may already have processed this transfer. Check this approved request using its original key; do not create a replacement.",
  ],
  POSTED: [
    "Posted in Teller",
    "The transfer is recorded in Teller’s ledger.",
  ],
  TELLER_HELD: [
    "Held by Teller",
    "Teller is waiting for its own payment-policy approval. Connector approval alone does not mean a transfer is posted.",
  ],
  TELLER_DENIED: [
    "Denied by Teller",
    "Teller declined the transfer under its own policy. It was not posted.",
  ],
  UPSTREAM_REJECTED: [
    "Teller rejected the request",
    "The request reached the upstream boundary and was rejected. It will not retry automatically.",
  ],
};
export const labels: Record<string, string> = {
  HELD: "Needs approval",
  DENIED: "Rejected",
  EXPIRED: "Expired",
  DISPATCHING: "Confirming result",
  OUTCOME_UNKNOWN: "Uncertain result",
  POSTED: "Posted",
  TELLER_HELD: "Teller-held",
  TELLER_DENIED: "Teller denied",
  UPSTREAM_REJECTED: "Upstream rejected",
};
export const money = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    n / 100,
  ) + " CAD";
export const amount = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    n / 100,
  );
export function time(
  value: number | string,
  compact = false,
  seconds = false,
  clockOnly = false,
) {
  const iso = new Date(value).toISOString();
  return `<time datetime="${iso}" title="${iso}" data-local-time${compact ? " data-compact" : ""}${seconds ? " data-seconds" : ""}${clockOnly ? " data-clock-only" : ""}>${e(iso.replace("T", " ").replace("Z", " UTC"))}</time>`;
}
export const fact = (label: string, value: string, full = false) =>
  `<div${full ? ' class="span-all"' : ""}><dt>${e(label)}</dt><dd>${value}</dd></div>`;
export const badge = (status: string) =>
  `<span class="badge" data-status="${e(status)}">${e(labels[status] ?? status)}</span>`;
export const heading = (title: string, description: string, action = "") =>
  `<div class="page-heading"><div><h1>${e(title)}</h1><p>${e(description)}</p></div>${action}</div>`;
export const download = (url = "/audit/export", label = "Export JSON lines") =>
  `<a class="button secondary" href="${e(url)}">${icon("download")}${e(label)}</a>`;
export function copyValue(value: string, label: string) {
  return `<div class="copy-line"><code>${e(value)}</code><button class="secondary copy-button" type="button" data-copy="${e(value)}" aria-label="Copy ${e(label)}">${icon("copy")}</button></div>`;
}
export function accountRoute(from: string, to: string) {
  return `<div class="account-route"><div><span class="account-symbol">${icon("accounts")}</span><span><small>From account</small><strong>${e(from)}</strong></span></div>${icon("arrow")}<div><span class="account-symbol">${icon("accounts")}</span><span><small>To account</small><strong>${e(to)}</strong></span></div></div>`;
}
export function holdTable(holds: Hold[], empty = "No requests yet") {
  if (!holds.length)
    return `<div class="empty">${icon("queue")}<h2>${empty}</h2><p>Request a transfer from your connected client. It will appear here for your review.</p><a class="button secondary" href="/guide">Open guide ${icon("arrow")}</a></div>`;
  return `<table class="table"><caption class="sr-only">Transfer requests in this session</caption><thead><tr><th>Request</th><th class="route-col">Accounts</th><th class="status-col">Status</th><th class="amount-col numeric">Amount</th><th class="date-col">Requested</th><th class="arrow-cell"><span class="sr-only">Open</span></th></tr></thead><tbody>${holds
    .map((h) => {
      const a = JSON.parse(h.arguments_json);
      return `<tr tabindex="0" data-table-row data-row-href="/queue/${e(h.id)}" data-request-status="${e(h.status)}" data-state="${e(h.status)}" data-created="${h.created_at}" data-amount="${a.amountMinor}" data-search="${e(h.id + " " + h.request_key + " " + (h.teller_id ?? ""))}"><td data-label="Request"><a href="/queue/${e(h.id)}">${e(h.reference)}</a><span class="table-id mono">${e(h.id.slice(0, 8))}<button class="secondary copy-button" type="button" data-copy="${e(h.id)}" aria-label="Copy ${e(h.reference)} ID">${icon("copy")}</button></span></td><td class="route-cell" data-label="Accounts">${e(a.fromAccount)} <span class="muted">→</span> ${e(a.toAccount)}</td><td class="status-cell" data-label="State">${badge(h.status)}</td><td class="numeric" data-label="Amount">${money(a.amountMinor)}</td><td class="date-cell" data-label="Requested">${time(h.created_at, true)}</td><td class="arrow-cell">${icon("arrow")}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}
export const eventNames: Record<string, string> = {
  HELD: "Held by the connector",
  APPROVED: "Approved by you",
  DENIED: "Rejected by you",
  EXPIRED: "Approval expired",
  SEND_CLAIMED: "Dispatch recorded",
  RESPONSE_SAVED: "Teller receipt confirmed",
  RESULT_SAVED: "Teller result confirmed",
  OUTCOME_UNKNOWN: "Result not confirmed",
  DISPATCH_INTERRUPTED: "Dispatch interrupted",
  REPLAY_APPROVED: "Recovery approved by you",
  REPLAY_REJECTED: "Recovery rejected; earlier result uncertain",
  STOPPED_BEFORE_SEND: "Stopped before sending",
  REPLAY_STOPPED_BEFORE_SEND: "Recovery stopped; earlier result uncertain",
  SESSION_REPLACED: "Session ended",
  READ_OK: "Data read",
  TOOL_REFUSED: "Tool request refused",
  BROWSER_REFUSED: "Browser action refused",
  DUPLICATE_REQUEST: "Existing request returned",
  HELD_UNAVAILABLE: "Held; connection unavailable",
  UPSTREAM_REJECTED: "Teller rejected the request",
  SESSION_ENDED: "Session ended",
};
export function eventTitle(ev: any) {
  return ev.type === "RESULT_SAVED"
    ? (states[ev.holdState]?.[0] ?? "Teller result recorded")
    : (eventNames[ev.type] ?? "Session event recorded");
}
export function timeline(h: Hold, events: any[]) {
  const rows = [
    {
      title: "Transfer requested",
      at: h.created_at,
      description: "Saved with an idempotency key.",
    },
    ...events.map((ev) => ({
      title: eventTitle(ev),
      at: ev.occurredAt,
      description:
        ev.type === "HELD"
          ? `Policy: ${ruleTitle(h.policy_rule)}`
          : ev.type === "SEND_CLAIMED"
            ? "Outbound attempt claimed. Receipt is not yet confirmed."
            : ev.type === "RESPONSE_SAVED"
              ? "Teller returned a matching transfer record."
              : ev.type === "APPROVED"
                ? "You approved the saved amount and accounts."
                : ev.type === "RESULT_SAVED"
                  ? "Current state read back from Teller."
                  : "",
    })),
  ];
  const future =
    h.status === "HELD"
      ? [
          ["Your decision", "Approval is required to continue."],
          ["Teller result", "Nothing sent. Waiting for your decision."],
        ]
      : [];
  return `<section class="panel"><div class="panel-head"><h2>Event timeline</h2><small>Recorded history</small></div><ol class="timeline">${rows.map((r, i) => `<li class="${i === rows.length - 1 ? "current" : "done"}"><strong>${e(r.title)}</strong>${r.description ? `<p>${e(r.description)}</p>` : ""}${time(r.at)}</li>`).join("")}${future.map(([title, desc]) => `<li class="future"><strong>${title}</strong><p>${desc}</p></li>`).join("")}</ol><div class="timeline-foot">Times shown in your time zone. Hover for UTC.<br><a href="/audit?view=transfers">Inspect the session audit ${icon("arrow")}</a></div></section>`;
}
