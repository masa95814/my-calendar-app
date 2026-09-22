import { describe, expect, it } from "vitest";

import type { LinkedAccount } from "../src/repositories/index.js";
import { buildTestApp, ownerHeaders } from "./helpers.js";

function sampleAccount(
  cipher: ReturnType<typeof buildTestApp>["cipher"],
  overrides: Partial<LinkedAccount> = {},
): LinkedAccount {
  return {
    id: "sub-1",
    email: "a@company.example",
    hd: "company.example",
    type: "workspace",
    refreshTokenEnc: cipher.encrypt("refresh-a"),
    scopes: ["openid"],
    status: "ok",
    calendars: [],
    linkedAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

describe("GET /api/accounts", () => {
  it("認証が必要", async () => {
    const { app } = buildTestApp();
    expect((await app.request("/api/accounts")).status).toBe(401);
  });

  it("自分の連携アカウントをトークン抜きで返す", async () => {
    const h = buildTestApp();
    await h.stores.accounts.upsert("owner-uid", sampleAccount(h.cipher));
    await h.stores.accounts.upsert(
      "owner-uid",
      sampleAccount(h.cipher, {
        id: "sub-2",
        email: "me@gmail.com",
        hd: undefined,
        type: "personal",
        linkedAt: new Date("2026-09-02T00:00:00Z"),
      }),
    );
    await h.stores.accounts.upsert(
      "someone-else",
      sampleAccount(h.cipher, { id: "sub-9" }),
    );

    const res = await h.app.request("/api/accounts", { headers: ownerHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Record<string, unknown>[] };
    expect(body.accounts.map((a) => a.id)).toEqual(["sub-1", "sub-2"]);
    for (const account of body.accounts) {
      expect(account).not.toHaveProperty("refreshTokenEnc");
    }
    expect(body.accounts[0]).toMatchObject({
      email: "a@company.example",
      type: "workspace",
      hd: "company.example",
    });
  });
});

describe("POST /api/accounts/link", () => {
  it("returnTo が不正なら 400", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/accounts/link", {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({ returnTo: "https://evil.example/" }),
    });
    expect(res.status).toBe(400);
  });

  it("uid 付きの state を保存し、オフラインアクセス付きの同意 URL を返す", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/accounts/link", {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({ returnTo: "mycalendarapp://accounts" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const url = new URL(body.url);
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("calendar.events");

    const saved = h.stores.states.get("state-1");
    expect(saved).toMatchObject({
      purpose: "link",
      uid: "owner-uid",
      returnTo: "mycalendarapp://accounts",
    });
    expect(saved?.expiresAt.getTime()).toBe(h.clock.now.getTime() + 600 * 1000);
  });
});

describe("DELETE /api/accounts/:id", () => {
  it("存在しなければ 404", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/accounts/nope", {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(404);
  });

  it("Google のトークンを失効させて連携情報を削除する", async () => {
    const h = buildTestApp();
    await h.stores.accounts.upsert("owner-uid", sampleAccount(h.cipher));
    const res = await h.app.request("/api/accounts/sub-1", {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(204);
    expect(h.google.revoked).toEqual(["refresh-a"]);
    expect(await h.stores.accounts.get("owner-uid", "sub-1")).toBeUndefined();
  });

  it("失効に失敗しても連携情報は削除する", async () => {
    const h = buildTestApp();
    h.google.revokeToken = async () => {
      throw new Error("network");
    };
    await h.stores.accounts.upsert("owner-uid", sampleAccount(h.cipher));
    const res = await h.app.request("/api/accounts/sub-1", {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(204);
    expect(await h.stores.accounts.get("owner-uid", "sub-1")).toBeUndefined();
  });

  it("他人のアカウントは消せない", async () => {
    const h = buildTestApp();
    await h.stores.accounts.upsert("someone-else", sampleAccount(h.cipher));
    const res = await h.app.request("/api/accounts/sub-1", {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(404);
    expect(await h.stores.accounts.get("someone-else", "sub-1")).toBeDefined();
  });
});
