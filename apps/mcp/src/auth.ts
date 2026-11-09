import {
  OAuthResourceServer,
  insufficientScope,
  type AuthorizationServerBinding,
} from "@cloudflare/workers-oauth-provider";
import { validSession, type SessionProps } from "../../../packages/state.ts";
import { safeHttp } from "../../../packages/http.ts";
import type { ConnectionMetadata } from "../../auth/src/connection-metadata.ts";
export type { ConnectionMetadata } from "../../auth/src/connection-metadata.ts";
export interface Env {
  EVAL_REPORT_SECRET?: string;
  PUBLIC_ORIGIN: string;
  ORIGIN_URL: string;
  ORIGIN_SIGNING_SECRET: string;
  DB: D1Database;
  AUTH_SERVER: AuthorizationServerBinding<SessionProps> &
    Fetcher & {
      getConnectionMetadata(
        props: SessionProps,
      ): Promise<ConnectionMetadata | null>;
    };
}
export function resource(
  env: Env,
  handler: (
    request: Request,
    props: SessionProps,
    scopes: string[],
  ) => Promise<Response>,
) {
  return new OAuthResourceServer<Env, SessionProps>({
    resourceMetadata: {
      resource: env.PUBLIC_ORIGIN + "/mcp",
      authorization_servers: [env.PUBLIC_ORIGIN],
      resource_name: "Demo data. No real money.",
    },
    requiredScopes: ["sample:read", "sample:request"],
    validateToken: (env) => env.AUTH_SERVER.validateToken,
    handler: {
      async fetch(request, env, ctx) {
        if (!ctx.auth.scope.includes("sample:read"))
          return insufficientScope(ctx.auth, ["sample:read"]);
        if (
          request.method === "POST" &&
          !ctx.auth.scope.includes("sample:request")
        ) {
          let payload: any;
          try {
            payload = await request.clone().json();
          } catch {}
          if (
            payload?.method === "tools/call" &&
            payload.params?.name === "request_transfer"
          )
            return insufficientScope(ctx.auth, ["sample:request"]);
        }
        if (!(await validSession(env.DB, ctx.props)))
          return safeHttp("SESSION_EXPIRED", 401);
        return handler(request, ctx.props, ctx.auth.scope);
      },
    },
  });
}
