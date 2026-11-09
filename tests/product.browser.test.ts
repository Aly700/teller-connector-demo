import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright-core";
import { base, session, mcp } from "./helpers.ts";
import { chromium } from "../scripts/browser.ts";

type Session = Awaited<ReturnType<typeof session>>;
const call = async (s: Session, name: string, args: object) => {
  const response = await mcp(s.tokens.access_token, "tools/call", {
    name,
    arguments: args,
  });
  assert.equal(response.status, 200);
  const result = ((await response.json()) as any).result;
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent;
};
const transferPosts = async () =>
  JSON.parse(await readFile(".data/origin-metrics.json", "utf8")).transferPosts;
async function authenticate(context: BrowserContext, s: Session) {
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
}
const visibleRows = (page: Page) =>
  page.locator("[data-table] [data-table-row]:visible");

test("all console routes stay usable at desktop, phone and narrow landscape sizes in both themes", async () => {
  const browser = await chromium.launch();
  const before = await transferPosts();
  try {
    // Each viewport gets a session so this matrix stays below the real 30-call read budget.
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 720, height: 450 },
    ]) {
      const s = await session();
      const list = await call(s, "list_accounts", {});
      const held = await call(s, "request_transfer", {
        fromAccount: "operating",
        toAccount: "reserve",
        amountMinor: 137,
        currency: "CAD",
        requestKey: list.requestSlots[0].requestKey,
      });
      const context: BrowserContext = await browser.newContext({
        viewport,
        reducedMotion: "reduce",
        timezoneId: "America/Toronto",
      });
      await authenticate(context, s);
      const page = await context.newPage();
      const errors: string[] = [],
        external: string[] = [],
        posts: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (req) => {
        if (new URL(req.url()).origin !== base) external.push(req.url());
        if (req.method() === "POST") posts.push(req.url());
      });
      const requestPath = new URL(held.approvalUrl).pathname;
      const routes = [
        "/overview",
        "/queue",
        "/accounts",
        "/accounts?account=operating",
        "/accounts?account=reserve",
        "/policies",
        "/audit",
        "/eval",
        "/tools",
        "/connection",
        "/settings",
        "/settings/connection",
        "/settings/preferences",
        "/search?q=operating",
        "/guide",
        "/session/end",
        "/queue/sample-held",
        "/queue/sample-posted",
        ...["stream", "details", "events", "raw"].map(
          (tab) => requestPath + "?tab=" + tab,
        ),
        "/missing-product-page",
      ];
      for (const theme of ["dark", "light"] as const) {
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        for (const route of routes) {
          const label = `${route}, ${viewport.width}px, ${theme}`;
          const response = await page.goto(base + route);
          assert.equal(
            response?.status(),
            route === "/missing-product-page" ? 404 : 200,
            label,
          );
          await page.evaluate(() => document.fonts.ready);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
            label,
          );
          assert.equal(
            await page
              .getByText("Demo data. No real money.", { exact: true })
              .count(),
            1,
            label,
          );
          assert.equal(await page.getByRole("main").count(), 1, label);
          assert.equal(
            await page.getByRole("heading", { level: 1 }).count(),
            1,
            label,
          );
          assert.equal(
            await page.evaluate(
              () => getComputedStyle(document.documentElement).colorScheme,
            ),
            theme,
            label,
          );
          assert.equal(
            await page.evaluate(
              () => matchMedia("(prefers-reduced-motion: reduce)").matches,
            ),
            true,
            label,
          );
          assert.equal(
            await page.evaluate(() => document.fonts.check("14px Manrope")),
            true,
            label,
          );
          if (route.endsWith("?tab=stream"))
            assert.equal(
              await page
                .getByRole("button", {
                  name: "Approve transfer",
                  exact: true,
                })
                .isVisible(),
              false,
            );
          if (route.startsWith("/accounts?account=")) {
            const account = new URL(base + route).searchParams.get("account")!;
            assert.equal(
              await page
                .getByRole("heading", {
                  name: "Recent transfers · " + account,
                  exact: true,
                })
                .isVisible(),
              true,
            );
            assert.equal(
              await page
                .getByRole("navigation", {
                  name: "Filter transfers by account",
                })
                .locator('[aria-current="page"]')
                .getAttribute("href"),
              `/accounts?account=${account}#recent`,
            );
          }
        }
      }
      assert.deepEqual(errors, [], `${viewport.width}px browser errors`);
      assert.deepEqual(external, [], `${viewport.width}px external assets`);
      assert.deepEqual(posts, [], `${viewport.width}px browser writes`);
      await context.close();
    }
    assert.equal(
      await transferPosts(),
      before,
      "Browsing the console must never dispatch a Teller transfer",
    );
  } finally {
    await browser.close();
  }
});

