import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  GrantSummary,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { fixture } from "./d1.ts";
import * as metadata from "../apps/auth/src/connection-metadata.ts";

const origin = "https://sample.example";
const grantId = "abcdefghijklmnop";
const otherGrantId = "qrstuvwxyzABCDEF";

async function setup() {
  const f = await fixture();
  const now = Math.floor(f.now / 1000);
  const grant: GrantSummary = {
    id: grantId,
    userId: f.visitor.id,
    clientId: "private-client-id",
    scope: ["sample:read"],
    resource: origin + "/mcp",
    createdAt: now - 30,
    expiresAt: now + 3600,
    metadata: { secret: "private-metadata" },
    redirectUri: "http://localhost/private-redirect",
  };
  const records = new Map<string, unknown>();
  const reads: string[] = [];
  const lists: string[] = [];
  let grants = [grant];
  let pageSize = 100;
  let tokenStorageDown = false;
  const kv = {
    async list(options: { prefix: string; cursor?: string; limit?: number }) {
      if (tokenStorageDown) throw new Error("private-kv-failure");
      lists.push(options.prefix);
      const keys = [...records.keys()]
        .filter((key) => key.startsWith(options.prefix))
        .sort();
      const offset = Number(options.cursor ?? 0);
      const end = offset + Math.min(pageSize, options.limit ?? 1000);
      return {
        keys: keys.slice(offset, end).map((name) => ({ name })),
        list_complete: end >= keys.length,
        cursor: end < keys.length ? String(end) : undefined,
      };
    },
    async get(key: string) {
      reads.push(key);
      return structuredClone(records.get(key) ?? null);
    },
    async put() {
      assert.fail("Connection metadata must not write KV");
    },
    async delete() {
      assert.fail("Connection metadata must not delete KV");
    },
  } as unknown as KVNamespace;
  const oauth: Pick<OAuthHelpers, "listUserGrants"> = {
    async listUserGrants(userId, options) {
      assert.equal(userId, f.visitor.id);
      const offset = Number(options?.cursor ?? 0);
      const end = offset + pageSize;
      return {
        items: grants.slice(offset, end),
        cursor: end < grants.length ? String(end) : undefined,
      };
    },
  };
  function token(
    id: string,
    changes: Record<string, unknown> = {},
    ownerGrant = grantId,
  ) {
    const key = `token:${f.visitor.id}:${ownerGrant}:${id}`;
    records.set(key, {
      id,
      userId: f.visitor.id,
      grantId: ownerGrant,
      audience: origin + "/mcp",
      scope: ["sample:read"],
      createdAt: now - 10,
      expiresAt: now + 890,
      wrappedEncryptionKey: "private-wrapped-key",
      grant: {
        clientId: "private-client-id",
        scope: ["sample:read"],
        encryptedProps: "private-encrypted-props",
      },
      ...changes,
    });
    return key;
  }
  const env = { PUBLIC_ORIGIN: origin, DB: f.db, OAUTH_KV: kv };
  return {
    ...f,
    now,
    env,
    oauth,
    grant,
    records,
    reads,
    lists,
    token,
    setGrants(value: GrantSummary[]) {
      grants = value;
    },
    paginate() {
      pageSize = 1;
    },
    failTokenStorage() {
      tokenStorageDown = true;
    },
    read() {
      return metadata.readConnectionMetadata(env, f.props, oauth);
    },
  };
}

test("connection metadata returns actual scopes and exact stored expiry without private fields or writes", async () => {
  const f = await setup();
  f.token("first");
  const before = f.raw.prepare("SELECT total_changes() AS count").get()!.count;
  assert.deepEqual(await f.read(), {
    grantedScopes: ["sample:read"],
    tokenMetadataAvailable: true,
    accessTokens: [
      {
        scopes: ["sample:read"],
        issuedAt: (f.now - 10) * 1000,
        expiresAt: (f.now + 890) * 1000,
      },
    ],
  });
  assert.equal(
    f.raw.prepare("SELECT total_changes() AS count").get()!.count,
    before,
  );
  assert.deepEqual(f.lists, [`token:${f.visitor.id}:${grantId}:`]);
});

test("connection metadata excludes expired grants and tokens and foreign visitors or resources", async () => {
  const f = await setup();
  const expiredGrant = {
    ...f.grant,
    id: otherGrantId,
    scope: ["sample:request"],
    expiresAt: f.now - 1,
  };
  f.setGrants([
    f.grant,
    expiredGrant,
    {
      ...f.grant,
      id: "foreign-grant-id1",
      userId: "another-visitor",
      scope: ["sample:request"],
    },
    {
      ...f.grant,
      id: "foreign-grant-id2",
      resource: "https://elsewhere.example/mcp",
      scope: ["sample:request"],
    },
  ]);
  f.token("valid");
  f.token("expired", { expiresAt: f.now - 1 });
  f.token("foreign-user", { userId: "another-visitor" });
  f.token("foreign-grant", { grantId: otherGrantId });
  f.token("foreign-resource", { audience: "https://elsewhere.example/mcp" });
  const ignored = f.token("expired-grant-token", {}, otherGrantId);
  const result = await f.read();
  assert.deepEqual(result?.grantedScopes, ["sample:read"]);
  assert.equal(result?.accessTokens.length, 1);
  assert.ok(!f.reads.includes(ignored));
  assert.ok(!JSON.stringify(result).includes("private-"));
});

