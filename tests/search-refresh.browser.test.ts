import { test } from "node:test";
import assert from "node:assert/strict";
import type { BrowserContext } from "playwright-core";
import { base, session, mcp } from "./helpers.ts";
import { chromium } from "../scripts/browser.ts";

test(
  "queue polling refreshes searchable read events without a hold revision change",
  { timeout: 45000 },
  async () => {
    const s = await session();
    const call = async (name: string, args: object) => {
      const response = await mcp(s.tokens.access_token, "tools/call", {
        name,
        arguments: args,
      });
      assert.equal(response.status, 200);
      const result = ((await response.json()) as any).result;
      assert.ok(!result.isError, JSON.stringify(result));
      return result.structuredContent;
    };
    const accounts = await call("list_sample_accounts", {});
    await call("request_sample_transfer", {
      fromAccount: "operating",
      toAccount: "reserve",
      amountMinor: 137,
      currency: "CAD",
      requestKey: accounts.requestSlots[0].requestKey,
    });
    const browser = await chromium.launch();
    try {
      const context: BrowserContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      await context.addCookies([
        {
          name: "__Host-sample-session",
          value: /__Host-sample-session=([^;]+)/.exec(s.cookie)![1],
          domain: "localhost",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + "/queue");
      const revision = await page
        .locator("[data-live-queue]")
        .getAttribute("data-revision");
      const initialIndex = await page
        .locator("[data-console-index]")
        .evaluate((element) =>
          JSON.parse(
            (element as HTMLTemplateElement).content.textContent ?? "{}",
          ),
        );

      // This records a new event while leaving the saved transfer untouched.
      await call("get_sample_account", { account: "operating" });
      const exported = await fetch(base + "/audit/export", {
        headers: { Cookie: s.cookie },
      });
      assert.equal(exported.status, 200);
      const events = (await exported.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const event = events.find(
        (record) =>
          record.type === "READ_OK" && record.tool === "get_sample_account",
      );
      assert.ok(event, "The real MCP read must record an audit event");
      assert.ok(
        !initialIndex.items.some(
          (item: { url: string }) =>
            item.url === "/audit?event=" + event.eventId,
        ),
      );

      // Focus remains inside the queue: an index refresh must not depend on replacing its rows.
      await page
        .getByRole("searchbox", { name: "Search requests", exact: true })
        .focus();
      const response = await page.waitForResponse(
        (result) =>
          new URL(result.url()).pathname === "/queue/snapshot" &&
          result.status() === 200,
        { timeout: 20000 },
      );
      const snapshot = await response.json();
      assert.equal(snapshot.revision, revision);
      assert.ok(
        snapshot.index.items.some(
          (item: { url: string }) =>
            item.url === "/audit?event=" + event.eventId,
        ),
      );
      await page.waitForFunction(() =>
        document
          .querySelector("[data-sync-status]")
          ?.textContent?.startsWith("Up to date"),
      );

      await page
        .getByRole("searchbox", { name: "Search this session", exact: true })
        .fill(event.eventId);
      const result = page
        .locator("#search-results a")
        .filter({ hasText: "Sample data read" });
      await result.waitFor({ timeout: 5000 });
      assert.equal(
        await result.getAttribute("href"),
        "/audit?event=" + event.eventId,
      );
      assert.equal(
        await page.locator("[data-live-queue]").getAttribute("data-revision"),
        revision,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
