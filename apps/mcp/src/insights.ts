import { ruleTitle } from './policy-display.ts';
import { escapeHtml as e, icon } from '../../../packages/http.ts';
import { money, amount, time } from './view.ts';
import type { Hold } from '../../../packages/gate/holds.ts';
import type { RequestCounts, ToolBudget, AccountInsights, ObservedBalance, SessionInsights } from "./insights-data.ts";
import { requestExplanation } from './request-explanation.ts';

export function plainWords(h: Hold) {
  const explanation = requestExplanation(h);
  return `<section class="plain-words"><div class="explanation-label"><span class="icon-tile">${icon('help')}</span><h2>In plain words</h2></div><p>${e(explanation.paragraph)}</p><small>${e(explanation.source)}</small></section>`;
}
export function policyTrace(h: Hold) {
  const explanation = requestExplanation(h);
  return `<details class="policy-trace"><summary><span>${icon('lock')}Why it was held</span><span>${explanation.traceAvailable ? 'Recorded rule checks' : 'History unavailable'}</span></summary>${explanation.traceAvailable ? `<ol>${explanation.trace.map((step) => `<li data-rule-state="${step.status}"><span class="rule-check" aria-hidden="true">${step.status === 'matched' ? icon('check') : step.status === 'checked' ? icon('check') : '—'}</span><div><div class="rule-title"><strong>${e(ruleTitle(step.rule))}</strong><span class="rule-state">${step.status}</span></div>${step.status === 'skipped' ? '' : `<p>${e(step.reason)}</p>`}</div></li>`).join('')}</ol><p class="chart-takeaway">The first matching rule held the request. Later rules were not evaluated.</p>` : `<p class="chart-takeaway">${e(explanation.traceUnavailableReason ?? 'This request has no usable saved rule history.')}</p>`}</details>`;
}
export function ring(value: number, limit: number, key: string, label: string, tone = 'blue') {
  const percent = limit > 0 ? Math.min(100, Math.max(0, value / limit * 100)) : 0;
  return `<div class="ring" data-tone="${tone}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-track" cx="50" cy="50" r="41"/><circle class="ring-fill" cx="50" cy="50" r="41" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100-percent}" data-ring-key="${e(key)}" data-ring-value="${percent}"/></svg><div><strong data-figure-key="${e(key)}" data-figure-value="${value}">${value.toLocaleString('en-CA')}</strong><span>of ${limit.toLocaleString('en-CA')}</span></div><span class="sr-only">${e(label)}: ${value} of ${limit}</span></div>`;
}
export function outcomeTiles(counts: RequestCounts, key: string) {
  const tiles: [string, number, string, string, string][] = [
    ['Needs approval', counts.awaitingApproval, 'Waiting for your decision', 'clock', 'held'],
    ['Posted', counts.posted, 'Recorded in Teller’s ledger', 'check', 'posted'],
    ['Rejected', counts.denied + counts.tellerDenied + counts.upstreamRejected, 'Closed without posting', 'cross', 'rejected'],
    ['Uncertain', counts.dispatching + counts.outcomeUnknown, 'Awaiting a confirmed result', 'help', 'uncertain'],
  ];
  return `<dl class="kpi-grid">${tiles.map(([label, value, meaning, glyph, tone]) => `<div class="kpi-tile" data-tone="${tone}"><dt><span class="icon-tile">${icon(String(glyph))}</span>${label}</dt><dd data-figure-key="${e(key)}:${tone}" data-figure-value="${value}">${value}</dd><dd class="kpi-meaning">${meaning}</dd></div>`).join('')}</dl>`;
}
export function outcomeChart(counts: RequestCounts, key: string) {
  const outcomes = [
    ['Needs approval', counts.awaitingApproval, 'held'], ['Posted', counts.posted, 'posted'],
    ['Rejected', counts.denied + counts.tellerDenied + counts.upstreamRejected, 'rejected'],
    ['Uncertain', counts.dispatching + counts.outcomeUnknown, 'uncertain'],
    ['Teller-held', counts.tellerHeld, 'teller-held'], ['Expired', counts.expired, 'expired'], ['Other', counts.other, 'other'],
  ] as [string, number, string][];
  const shown = outcomes.filter(([, value], i) => i < 4 || value > 0);
  let x = 0;
  const bars = outcomes.map(([label, value, tone]) => {
    const width = counts.total ? value / counts.total * 100 : 0, start = x; x += width;
    return width ? `<rect x="${start}" y="0" width="${width}" height="12" data-tone="${tone}"/>` : '';
  }).join('');
  return `<section class="panel outcome-panel"><div class="panel-head"><div><span class="eyebrow">This session</span><h2>Request outcomes</h2></div><span class="count-pill">${counts.total} ${counts.total === 1 ? 'request' : 'requests'}</span></div><div class="panel-body"><svg class="outcome-bar" viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label="${e(shown.map(([label, value]) => `${label}: ${value}`).join(', '))}"><rect class="outcome-track" width="100" height="12"/>${bars}</svg><ul class="chart-legend">${shown.map(([label, value, tone]) => `<li data-tone="${tone}"><span class="legend-dot"></span><span>${label}</span><strong data-figure-key="${e(key)}:outcome:${tone}" data-figure-value="${value}">${value}</strong></li>`).join('')}</ul><p class="chart-takeaway">${counts.total ? `${counts.posted} of ${counts.total} requests posted; ${counts.awaitingApproval} ${counts.awaitingApproval === 1 ? 'still needs' : 'still need'} your decision.` : 'Your first transfer request will start the picture here.'}</p></div></section>`;
}
export function budgetChart(budget: ToolBudget, key: string) {
  const minute = budget.visitorMinute, day = budget.sharedUtcDay;
  return `<section class="panel budget-panel"><div class="panel-head"><div><span class="eyebrow">Connector capacity</span><h2>Call budget</h2></div>${icon('connection')}</div><div class="budget-rings"><div>${ring(minute.used, minute.limit, `${key}:minute:${minute.resetsAt}`, 'Session calls this minute')}<h3>This session · minute</h3></div><div>${ring(day.used, day.limit, `shared:day:${day.resetsAt}`, 'Shared demo calls today', 'violet')}<h3>Shared demo · UTC day</h3></div></div><p class="chart-takeaway">${minute.remaining} session calls remain this minute. Today’s limit is shared by every session.</p><details class="budget-details"><summary>How the limits work</summary><p>Browser reads and refreshes count as calls. The minute window resets ${time(minute.resetsAt, true, true)}; the shared day resets ${time(day.resetsAt)}.</p></details></section>`;
}
function accountLine(account: AccountInsights, points: ObservedBalance[], suffix: string) {
  const width = 480, height = 112, left = 82, right = 472, top = 12, bottom = 96;
  const values = points.map(p => p.availableBalanceMinor);
  const low = Math.min(...values), high = Math.max(...values), start = points[0], end = points.at(-1)!;
  const firstTime = start ? Date.parse(start.occurredAt) : 0, lastTime = end ? Date.parse(end.occurredAt) : 0;
  const coordinates = points.map((p, i) => {
    const x = points.length === 1 ? width / 2 : lastTime === firstTime ? left + i / (points.length-1) * (right-left) : left + (Date.parse(p.occurredAt)-firstTime)/(lastTime-firstTime)*(right-left);
    const y = high === low ? (top+bottom)/2 : bottom-(p.availableBalanceMinor-low)/(high-low)*(bottom-top);
    return {x,y,point:p};
  });
  const title = account.account === 'operating' ? 'Operating' : 'Reserve';
  const description = points.length ? `${title}: ${points.length} recorded balance reads, from ${money(start.availableBalanceMinor)} to ${money(end.availableBalanceMinor)}.` : `${title}: no saved balance observations yet.`;
  return `<div class="account-history" data-account="${e(account.account)}"><div class="history-heading"><div><span class="legend-dot"></span><h3>${title}</h3></div><strong>${end ? amount(end.availableBalanceMinor) : 'No reads yet'}${end ? '<small>available · CAD</small>' : ''}</strong></div>${points.length ? `<svg class="balance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(description)}">${high === low ? `<text class="chart-value-label" x="0" y="${(top+bottom)/2+4}">${amount(high)}</text>` : `<text class="chart-value-label" x="0" y="${top+4}">${amount(high)}</text><text class="chart-value-label" x="0" y="${bottom+4}">${amount(low)}</text>`}<path class="chart-baseline" d="M ${left} ${bottom} H ${right}"/>${coordinates.length > 1 ? `<polyline class="history-line" points="${coordinates.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}"/>` : ''}${coordinates.map(({x,y,point})=>`<circle class="history-point" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5"><title>${e(money(point.availableBalanceMinor)+' · '+point.occurredAt)}</title></circle>`).join('')}</svg><div class="chart-axis">${time(start.occurredAt,true,true)}${points.length>1?time(end.occurredAt,true,true):'<span>One observed point</span>'}</div><p class="chart-takeaway">${points.length===1?'One recorded read. Another read will add a point.':low===high?`${points.length} recorded reads; available balance was unchanged at those reads.`:`${points.length} recorded reads; available moved from ${amount(start.availableBalanceMinor)} to ${amount(end.availableBalanceMinor)}.`}</p>` : `<div class="chart-empty">${icon('accounts')}<p>Balance history starts with the first saved Teller read.</p></div>`}<details class="observations"><summary>Read values${account.observationCount ? ` · ${points.length} of ${account.observationCount}` : ''}</summary>${points.length?`<div class="observation-table" role="region" aria-label="${title} observed values" tabindex="0"><table class="table"><caption class="sr-only">${title} recorded balance reads ${suffix}</caption><thead><tr><th>Observed</th><th>Available</th><th>Ledger</th></tr></thead><tbody>${points.map(p=>`<tr><td>${time(p.occurredAt,true,true)}</td><td>${money(p.availableBalanceMinor)}</td><td>${money(p.ledgerBalanceMinor)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No observed values are available for this account.</p>'}</details></div>`;
}
export function balanceHistory(insights: SessionInsights) {
  const views = ['session','recent'];
  return `<section class="panel balance-history"><div class="panel-head"><div><span class="eyebrow">Actual Teller reads</span><h2>Balance history</h2></div><div class="segmented history-controls" role="group" aria-label="Balance history range"><button type="button" data-history-range="session" aria-pressed="true">This session</button><button type="button" data-history-range="recent" aria-pressed="false">Recent reads</button></div></div>${views.map(range=>`<div class="history-view" data-history-view="${range}"${range==='recent'?' hidden':''}><div class="history-grid">${insights.accounts.map((account)=>accountLine(account, account.observations.slice(range==='recent'?-8:-48),range)).join('')}</div></div>`).join('')}<div class="history-foot"><p>Lines join recorded reads; balances between reads are unknown. Up to 48 recent observations per account are shown.</p>${insights.postedTransfers.length ? `<div class="posted-markers"><span>Confirmed transfers</span>${insights.postedTransfers.slice(-5).map((m)=>`<a href="/queue/${e(m.holdId)}" data-open-request>${icon('check')} ${e(m.reference)} · ${amount(m.amountMinor)} <span>${time(m.occurredAt,true)}</span></a>`).join('')}</div>` : '<p>No posted transfers are recorded in this session yet.</p>'}</div></section>`;
}
export function matchBar(count: number, total: number) {
  return `<span class="policy-match"><svg viewBox="0 0 120 8" aria-hidden="true"><rect class="match-track" width="120" height="8" rx="4"/><rect class="match-fill" width="${total ? count/total*120 : 0}" height="8" rx="4"/></svg></span>`;
}