test("connection metadata paginates grants and tokens and orders tokens by issue time", async () => {
  const f = await setup();
  f.paginate();
  f.setGrants([
    f.grant,
    { ...f.grant, id: otherGrantId, scope: ["sample:read", "sample:request"] },
  ]);
  f.token("older", { createdAt: f.now - 20, expiresAt: f.now + 880 });
  f.token("newer", { createdAt: f.now - 5, expiresAt: f.now + 895 });
  f.token(
    "other-grant",
    {
      scope: ["sample:request"],
      grant: {
        clientId: "private-client-id",
        scope: ["sample:read", "sample:request"],
        encryptedProps: "private-encrypted-props",
      },
      createdAt: f.now - 1,
      expiresAt: f.now + 899,
    },
    otherGrantId,
  );
  const result = await f.read();
  assert.deepEqual(result?.grantedScopes, ["sample:read", "sample:request"]);
  assert.deepEqual(
    result?.accessTokens.map((token) => token.expiresAt),
    [899, 895, 880].map((seconds) => (f.now + seconds) * 1000),
  );
});

test("invalid visitor sessions cannot read connection metadata", async () => {
  for (const mutation of ["revoked", "expired", "missing", "epoch"]) {
    const f = await setup();
    if (mutation === "revoked")
      f.raw.prepare("UPDATE visitors SET revoked=1").run();
    if (mutation === "expired")
      f.raw.prepare("UPDATE visitors SET expires_at=0").run();
    if (mutation === "missing") f.raw.prepare("DELETE FROM visitors").run();
    if (mutation === "epoch") f.props.epoch = crypto.randomUUID();
    f.oauth.listUserGrants = async () => {
      assert.fail("Invalid sessions must not inspect grants");
    };
    assert.equal(await f.read(), null);
    assert.deepEqual(f.lists, []);
    assert.deepEqual(f.reads, []);
  }
});

test("unavailable token storage and unknown token schema never become an estimated expiry", async () => {
  for (const failure of ["storage", "expiry", "scope", "audience"]) {
    const f = await setup();
    if (failure === "storage") f.failTokenStorage();
    if (failure === "expiry") f.token("malformed", { expiresAt: undefined });
    if (failure === "scope")
      f.token("malformed", { scope: ["sample:approve"] });
    if (failure === "audience")
      f.token("malformed", { audience: { resource: origin + "/mcp" } });
    assert.deepEqual(await f.read(), {
      grantedScopes: ["sample:read"],
      tokenMetadataAvailable: false,
      accessTokens: [],
    });
  }
});

test("a downscoped token does not change the granted scope summary", async () => {
  const f = await setup();
  f.setGrants([{ ...f.grant, scope: ["sample:read", "sample:request"] }]);
  f.token("downscoped");
  const result = await f.read();
  assert.deepEqual(result?.grantedScopes, ["sample:read", "sample:request"]);
  assert.deepEqual(result?.accessTokens[0].scopes, ["sample:read"]);
});

test("revoking the visitor during metadata lookup prevents returning metadata", async () => {
  const f = await setup();
  f.oauth.listUserGrants = async () => {
    f.raw.prepare("UPDATE visitors SET revoked=1").run();
    return { items: [f.grant] };
  };
  assert.equal(await f.read(), null);
});

test("unknown granted scopes cannot be presented as supported permissions", async () => {
  const f = await setup();
  f.setGrants([{ ...f.grant, scope: ["sample:approve"] }]);
  await assert.rejects(f.read(), {
    message: "CONNECTION_METADATA_UNAVAILABLE",
  });
});

test("a repeated token cursor reports metadata unavailable without returning a partial token list", async () => {
  const f = await setup();
  f.env.OAUTH_KV.list = async () => ({
    keys: [],
    list_complete: false,
    cursor: "repeated",
    cacheStatus: null,
  });
  assert.deepEqual(await f.read(), {
    grantedScopes: ["sample:read"],
    tokenMetadataAvailable: false,
    accessTokens: [],
  });
});

test("no token records reports no visible active tokens without guessing from the grant expiry", async () => {
  const f = await setup();
  assert.deepEqual(await f.read(), {
    grantedScopes: ["sample:read"],
    tokenMetadataAvailable: true,
    accessTokens: [],
  });
});
