import {
  browserSession,
  browserCookie,
  hash,
} from "../../../packages/state.ts";
import { retireBrowserSession } from "../../../packages/gate/holds.ts";
import { securityEvent } from "../../../packages/limits.ts";
import { page, safeHttp, icon } from "../../../packages/http.ts";
export async function endSession(
  request: Request,
  db: D1Database,
  origin: string,
) {
  const visitor = await browserSession(db, request);
  if (!visitor)
    return page(
      '<section class="error-page"><h1>No active sample session</h1><p class="intro">This browser has no active sample connection. Start a new session from your MCP client.</p><div class="buttons"><a class="button secondary" href="/">Open connection guide</a></div></section>',
      401,
    );
  if (request.method === "GET") {
    const csrf = crypto.randomUUID() + crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO session_end_tokens VALUES(?,?,?,?) ON CONFLICT(visitor_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at",
      )
      .bind(visitor.id, visitor.epoch, await hash(csrf), Date.now() + 300000)
      .run();
    return page(
      `<section class="narrow"><div class="page-heading"><div><h1>End this sample session</h1><p>Close access for this browser and its connected client.</p></div></div><div class="panel"><div class="panel-body"><div class="scope-row">${icon("lock")}<div><h3>Revoke connector access</h3><p>The browser session and its connector token can no longer act.</p></div></div><div class="scope-row">${icon("clock")}<div><h3>Close pending requests</h3><p>Requests awaiting your approval expire. A transfer already sent to Teller cannot be undone here.</p></div></div></div><div class="consent-footer"><form method="post"><input type="hidden" name="csrf" value="${csrf}"><div class="buttons"><button class="secondary danger">End sample session ${icon("end")}</button><a class="button secondary" href="/queue">Keep session open</a></div></form></div></div></section>`,
    );
  }
  if (request.method !== "POST") return safeHttp("METHOD_NOT_ALLOWED", 405);
  if (request.headers.get("Origin") !== origin)
    return safeHttp("INVALID_ORIGIN", 403);
  const form = await request.formData(),
    token = form.get("csrf");
  if (typeof token !== "string") return safeHttp("INVALID_ACTION", 403);
  const changed = await db.batch([
    db
      .prepare(
        "UPDATE visitors SET revoked=1 WHERE id=? AND epoch=? AND revoked=0 AND EXISTS(SELECT 1 FROM session_end_tokens WHERE visitor_id=? AND epoch=? AND token_hash=? AND expires_at>?) RETURNING id",
      )
      .bind(
        visitor.id,
        visitor.epoch,
        visitor.id,
        visitor.epoch,
        await hash(token),
        Date.now(),
      ),
    db
      .prepare(
        "DELETE FROM session_end_tokens WHERE visitor_id=? AND EXISTS(SELECT 1 FROM visitors WHERE id=? AND revoked=1)",
      )
      .bind(visitor.id, visitor.id),
  ]);
  if (!changed[0].results.length) return safeHttp("INVALID_ACTION", 403);
  await retireBrowserSession(db, visitor);
  await securityEvent(db, "SESSION_ENDED", {
    visitorId: visitor.id,
    epoch: visitor.epoch,
  });
  return page(
    '<section class="error-page"><h1>Sample session ended</h1><p class="intro">Your connector token and browser session can no longer act. Start a new session from your MCP client when you want to try again.</p><div class="buttons"><a class="button secondary" href="/">Open connection guide</a></div></section>',
    200,
    new Headers({ "Set-Cookie": browserCookie("", 0) }),
  );
}
