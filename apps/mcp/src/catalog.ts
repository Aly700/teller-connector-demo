import { escapeHtml as e, icon } from "../../../packages/http.ts";
import { heading, copyValue } from "./view.ts";
export function info(term: string, explanation: string) {
  return `<details class="info"><summary aria-label="About ${e(term)}">${icon("help")}</summary><div class="info-popover"><strong>${e(term)}</strong><p>${e(explanation)}</p></div></details>`;
}
export function tableControls(
  label: string,
  filters: string,
  count: number,
  options = "",
) {
  return `<div class="table-toolbar"><label class="table-search">${icon("search")}<span class="sr-only">Search ${e(label)}</span><input type="search" data-table-search placeholder="Search ${e(label)}…" aria-label="Search ${e(label)}"></label>${filters}${options}<span class="result-count" data-result-count>${count} ${e(label)}</span></div>`;
}
export const pagination = `<div class="pagination"><span data-page-info>All records</span><label>Rows <select data-page-size aria-label="Rows per page"><option>10</option><option>25</option><option>50</option></select></label><button class="secondary icon-button" data-prev type="button" aria-label="Previous page">${icon("back")}</button><button class="secondary icon-button" data-next type="button" aria-label="Next page">${icon("arrow")}</button></div>`;
export function evaluationCatalog(raw: string) {
  const cases = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const families = [...new Set(cases.map((c) => String(c.family)))];
  return `<section class="section-space" data-table><div class="section-heading"><div><h2>Frozen cases</h2><p>Inspect the expected tool choice and outcome. These are fixtures, not model results.</p></div></div><div class="panel">${tableControls("cases", `<label class="select-field"><span>Tool</span><select data-field-filter="tool" aria-label="Filter cases by tool"><option value="all">All tools</option>${families.map((f) => `<option value="${e(f)}">${e(f)}</option>`).join("")}</select></label><label class="select-field"><span>Outcome</span><select data-field-filter="outcome" aria-label="Filter cases by outcome"><option value="all">All outcomes</option><option value="read">Allowed read</option><option value="hold">Approval required</option><option value="refuse">Refused</option></select></label>`, cases.length)}<table class="table case-table"><caption class="sr-only">80 frozen evaluation cases</caption><thead><tr><th>Case</th><th>Tool family</th><th>Expected outcome</th><th>Inspect</th></tr></thead><tbody>${cases.map((c) => `<tr data-table-row data-tool="${e(c.family)}" data-outcome="${e(c.kind)}"><td data-label="Case"><code>${e(c.id)}</code></td><td data-label="Tool family"><code>${e(c.family)}</code></td><td data-label="Expected outcome"><span class="badge" data-status="${c.kind === "hold" ? "HELD" : c.kind === "read" ? "POSTED" : "DENIED"}">${c.kind === "read" ? "Allowed read" : c.kind === "hold" ? "Approval required" : "Refused"}</span></td><td><details class="case-detail"><summary>View case</summary><div><h3>${e(c.id)}</h3><p>${e(c.prompt)}</p><h4>Expected selection and runtime</h4><pre>${e(JSON.stringify(c.expected, null, 2))}</pre></div></details></td></tr>`).join("")}</tbody></table><p class="filter-empty empty" hidden>No cases match these filters.</p>${pagination}</div></section><section class="panel section-space"><div class="panel-head"><h2>Run the evaluation</h2><span class="badge">Manual setup</span></div><div class="panel-body"><p>Run <code>EVAL_DATASET=isolated npm run eval:ci</code> in a dedicated evaluation checkout. This resets that checkout’s demo database. The README describes the <code>model-eval</code> environment, required secrets and <code>ENABLE_MODEL_EVAL=true</code> switch.</p>${copyValue("EVAL_DATASET=isolated npm run eval:ci", "evaluation command")}<p class="small muted">A model key is required for evaluation. Local connector tests call no model.</p></div></section>`;
}

export function sectionNavigation(section: string, selected: string) {
  const settings = section === "settings";
  const items = settings
    ? [
        ["/settings", "General"],
        ["/settings/connection", "Connection"],
        ["/settings/preferences", "Preferences"],
      ]
    : [
        ["/tools", "Tools"],
        ["/connection", "Connection"],
      ];
  return `<nav class="section-navigation" aria-label="${settings ? "Settings" : "Developer"} navigation"><span class="nav-label">${settings ? "Workspace" : "Developers"}</span>${items.map(([url, label]) => `<a href="${url}"${url === selected ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}
