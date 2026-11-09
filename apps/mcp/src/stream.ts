import { ruleTitle, policyVersionLabel } from './policy-display.ts';
import { escapeHtml as e, icon } from "../../../packages/http.ts";
import type { Hold } from "../../../packages/gate/holds.ts";
import { money, amount, time, badge, copyValue, states } from "./view.ts";
import { requestExplanation } from "./request-explanation.ts";
import { policyTrace } from "./insights.ts";
import { info } from "./catalog.ts";
export function ledger(
  accounts: any[] | undefined,
  error = "",
  compact = false,
) {
  return `<section class="ledger${compact ? " ledger-compact" : ""}"><div class="ledger-heading"><h2>Current balances</h2><span>Teller · CAD</span></div>${accounts?.length ? `<p class="ledger-read">Read ${time(Date.now(), true, true)}</p>` : ""}${accounts?.length ? accounts.map((a) => `<div class="ledger-account"><div class="ledger-account-heading"><h3>${a.account === "operating" ? "Operating" : "Reserve"}</h3><span>Available</span></div><div class="ledger-value" data-balance="${e(a.id)}" data-value="${a.availableBalanceMinor}">${amount(a.availableBalanceMinor)}</div><dl class="ledger-details"><div><dt>Ledger ${info("Ledger balance", "The total recorded in Teller’s ledger, including reserved funds.")}</dt><dd>${amount(a.ledgerBalanceMinor)}</dd></div><div><dt>Reserved ${info("Reserved funds", "Ledger balance minus available balance. Connector holds do not reserve funds.")}</dt><dd>${amount(a.ledgerBalanceMinor - a.availableBalanceMinor)}</dd></div></dl></div>`).join("") : `<div class="ledger-unavailable"><h3>Balances unavailable</h3><p>${e(error || "The current balances could not be read from Teller.")}</p><a href="/accounts">Try reading accounts ${icon("arrow")}</a></div>`}<p class="ledger-note">Connector holds do not reserve funds in Teller.</p><a class="ledger-link" href="/accounts">View accounts ${icon("arrow")}</a></section>`;
}
export function requestStream(h: Hold, controls: string, compact = false) {
  const a = JSON.parse(h.arguments_json);
  const nothing = requestExplanation(h).receipt === "not-sent";
  const posted = h.status === "POSTED";
  const approved = h.approved_at ? time(h.approved_at, true, false, true) : "";
  const tellerTitle = nothing
    ? "Teller has received nothing"
    : h.status === "UPSTREAM_REJECTED"
      ? "Rejected at the upstream boundary"
      : posted
        ? "Confirmed in Teller’s ledger"
        : h.teller_id
          ? "Teller has received this transfer"
          : "Teller receipt is not confirmed";
  const tellerNote = nothing
    ? "No transfer request has crossed the approval boundary."
    : h.status === "UPSTREAM_REJECTED"
      ? "The upstream response rejected this request. It will not retry automatically."
      : posted
        ? "The transfer is recorded. Balances are read back from Teller."
        : ["DENIED", "EXPIRED"].includes(h.status) ? "Teller receipt cannot be verified from the saved history." : (states[h.status]?.[1] ??
          "Keep the original request key until the result is known.");
  return `<section class="exchange${compact ? " exchange-compact" : ""}" aria-label="Request exchange" data-request-id="${e(h.id)}" data-outcome="${e(h.status)}"><div class="exchange-head"><a class="mono" href="/queue/${e(h.id)}">${e(h.reference)}</a><span class="small muted">${time(h.created_at, true)}</span>${h.status === "HELD" ? `<a class="decision-jump" href="#decision-${h.id}" aria-label="Needs approval. Go to your decision">${badge(h.status)}<span aria-hidden="true">↓</span></a>` : badge(h.status)}</div><div class="stream-turn agent-turn"><div class="speaker"><span class="speaker-mark">A</span><strong>Agent</strong><span class="speaker-time">${time(h.created_at, true, false, true)}</span></div><div class="turn-content"><div class="call-name"><code>request_transfer</code><span class="eyebrow">Tool call</span></div><div class="transfer-slip"><div><span class="eyebrow">Transfer instruction</span><p class="stream-amount">${amount(a.amountMinor)} <span>CAD</span></p><div class="slip-route"><div><small>From</small><strong>${e(a.fromAccount)}</strong></div>${icon("arrow")}<div><small>To</small><strong>${e(a.toAccount)}</strong></div></div></div><details class="arguments"><summary>Exact tool arguments</summary><pre>${e(JSON.stringify(a, null, 2))}</pre></details></div></div></div><div class="stream-turn connector-turn${h.status === "HELD" ? " active-turn" : ""}"><div class="speaker"><span class="speaker-mark">C</span><strong>Connector</strong></div><div class="turn-content"><h2>${h.status === "HELD" ? "Held for your decision" : "Held for your approval"} ${info("Connector hold", "The connector saves the request. Nothing is sent to Teller before you approve.")}</h2><p>${h.status === "HELD" ? "The request stops here until you decide." : "This request was held before it could reach Teller."}</p><div class="policy-stamp"><a href="/policies">${e(ruleTitle(h.policy_rule))}</a><span>${e(policyVersionLabel(h.policy_version))}</span></div>${policyTrace(h)}</div></div><div id="decision-${h.id}" tabindex="-1" class="stream-turn you-turn${h.status === "HELD" ? " awaiting-turn" : ""}"><div class="speaker"><span class="speaker-mark">Y</span><strong>You</strong>${approved ? `<span class="speaker-time">${approved}</span>` : ""}</div><div class="turn-content">${controls || `<h2>${h.status === "DENIED" ? "Request rejected" : h.status === "EXPIRED" ? "Approval expired" : h.approved_at ? "Approval recorded" : "Decision closed"}</h2><p>${h.status === "DENIED" ? (nothing ? "You closed the request. No transfer was sent." : "You closed the request. Teller receipt cannot be verified from the saved history.") : h.status === "EXPIRED" ? "The approval window has closed." : h.approved_at ? "You approved the saved amount and accounts." : "See the recorded events for this request."}</p>`}</div></div><div class="stream-turn teller-turn${posted ? " posted-turn" : ""}"><div class="speaker"><span class="speaker-mark">T</span><strong>Teller</strong></div><div class="turn-content"><h2>${tellerTitle}</h2>${posted ? `<p class="posted-amount">${icon("check")}${money(a.amountMinor)} recorded</p>` : ""}<p>${tellerNote}</p>${h.teller_id ? `<div class="receipt-id"><span>${posted ? "Ledger reference:" : "Transfer reference:"}</span>${copyValue(h.teller_id, "Teller transfer ID")}</div>` : ""}${h.status === "TELLER_HELD" ? info("Teller hold", "Teller accepted the transfer but its own payment policy still holds it. Connector approval does not mean it posted.") : ""}</div></div></section>`;
}
