import { describe, expect, it } from "vitest";

import { buildTestApp, ownerHeaders } from "./helpers.js";

describe("CORS（Web 版アプリ）", () => {
  it("localhost からのプリフライトは認証なしで許可する", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/accounts", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:8081",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:8081",
    );
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "Authorization",
    );
  });

  it("アプリが使うメソッド（PATCH を含む）をすべて許可する", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/accounts/sub-1", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:8081",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-methods") ?? "")
      .split(",")
      .map((m) => m.trim());
    expect(allowed).toEqual(
      expect.arrayContaining(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    );
  });

  it("許可したオリジンの実リクエストに CORS ヘッダーを付ける", async () => {
    const h = buildTestApp({
      env: { WEB_ALLOWED_ORIGINS: "https://app.example.com" },
    });
    const res = await h.app.request("/api/me", {
      headers: { ...ownerHeaders, Origin: "https://app.example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
  });

  it("許可していないオリジンには CORS ヘッダーを付けない", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/me", {
      headers: { ...ownerHeaders, Origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
