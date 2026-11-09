import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../scripts/browser.ts';
import { session, mcp, base } from './helpers.ts';

test('product copy stays natural across pages and drawers while technical policy facts remain inspectable', async () => {
  const s = await session();
  const call = async (name: string, args: object) => {
    const result: any = await (await mcp(s.tokens.access_token, 'tools/call', { name, arguments: args })).json();
    assert.equal(result.result.isError, undefined);
    return result.result.structuredContent;
  };
  const list = await call('list_accounts', {});
  const held = await call('request_transfer', {
    fromAccount: 'operating', toAccount: 'reserve', amountMinor: 725, currency: 'CAD',
    requestKey: list.requestSlots[0].requestKey,
  });
  const path = new URL(held.approvalUrl).pathname;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.addCookies([{
    name: '__Host-sample-session', value: /__Host-sample-session=([^;]+)/.exec(s.cookie)![1],
    domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax',
  }]);
  const p = await context.newPage();
  p.setDefaultTimeout(15000);
  const errors: string[] = [];
  p.on('pageerror', (error: Error) => errors.push(error.message));
  const checkNotice = async () => assert.equal(await p.getByText('Demo data. No real money.', { exact: true }).count(), 1);
  try {
    for (const route of ['/overview', '/queue', '/accounts', '/policies', '/audit', '/eval', '/tools', '/connection', '/settings', '/settings/preferences', '/settings/connection', '/guide', '/session/end', '/search?q=operating', '/missing', '/queue/sample-held', '/queue/sample-posted']) {
      await p.goto(base + route);
      await checkNotice();
      const labels = await p.locator('h1,h2,h3,label,button,a,summary').allTextContents();
      assert.doesNotMatch(labels.join(' '), /\bsample\b/i, route);
      assert.doesNotMatch(await p.locator('body').innerText(), /browser gate|browser session/i, route);
      if (route === '/policies') {
        assert.doesNotMatch(await p.locator('main').innerText(), /browser-approval|sample-gate-v1/);
        assert.ok((await p.locator('main').innerText()).includes('Transfers need approval'));
      }
    }
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await p.goto(base + '/queue');
      await p.locator(`[data-row-href="${path}"]`).getByRole('link', { name: held.reference, exact: true }).click();
      const drawer = p.getByRole('dialog', { name: 'Request details', exact: true });
      await drawer.locator('.plain-words').waitFor();
      assert.equal(await drawer.locator('.plain-words > p').innerText(), 'The agent asked to move $7.25 from Operating to Reserve. Transfers need your approval, so it is waiting here. Approve to send it to Teller once, or reject to close it without sending. Teller has received nothing yet.');
      await drawer.locator('.policy-trace summary').click();
      await drawer.locator('.metadata > summary').filter({ hasText: 'Event timeline' }).click();
      assert.doesNotMatch(await drawer.innerText(), /sample-gate-v1|browser-approval|browser gate|browser session/i);
      assert.match(await drawer.locator('.policy-stamp').innerText(), /Transfers need approval.*version 1/s);
      await checkNotice();
      for (const tab of ['Details', 'Raw']) {
        await drawer.getByRole('link', { name: tab, exact: true }).click();
        await drawer.locator(`.resource-tabs a[aria-current="page"]`).filter({ hasText: tab }).waitFor();
        assert.match(await drawer.innerText(), /browser-approval/);
        assert.match(await drawer.innerText(), /sample-gate-v1/);
        await checkNotice();
      }
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await p.keyboard.press('Escape');
    }
    await p.goto(base + '/audit');
    await p.locator('.event-detail > summary').filter({ hasText: 'Held by the connector' }).click();
    const event = p.getByRole('dialog', { name: 'Event details', exact: true });
    await event.locator('.event-facts').waitFor();
    assert.match(await event.locator('.event-facts').innerText(), /Transfers need approval/);
    assert.doesNotMatch(await event.innerText(), /browser-approval|sample-gate-v1/);
    await event.getByRole('button', { name: 'Show full event JSON', exact: true }).click();
    assert.match(await event.locator('pre').innerText(), /browser-approval/);
    assert.match(await event.locator('pre').innerText(), /sample-gate-v1/);
    await checkNotice();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
});
