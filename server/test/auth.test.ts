import { describe, expect, it } from "vitest";

import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_LIST_SCOPE,
} from "../src/lib/google.js";
import { buildTestApp, ownerHeaders } from "./helpers.js";

const LINK_SCOPE_STRING = `openid email ${CALENDAR_EVENTS_SCOPE} ${CALENDAR_LIST_SCOPE}`;

describe("GET /auth/login/start", () => {
  it("return_to が許可されていなければ 400", async () => {
    const { app } = buildTestApp();
    const res = await app.request(
      "/auth/login/start?return_to=https://evil.example/",
    );
    expect(res.status).toBe(400);
  });

  it("state を保存して Google の同意画面へリダイレクトする", async () => {
    const { app, stores, google } = buildTestApp();
    const res = await app.request(
      "/auth/login/start?return_to=mycalendarapp://auth",
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("state")).toBe("state-1");
    expect(location.searchParams.get("access_type")).toBe("online");

    const saved = stores.states.get("state-1");
    expect(saved?.purpose).toBe("login");
    expect(saved?.returnTo).toBe("mycalendarapp://auth");
    expect(saved?.uid).toBeUndefined();
    expect(google.authorizeCalls[0]?.scopes).toEqual([
      "openid",
      "email",
      "profile",
    ]);
  });
});

describe("GET /auth/google/callback（ログイン）", () => {
  async function startLogin(h: ReturnType<typeof buildTestApp>) {
    await h.app.request("/auth/login/start?return_to=mycalendarapp://auth");
    return "state-1";
  }

  it("state が無ければ 400", async () => {
    const { app } = buildTestApp();
    expect((await app.request("/auth/google/callback?code=x")).status).toBe(
      400,
    );
  });

  it("知らない state なら 400（使い回し防止）", async () => {
    const { app } = buildTestApp();
    const res = await app.request("/auth/google/callback?code=x&state=nope");
    expect(res.status).toBe(400);
  });

  it("期限切れの state はアプリに error=expired で戻す", async () => {
    const h = buildTestApp();
    const state = await startLogin(h);
    h.clock.now = new Date(h.clock.now.getTime() + 601 * 1000);
    const res = await h.app.request(
      `/auth/google/callback?code=x&state=${state}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "mycalendarapp://auth?error=expired",
    );
  });

  it("Google がエラーを返したらそのままアプリに渡す", async () => {
    const h = buildTestApp();
    const state = await startLogin(h);
    const res = await h.app.request(
      `/auth/google/callback?error=access_denied&state=${state}`,
    );
    expect(res.headers.get("location")).toBe(
      "mycalendarapp://auth?error=access_denied",
    );
  });

  it("許可されていないメールアドレスは error=not_allowed", async () => {
    const h = buildTestApp();
    const state = await startLogin(h);
    h.google.codes.set("code-1", { idToken: "id-1" });
    h.google.identities.set("id-1", {
      sub: "sub-stranger",
      email: "stranger@example.com",
      emailVerified: true,
    });
    const res = await h.app.request(
      `/auth/google/callback?code=code-1&state=${state}`,
    );
    expect(res.headers.get("location")).toBe(
      "mycalendarapp://auth?error=not_allowed",
    );
    expect(h.firebase.users.size).toBe(0);
  });

  it("本人ならユーザーを作ってカスタムトークン付きでアプリへ戻す", async () => {
    const h = buildTestApp();
    const state = await startLogin(h);
    h.google.codes.set("code-1", { idToken: "id-1" });
    h.google.identities.set("id-1", {
      sub: "sub-owner",
      email: "Owner@Example.com",
      emailVerified: true,
    });
    const res = await h.app.request(
      `/auth/google/callback?code=code-1&state=${state}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "mycalendarapp://auth?token=custom-token-for-sub-owner",
    );
    expect(h.firebase.users.get("sub-owner")).toBe("owner@example.com");
    expect(h.stores.logins).toEqual([
      { uid: "sub-owner", email: "owner@example.com", at: h.clock.now },
    ]);
    // state は 1 回しか使えない
    const again = await h.app.request(
      `/auth/google/callback?code=code-1&state=${state}`,
    );
    expect(again.status).toBe(400);
  });

  it("トークン交換に失敗したら error=callback_failed", async () => {
    const h = buildTestApp();
    const state = await startLogin(h);
    const res = await h.app.request(
      `/auth/google/callback?code=unknown&state=${state}`,
    );
    expect(res.headers.get("location")).toBe(
      "mycalendarapp://auth?error=callback_failed",
    );
  });
});

