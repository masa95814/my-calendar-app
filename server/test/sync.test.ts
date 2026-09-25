import { describe, expect, it } from "vitest";

import type { SyncRule } from "../src/domain/rules.js";
import type { CalendarEvent } from "../src/lib/calendar.js";
import type { SyncSummary } from "../src/services/sync.js";
import {
  buildTestApp,
  jsonHeaders,
  ownerHeaders,
  seedAccounts,
  type TestHarness,
} from "./helpers.js";

const ruleInput = {
  source: { accountId: "acc-a", calendarIds: ["primary"] },
  target: { accountId: "acc-b" },
  output: { kind: "outOfOffice" },
};

function meeting(
  id: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id,
    summary: `会議 ${id}`,
    start: { dateTime: "2026-09-24T10:00:00+09:00" },
    end: { dateTime: "2026-09-24T11:00:00+09:00" },
    attendees: [
      { email: "a@company-a.example", self: true, responseStatus: "accepted" },
      { email: "x@example.com", responseStatus: "accepted" },
    ],
    ...overrides,
  };
}

type RuleResponse = { rule: SyncRule; summary?: SyncSummary };

async function createRule(
  h: TestHarness,
  body: unknown = ruleInput,
): Promise<RuleResponse> {
  const res = await h.app.request("/api/rules", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as RuleResponse;
}

async function poll(h: TestHarness): Promise<SyncSummary> {
  const res = await h.app.request("/tasks/poll", { method: "POST" });
  expect(res.status).toBe(200);
  return ((await res.json()) as { summary: SyncSummary }).summary;
}

const mirrorsInB = (h: TestHarness) => h.calendars.list("acc-b", "primary");

describe("同期エンジン: 作成", () => {
  it("同期設定を作ると初回同期が走り、同期先に「不在」が作られる", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));

    const { rule, summary } = await createRule(h);
    expect(summary).toMatchObject({
      calendars: 1,
      processed: 1,
      created: 1,
      errors: [],
    });
    expect(rule.lastSyncAt).not.toBeNull();
    expect(rule.lastError).toBeNull();

    const mirrors = mirrorsInB(h);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatchObject({
      summary: "不在",
      eventType: "outOfOffice",
      transparency: "opaque",
      start: { dateTime: "2026-09-24T10:00:00+09:00" },
      extendedProperties: {
        private: { mcaApp: "1", mcaRuleId: rule.id, mcaSourceEventId: "evt-1" },
      },
    });

    const records = await h.stores.mirrors.listByRule("owner-uid", rule.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceEventId: "evt-1",
      targetAccountId: "acc-b",
      targetEventId: mirrors[0]?.id,
      kind: "outOfOffice",
    });
    const state = await h.stores.syncStates.get("owner-uid", "acc-a~primary");
    expect(state?.syncToken).toMatch(/^v:/);
    expect(state?.lastFullSyncAt).toEqual(h.clock.now);
  });

  it("フィルタに合わない予定とミラー予定（ループ防止）は同期しない", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put(
      "acc-a",
      "primary",
      meeting("evt-solo", { attendees: undefined }),
    );
    h.calendars.put(
      "acc-a",
      "primary",
      meeting("evt-mirror", {
        extendedProperties: { private: { mcaApp: "1" } },
      }),
    );
    h.calendars.put("acc-a", "primary", meeting("evt-ok"));

    const { summary } = await createRule(h, {
      ...ruleInput,
      filters: { minAttendees: 2 },
    });
    expect(summary).toMatchObject({ processed: 3, created: 1, skipped: 2 });
    expect(mirrorsInB(h)).toHaveLength(1);
  });

  it("無効な同期設定は同期しない", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const { summary } = await createRule(h, { ...ruleInput, enabled: false });
    expect(summary).toBeUndefined();
    expect(mirrorsInB(h)).toHaveLength(0);
  });
});

