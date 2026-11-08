import {
  browserSession,
  type Visitor,
  type Registry,
} from "../../../packages/state.ts";
import { safeHttp } from "../../../packages/http.ts";
import { consumeTool } from "../../../packages/limits.ts";
import type { Hold } from "../../../packages/gate/holds.ts";
import type { Env } from "./auth.ts";
import { auditExport } from "./audit.ts";
import { eventTitle, money, labels } from "./view.ts";

export async function sessionEvents(request: Request, db: D1Database) {
  const url = new URL("/audit/export", request.url);
  const response = await auditExport(
    new Request(url, { headers: request.headers }),
    db,
  );
  if (!response.ok) return [];
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
export async function consoleIndex(
  request: Request,
  env: Env,
  visitor: Visitor,
) {
  const [rows, events, registry] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM holds WHERE visitor_id=? AND epoch=? ORDER BY created_at DESC,id",
    )
      .bind(visitor.id, visitor.epoch)
      .all<Hold>(),
    sessionEvents(request, env.DB),
    env.DB.prepare(
      "SELECT * FROM sample_registry WHERE visitor_id=? AND epoch=?",
    )
      .bind(visitor.id, visitor.epoch)
      .first<Registry>(),
  ]);
  const holds = rows.results;
  const items = [
    ...holds.map((h) => {
      const a = JSON.parse(h.arguments_json);
      return {
        kind: "Request",
        title: h.reference,
        detail: `${money(a.amountMinor)} · ${labels[h.status] ?? h.status}`,
        text: [
          h.id,
          h.request_key,
          h.reference,
          h.status,
          h.teller_id,
          a.fromAccount,
          a.toAccount,
        ].join(" "),
        url: `/queue/${h.id}`,
      };
    }),
    ...events.map((ev) => ({
      kind: "Event",
      title: eventTitle(ev),
      detail: ev.tool ?? "Browser session",
      text: [
        ev.eventId,
        ev.holdId,
        ev.type,
        ev.requestKey,
        ev.policyRule,
        ev.tellerTransferId,
        ev.occurredAt,
      ].join(" "),
      url: `/audit?event=${encodeURIComponent(ev.eventId)}`,
    })),
    ...Object.entries(JSON.parse(registry?.accounts_json ?? "{}")).map(
      ([alias, id]) => ({
        kind: "Account",
        title: alias,
        detail: String(id),
        text: String(id),
        url: "/accounts#" + alias,
      }),
    ),
  ];
  return {
    pending: holds.filter(
      (h) => h.status === "HELD" && h.expires_at > Date.now(),
    ).length,
    sessionId: visitor.id,
    items,
  };
}
export async function consoleSnapshot(request: Request, env: Env) {
  const visitor = await browserSession(env.DB, request);
  if (!visitor) return safeHttp("SESSION_REQUIRED", 401);
  if (
    !(await consumeTool(
      env.DB,
      { visitorId: visitor.id, epoch: visitor.epoch },
      "console_snapshot",
    ))
  )
    return safeHttp("RATE_LIMIT", 429);
  return Response.json(await consoleIndex(request, env, visitor), {
    headers: { "Cache-Control": "no-store" },
  });
}
