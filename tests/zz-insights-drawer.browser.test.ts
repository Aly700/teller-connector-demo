// Run approved transfers after the shared live-seed baseline checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Browser, BrowserContext, Locator, Page, Request } from 'playwright-core';
import { base, session, mcp } from './helpers.ts';
import { chromium } from '../scripts/browser.ts';

type Session = Awaited<ReturnType<typeof session>>;
type Held = { holdId: string; reference: string; approvalUrl: string };
async function call(s: Session, name: string, args: object) {
  const response = await mcp(s.tokens.access_token, 'tools/call', { name, arguments: args });
  assert.equal(response.status, 200);
  const result = ((await response.json()) as any).result;
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent;
}
async function prepare(s: Session, amountMinor = 125): Promise<Held> {
  const list = await call(s, 'list_accounts', {});
  return call(s, 'request_transfer', {
    fromAccount: 'operating', toAccount: 'reserve', amountMinor, currency: 'CAD',
    requestKey: list.requestSlots[0].requestKey,
  });
}
async function authenticate(context: BrowserContext, s: Session) {
  context.setDefaultTimeout(15000);
  await context.addCookies([{
    name: '__Host-sample-session', value: /__Host-sample-session=([^;]+)/.exec(s.cookie)![1],
    domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax',
  }]);
}
const transferPosts = async (): Promise<number> =>
  JSON.parse(await readFile('.data/origin-metrics.json', 'utf8')).transferPosts;
const drawerOf = (page: Page) => page.getByRole('dialog', { name: 'Request details', exact: true });
const rowOf = (page: Page, held: Held) => page.locator(`[data-table-row][data-row-href="${new URL(held.approvalUrl).pathname}"]`);
const requestFetch = (request: Request, path: string) =>
  request.method() === 'GET' && request.resourceType() === 'fetch' && new URL(request.url()).pathname === path;
async function assertFocused(locator: Locator) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (await locator.evaluate(element => element === document.activeElement)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(await locator.evaluate(element => element === document.activeElement), true);
}
async function assertNoOverflow(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const drawer = drawerOf(page);
  if (await drawer.isVisible()) {
    const bounds = await drawer.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.width <= page.viewportSize()!.width + 1);
    assert.equal(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  }
}