describe("同期エンジン: 差分同期（/tasks/poll）", () => {
  async function setup() {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const { rule } = await createRule(h);
    h.calendars.calls.length = 0;
    return { h, rule };
  }

  it("変更が無ければ何もしない", async () => {
    const { h } = await setup();
    const summary = await poll(h);
    expect(summary).toMatchObject({
      calendars: 1,
      processed: 0,
      created: 0,
      updated: 0,
      deleted: 0,
    });
    expect(h.calendars.calls.filter((c) => c.method !== "list")).toHaveLength(
      0,
    );
  });

  it("元予定の時間が変わればミラーを更新する", async () => {
    const { h } = await setup();
    h.calendars.put(
      "acc-a",
      "primary",
      meeting("evt-1", {
        start: { dateTime: "2026-09-24T14:00:00+09:00" },
        end: { dateTime: "2026-09-24T15:00:00+09:00" },
      }),
    );
    const summary = await poll(h);
    expect(summary).toMatchObject({ processed: 1, updated: 1 });
    expect(mirrorsInB(h)[0]?.start).toEqual({
      dateTime: "2026-09-24T14:00:00+09:00",
    });
    expect(h.calendars.calls.some((c) => c.method === "patch")).toBe(true);
  });

  it("元予定がキャンセルされればミラーを削除する", async () => {
    const { h, rule } = await setup();
    h.calendars.cancel("acc-a", "primary", "evt-1");
    const summary = await poll(h);
    expect(summary).toMatchObject({ processed: 1, deleted: 1 });
    expect(mirrorsInB(h)).toHaveLength(0);
    expect(
      await h.stores.mirrors.listByRule("owner-uid", rule.id),
    ).toHaveLength(0);
  });

  it("元予定がフィルタから外れればミラーを削除し、戻れば作り直す", async () => {
    const { h } = await setup();
    h.calendars.put(
      "acc-a",
      "primary",
      meeting("evt-1", { transparency: "transparent" }),
    );
    expect(await poll(h)).toMatchObject({ deleted: 1 });
    expect(mirrorsInB(h)).toHaveLength(0);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    expect(await poll(h)).toMatchObject({ created: 1 });
    expect(mirrorsInB(h)).toHaveLength(1);
  });

  it("同期先で手動削除されたミラーは、元予定の変更時に作り直す", async () => {
    const { h } = await setup();
    const mirrorId = mirrorsInB(h)[0]?.id ?? "";
    h.calendars.purge("acc-b", "primary", mirrorId);
    h.calendars.put(
      "acc-a",
      "primary",
      meeting("evt-1", { summary: "変更後" }),
    );
    // タイトルは写さないので指紋は変わらない → 時間を変えて更新を誘発する
    h.calendars.put(
      "acc-a",
      "primary",
      meeting("evt-1", {
        start: { dateTime: "2026-09-24T16:00:00+09:00" },
        end: { dateTime: "2026-09-24T17:00:00+09:00" },
      }),
    );
    expect(await poll(h)).toMatchObject({ updated: 1 });
    expect(mirrorsInB(h)).toHaveLength(1);
    expect(mirrorsInB(h)[0]?.id).not.toBe(mirrorId);
  });

  it("syncToken が失効したら全件同期に切り替え、消えた元予定のミラー（孤児）も掃除する", async () => {
    const { h, rule } = await setup();
    h.calendars.put("acc-a", "primary", meeting("evt-2"));
    expect(await poll(h)).toMatchObject({ created: 1 });
    expect(mirrorsInB(h)).toHaveLength(2);

    // evt-2 が差分に現れないまま消え、トークンも失効した状況
    h.calendars.purge("acc-a", "primary", "evt-2");
    h.calendars.expireSyncTokens();
    const summary = await poll(h);
    expect(summary).toMatchObject({ processed: 1, deleted: 1, errors: [] });
    expect(mirrorsInB(h)).toHaveLength(1);
    expect(
      await h.stores.mirrors.listByRule("owner-uid", rule.id),
    ).toHaveLength(1);
    const state = await h.stores.syncStates.get("owner-uid", "acc-a~primary");
    expect(state?.lastFullSyncAt).toEqual(h.clock.now);
  });

  it("送信元の認証が失効したらアカウントを再認証待ちにし、同期設定にエラーを記録する", async () => {
    const { h, rule } = await setup();
    h.calendars.revoke("acc-a");
    const summary = await poll(h);
    expect(summary.errors).toHaveLength(1);
    expect((await h.stores.accounts.get("owner-uid", "acc-a"))?.status).toBe(
      "reauth_required",
    );
    expect(
      (await h.stores.rules.get("owner-uid", rule.id))?.lastError,
    ).toContain("invalid_grant");
  });

  it("エラーになったとき・再認証が必要になったときだけ通知し、続く同期では繰り返さない", async () => {
    const { h, rule } = await setup();
    h.calendars.revoke("acc-a");
    await poll(h);
    expect(h.notifications).toHaveLength(2);
    expect(h.notifications[0]).toContain(
      "a@company-a.example の連携が切れました",
    );
    expect(h.notifications[1]).toContain(`同期エラー: ${rule.name}`);
    expect(h.notifications[1]).toContain("invalid_grant");

    await poll(h);
    expect(h.notifications).toHaveLength(2);
  });

  it("エラーから戻ったら復旧を通知する", async () => {
    const { h, rule } = await setup();
    const saved = await h.stores.rules.get("owner-uid", rule.id);
    await h.stores.rules.update("owner-uid", {
      ...saved!,
      lastError: "同期先への反映に失敗: 一時的なエラー",
    });
    h.calendars.put("acc-a", "primary", meeting("evt-2"));
    await poll(h);
    expect(h.notifications).toEqual([`✅ 同期が復旧しました: ${rule.name}`]);
  });
});

