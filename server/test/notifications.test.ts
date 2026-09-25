import { describe, expect, it } from "vitest";

import { createSlackNotifier } from "../src/lib/slack.js";
import { buildTestApp, ownerHeaders } from "./helpers.js";

describe("Slack 通知", () => {
  it("Incoming Webhook に text を JSON で送る", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const notify = createSlackNotifier("https://hooks.slack.com/services/x", {
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response("ok");
      },
    });
    await notify("こんにちは");
    expect(calls).toEqual([
      {
        url: "https://hooks.slack.com/services/x",
        body: { text: "こんにちは" },
      },
    ]);
  });

  it("対応が必要な通知だけ、設定したメンバーにメンションする", async () => {
    const texts: string[] = [];
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      texts.push((JSON.parse(String(init?.body)) as { text: string }).text);
      return new Response("ok");
    };
    const notify = createSlackNotifier("https://hooks.slack.com/x", {
      mentionUserId: "U01ABCDEF",
      fetchImpl,
    });
    await notify("⚠️ 同期エラー", { urgent: true });
    await notify("✅ 復旧");
    // メンション先が未設定なら、対応が必要な通知でもメンションしない
    await createSlackNotifier("https://hooks.slack.com/x", { fetchImpl })(
      "⚠️ 同期エラー",
      { urgent: true },
    );
    expect(texts).toEqual([
      "<@U01ABCDEF> ⚠️ 同期エラー",
      "✅ 復旧",
      "⚠️ 同期エラー",
    ]);
  });

  it("送信に失敗しても例外を投げない（同期を止めない）", async () => {
    const failing = createSlackNotifier(
      "https://hooks.slack.com/x",
      async () => {
        throw new Error("network");
      },
    );
    await expect(failing("x")).resolves.toBeUndefined();
    const rejected = createSlackNotifier("https://hooks.slack.com/x", {
      fetchImpl: async () => new Response("no", { status: 404 }),
    });
    await expect(rejected("x")).resolves.toBeUndefined();
  });
});

describe("POST /api/notifications/test", () => {
  it("テスト通知を送る", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/notifications/test", {
      method: "POST",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(200);
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]).toContain("テスト通知");
    expect(h.urgentFlags).toEqual([true]);
  });

  it("通知先が未設定なら 409", async () => {
    const h = buildTestApp({ notify: undefined });
    const res = await h.app.request("/api/notifications/test", {
      method: "POST",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(409);
  });

  it("認証が必要", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/notifications/test", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});