test("search, nested navigation, preferences and confirmation are keyboard operable and persist correctly", async () => {
  const s = await session();
  const list = await call(s, "list_accounts", {});
  const held = await call(s, "request_transfer", {
    fromAccount: "operating",
    toAccount: "reserve",
    amountMinor: 275,
    currency: "CAD",
    requestKey: list.requestSlots[0].requestKey,
  });
  const browser = await chromium.launch();
  const before = await transferPosts();
  try {
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      colorScheme: "light",
      timezoneId: "America/Toronto",
    });
    await authenticate(context, s);
    const page = await context.newPage();
    const indexRequests: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/console/snapshot")
        indexRequests.push(req.url());
    });
    await page.goto(base + "/tools");
    await page.keyboard.press("/");
    assert.equal(
      await page
        .locator("#global-search")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page
      .getByRole("searchbox", { name: "Search this session" })
      .fill(held.holdId);
    await page.locator("#search-results a").first().waitFor();
    assert.equal(
      await page.locator("#search-results a").first().getAttribute("href"),
      new URL(held.approvalUrl).pathname,
    );
    assert.deepEqual(
      indexRequests,
      [],
      "Search should use the session index already rendered in the page",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page
        .locator("#search-results a")
        .first()
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Enter");
    await page.waitForURL(held.approvalUrl);
    const review = page.locator(".approval-review summary");
    await review.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page
        .getByRole("button", { name: "Approve transfer", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(await transferPosts(), before);
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "Approve transfer", exact: true })
        .isVisible(),
      false,
    );
    assert.equal(
      await review.evaluate((el) => el === document.activeElement),
      true,
    );
    for (const [label, tab, heading] of [
      ["Details", "details", "Saved instruction"],
      ["Events", "events", "Event timeline"],
      ["Raw", "raw", "Exact tool call"],
    ] as const) {
      await page
        .getByRole("navigation", { name: "Request views" })
        .getByRole("link", { name: label, exact: true })
        .click();
      await page.waitForLoadState("load");
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("tab"), tab);
      assert.equal(
        await page
          .getByRole("heading", { name: heading, exact: true })
          .isVisible(),
        true,
      );
      assert.equal(
        await page
          .getByRole("navigation", { name: "Request views" })
          .getByRole("link", { name: label, exact: true })
          .getAttribute("aria-current"),
        "page",
      );
    }
    await page.goto(base + "/settings");
    assert.equal(
      await page
        .getByRole("heading", { name: "Danger zone", exact: true })
        .isVisible(),
      true,
    );
    await page
      .getByRole("navigation", { name: "Settings navigation" })
      .getByRole("link", { name: "Preferences", exact: true })
      .click();
    await page.waitForLoadState("load");
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("dark");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.reload();
    assert.equal(
      await page
        .getByRole("combobox", { name: "Theme", exact: true })
        .inputValue(),
      "dark",
    );
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("light");
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      ),
      "light",
    );
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("system");
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal(await page.locator("html").getAttribute("data-theme"), null);
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      ),
      "dark",
    );
    await page
      .getByRole("combobox", { name: "Time display", exact: true })
      .selectOption("utc");
    await page
      .getByRole("navigation", { name: "Settings navigation" })
      .getByRole("link", { name: "Connection", exact: true })
      .click();
    await page.waitForLoadState("load");
    assert.match(
      await page.locator("[data-local-time]").first().innerText(),
      /UTC/,
    );
    assert.match(
      (await page.locator("[data-local-time]").first().getAttribute("title")) ??
        "",
      /Z$/,
    );
    await page
      .getByRole("navigation", { name: "Settings navigation" })
      .getByRole("link", { name: "Preferences", exact: true })
      .click();
    await page.waitForLoadState("load");
    assert.equal(
      await page
        .getByRole("combobox", { name: "Time display", exact: true })
        .inputValue(),
      "utc",
    );
    await page
      .getByRole("combobox", { name: "Time display", exact: true })
      .selectOption("local");
    await page.goto(base + "/connection");
    assert.match(
      await page.locator("[data-local-time]").first().innerText(),
      /[ED]ST/,
    );
    await page
      .getByRole("navigation", { name: "Developer navigation" })
      .getByRole("link", { name: "Tools", exact: true })
      .click();
    await page.waitForLoadState("load");
    assert.equal(new URL(page.url()).pathname, "/tools");
    await page
      .getByRole("searchbox", { name: "Search this session" })
      .fill("no-matching-console-record");
    await page
      .getByText("No matching records. Try a request key or event name.", {
        exact: true,
      })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#search-results").isVisible(), false);
    await page
      .getByRole("searchbox", { name: "Search this session" })
      .fill("</template><script>window.consoleXss=true</script>");
    await page
      .getByText("No matching records. Try a request key or event name.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(() => (window as any).consoleXss),
      undefined,
    );
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page.waitForLoadState("load");
    assert.equal(
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Overview", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page.waitForLoadState("load");
    await page.keyboard.press("/");
    assert.equal(
      await page.locator("html").getAttribute("data-nav-open"),
      null,
    );
    assert.equal(
      await page
        .getByRole("searchbox", { name: "Search this session", exact: true })
        .isVisible(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await transferPosts(), before);
    for (const path of [
      "/overview",
      "/policies",
      "/tools",
      "/connection",
      "/settings",
      "/settings/connection",
      "/settings/preferences",
      "/search",
      "/console/snapshot",
    ]) {
      assert.equal(
        (
          await fetch(base + path, {
            headers: { Authorization: "Bearer " + s.tokens.access_token },
          })
        ).status,
        401,
        path,
      );
    }
  } finally {
    await browser.close();
  }
});