describe("同期エンジン: 同期設定の変更", () => {
  it("設定変更で対象外になった予定のミラーは削除され、種別変更は作り直しになる", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put(
      "acc-a",
      "primary",
      meeting("evt-1", { summary: "【仮】会議" }),
    );
    h.calendars.put("acc-a", "primary", meeting("evt-2"));
    const { rule } = await createRule(h);
    expect(mirrorsInB(h)).toHaveLength(2);
    const before = mirrorsInB(h).map((e) => e.id);

    const res = await h.app.request(`/api/rules/${rule.id}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        ...ruleInput,
        filters: { excludeKeywords: ["仮"] },
        output: { kind: "busy" },
      }),
    });
    expect(res.status).toBe(200);
    const { summary } = (await res.json()) as RuleResponse;
    expect(summary).toMatchObject({ deleted: 1, updated: 1 });
    const after = mirrorsInB(h);
    expect(after).toHaveLength(1);
    expect(after[0]?.eventType).toBeUndefined();
    expect(after[0]?.summary).toBe("予定あり");
    expect(before).not.toContain(after[0]?.id);
  });

  it("無効化するとミラーを削除し、削除でもミラーを削除する", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const { rule } = await createRule(h);
    expect(mirrorsInB(h)).toHaveLength(1);

    const disable = await h.app.request(`/api/rules/${rule.id}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ ...ruleInput, enabled: false }),
    });
    expect(disable.status).toBe(200);
    expect(mirrorsInB(h)).toHaveLength(0);
    expect(
      await h.stores.mirrors.listByRule("owner-uid", rule.id),
    ).toHaveLength(0);

    const enable = await h.app.request(`/api/rules/${rule.id}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });
    expect(enable.status).toBe(200);
    expect(mirrorsInB(h)).toHaveLength(1);

    const del = await h.app.request(`/api/rules/${rule.id}`, {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(del.status).toBe(204);
    expect(mirrorsInB(h)).toHaveLength(0);
  });

  it("手動同期 API と全体同期 API", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const { rule } = await createRule(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));

    const one = await h.app.request(`/api/rules/${rule.id}/sync`, {
      method: "POST",
      headers: ownerHeaders,
    });
    expect(one.status).toBe(200);
    expect(((await one.json()) as RuleResponse).summary).toMatchObject({
      created: 1,
    });

    h.calendars.put("acc-a", "primary", meeting("evt-2"));
    const all = await h.app.request("/api/sync", {
      method: "POST",
      headers: ownerHeaders,
    });
    expect(all.status).toBe(200);
    expect(
      ((await all.json()) as { summary: SyncSummary }).summary,
    ).toMatchObject({ created: 1 });
    expect(mirrorsInB(h)).toHaveLength(2);
  });

  it("双方向の設定は互いのミラーを元予定として扱わない", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-a"));
    h.calendars.put(
      "acc-b",
      "primary",
      meeting("evt-b", {
        attendees: [
          {
            email: "b@company-b.example",
            self: true,
            responseStatus: "accepted",
          },
          { email: "y@example.com" },
        ],
      }),
    );
    await createRule(h);
    await createRule(h, {
      source: { accountId: "acc-b", calendarIds: ["primary"] },
      target: { accountId: "acc-a" },
      output: { kind: "busy" },
    });
    // 何回回しても増えない
    await poll(h);
    await poll(h);
    expect(
      h.calendars
        .list("acc-b", "primary")
        .filter((e) => e.extendedProperties?.private?.mcaApp),
    ).toHaveLength(1);
    expect(
      h.calendars
        .list("acc-a", "primary")
        .filter((e) => e.extendedProperties?.private?.mcaApp),
    ).toHaveLength(1);
  });
});

describe("同期エンジン: 連携解除", () => {
  it("解除するアカウントが関わるミラーを、トークン失効の前に削除する", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-a"));
    await createRule(h);
    await createRule(h, {
      source: { accountId: "acc-a", calendarIds: ["primary"] },
      target: { accountId: "acc-p" },
      output: { kind: "busy" },
    });
    expect(mirrorsInB(h)).toHaveLength(1);
    expect(h.calendars.list("acc-p", "primary")).toHaveLength(1);

    const res = await h.app.request("/api/accounts/acc-b", {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(204);
    expect(mirrorsInB(h)).toHaveLength(0);
    expect(h.calendars.list("acc-p", "primary")).toHaveLength(1);
    const deleteCall = h.calendars.calls.findIndex(
      (c) => c.method === "delete" && c.accountId === "acc-b",
    );
    expect(deleteCall).toBeGreaterThanOrEqual(0);
    expect(h.google.revoked).toEqual(["rt-acc-b"]);
  });
});

describe("同期エンジン: 予定の色", () => {
  it("指定した色でミラーを作り、色を変えると既存のミラーも更新する", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const { rule } = await createRule(h, {
      ...ruleInput,
      output: { kind: "busy", colorId: "5" },
    });
    expect(mirrorsInB(h)[0]?.colorId).toBe("5");

    const res = await h.app.request(`/api/rules/${rule.id}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        ...ruleInput,
        output: { kind: "busy", colorId: "11" },
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as RuleResponse).summary).toMatchObject({
      updated: 1,
    });
    expect(mirrorsInB(h)[0]?.colorId).toBe("11");
  });

  it("Google が色を拒否（400）したら色なしで作成する", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const calls: (string | undefined | null)[] = [];
    const wrapped = h.calendars.clientFor;
    h.calendars.clientFor = (accountId) => {
      const c = wrapped(accountId);
      if (accountId !== "acc-b") return c;
      return {
        ...c,
        async insertEvent(calendarId, event) {
          calls.push(event.colorId);
          if (event.colorId) {
            throw Object.assign(new Error("Invalid color"), { code: 400 });
          }
          return c.insertEvent(calendarId, event);
        },
      };
    };
    const { summary } = await createRule(h, {
      ...ruleInput,
      output: { kind: "outOfOffice", colorId: "3" },
    });
    expect(summary).toMatchObject({ created: 1, errors: [] });
    expect(calls).toEqual(["3", undefined]);
    expect(mirrorsInB(h)[0]?.colorId).toBeUndefined();
  });
});

