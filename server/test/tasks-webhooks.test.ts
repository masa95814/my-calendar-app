import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "../src/lib/calendar.js";
import { buildTestApp, jsonHeaders, seedAccounts } from "./helpers.js";

const ruleInput = {
  source: { accountId: "acc-a", calendarIds: ["primary"] },
  target: { accountId: "acc-b" },
  output: { kind: "outOfOffice" },
};

const meeting: CalendarEvent = {
  id: "evt-1",
  summary: "会議",
  start: { dateTime: "2026-09-24T10:00:00+09:00" },
  end: { dateTime: "2026-09-24T11:00:00+09:00" },
};

describe("/tasks/*", () => {
  it("TASKS_SECRET が設定されていればヘッダーが一致するときだけ受け付ける", async () => {
    const h = buildTestApp({ env: { TASKS_SECRET: "s3cret" } });
    expect(
      (await h.app.request("/tasks/poll", { method: "POST" })).status,
    ).toBe(401);
    expect(
      (
        await h.app.request("/tasks/poll", {
          method: "POST",
          headers: { "X-Tasks-Secret": "wrong" },
        })
      ).status,
    ).toBe(401);
    const ok = await h.app.request("/tasks/poll", {
      method: "POST",
      headers: { "X-Tasks-Secret": "s3cret" },
    });
    expect(ok.status).toBe(200);
  });

  it("全件同期は範囲内を再評価する", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    await h.app.request("/api/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });
    h.calendars.put("acc-a", "primary", meeting);
    const res = await h.app.request("/tasks/full-resync", { method: "POST" });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { summary: { created: number } }).summary.created,
    ).toBe(1);
  });
});

describe("watch チャネルと通知", () => {
  it("PUBLIC_BASE_URL が無ければチャネルを張らない", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    await h.app.request("/api/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });
    const res = await h.app.request("/tasks/renew-watch", { method: "POST" });
    expect(res.status).toBe(200);
    expect(h.calendars.calls.some((c) => c.method === "watch")).toBe(false);
  });

  it("チャネルを張り、正しいトークン付きの通知で差分同期が走る。不正な通知は無視する", async () => {
    const h = buildTestApp({
      env: { PUBLIC_BASE_URL: "https://example.run.app" },
    });
    await seedAccounts(h);
    await h.app.request("/api/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });

    const renew = await h.app.request("/tasks/renew-watch", { method: "POST" });
    expect(renew.status).toBe(200);
    const watchCall = h.calendars.calls.find((c) => c.method === "watch");
    expect(watchCall).toMatchObject({
      accountId: "acc-a",
      calendarId: "primary",
    });
    const channel = [...h.stores.channels.data.values()][0];
    expect(channel).toMatchObject({
      uid: "owner-uid",
      accountId: "acc-a",
      calendarId: "primary",
    });
    const state = await h.stores.syncStates.get("owner-uid", "acc-a~primary");
    expect(state?.channelId).toBe(channel?.id);

    // 期限に余裕があれば張り直さない
    const again = await h.app.request("/tasks/renew-watch", { method: "POST" });
    expect(again.status).toBe(200);
    expect(h.calendars.calls.filter((c) => c.method === "watch")).toHaveLength(
      1,
    );

    // 通知: 登録直後の sync は同期しない
    h.calendars.put("acc-a", "primary", meeting);
    const syncPing = await h.app.request("/webhooks/calendar", {
      method: "POST",
      headers: {
        "X-Goog-Channel-ID": channel!.id,
        "X-Goog-Channel-Token": channel!.token,
        "X-Goog-Resource-State": "sync",
      },
    });
    expect(syncPing.status).toBe(200);
    expect(h.calendars.list("acc-b", "primary")).toHaveLength(0);

    // トークン不一致は無視
    const bad = await h.app.request("/webhooks/calendar", {
      method: "POST",
      headers: {
        "X-Goog-Channel-ID": channel!.id,
        "X-Goog-Channel-Token": "wrong",
        "X-Goog-Resource-State": "exists",
      },
    });
    expect(bad.status).toBe(200);
    expect(h.calendars.list("acc-b", "primary")).toHaveLength(0);

    // 正しい通知で差分同期
    const good = await h.app.request("/webhooks/calendar", {
      method: "POST",
      headers: {
        "X-Goog-Channel-ID": channel!.id,
        "X-Goog-Channel-Token": channel!.token,
        "X-Goog-Resource-State": "exists",
      },
    });
    expect(good.status).toBe(200);
    expect(h.calendars.list("acc-b", "primary")).toHaveLength(1);

    // 期限が近づいたら張り直し、古いチャネルを止める
    h.clock.now = new Date(h.clock.now.getTime() + 6.5 * 24 * 60 * 60 * 1000);
    await h.app.request("/tasks/renew-watch", { method: "POST" });
    expect(h.calendars.calls.filter((c) => c.method === "watch")).toHaveLength(
      2,
    );
    expect(
      h.calendars.calls.some(
        (c) => c.method === "stop" && c.eventId === channel?.id,
      ),
    ).toBe(true);
    expect(await h.stores.channels.get(channel!.id)).toBeUndefined();
  });
});
