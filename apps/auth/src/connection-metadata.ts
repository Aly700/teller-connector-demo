import type {
  GrantSummary,
  OAuthHelpers,
  Token,
} from "@cloudflare/workers-oauth-provider";
import {
  SCOPES,
  validSession,
  type SessionProps,
} from "../../../packages/state.ts";

export interface ConnectionMetadata {
  grantedScopes: string[];
  // Milliseconds, from stored provider timestamps. A client may hold several tokens.
  accessTokens: Array<{
    scopes: string[];
    issuedAt: number;
    expiresAt: number;
  }>;
  tokenMetadataAvailable: boolean;
}

const unavailable = () => new Error("CONNECTION_METADATA_UNAVAILABLE");
const timestamp = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= 8_640_000_000_000;
const scopes = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((scope) => typeof scope === "string" && SCOPES.includes(scope));
const resourceShape = (value: unknown) =>
  typeof value === "string" ||
  (Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string"));
const resourceMatches = (value: unknown, resource: string) =>
  value === resource ||
  (Array.isArray(value) && value.length === 1 && value[0] === resource);

async function activeGrants(
  oauth: Pick<OAuthHelpers, "listUserGrants">,
  userId: string,
  resource: string,
): Promise<GrantSummary[]> {
  const grants: GrantSummary[] = [],
    cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await oauth.listUserGrants(userId, { limit: 100, cursor });
    for (const grant of result.items) {
      if (grant.userId !== userId || !resourceMatches(grant.resource, resource))
        continue;
      if (
        !/^[A-Za-z0-9_-]{16}$/.test(grant.id) ||
        typeof grant.clientId !== "string" ||
        !scopes(grant.scope) ||
        (grant.expiresAt !== undefined && !timestamp(grant.expiresAt))
      )
        throw unavailable();
      if (grant.expiresAt !== undefined && grant.expiresAt * 1000 <= Date.now())
        continue;
      grants.push(grant);
    }
    cursor = result.cursor;
    if (cursor && (cursors.has(cursor) || cursors.size >= 9))
      throw unavailable();
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return grants;
}

async function storedAccessTokens(
  kv: KVNamespace,
  grants: GrantSummary[],
  userId: string,
  resource: string,
): Promise<ConnectionMetadata["accessTokens"]> {
  const tokens: ConnectionMetadata["accessTokens"] = [];
  // Provider 1.2.4 has no token-list helper. Its exported Token records contain the
  // authoritative expiry; keep this read-only storage adapter isolated on upgrades.
  for (const grant of grants) {
    const prefix = `token:${userId}:${grant.id}:`,
      cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await kv.list({ prefix, limit: 100, cursor });
      for (const key of result.keys) {
        if (
          !key.name.startsWith(prefix) ||
          key.name.slice(prefix.length).includes(":")
        )
          throw unavailable();
        const token = await kv.get<Partial<Token>>(key.name, "json");
        if (token === null) continue;
        if (
          typeof token !== "object" ||
          typeof token.userId !== "string" ||
          typeof token.grantId !== "string" ||
          !resourceShape(token.audience)
        )
          throw unavailable();
        if (
          token.userId !== userId ||
          token.grantId !== grant.id ||
          !resourceMatches(token.audience, resource)
        )
          continue;
        if (
          typeof token.id !== "string" ||
          key.name !== prefix + token.id ||
          !timestamp(token.createdAt) ||
          !timestamp(token.expiresAt) ||
          token.expiresAt <= token.createdAt ||
          !scopes(token.scope) ||
          token.scope.some((scope) => !grant.scope.includes(scope)) ||
          token.grant?.clientId !== grant.clientId ||
          !scopes(token.grant.scope) ||
          token.scope.some((scope) => !token.grant!.scope.includes(scope))
        )
          throw unavailable();
        if (token.expiresAt * 1000 <= Date.now()) continue;
        tokens.push({
          scopes: [...new Set(token.scope)],
          issuedAt: token.createdAt * 1000,
          expiresAt: token.expiresAt * 1000,
        });
      }
      cursor = result.list_complete ? undefined : result.cursor;
      if (
        !result.list_complete &&
        (!cursor || cursors.has(cursor) || cursors.size >= 9)
      )
        throw unavailable();
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }
  return tokens.sort(
    (a, b) => b.issuedAt - a.issuedAt || b.expiresAt - a.expiresAt,
  );
}

export async function readConnectionMetadata(
  env: { DB: D1Database; OAUTH_KV: KVNamespace; PUBLIC_ORIGIN: string },
  props: SessionProps,
  oauth: Pick<OAuthHelpers, "listUserGrants">,
): Promise<ConnectionMetadata | null> {
  const visitor = await validSession(env.DB, props);
  if (!visitor) return null;
  const resource = env.PUBLIC_ORIGIN + "/mcp";
  const grants = await activeGrants(oauth, visitor.id, resource);
  const grantedScopes = SCOPES.filter((scope) =>
    grants.some((grant) => grant.scope.includes(scope)),
  );
  let accessTokens: ConnectionMetadata["accessTokens"] = [],
    tokenMetadataAvailable = true;
  try {
    accessTokens = await storedAccessTokens(
      env.OAUTH_KV,
      grants,
      visitor.id,
      resource,
    );
  } catch {
    tokenMetadataAvailable = false;
  }
  if (!(await validSession(env.DB, props))) return null;
  return { grantedScopes, accessTokens, tokenMetadataAvailable };
}
