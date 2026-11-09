import type { Browser } from "playwright-core";
import { test } from "node:test";
import assert from "node:assert/strict";
import { session, mcp } from "./helpers.ts";
import { chromium } from "../scripts/browser.ts";

// Run ledger writes after the shared live-seed baseline checks.
test("approved balances retain their values and changes with or without motion", async () => {
  const s = await session();
  const call = async (name: string, args: object) => {
    const response = (await (
      await mcp(s.tokens.access_token, "tools/call", { name, arguments: args })
    ).json()) as any;
    assert.ok(!response.result.isError);
    return response.result.structuredContent;
  };
  const list = await call("list_accounts", {});
  const browser: Browser = await chromium.launch();
  try {
    for (const [slot, reduced] of [false, true].entries()) {
      const held = await call("request_transfer", {
        fromAccount: "operating",
        toAccount: "reserve",
        amountMinor: 125,
        currency: "CAD",
        requestKey: list.requestSlots[slot].requestKey,
      });
      const context = await browser.newContext({
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      await context.addCookies([
        {
          name: "__Host-sample-session",
          value: /__Host-sample-session=([^;]+)/.exec(s.cookie)![1],
          domain: "localhost",
          path: "/",
          secure: true,
        },
      ]);
      await context.addInitScript(() => {
        const durations: number[] = [];
        (window as any).ledgerMotion = durations;
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          if (this.classList.contains("digit-track"))
            durations.push(
              Number((args[1] as KeyframeAnimationOptions).duration),
            );
          return animate.apply(this, args);
        };
      });
      const page = await context.newPage();
      await page.goto(held.approvalUrl);
      const before = await page
        .locator("[data-balance]")
        .evaluateAll((elements) =>
          elements.map((e) => Number((e as HTMLElement).dataset.value)),
        );
      await page.locator(".approval-review summary").click();
      await page
        .getByRole("button", { name: "Approve transfer", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Posted in Teller", exact: true })
        .waitFor();
      await page.locator(".balance-change").first().waitFor();
      const after = await page
        .locator("[data-balance]")
        .evaluateAll((elements) =>
          elements.map((e) => Number((e as HTMLElement).dataset.value)),
        );
      assert.deepEqual(
        after.map((value, i) => value - before[i]),
        [-125, 125],
      );
      assert.deepEqual(
        await page.locator(".balance-change").allTextContents(),
        ["−$1.25 since previous view", "+$1.25 since previous view"],
      );
      const durations = await page.evaluate(
        () => (window as any).ledgerMotion as number[],
      );
      if (reduced) assert.deepEqual(durations, []);
      else
        assert.ok(
          durations.length > 0 &&
            durations.every((duration) => duration === 240),
        );
      assert.match(
        await page.locator(".posted-amount").innerText(),
        /1\.25 CAD recorded/,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
