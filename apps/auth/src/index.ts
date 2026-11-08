import { securityEvent } from "../../../packages/limits.ts";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  OAuthAuthorizationServer,
  OAuthError,
} from "@cloudflare/workers-oauth-provider";
import { consent } from "./consent.ts";
import {
  SCOPES,
  validSession,
  type SessionProps,
} from "../../../packages/state.ts";
import { bounded, safeHttp } from "../../../packages/http.ts";
import {
  readConnectionMetadata,
  type ConnectionMetadata,
} from "./connection-metadata.ts";
export interface AuthEnv {
  PUBLIC_ORIGIN: string;
  DB: D1Database;
  OAUTH_KV: KVNamespace;
}
function provider(env: AuthEnv) {
  return new OAuthAuthorizationServer<AuthEnv>({
    issuer: env.PUBLIC_ORIGIN,
    resources: [env.PUBLIC_ORIGIN + "/mcp"],
    scopesSupported: SCOPES,
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationEndpoint: "/oauth/register",
    accessTokenTTL: 900,
    refreshTokenTTL: 86400,
    clientRegistrationTTL: 86400,
    onError: ({ code, status, headers }) =>
      Response.json(
        {
          error: code,
          error_description: "The sample connection could not be authorized.",
          notice: "Sample data. No real money.",
        },
        { status, headers },
      ),
    clientRegistrationCallback: ({ clientMetadata }) => {
      if (clientMetadata.token_endpoint_auth_method !== "none")
        return {
          code: "invalid_client_metadata",
          description: "Use public-client authentication.",
          status: 400,
        };
    },
    tokenExchangeCallback: async ({ env, props, scope, grantType }) => {
      const visitor = await validSession(env.DB, props);
      if (
        !visitor ||
        scope.some((s) => !SCOPES.includes(s)) ||
        !["authorization_code", "refresh_token"].includes(grantType)
      )
        throw new OAuthError("invalid_grant", {
          description: "Start a new sample session.",
        });
      const remaining = Math.floor((visitor.expires_at - Date.now()) / 1000);
      if (remaining < 60)
        throw new OAuthError("invalid_grant", {
          description: "Start a new sample session.",
        });
      return {
        accessTokenTTL: Math.min(900, remaining),
        refreshTokenTTL: remaining,
      };
    },
  });
}
export default class AuthServer extends WorkerEntrypoint<AuthEnv> {
  async getConnectionMetadata(
    props: SessionProps,
  ): Promise<ConnectionMetadata | null> {
    return readConnectionMetadata(
      this.env,
      props,
      provider(this.env).getOAuthApi(this.env),
    );
  }
  async validateToken(resource: string, token: string) {
    const result = await provider(this.env).validateToken<SessionProps>(
      resource,
      token,
      this.env,
    );
    if (
      !result ||
      result.scope.some((scope) => !SCOPES.includes(scope)) ||
      !(await validSession(this.env.DB, result.props))
    )
      return null;
    return result;
  }
  async fetch(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).origin !== this.env.PUBLIC_ORIGIN)
        return safeHttp("INVALID_HOST", 403);
      if (!(await bounded(request))) return safeHttp("TOO_LARGE", 413);
      const service = provider(this.env),
        path = new URL(request.url).pathname;
      if (path === "/authorize")
        return consent(
          request,
          this.env.DB,
          service.getOAuthApi(this.env),
          this.env.PUBLIC_ORIGIN,
        );
      if (path === "/oauth/token" || path === "/oauth/revoke") {
        if (request.headers.has("Authorization"))
          return safeHttp("INVALID_CLIENT", 400);
        const params = new URLSearchParams(await request.clone().text());
        if (
          ["client_secret", "client_assertion", "client_assertion_type"].some(
            (key) => params.has(key),
          )
        )
          return safeHttp("INVALID_CLIENT", 400);
        const clientId = params.get("client_id") ?? "";
        if (
          clientId.includes(":") &&
          !/^https:\/\/claude\.ai\/[^?#]+$/.test(clientId)
        )
          return safeHttp("INVALID_CLIENT", 400);
      }
      const response = await service.fetch(request, this.env, this.ctx);
      if (path === "/.well-known/oauth-authorization-server" && response.ok) {
        const metadata = (await response.json()) as Record<string, unknown>;
        metadata.token_endpoint_auth_methods_supported = ["none"];
        delete metadata.token_endpoint_auth_signing_alg_values_supported;
        return Response.json(metadata, { headers: response.headers });
      }
      if (response.status >= 400)
        await securityEvent(this.env.DB, "AUTH_FAILURE");
      return response;
    } catch {
      return safeHttp("DEMO_UNAVAILABLE", 503);
    }
  }
}