test("request, audit and evaluation tables filter, sort, paginate and open full event records", async () => {
  const s = await session();
  const list = await call(s, "list_accounts", {});
  const amounts = [325, 125, 225];
  const held = [];
  for (const [index, amountMinor] of amounts.entries())
    held.push(
      await call(s, "request_transfer", {
        fromAccount: "operating",
        toAccount: "reserve",
        amountMinor,
        currency: "CAD",
        requestKey: list.requestSlots[index].requestKey,
      }),
    );
  // Duplicate requests add audit evidence without dispatching another transfer or consuming a new slot.
  for (let i = 0; i < 8; i++)
    await call(s, "request_transfer", {
      fromAccount: "operating",
      toAccount: "reserve",
      amountMinor: amounts[0],
      currency: "CAD",
      requestKey: list.requestSlots[0].requestKey,
    });
  const browser = await chromium.launch();
  const before = await transferPosts();
  try {
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    await authenticate(context, s);
    const page = await context.newPage();
    await page.goto(held[1].approvalUrl);
    await page
      .getByRole("button", { name: "Reject request", exact: true })
      .click();
    await page.waitForLoadState("load");
    await page
      .getByRole("heading", { name: "Rejected by you", exact: true })
      .waitFor();
    await page.goto(base + "/queue");
    assert.equal(await visibleRows(page).count(), 3);
    await page
      .getByRole("combobox", { name: "Filter requests by state", exact: true })
      .selectOption("DENIED");
    assert.equal(await visibleRows(page).count(), 1);
    assert.match(
      await visibleRows(page).innerText(),
      new RegExp(held[1].reference),
    );
    await page
      .getByRole("button", { name: "Needs approval", exact: true })
      .click();
    await page.waitForLoadState("load");
    assert.equal(await visibleRows(page).count(), 2);
    await page
      .getByRole("button", { name: "All requests", exact: true })
      .click();
    await page.waitForLoadState("load");
    await page
      .getByRole("combobox", { name: "Sort requests", exact: true })
      .selectOption("amount-asc");
    assert.deepEqual(
      await visibleRows(page).evaluateAll((rows) =>
        rows.map((row) => Number((row as HTMLElement).dataset.amount)),
      ),
      [125, 225, 325],
    );
    await page
      .getByRole("combobox", { name: "Sort requests", exact: true })
      .selectOption("amount-desc");
    assert.deepEqual(
      await visibleRows(page).evaluateAll((rows) =>
        rows.map((row) => Number((row as HTMLElement).dataset.amount)),
      ),
      [325, 225, 125],
    );
    await page
      .getByRole("searchbox", { name: "Search requests", exact: true })
      .fill(list.requestSlots[2].requestKey);
    assert.equal(await visibleRows(page).count(), 1);
    assert.match(
      await visibleRows(page).innerText(),
      new RegExp(held[2].reference),
    );
    await page
      .getByRole("searchbox", { name: "Search requests", exact: true })
      .fill("not-a-real-request");
    assert.equal(await visibleRows(page).count(), 0);
    assert.equal(
      await page
        .getByText("No requests in this view.", { exact: true })
        .isVisible(),
      true,
    );
    await page.goto(base + "/queue?state=HELD");
    assert.equal(
      await page
        .getByRole("combobox", {
          name: "Filter requests by state",
          exact: true,
        })
        .inputValue(),
      "HELD",
    );
    assert.equal(await visibleRows(page).count(), 2);
    await page.goto(base + "/audit");
    assert.equal(
      await page.locator(".audit-filters [aria-current]").innerText(),
      "Transfers",
    );
    await page.getByRole("link", { name: "All events", exact: true }).click();
    await page.waitForLoadState("load");
    const totalEvents = await page.locator("[data-table-row]").count();
    assert.ok(totalEvents > 10);
    assert.equal(await visibleRows(page).count(), 10);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await page.waitForLoadState("load");
    assert.match(await page.locator("[data-page-info]").innerText(), /^11–/);
    await page
      .getByRole("combobox", { name: "Rows per page", exact: true })
      .selectOption("25");
    assert.equal(await visibleRows(page).count(), totalEvents);
    await page
      .getByRole("combobox", { name: "Filter event type", exact: true })
      .selectOption("HELD");
    assert.equal(await visibleRows(page).count(), 3);
    await page
      .getByRole("searchbox", { name: "Search events", exact: true })
      .fill(held[0].holdId);
    assert.equal(await visibleRows(page).count(), 1);
    await visibleRows(page).locator("summary").click();
    await page.waitForLoadState("load");
    const dialog = page.getByRole("dialog", {
      name: "Event details",
      exact: true,
    });
    await dialog.waitFor();
    const event = JSON.parse(await dialog.locator("pre").innerText());
    assert.equal(event.holdId, held[0].holdId);
    assert.equal(event.requestKey, list.requestSlots[0].requestKey);
    assert.equal(event.type, "HELD");
    assert.equal(event.policyRule, "browser-approval");
    assert.equal(new URL(page.url()).searchParams.get("event"), event.eventId);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.equal(new URL(page.url()).searchParams.has("event"), false);
    await page.goto(base + "/audit?event=" + event.eventId);
    await dialog.waitFor();
    assert.equal(
      JSON.parse(await dialog.locator("pre").innerText()).eventId,
      event.eventId,
    );
    await dialog
      .getByRole("button", { name: "Close event details", exact: true })
      .click();
    await page.waitForLoadState("load");
    await page
      .getByRole("navigation", { name: "Filter audit events" })
      .getByRole("link", { name: "Transfers", exact: true })
      .click();
    await page.waitForLoadState("load");
    assert.ok((await page.locator("[data-table-row]").count()) >= 12);
    const exported = await fetch(base + "/audit/export", {
      headers: { Cookie: s.cookie },
    });
    const fullEvents = (await exported.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(fullEvents.length, totalEvents);
    assert.ok(fullEvents.some((record) => record.type === "READ_OK"));
    await page.goto(base + "/eval");
    assert.equal(
      await page
        .getByRole("heading", { name: "Not run yet", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(await page.locator("[data-table-row]").count(), 80);
    assert.equal(await visibleRows(page).count(), 10);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await page.waitForLoadState("load");
    assert.equal(
      await page.locator("[data-page-info]").innerText(),
      "11–20 of 80",
    );
    await page
      .getByRole("combobox", { name: "Rows per page", exact: true })
      .selectOption("50");
    assert.equal(await visibleRows(page).count(), 50);
    await page
      .getByRole("combobox", { name: "Filter cases by outcome", exact: true })
      .selectOption("hold");
    assert.equal(await visibleRows(page).count(), 20);
    await page
      .getByRole("combobox", { name: "Filter cases by outcome", exact: true })
      .selectOption("refuse");
    assert.equal(await visibleRows(page).count(), 26);
    await page
      .getByRole("combobox", { name: "Filter cases by outcome", exact: true })
      .selectOption("read");
    assert.equal(await visibleRows(page).count(), 34);
    const family = await visibleRows(page).first().getAttribute("data-tool");
    await page
      .getByRole("combobox", { name: "Filter cases by tool", exact: true })
      .selectOption(family!);
    assert.ok((await visibleRows(page).count()) > 0);
    assert.ok(
      (
        await visibleRows(page).evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-tool")),
        )
      ).every((value) => value === family),
    );
    const caseId = await visibleRows(page)
      .first()
      .locator("td")
      .first()
      .innerText();
    await page
      .getByRole("searchbox", { name: "Search cases", exact: true })
      .fill(caseId);
    assert.equal(await visibleRows(page).count(), 1);
    await visibleRows(page).locator("summary").click();
    await page.waitForLoadState("load");
    assert.equal(
      await page
        .getByRole("dialog")
        .getByRole("heading", { name: caseId, exact: true })
        .isVisible(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await visibleRows(page).locator("details").getAttribute("open"),
      null,
    );
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await visibleRows(page)
        .locator("summary")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await visibleRows(page).locator("summary").click();
    await page.waitForLoadState("load");
    await page.getByRole("button", { name: "Close case", exact: true }).click();
    await page.waitForLoadState("load");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await transferPosts(),
      before,
      "Rejecting and browsing records must not dispatch a transfer",
    );
  } finally {
    await browser.close();
  }
});