describe("GET /auth/google/callback（アカウント連携）", () => {
  async function startLink(h: ReturnType<typeof buildTestApp>) {
    const res = await h.app.request("/api/accounts/link", {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({ returnTo: "exp://192.168.1.5:8081/--/accounts" }),
    });
    expect(res.status).toBe(200);
    return "state-1";
  }

  it("Workspace アカウントを type=workspace で保存し、トークンは暗号化して持つ", async () => {
    const h = buildTestApp();
    const state = await startLink(h);
    h.google.codes.set("code-1", {
      idToken: "id-1",
      refreshToken: "refresh-1",
      scope: LINK_SCOPE_STRING,
    });
    h.google.identities.set("id-1", {
      sub: "sub-work",
      email: "Me@Company.example",
      emailVerified: true,
      hd: "company.example",
    });

    const res = await h.app.request(
      `/auth/google/callback?code=code-1&state=${state}`,
    );
    expect(res.headers.get("location")).toBe(
      "exp://192.168.1.5:8081/--/accounts?linked=me%40company.example",
    );

    const saved = await h.stores.accounts.get("owner-uid", "sub-work");
    expect(saved).toMatchObject({
      id: "sub-work",
      email: "me@company.example",
      hd: "company.example",
      type: "workspace",
      status: "ok",
      linkedAt: h.clock.now,
    });
    expect(saved?.refreshTokenEnc).not.toBe("refresh-1");
    expect(h.cipher.decrypt(saved?.refreshTokenEnc ?? "")).toBe("refresh-1");
    expect(saved?.calendars.map((c) => c.id)).toEqual(["primary-id"]);
    expect(saved?.scopes).toContain(CALENDAR_EVENTS_SCOPE);
  });

  it("個人アカウントは type=personal になり、再連携では linkedAt を保つ", async () => {
    const h = buildTestApp();
    const state = await startLink(h);
    h.google.codes.set("code-1", {
      idToken: "id-1",
      refreshToken: "refresh-1",
      scope: LINK_SCOPE_STRING,
    });
    h.google.identities.set("id-1", {
      sub: "sub-personal",
      email: "me@gmail.com",
      emailVerified: true,
    });
    await h.app.request(`/auth/google/callback?code=code-1&state=${state}`);
    const first = await h.stores.accounts.get("owner-uid", "sub-personal");
    expect(first?.type).toBe("personal");
    expect(first?.hd).toBeUndefined();

    // 2 回目の連携（トークン更新）
    h.clock.now = new Date(h.clock.now.getTime() + 60 * 1000);
    await h.app.request("/api/accounts/link", {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({ returnTo: "mycalendarapp://accounts" }),
    });
    h.google.codes.set("code-2", {
      idToken: "id-1",
      refreshToken: "refresh-2",
      scope: LINK_SCOPE_STRING,
    });
    await h.app.request("/auth/google/callback?code=code-2&state=state-2");
    const second = await h.stores.accounts.get("owner-uid", "sub-personal");
    expect(second?.linkedAt).toEqual(first?.linkedAt);
    expect(second?.updatedAt).toEqual(h.clock.now);
    expect(h.cipher.decrypt(second?.refreshTokenEnc ?? "")).toBe("refresh-2");
  });

  it("リフレッシュトークンが返らなければ error=missing_refresh_token", async () => {
    const h = buildTestApp();
    const state = await startLink(h);
    h.google.codes.set("code-1", { idToken: "id-1", scope: LINK_SCOPE_STRING });
    h.google.identities.set("id-1", {
      sub: "sub-x",
      email: "x@example.com",
      emailVerified: true,
    });
    const res = await h.app.request(
      `/auth/google/callback?code=code-1&state=${state}`,
    );
    expect(res.headers.get("location")).toContain(
      "error=missing_refresh_token",
    );
    expect(h.stores.accounts.data.size).toBe(0);
  });

  it("カレンダーの権限が許可されなかったら error=insufficient_scope", async () => {
    const h = buildTestApp();
    const state = await startLink(h);
    h.google.codes.set("code-1", {
      idToken: "id-1",
      refreshToken: "refresh-1",
      scope: "openid email",
    });
    h.google.identities.set("id-1", {
      sub: "sub-x",
      email: "x@example.com",
      emailVerified: true,
    });
    const res = await h.app.request(
      `/auth/google/callback?code=code-1&state=${state}`,
    );
    expect(res.headers.get("location")).toContain("error=insufficient_scope");
    expect(h.stores.accounts.data.size).toBe(0);
  });
});
