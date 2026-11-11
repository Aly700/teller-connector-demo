import frozenCases from "../../../eval/cases.jsonl";
import { evaluationCatalog } from "./catalog.ts";
import { productPage } from "./product.ts";
import { consoleSnapshot, consoleIndex } from "./console-data.ts";
import {
  consumeTool,
  securityEvent,
  pruneLimits,
} from "../../../packages/limits.ts";
import { endSession } from "./session.ts";
import { reportPage, evalRoute, retainReports } from "../../../eval/report.ts";
import css from "./styles.css";
import consoleScript from "./console.js";
import manrope from "../assets/manrope-latin.woff2";
import plex from "../assets/plex-mono-latin.woff2";
import { homePage, guidePage } from "./guide.ts";
import {
  queuePage,
  detailPage,
  seededPage,
  pageError,
  accountsPage,
  mcpBrowserPage,
} from "./pages.ts";
import { auditExport, auditPage, recordCall } from "./audit.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resource, type Env } from "./auth.ts";
import { bounded, safeHttp, page, escapeHtml } from "../../../packages/http.ts";
import {
  browserSession,
  config,
  type Registry,
} from "../../../packages/state.ts";
import { readTool, tools, unavailable } from "./tools.ts";
import { watchdog } from "../../../packages/gate/dispatch.ts";
import {
  createHold,
  heldResult,
  getHold,
  expireHold,
  sweepHolds,
  type Hold,
} from "../../../packages/gate/holds.ts";
import { WRITE_TOOL, evaluate } from "../../../packages/gate/policy.ts";
import { holdErrors } from "../../../packages/gate/errors.ts";
import { decisionRoute } from "./decisions.ts";
import { failure, success } from "./tools.ts";
import { TellerClient } from "./teller.ts";
async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_ORIGIN) return safeHttp("INVALID_HOST", 403);
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.PUBLIC_ORIGIN)
      return safeHttp("INVALID_ORIGIN", 403);
    if (url.pathname.startsWith("/internal/eval/")) {
      if (
        !["/internal/eval/reserve", "/internal/eval/report"].includes(
          url.pathname,
        )
      )
        return safeHttp("NOT_FOUND", 404);
      if (!(await bounded(request, 512 * 1024)))
        return safeHttp("TOO_LARGE", 413);
      return await evalRoute(request, env.DB, env.EVAL_REPORT_SECRET);
    }
    if (url.pathname === "/eval" && request.method === "GET")
      return await reportPage(
        env.DB,
        false,
        Date.now(),
        evaluationCatalog(frozenCases),
      );
    if (url.pathname === "/eval.json" && request.method === "GET")
      return await reportPage(env.DB, true);
    if (!(await bounded(request))) {
      await securityEvent(env.DB, "TOO_LARGE");
      return safeHttp("TOO_LARGE", 413);
    }
    if (url.pathname === "/session/end")
      return await endSession(request, env.DB, env.PUBLIC_ORIGIN);
    if (
      url.pathname === "/authorize" ||
      url.pathname.startsWith("/oauth/") ||
      url.pathname === "/.well-known/oauth-authorization-server"
    )
      return env.AUTH_SERVER.fetch(request);
    if (url.pathname === "/favicon.ico")
      return new Response(null, { status: 204 });
    if (url.pathname === "/styles.css")
      return new Response(css, {
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    if (url.pathname === "/console.js" && request.method === "GET")
      return new Response(consoleScript, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    const fonts: Record<string, ArrayBuffer> = {
      "/assets/manrope-latin.woff2": manrope,
      "/assets/plex-mono-latin.woff2": plex,
    };
    if (fonts[url.pathname] && request.method === "GET")
      return new Response(fonts[url.pathname], {
        headers: {
          "Content-Type": "font/woff2",
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (url.pathname === "/" && request.method === "GET")
      return (await browserSession(env.DB, request))
        ? productPage(request, env, "overview")
        : homePage();
    if (url.pathname === "/console/snapshot" && request.method === "GET")
      return consoleSnapshot(request, env);
    if (
      [
        "/overview",
        "/policies",
        "/tools",
        "/connection",
        "/settings",
        "/settings/connection",
        "/settings/preferences",
        "/search",
      ].includes(url.pathname) &&
      request.method === "GET"
    )
      return productPage(request, env, url.pathname.slice(1));
    if (url.pathname === "/guide" && request.method === "GET")
      return guidePage(request, env);
    if (url.pathname === "/accounts" && request.method === "GET")
      return accountsPage(request, env);
    if (url.pathname === "/audit" && request.method === "GET")
      return auditPage(request, env.DB);
    if (url.pathname === "/queue/snapshot" && request.method === "GET")
      return queuePage(request, env, true);
    if (url.pathname === "/audit/export")
      return await auditExport(request, env.DB);
    if (url.pathname === "/queue" && request.method === "GET")
      return await queuePage(request, env);
    if (
      /^\/queue\/sample-(held|posted)$/.test(url.pathname) &&
      request.method === "GET"
    ) {
      return await seededPage(request, env, url.pathname.split("/")[2]);
    }
    const queue = /^\/queue\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (queue) return await decisionRoute(request, env, queue[1]);
    if (
      url.pathname !== "/mcp" &&
      url.pathname !== "/.well-known/oauth-protected-resource/mcp"
    )
      return request.method === "GET"
        ? pageError(
            "Page not found",
            "This address does not point to a page. Return to your queue or open the guide.",
            404,
          )
        : safeHttp("NOT_FOUND", 404);
    const response = await resource(env, async (req, props, scopes) => {
      const server = new Server(
        { name: "teller-connector", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
      server.setRequestHandler(CallToolRequestSchema, async (call) => {
        const started = Date.now();
        try {
          if (!(await consumeTool(env.DB, props, call.params.name)))
            return failure(
              "RATE_LIMIT",
              "The call limit has been reached. Try again later.",
            );
          if (!tools.some((t) => t.name === call.params.name)) {
            await securityEvent(env.DB, "UNKNOWN_TOOL", props);
            return failure(
              "UNKNOWN_TOOL",
              "Choose one of the four tools.",
            );
          }
          const settings = await config(env.DB);
          if (
            evaluate(
              call.params.name,
              JSON.parse(settings.tools_json)[call.params.name] === true,
              true,
              settings.epoch === props.epoch,
            ).effect === "DENY"
          ) {
            const result = unavailable();
            await recordCall(
              env.DB,
              props,
              call.params.name,
              null,
              result,
              started,
              undefined,
              false,
            );
            return result;
          }
          const registry = await env.DB.prepare(
            "SELECT * FROM sample_registry WHERE visitor_id=? AND epoch=?",
          )
            .bind(props.visitorId, props.epoch)
            .first<Registry>();
          if (!registry) return unavailable();
          if (call.params.name === WRITE_TOOL) {
            if (!scopes.includes("sample:request")) {
              const result = failure(
                "INSUFFICIENT_SCOPE",
                "Reconnect with sample:request to request a held transfer.",
              );
              await recordCall(
                env.DB,
                props,
                call.params.name,
                null,
                result,
                started,
              );
              return result;
            }
            try {
              return success(
                heldResult(
                  await createHold(env.DB, props, call.params.arguments),
                  env.PUBLIC_ORIGIN,
                ),
              );
            } catch (error) {
              const code =
                error instanceof Error && holdErrors[error.message]
                  ? error.message
                  : "HOLD_UNCONFIRMED";
              const result = failure(code, holdErrors[code]);
              try {
                await recordCall(
                  env.DB,
                  props,
                  call.params.name,
                  null,
                  result,
                  started,
                );
              } catch {}
              return result;
            }
          }
          const holds = await env.DB.prepare(
            "SELECT * FROM holds WHERE visitor_id=? AND epoch=?",
          )
            .bind(props.visitorId, props.epoch)
            .all<Hold>();
          registry.request_slots_json = JSON.stringify(
            JSON.parse(registry.request_slots_json).map((slot: any) => ({
              ...slot,
              used: holds.results.some(
                (h) => h.request_key === slot.requestKey,
              ),
            })),
          );
          for (let i = 0; i < holds.results.length; i++)
            holds.results[i] = await expireHold(env.DB, holds.results[i]);
          const result = await readTool(
            call.params.name,
            call.params.arguments,
            registry,
            new TellerClient(
              env.ORIGIN_URL,
              env.ORIGIN_SIGNING_SECRET,
              props.epoch,
            ),
            holds.results,
            env.PUBLIC_ORIGIN,
          );
          await recordCall(
            env.DB,
            props,
            call.params.name,
            call.params.arguments,
            result,
            started,
            holds.results.find(
              (h) => h.reference === call.params.arguments?.reference,
            ),
          );
          return result;
        } catch {
          return unavailable();
        }
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return transport.handleRequest(req);
    }).fetch(request, env, ctx);
    if (response.status === 401 && browserVisit(request))
      return mcpBrowserPage(env.PUBLIC_ORIGIN, response.headers.get("WWW-Authenticate"));
    if (response.status === 401 || response.status === 403)
      await securityEvent(env.DB, "AUTH_FAILURE");
    return response;
  } catch {
    return new URL(request.url).pathname.startsWith("/mcp")
      ? safeHttp("DEMO_UNAVAILABLE", 503)
      : pageError(
          "Service unavailable",
          "The demo is unavailable. Try again later.",
          503,
        );
  }
}
function browserVisit(request: Request) {
  return (
    request.method === "GET" &&
    new URL(request.url).pathname === "/mcp" &&
    !request.headers.has("Authorization") &&
    (request.headers.get("Accept") ?? "").includes("text/html")
  );
}
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const response = await handleRequest(request, env, ctx);
    if (!response.headers.get("Content-Type")?.includes("text/html"))
      return response;
    try {
      const visitor = await browserSession(env.DB, request);
      if (!visitor) return response;
      const index = await consoleIndex(request, env, visitor);
      return new HTMLRewriter()
        .on("[data-pending-link]", {
          element(el) {
            el.setAttribute("aria-label", `${index.pending} pending approvals`);
          },
        })
        .on("[data-session-expiry]", {
          element(el) {
            el.setInnerContent(
              `Session expires <time data-session-time datetime="${new Date(visitor.expires_at).toISOString()}">${new Date(visitor.expires_at).toISOString()}</time>`,
              { html: true },
            );
          },
        })
        .on("[data-pending-count]", {
          element(el) {
            el.setInnerContent(String(index.pending));
          },
        })
        .on("body", {
          element(el) {
            el.append(
              `<template data-console-index>${escapeHtml(JSON.stringify(index))}</template>`,
              { html: true },
            );
          },
        })
        .transform(response);
    } catch {
      return response;
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      Promise.all([
        sweepHolds(env.DB),
        watchdog(env.DB),
        retainReports(env.DB),
        pruneLimits(env.DB),
      ]),
    );
  },
};
