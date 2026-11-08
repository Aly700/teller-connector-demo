import { SAMPLE } from "./sample.ts";
export const safeHttp = (code: string, status: number) =>
  Response.json(
    { ...SAMPLE, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export function icon(name: string): string {
  const paths: Record<string, string> = {
    overview:
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/>',
    tools: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    connection:
      '<path d="M9 3v5m6-5v5M6 8h12v4a6 6 0 0 1-6 6v4M6 8v4a6 6 0 0 0 6 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3l-1 1m0 4h.01"/>',
    queue:
      '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 13h5l2 3h2l2-3h5M8 8h8"/>',
    accounts:
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    audit: '<path d="M7 3h10l3 3v15H4V3h3M8 9h8M8 13h8M8 17h5"/>',
    guide:
      '<path d="M12 5v15M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Z"/>',
    eval: '<path d="M5 3h14v18H5ZM9 8l1 1 3-3M9 15l1 1 3-3M15 8h1M15 15h1"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    back: '<path d="M19 12H5M10 7l-5 5 5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    end: '<path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5"/>',
    theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 0 0 0-16"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
    cross: '<path d="m6 6 12 12M6 18 18 6"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.queue}</svg>`;
}
export function page(
  body: string,
  status = 200,
  headers = new Headers(),
  callbackOrigin?: string,
  section = "",
): Response {
  if (
    status >= 400 &&
    !body.includes("<section") &&
    !body.includes("page-heading")
  )
    body = `<section class="error-page">${icon("lock")}${body}<div class="buttons"><a class="button secondary" href="/">Open connection guide</a></div></section>`;
  const title =
    body.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1].replace(/<[^>]+>/g, "") ??
    "Sample connector";
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'${callbackOrigin ? " " + callbackOrigin : ""}; frame-ancestors 'none'; base-uri 'none'`,
  );
  const sections = [
    [
      "Operate",
      [
        ["overview", "Overview", "overview"],
        ["queue", "Requests", "queue"],
        ["accounts", "Accounts", "accounts"],
      ],
    ],
    [
      "Govern",
      [
        ["policies", "Policies", "lock"],
        ["audit", "Audit trail", "audit"],
      ],
    ],
    ["Quality", [["eval", "Evaluation", "eval"]]],
    [
      "Developers",
      [
        ["tools", "Tools", "tools"],
        ["connection", "Connection", "connection"],
      ],
    ],
  ] as const;
  const label =
    [
      ...sections.flatMap(([, items]) => [...items]),
      ["settings", "Settings", "settings"],
      ["guide", "Help", "help"],
    ].find(([path]) => path === section)?.[1] ?? title;
  const nav = (path: string, name: string, glyph: string) =>
    `<a href="/${path}"${section === path ? ' aria-current="page"' : ""}>${icon(glyph)}<span>${name}</span>${path === "queue" ? '<span class="nav-count" data-pending-count></span>' : ""}</a>`;
  const navigation = sections
    .map(
      ([group, items]) =>
        `<div class="nav-group"><span class="nav-label">${group}</span>${items.map(([path, name, glyph]) => nav(path, name, glyph)).join("")}</div>`,
    )
    .join("");
  return new Response(
    `<!doctype html><html lang="en" data-type="software"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="page-type" content="software"><meta name="site-kind" content="software"><title>${title} · Teller connector</title><link rel="preload" href="/assets/manrope-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css"><script src="/console.js" defer></script></head><body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="topbar">
    <button class="icon-button mobile-toggle secondary" type="button" data-nav-toggle aria-label="Open navigation" aria-expanded="false" aria-controls="navigation">${icon("menu")}</button>
    <a class="brand" href="/overview" ><span class="brand-mark" aria-hidden="true"></span>Teller <span class="brand-sub">connector</span></a>
    <span class="workspace"><span class="workspace-mark" aria-hidden="true">S</span>Sample workspace<span class="workspace-only">Only workspace</span></span>
    <form class="global-search" action="/search" role="search">${icon("search")}<label class="sr-only" for="global-search">Search this session</label><input id="global-search" name="q" type="search" placeholder="Search requests, IDs, events…" autocomplete="off" aria-controls="search-results"><kbd>/</kbd><div id="search-results" class="search-results" role="region" aria-label="Search results" hidden></div></form>
    <div class="topbar-actions"><button class="mobile-search icon-button secondary" type="button" data-search-toggle aria-label="Open session search" aria-expanded="false" aria-controls="global-search">${icon("search")}</button><a class="pending-link" data-pending-link href="/queue?state=HELD" aria-label="Pending approvals">${icon("queue")}<span data-pending-count></span> <span class="pending-label">pending</span></a><a class="icon-button" href="/guide" aria-label="Help">${icon("help")}</a><button class="theme-button icon-button secondary" type="button" data-theme-toggle aria-label="Change color theme">${icon("theme")}<span class="sr-only" data-theme-label>System</span></button><details class="session-menu"><summary aria-label="Session menu"><span class="avatar">S</span></summary><div class="menu-panel"><strong>Sample session</strong><p data-session-expiry>This browser owns approvals.</p><a href="/connection">Connection details</a><a href="/settings">Session settings</a><a href="/session/end">${icon("end")}End session</a></div></details></div>
  </header>
  <aside class="sidebar" id="navigation"><nav aria-label="Main navigation">${navigation}<div class="nav-group settings-nav">${nav("settings", "Settings", "settings")}</div></nav><div class="sidebar-bottom"><span class="sidebar-rule"></span><strong>Your decision.<br>Then the ledger.</strong><a href="/guide">How the connector works ${icon("arrow")}</a></div></aside>
  <div class="app"><div class="contextbar"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/overview">Workspace</a><span aria-hidden="true">/</span>${section && label !== title ? `<a href="/${section}">${escapeHtml(label)}</a><span aria-hidden="true">/</span>` : ""}<span aria-current="page">${escapeHtml(label === title ? label : title)}</span></nav><p class="notice"><span class="sample-dot" aria-hidden="true"></span>${SAMPLE.notice}</p></div><main id="main" tabindex="-1">${body}</main><footer><span>Temporary session · Resets at 03:00 Toronto time</span><div class="footer-links"><a href="/guide">Help</a><a href="/connection">Connection ${icon("arrow")}</a></div></footer></div><div class="toast" role="status" aria-live="polite" hidden></div><div class="navigation-shade" data-nav-close hidden></div></body></html>`,
    { status, headers },
  );
}
export async function bounded(
  request: Request,
  limit = 16384,
): Promise<boolean> {
  if (Number(request.headers.get("Content-Length") ?? 0) > limit) return false;
  const reader = request.clone().body?.getReader();
  if (!reader) return true;
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return true;
      size += chunk.value.byteLength;
      if (size > limit) {
        void reader.cancel();
        return false;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
