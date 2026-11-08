import { SAMPLE } from './sample.ts';
export const safeHttp = (code: string, status: number) => Response.json({ ...SAMPLE, code }, { status, headers: { 'Cache-Control': 'no-store' } });
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export function icon(name: string): string {
  const paths: Record<string, string> = {
    queue: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 13h5l2 3h2l2-3h5M8 8h8"/>',
    accounts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    audit: '<path d="M7 3h10l3 3v15H4V3h3M8 9h8M8 13h8M8 17h5"/>',
    guide: '<path d="M12 5v15M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Z"/>',
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
export function page(body: string, status = 200, headers = new Headers(), callbackOrigin?: string, section = ''): Response {
  if (status >= 400 && !body.includes('<section') && !body.includes('page-heading')) body = `<section class="error-page">${icon('lock')}${body}<div class="buttons"><a class="button secondary" href="/">Open connection guide</a></div></section>`;
  const title = body.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1].replace(/<[^>]+>/g, '') ?? 'Sample connector';
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'${callbackOrigin ? ' ' + callbackOrigin : ''}; frame-ancestors 'none'; base-uri 'none'`);
  const nav = (path: string, label: string, glyph: string) => `<a href="/${path}" aria-label="${label}"${section === path ? ' aria-current="page"' : ''}>${icon(glyph)}<span class="nav-full">${label}</span><span class="nav-short" aria-hidden="true">${({queue:"Queue",accounts:"Accounts",audit:"Audit",eval:"Evaluation",guide:"Guide"} as Record<string,string>)[path]??label}</span></a>`;
  return new Response(`<!doctype html><html lang="en" data-type="software"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="page-type" content="software"><meta name="site-kind" content="software"><title>${title} · Teller connector</title><link rel="preload" href="/assets/manrope-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css"><script src="/console.js" defer></script></head><body><a class="skip" href="#main">Skip to content</a><aside class="sidebar"><a class="brand" href="/">Teller<span>connector</span></a><div class="workspace">${icon('lock')}<span>Sample workspace<small>Browser-owned session</small></span></div><nav aria-label="Main navigation">${nav('queue', 'Approval queue', 'queue')}${nav('accounts', 'Accounts', 'accounts')}${nav('audit', 'Audit trail', 'audit')}<span class="nav-label">Resources</span>${nav('eval', 'Evaluation', 'eval')}${nav('guide', 'Sample guide', 'guide')}</nav><div class="sidebar-bottom"><p>Every write waits<br>for your approval.</p>${nav('session/end', 'End session', 'end')}</div></aside><div class="app"><header class="topbar"><p class="notice"><span class="sample-dot" aria-hidden="true"></span>${SAMPLE.notice}</p><button class="theme-button secondary" type="button" data-theme-toggle aria-label="Change color theme">${icon('theme')}<span data-theme-label>System</span></button></header><main id="main" tabindex="-1">${body}</main><footer><span>Temporary session · Resets at 03:00 Toronto time</span><div class="footer-links"><a href="/session/end">End session</a><a href="/guide">How the connector works ${icon('arrow')}</a></div></footer></div></body></html>`, { status, headers });
}
export async function bounded(request: Request, limit=16384): Promise<boolean> {
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) return false;
  const reader = request.clone().body?.getReader();
  if (!reader) return true;
  let size = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) return true; size += chunk.value.byteLength; if (size > limit) { void reader.cancel(); return false; } } }
  finally { reader.releaseLock(); }
}
