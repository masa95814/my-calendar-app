import { describe, expect, it } from "vitest";

import { buildTestApp, ownerHeaders } from "./helpers.js";

const { app } = buildTestApp();

describe("GET /healthz", () => {
  it("認証なしで 200 を返す", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

describe("GET /api/me", () => {
  it("トークンが無ければ 401", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
  });

  it("トークンが無効なら 401", async () => {
    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer bogus" },
    });
    expect(res.status).toBe(401);
  });

  it("許可されていないメールアドレスなら 403", async () => {
    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer stranger-token" },
    });
    expect(res.status).toBe(403);
  });

  it("許可されたユーザーなら uid とメールアドレスを返す（大文字小文字は区別しない）", async () => {
    const res = await app.request("/api/me", { headers: ownerHeaders });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      uid: "owner-uid",
      email: "owner@example.com",
    });
  });
});

describe("未知のパス", () => {
  it("404 を JSON で返す", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