test('drawer preserves queue context, isolates ownership, restores focus, and sends only after explicit approval', async () => {
  const s = await session(), foreign = await session();
  const held = await prepare(s);
  const list = await call(s, 'list_accounts', {});
  const untouched: Held = await call(s, 'request_transfer', {
    fromAccount: 'reserve', toAccount: 'operating', amountMinor: 275, currency: 'CAD',
    requestKey: list.requestSlots[1].requestKey,
  });
  const requestPath = new URL(held.approvalUrl).pathname;
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await authenticate(context, s);
    const page = await context.newPage();
    const errors: string[] = [], writes: Request[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST') writes.push(request); });
    const before = await transferPosts();
    await page.goto(base + '/queue');
    const queueUrl = page.url();
    await page.keyboard.press('/');
    await page.getByRole('searchbox', { name: 'Search this session', exact: true }).fill(held.reference);
    await page.locator('#search-results a').first().waitFor();
    assert.equal(await page.locator('.app').evaluate(element => (element as HTMLElement).inert), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.app').evaluate(element => (element as HTMLElement).inert), false);
    await page.evaluate(() => { (window as any).drawerDocument = 'original queue'; });
    assert.equal(await page.locator('input[name="csrf"]').count(), 0);
    const row = rowOf(page, held), trigger = row.getByRole('link', { name: held.reference, exact: true });
    const resourceResponse = page.waitForResponse(response => requestFetch(response.request(), requestPath));
    await trigger.click();
    const resource = await resourceResponse;
    assert.equal(resource.status(), 200);
    const drawer = drawerOf(page);
    await drawer.getByRole('heading', { name: 'In plain words', exact: true }).waitFor();
    assert.equal(await drawer.evaluate(element => element instanceof HTMLDialogElement && element.open), true);
    assert.equal(page.url(), queueUrl);
    assert.equal(await page.evaluate(() => (window as any).drawerDocument), 'original queue');
    assert.equal(await row.getAttribute('data-selected'), 'true');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await drawer.getByRole('button', { name: 'Copy request ID', exact: true }).click();
    await drawer.getByRole('button', { name: 'Copied to clipboard', exact: true }).waitFor();
    const toast = drawer.locator('.toast');
    assert.equal(await toast.isVisible(), true);
    assert.equal(await toast.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), true, 'feedback appears above the native modal layer');
    assert.notEqual(await rowOf(page, untouched).getAttribute('data-selected'), 'true');
    assert.equal(new URL((await drawer.getByRole('link', { name: 'Open full page', exact: true }).getAttribute('href'))!, base).pathname, requestPath);
    assert.match(await drawer.locator('.plain-words').innerText(), /\$1\.25 from Operating to Reserve/);
    assert.equal(await drawer.getByRole('button', { name: 'Copy request ID', exact: true }).getAttribute('data-copy'), held.holdId);
    assert.match(await drawer.locator('.plain-words small').innerText(), /Transfers need approval.*version 1/);
    await drawer.locator('summary').filter({ hasText: 'Why it was held' }).click();
    assert.deepEqual(await drawer.locator('[data-rule-state]').evaluateAll(elements => elements.map(element => element.getAttribute('data-rule-state'))), ['checked', 'checked', 'matched', 'skipped', 'skipped']);
    assert.equal(await drawer.locator(`form[action="${new URL(untouched.approvalUrl).pathname}"]`).count(), 0);
    const foreignResponse = await fetch(resource.url(), { headers: { Cookie: foreign.cookie } });
    assert.equal(foreignResponse.status, 404);
    const foreignHtml = await foreignResponse.text();
    assert.doesNotMatch(foreignHtml, /name="csrf"|name="bodyHash"/);
    assert.ok(!foreignHtml.includes(held.holdId));

    for (const [tab, heading] of [['Details', 'Saved instruction'], ['Events', 'Event timeline'], ['Raw', 'Exact tool call']] as const) {
      const response = page.waitForResponse(result => requestFetch(result.request(), requestPath) && new URL(result.url()).searchParams.get('tab') === tab.toLowerCase());
      await drawer.getByRole('navigation', { name: 'Request views' }).getByRole('link', { name: tab, exact: true }).click();
      assert.equal((await response).status(), 200);
      await drawer.getByRole('heading', { name: heading, exact: true }).waitFor();
      assert.equal(page.url(), queueUrl);
      assert.equal(await drawer.locator('input[name="csrf"]').count(), 0, `${tab} is read-only`);
      assert.equal(await drawer.getByRole('heading', { name: 'In plain words', exact: true }).isVisible(), true);
      assert.equal(await drawer.locator('summary').filter({ hasText: 'Why it was held' }).isVisible(), true);
    }
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    await assertFocused(trigger);
    assert.notEqual(await row.getAttribute('data-selected'), 'true');
    await row.focus();
    await page.keyboard.press('Enter');
    await drawer.getByRole('heading', { name: 'In plain words', exact: true }).waitFor();
    await drawer.getByRole('button', { name: /close/i }).click();
    await drawer.waitFor({ state: 'hidden' });
    await assertFocused(row);

    await trigger.click();
    await drawer.locator('.approval-review summary').waitFor();
    const approve = drawer.getByRole('button', { name: 'Approve transfer', exact: true });
    assert.equal(await approve.isVisible(), false);
    const csrf = await drawer.locator('input[name="csrf"]').inputValue();
    const bodyHash = await drawer.locator('input[name="bodyHash"]').inputValue();
    assert.ok(csrf.length > 0);
    assert.match(bodyHash, /^[a-f0-9]{64}$/);
    await drawer.locator('.approval-review summary').click();
    await approve.waitFor();
    assert.deepEqual(writes, [], 'opening, changing tabs, and reviewing approval must not POST');
    assert.equal(await transferPosts(), before, 'Teller has received no transfer before explicit approval');
    const decisionResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === requestPath);
    await approve.click();
    const decision = await decisionResponse;
    assert.equal(await decision.request().headerValue('origin'), base);
    assert.ok([200, 303].includes(decision.status()));
    const posted = new URLSearchParams(decision.request().postData()!);
    assert.deepEqual([...posted.keys()].sort(), ['action', 'bodyHash', 'csrf']);
    assert.equal(posted.get('action'), 'approve');
    assert.equal(posted.get('csrf'), csrf);
    assert.equal(posted.get('bodyHash'), bodyHash);
    await drawer.getByRole('heading', { name: 'Posted in Teller', exact: true }).waitFor();
    assert.equal(page.url(), queueUrl);
    assert.equal(await page.evaluate(() => (window as any).drawerDocument), 'original queue');
    assert.equal(await transferPosts(), before + 1);
    assert.equal(writes.length, 1);
    assert.match(await drawer.locator('.plain-words').innerText(), /posted.*ledger/i);
    assert.equal(await drawer.locator('input[name="csrf"]').count(), 0);
    assert.equal(await drawer.getByRole('button', { name: 'Approve transfer', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    await assertFocused(trigger);
    await page.waitForFunction(path => document.querySelector(`[data-row-href="${path}"]`)?.getAttribute('data-state') === 'POSTED', requestPath);
    assert.equal(await row.getAttribute('data-state'), 'POSTED');
    assert.equal(await rowOf(page, untouched).getAttribute('data-state'), 'HELD');

    await page.goto(base + '/overview');
    const outcomes = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Request outcomes', exact: true }) });
    assert.equal(await outcomes.getByRole('img', { name: /Needs approval: 1, Posted: 1/ }).count(), 1);
    assert.match(await outcomes.innerText(), /1 of 2 requests posted/);
    const budget = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Call budget', exact: true }) });
    assert.match(await budget.innerText(), /Session calls this minute: \d+ of 30/);
    assert.match(await budget.innerText(), /Shared demo calls today: \d+ of 10000/);
    assert.equal(await budget.locator('[data-ring-value]').count(), 2);
    const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Balance history', exact: true }) });
    assert.equal(await history.getByRole('img', { name: /recorded balance reads/ }).count(), 2);
    assert.ok((await history.innerText()).includes(held.reference));
    await history.getByRole('button', { name: 'Recent reads', exact: true }).click();
    assert.equal(await history.getByRole('button', { name: 'Recent reads', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await history.locator('[data-history-view="recent"]').isVisible(), true);
    assert.equal(await history.locator('[data-history-view="session"]').isVisible(), false);
    const overviewReview = page.getByRole('link', { name: 'Review latest request', exact: true });
    const untouchedPath = new URL(untouched.approvalUrl).pathname;
    assert.equal(await overviewReview.getAttribute('data-open-request'), null, 'Overview keeps native review navigation');
    assert.equal(new URL((await overviewReview.getAttribute('href'))!, base).pathname, untouchedPath);
    const inlineDecision = page.locator(`form[action="${untouchedPath}"]`);
    assert.ok((await inlineDecision.locator('input[name="csrf"]').inputValue()).length > 0);
    const inlineResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === untouchedPath);
    await inlineDecision.getByRole('button', { name: 'Reject request', exact: true }).click();
    assert.equal((await inlineResponse).status(), 303);
    await page.waitForURL(url => url.pathname === untouchedPath);
    await page.getByRole('heading', { name: 'Rejected by you', exact: true }).waitFor();
    assert.equal(await transferPosts(), before + 1, 'the inline rejection does not send another transfer');
    await page.goto(base + '/policies');
    assert.equal(await page.locator('.policy-match').count(), 5);
    assert.ok((await page.locator('.policy-match .match-fill').evaluateAll(elements => elements.map(element => Number(element.getAttribute('width'))))).some(width => width > 0));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('drawer errors remain recoverable and themes, phone layout, and reduced motion remain usable', async () => {
  const s = await session(), held = await prepare(s, 225);
  const requestPath = new URL(held.approvalUrl).pathname;
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    await authenticate(context, s);
    const page = await context.newPage();
    const errors: string[] = [], posts: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    const before = await transferPosts();
    await page.goto(base + '/settings/preferences');
    for (const [choice, scheme] of [['light', 'light'], ['dark', 'dark'], ['system', 'dark']] as const) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      const button = page.locator(`[data-theme-choice="${choice}"]`);
      await button.focus();
      await page.keyboard.press('Enter');
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
      assert.equal(await page.getByRole('combobox', { name: 'Theme', exact: true }).inputValue(), choice);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), scheme);
    }
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
    await page.reload();
    assert.equal(await page.locator('[data-theme-choice="system"]').getAttribute('aria-pressed'), 'true');
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
    assert.equal(await page.locator('[data-theme-choice="dark"]').getAttribute('aria-pressed'), 'true');
    await assertNoOverflow(page);
    await page.goto(base + '/queue');
    const trigger = rowOf(page, held).getByRole('link', { name: held.reference, exact: true });
    await page.route(url => url.pathname === requestPath, route => route.abort('failed'));
    await trigger.click();
    const drawer = drawerOf(page);
    await drawer.getByRole('heading', { name: 'Request unavailable', exact: true }).waitFor();
    assert.equal(await drawer.getByRole('link', { name: 'Open full page', exact: true }).isVisible(), true);
    assert.equal(await drawer.locator('input[name="csrf"]').count(), 0);
    assert.equal(new URL(page.url()).pathname, '/queue');
    await assertNoOverflow(page);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    await assertFocused(trigger);
    await page.unrouteAll();
    for (const viewport of [{ width: 390, height: 844 }, { width: 720, height: 450 }]) {
      await page.setViewportSize(viewport);
      await trigger.click();
      await drawer.getByRole('heading', { name: 'In plain words', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      assert.deepEqual(await drawer.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').map(animation => animation.effect?.getTiming().duration)), []);
      await assertNoOverflow(page);
      await drawer.getByRole('button', { name: /close/i }).click();
      await drawer.waitFor({ state: 'hidden' });
      await assertFocused(trigger);
    }
    await trigger.click();
    await drawer.getByRole('heading', { name: 'In plain words', exact: true }).waitFor();
    await drawer.getByRole('link', { name: 'Open full page', exact: true }).click();
    await page.waitForURL(url => url.pathname === requestPath);
    assert.equal(await page.getByRole('heading', { name: 'In plain words', exact: true }).isVisible(), true);
    await assertNoOverflow(page);

    await page.goto(base + '/audit?view=transfers');
    const auditEntry = page.locator('.event-detail').filter({ has: page.locator(`a[data-open-request][href="${requestPath}"]`) }).first();
    const auditTrigger = auditEntry.locator('summary');
    await auditTrigger.click();
    const eventDialog = page.getByRole('dialog', { name: 'Event details', exact: true });
    await eventDialog.getByRole('link', { name: 'Open request stream', exact: true }).waitFor();
    assert.equal(await eventDialog.locator('.notice').getByText('Demo data. No real money.', { exact: true }).isVisible(), true);
    await eventDialog.getByRole('link', { name: 'Open request stream', exact: true }).click();
    await drawer.getByRole('heading', { name: 'In plain words', exact: true }).waitFor();
    await eventDialog.waitFor({ state: 'hidden' });
    assert.equal(await drawer.locator('.notice').getByText('Demo data. No real money.', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Demo data. No real money.', { exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    await assertFocused(auditTrigger);
    assert.equal(await page.locator('.contextbar .notice').isVisible(), true);
    assert.equal(await transferPosts(), before);
    assert.deepEqual(posts, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('a failed decision response followed by a failed reload never claims the decision was unsent', async () => {
  const s = await session(), held = await prepare(s, 425);
  const requestPath = new URL(held.approvalUrl).pathname;
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await authenticate(context, s);
    const page = await context.newPage();
    let failReads = false, interceptedPosts = 0;
    // Abort before the request reaches the application; this test creates no Teller transfer.
    await page.route(url => url.pathname === requestPath, async route => {
      if (route.request().method() === 'POST') {
        interceptedPosts++;
        await route.abort('failed');
      } else if (failReads) await route.abort('failed');
      else await route.continue();
    });
    const before = await transferPosts();
    await page.goto(base + '/queue');
    await rowOf(page, held).getByRole('link', { name: held.reference, exact: true }).click();
    const drawer = drawerOf(page);
    await drawer.locator('.approval-review summary').click();
    await drawer.getByRole('button', { name: 'Approve transfer', exact: true }).click();
    await drawer.getByRole('alert').filter({ hasText: 'The decision may already be saved' }).waitFor();
    assert.equal(interceptedPosts, 1);
    assert.equal(await transferPosts(), before);
    failReads = true;
    await drawer.getByRole('button', { name: 'Reload request', exact: true }).click();
    await drawer.getByRole('heading', { name: 'Request unavailable', exact: true }).waitFor();
    assert.doesNotMatch(await drawer.innerText(), /decision has not been submitted|nothing (?:was|has been) sent|Teller has received nothing|request was not sent/i);
    assert.equal(await drawer.locator('input[name="csrf"]').count(), 0);
    assert.equal(await drawer.getByRole('link', { name: 'Open full page', exact: true }).isVisible(), true);
    assert.equal(new URL(page.url()).pathname, '/queue');
    assert.equal(await transferPosts(), before);
    assert.equal(interceptedPosts, 1, 'a failed read must not retry the approval POST');
  } finally { await browser.close(); }
});

test('without JavaScript queue links retain full-page review and never bypass approval confirmation', async () => {
  const s = await session(), held = await prepare(s, 325);
  const browser: Browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await authenticate(context, s);
    const page = await context.newPage();
    const before = await transferPosts();
    await page.goto(base + '/queue');
    await rowOf(page, held).getByRole('link', { name: held.reference, exact: true }).click();
    await page.waitForURL(url => url.pathname === new URL(held.approvalUrl).pathname);
    assert.equal(await drawerOf(page).isVisible(), false);
    assert.equal(await page.getByRole('heading', { name: 'In plain words', exact: true }).isVisible(), true);
    assert.equal(await page.locator('summary').filter({ hasText: 'Why it was held' }).isVisible(), true);
    const approve = page.getByRole('button', { name: 'Approve transfer', exact: true });
    assert.equal(await approve.isVisible(), false);
    await page.locator('.approval-review summary').click();
    assert.equal(await approve.isVisible(), true);
    assert.equal(await transferPosts(), before, 'native review details do not send a transfer');
    await assertNoOverflow(page);
  } finally { await browser.close(); }
});

test('switching to Details during an approval refreshes that same drawer and queue after the POST completes', async () => {
  const s = await session(), held = await prepare(s, 525);
  const requestPath = new URL(held.approvalUrl).pathname;
  const browser: Browser = await chromium.launch();
  let releasePost!: () => void;
  const postGate = new Promise<void>(resolve => { releasePost = resolve; });
  let forwardApproval = false;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await authenticate(context, s);
    const page = await context.newPage();
    const errors: string[] = [];
    let interceptedPosts = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route(url => url.pathname === requestPath, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      interceptedPosts++;
      await postGate;
      if (forwardApproval) await route.continue();
      else await route.abort('failed');
    });
    const before = await transferPosts();
    await page.goto(base + '/queue');
    const queueUrl = page.url();
    await page.evaluate(() => { (window as any).drawerDocument = 'pending approval queue'; });
    await rowOf(page, held).getByRole('link', { name: held.reference, exact: true }).click();
    const drawer = drawerOf(page);
    await drawer.locator('.approval-review summary').click();
    const postStarted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === requestPath);
    await drawer.getByRole('button', { name: 'Approve transfer', exact: true }).click();
    await postStarted;
    await drawer.getByRole('navigation', { name: 'Request views' }).getByRole('link', { name: 'Details', exact: true }).click();
    await drawer.getByRole('heading', { name: 'Saved instruction', exact: true }).waitFor();
    assert.equal(await drawer.locator('[data-request-resource]').getAttribute('data-status'), 'HELD');
    assert.equal(await drawer.locator('input[name="csrf"]').count(), 0);
    assert.equal(interceptedPosts, 1);
    assert.equal(await transferPosts(), before, 'the authorized POST is still waiting at the route gate');

    const decisionResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === requestPath);
    forwardApproval = true;
    releasePost();
    assert.equal((await decisionResponse).status(), 303);
    await drawer.getByRole('heading', { name: 'Posted in Teller', exact: true }).waitFor();
    assert.equal(await drawer.locator('[data-request-resource]').getAttribute('data-status'), 'POSTED');
    assert.equal(await drawer.getByRole('heading', { name: 'Saved instruction', exact: true }).isVisible(), true);
    assert.equal(await drawer.getByRole('navigation', { name: 'Request views' }).getByRole('link', { name: 'Details', exact: true }).getAttribute('aria-current'), 'page');
    assert.match(await drawer.locator('.plain-words').innerText(), /posted.*ledger/i);
    assert.equal(page.url(), queueUrl);
    assert.equal(await page.evaluate(() => (window as any).drawerDocument), 'pending approval queue');
    await page.waitForFunction(path => document.querySelector(`[data-row-href="${path}"]`)?.getAttribute('data-state') === 'POSTED', requestPath);
    assert.equal(await transferPosts(), before + 1);
    assert.equal(interceptedPosts, 1, 'refreshing the selected facet never repeats the approval POST');
    assert.deepEqual(errors, []);
  } finally {
    releasePost();
    await browser.close();
  }
});