describe("同期エンジン: 今日の予定と過去のミラー", () => {
  // meeting() の既定は 2026-09-24 10:00〜11:00（日本時間）
  const afternoonOf24th = new Date("2026-09-24T05:00:00Z"); // 14:00（日本時間）
  const nextDay = new Date("2026-09-25T05:00:00Z"); // 9/25 14:00（日本時間）

  it("今日すでに終わった予定も同期する", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.clock.now = afternoonOf24th;
    h.calendars.put("acc-a", "primary", meeting("evt-morning"));
    const { summary } = await createRule(h);
    expect(summary).toMatchObject({ created: 1, errors: [] });
    expect(mirrorsInB(h)).toHaveLength(1);
    const [record] = await h.stores.mirrors.listByRule(
      "owner-uid",
      mirrorsInB(h)[0]?.extendedProperties?.private?.mcaRuleId ?? "",
    );
    expect(record?.sourceEndAt).toEqual(new Date("2026-09-24T02:00:00Z"));
  });

  it("前日以前に終わった予定のミラーは、全件同期で元予定が範囲外になっても残す", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.clock.now = afternoonOf24th;
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const { rule } = await createRule(h);
    expect(mirrorsInB(h)).toHaveLength(1);

    // 翌日の全件同期: 元予定は範囲（今日の 0:00〜）より前なので取得されない
    h.clock.now = nextDay;
    h.calendars.purge("acc-a", "primary", "evt-1");
    h.calendars.expireSyncTokens();
    expect(await poll(h)).toMatchObject({ deleted: 0, errors: [] });
    expect(mirrorsInB(h)).toHaveLength(1);
    expect(
      await h.stores.mirrors.listByRule("owner-uid", rule.id),
    ).toHaveLength(1);
  });

  it("前日以前の予定が変更されてもミラーは残し、キャンセルされたら消す", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.clock.now = afternoonOf24th;
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    await createRule(h);

    h.clock.now = nextDay;
    h.calendars.put(
      "acc-a",
      "primary",
      meeting("evt-1", { summary: "会議（議事録を追記）" }),
    );
    expect(await poll(h)).toMatchObject({ deleted: 0 });
    expect(mirrorsInB(h)).toHaveLength(1);

    h.calendars.cancel("acc-a", "primary", "evt-1");
    expect(await poll(h)).toMatchObject({ deleted: 1 });
    expect(mirrorsInB(h)).toHaveLength(0);
  });

  it("終了時刻の無い古い対応表は、次の同期で埋める", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const { rule } = await createRule(h);
    const [record] = await h.stores.mirrors.listByRule("owner-uid", rule.id);
    await h.stores.mirrors.upsert("owner-uid", {
      ...record!,
      sourceEndAt: null,
    });

    h.calendars.expireSyncTokens();
    expect(await poll(h)).toMatchObject({ updated: 0, deleted: 0 });
    const [filled] = await h.stores.mirrors.listByRule("owner-uid", rule.id);
    expect(filled?.sourceEndAt).toEqual(new Date("2026-09-24T02:00:00Z"));
  });
});
