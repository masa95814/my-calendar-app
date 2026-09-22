import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "../src/lib/calendar.js";
import type { UnifiedEvent } from "../src/services/sync.js";
import {
  buildTestApp,
  jsonHeaders,
  ownerHeaders,
  seedAccounts,
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

describe("対応表が失われたときの復旧", () => {
  it("全件同期で、タグは付いているが対応表に無いミラーを掃除する", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const res = await h.app.request("/api/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });
    const { rule } = (await res.json()) as { rule: { id: string } };
    expect(h.calendars.list("acc-b", "primary")).toHaveLength(1);

    // 対応表だけ消えた状況を作り、元予定も無くなったとする
    h.stores.mirrors.data.clear();
    h.calendars.purge("acc-a", "primary", "evt-1");
    const sync = await h.app.request(`/api/rules/${rule.id}/sync`, {
      method: "POST",
      headers: ownerHeaders,
    });
    expect(sync.status).toBe(200);
    expect(h.calendars.list("acc-b", "primary")).toHaveLength(0);
  });

  it("元予定が残っていて対応表だけ消えた場合は、重複を作らず 1 件に収束する", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    const res = await h.app.request("/api/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });
    const { rule } = (await res.json()) as { rule: { id: string } };
    h.stores.mirrors.data.clear();
    await h.app.request(`/api/rules/${rule.id}/sync`, {
      method: "POST",
      headers: ownerHeaders,
    });
    // 対応表が無いので新しく 1 件作られ、古い 1 件はタグから見つけて消える
    expect(h.calendars.list("acc-b", "primary")).toHaveLength(1);
    expect(h.stores.mirrors.data.size).toBe(1);
  });

  it("POST /api/accounts/:id/purge-mirrors はそのアカウントのミラーをすべて消す", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    h.calendars.put(
      "acc-b",
      "primary",
      meeting("evt-own", { attendees: undefined }),
    );
    await h.app.request("/api/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });
    expect(h.calendars.list("acc-b", "primary")).toHaveLength(2);

    const res = await h.app.request("/api/accounts/acc-b/purge-mirrors", {
      method: "POST",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedEvents: 1, deletedRecords: 1 });
    const remaining = h.calendars.list("acc-b", "primary");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("evt-own");
    expect(
      (
        await h.app.request("/api/accounts/nope/purge-mirrors", {
          method: "POST",
          headers: ownerHeaders,
        })
      ).status,
    ).toBe(404);
  });
});

describe("GET /api/events", () => {
  it("期間の検証", async () => {
    const h = buildTestApp();
    expect(
      (await h.app.request("/api/events", { headers: ownerHeaders })).status,
    ).toBe(400);
    expect(
      (
        await h.app.request(
          "/api/events?from=2026-09-01T00:00:00Z&to=2026-12-31T00:00:00Z",
          {
            headers: ownerHeaders,
          },
        )
      ).status,
    ).toBe(400);
  });

  it("全アカウントの予定を時刻順に返し、ミラーには印を付ける", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.put("acc-a", "primary", meeting("evt-1"));
    h.calendars.put(
      "acc-b",
      "primary",
      meeting("evt-b", {
        summary: "B の予定",
        start: { dateTime: "2026-09-24T09:00:00+09:00" },
        end: { dateTime: "2026-09-24T09:30:00+09:00" },
      }),
    );
    h.calendars.put("acc-p", "primary", {
      id: "evt-p",
      summary: "休み",
      start: { date: "2026-09-25" },
      end: { date: "2026-09-26" },
    });
    const created = await h.app.request("/api/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });
    const { rule } = (await created.json()) as { rule: { id: string } };

    const res = await h.app.request(
      "/api/events?from=2026-09-23T00:00:00Z&to=2026-09-30T00:00:00Z",
      { headers: ownerHeaders },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: UnifiedEvent[];
      errors: string[];
    };
    expect(body.errors).toEqual([]);
    expect(body.events.map((e) => `${e.accountEmail}:${e.summary}`)).toEqual([
      "b@company-b.example:B の予定",
      "a@company-a.example:会議 evt-1",
      "b@company-b.example:不在",
      "me@gmail.com:休み",
    ]);
    const mirror = body.events.find((e) => e.isMirror);
    expect(mirror).toMatchObject({
      accountId: "acc-b",
      mirrorRuleId: rule.id,
      eventType: "outOfOffice",
    });
    expect(body.events.find((e) => e.summary === "休み")?.allDay).toBe(true);
  });

  it("再認証が必要なアカウントは飛ばしてエラーに載せる", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    h.calendars.revoke("acc-p");
    const res = await h.app.request(
      "/api/events?from=2026-09-23T00:00:00Z&to=2026-09-30T00:00:00Z",
      { headers: ownerHeaders },
    );
    const body = (await res.json()) as {
      events: UnifiedEvent[];
      errors: string[];
    };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toContain("me@gmail.com");
    expect((await h.stores.accounts.get("owner-uid", "acc-p"))?.status).toBe(
      "reauth_required",
    );
  });
});

describe("GET /api/status", () => {
  it("アカウント・同期設定・同期状態をまとめて返す", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    await h.app.request("/api/rules", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(ruleInput),
    });
    const res = await h.app.request("/api/status", { headers: ownerHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accounts: { email: string; calendarCount: number }[];
      rules: {
        name: string;
        lastSyncAt: string | null;
        lastError: string | null;
      }[];
      syncStates: {
        accountId: string;
        calendarId: string;
        watchActive: boolean;
      }[];
    };
    expect(body.accounts.map((a) => a.email)).toEqual([
      "a@company-a.example",
      "b@company-b.example",
      "me@gmail.com",
    ]);
    expect(body.accounts[0]).not.toHaveProperty("refreshTokenEnc");
    expect(body.accounts[0]?.calendarCount).toBe(2);
    expect(body.rules[0]).toMatchObject({ lastError: null });
    expect(body.rules[0]?.lastSyncAt).toBeTruthy();
    expect(body.syncStates).toEqual([
      expect.objectContaining({
        accountId: "acc-a",
        calendarId: "primary",
        watchActive: false,
      }),
    ]);
  });
});
