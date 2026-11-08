import { SAMPLE } from './sample.ts';
export const safeHttp = (code: string, status: number) => Response.json({ ...SAMPLE, code }, { status, headers: { 'Cache-Control': 'no-store' } });
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export function page(body: string, status = 200, headers = new Headers(), callbackOrigin?:string): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'same-origin');
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'self'; form-action 'self'${callbackOrigin?' '+callbackOrigin:''}; frame-ancestors 'none'; base-uri 'none'`);
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sample connector</title><link rel="stylesheet" href="/styles.css"></head><body><a class="skip" href="#main">Skip to content</a><header><a href="/">Sample connector</a><nav aria-label="Main navigation"><a href="/queue">Queue</a><a href="/guide">Sample guide</a><a href="/eval">Evaluation</a></nav></header><main id="main"><p class="notice">${SAMPLE.notice}</p>${body}</main><footer><p>Temporary sample data. Sessions end at 03:00 Toronto time.</p></footer></body></html>`, { status, headers });
}
export async function bounded(request: Request, limit=16384): Promise<boolean> {
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) return false;
  const reader = request.clone().body?.getReader();
  if (!reader) return true;
  let size = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) return true; size += chunk.value.byteLength; if (size > limit) { void reader.cancel(); return false; } } }
  finally { reader.releaseLock(); }
}
