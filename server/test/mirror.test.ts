import { describe, expect, it } from "vitest";

import { buildMirrorEvent, fingerprintOf } from "../src/domain/mirror.js";
import type { SyncRule } from "../src/domain/rules.js";
import type { CalendarEvent } from "../src/lib/calendar.js";
import type { LinkedAccount } from "../src/repositories/index.js";

const now = new Date("2026-09-23T00:00:00Z");

const sourceAccount: LinkedAccount = {
  id: "acc-a",
  email: "a@company-a.example",
  hd: "company-a.example",
  type: "workspace",
  refreshTokenEnc: "plain:rt",
  scopes: [],
  status: "ok",
  calendars: [
    {
      id: "primary",
      summary: "a",
      primary: true,
      accessRole: "owner",
      timeZone: "Asia/Tokyo",
    },
  ],
  linkedAt: now,
  updatedAt: now,
};

function rule(output: Partial<SyncRule["output"]> = {}): SyncRule {
  return {
    id: "rule-1",
    name: "A → B",
    enabled: true,
    source: { accountId: "acc-a", calendarIds: ["primary"] },
    target: { accountId: "acc-b" },
    windowDays: 60,
    filters: {
      minAttendees: null,
      requireMeetLink: false,
      excludeKeywords: [],
      includeKeywords: [],
      excludeAllDay: false,
      excludeTransparent: true,
      excludeDeclined: true,
      includeTentative: true,
    },
    output: {
      kind: "outOfOffice",
      title: "不在",
      copyDescription: false,
      copyLocation: false,
      visibility: "public",
      colorId: null,
      allDaySourceHandling: "fullDay",
      autoDeclineMode: "declineOnlyNewConflictingInvitations",
      declineMessage: "別件の予定があるため参加できません。",
      ...output,
    },
    createdAt: now,
    updatedAt: now,
    lastSyncAt: null,
    lastError: null,
  };
}

const timed: CalendarEvent = {
  id: "evt-1",
  summary: "顧客打ち合わせ",
  description: "議題: 見積",
  location: "会議室 A",
  hangoutLink: "https://meet.google.com/abc",
  start: { dateTime: "2026-09-24T10:00:00+09:00", timeZone: "Asia/Tokyo" },
  end: { dateTime: "2026-09-24T11:00:00+09:00", timeZone: "Asia/Tokyo" },
};

const context = {
  sourceAccount,
  sourceCalendarId: "primary",
  timeZone: "Asia/Tokyo",
};

describe("buildMirrorEvent", () => {
  it("「不在」は eventType と自動辞退を付け、詳細は写さず、通知を止め、元予定のタグを埋め込む", () => {
    const body = buildMirrorEvent(timed, rule(), context);
    expect(body).toMatchObject({
      summary: "不在",
      start: { dateTime: "2026-09-24T10:00:00+09:00" },
      end: { dateTime: "2026-09-24T11:00:00+09:00" },
      transparency: "opaque",
      visibility: "public",
      eventType: "outOfOffice",
      outOfOfficeProperties: {
        autoDeclineMode: "declineOnlyNewConflictingInvitations",
        declineMessage: "別件の予定があるため参加できません。",
      },
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: {
        private: {
          mcaApp: "1",
          mcaRuleId: "rule-1",
          mcaSourceAccountId: "acc-a",
          mcaSourceCalendarId: "primary",
          mcaSourceEventId: "evt-1",
        },
      },
    });
    expect(body.description).toBeUndefined();
    expect(body.location).toBeUndefined();
  });

  it("「予定あり」は eventType を付けず、辞退しない設定ならメッセージも付けない", () => {
    const body = buildMirrorEvent(
      timed,
      rule({ kind: "busy", title: "予定あり" }),
      context,
    );
    expect(body.eventType).toBeUndefined();
    expect(body.outOfOfficeProperties).toBeUndefined();
    const noDecline = buildMirrorEvent(
      timed,
      rule({ autoDeclineMode: "declineNone" }),
      context,
    );
    expect(noDecline.outOfOfficeProperties).toEqual({
      autoDeclineMode: "declineNone",
    });
  });

  it("タイトルのテンプレートと、説明・場所・会議リンクの複写", () => {
    const body = buildMirrorEvent(
      timed,
      rule({
        title: "{title}（{account}）",
        copyDescription: true,
        copyLocation: true,
        visibility: "default",
      }),
      context,
    );
    expect(body.summary).toBe("顧客打ち合わせ（a@company-a.example）");
    expect(body.description).toBe("議題: 見積\n\nhttps://meet.google.com/abc");
    expect(body.location).toBe("会議室 A");
    expect(body.visibility).toBeUndefined();
  });

  it("終日の元予定は「不在」なら 0:00〜翌 0:00 の時間指定、「予定あり」なら終日のまま", () => {
    const allDay: CalendarEvent = {
      id: "evt-2",
      summary: "休暇",
      start: { date: "2026-09-25" },
      end: { date: "2026-09-27" },
    };
    const ooo = buildMirrorEvent(allDay, rule(), context);
    expect(ooo.start).toEqual({
      dateTime: "2026-09-25T00:00:00",
      timeZone: "Asia/Tokyo",
    });
    expect(ooo.end).toEqual({
      dateTime: "2026-09-27T00:00:00",
      timeZone: "Asia/Tokyo",
    });
    const busy = buildMirrorEvent(allDay, rule({ kind: "busy" }), context);
    expect(busy.start).toEqual({ date: "2026-09-25" });
    expect(busy.end).toEqual({ date: "2026-09-27" });
  });
});

describe("予定の色", () => {
  it("色を指定すると colorId を付け、既定なら付けない。色の変更は指紋に反映する", () => {
    const tomato = buildMirrorEvent(timed, rule({ colorId: "11" }), context);
    const none = buildMirrorEvent(timed, rule(), context);
    expect(tomato.colorId).toBe("11");
    expect(none.colorId).toBeUndefined();
    expect(fingerprintOf(tomato)).not.toBe(fingerprintOf(none));
  });
});

describe("公開設定", () => {
  it("公開・非公開はそのまま、カレンダーの既定は visibility を付けない", () => {
    expect(
      buildMirrorEvent(timed, rule({ visibility: "public" }), context)
        .visibility,
    ).toBe("public");
    expect(
      buildMirrorEvent(timed, rule({ visibility: "private" }), context)
        .visibility,
    ).toBe("private");
    expect(
      buildMirrorEvent(timed, rule({ visibility: "default" }), context)
        .visibility,
    ).toBeUndefined();
  });

  it("公開設定を変えると指紋が変わり、既存のミラーも更新される", () => {
    const pub = buildMirrorEvent(
      timed,
      rule({ visibility: "public" }),
      context,
    );
    const priv = buildMirrorEvent(
      timed,
      rule({ visibility: "private" }),
      context,
    );
    expect(fingerprintOf(pub)).not.toBe(fingerprintOf(priv));
  });
});

describe("fingerprintOf", () => {
  it("表示に関わる項目が同じなら同じ、時間が変われば変わる", () => {
    const a = buildMirrorEvent(timed, rule(), context);
    const b = buildMirrorEvent(
      { ...timed, updated: "2026-09-23T01:00:00Z" },
      rule(),
      context,
    );
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
    const moved = buildMirrorEvent(
      { ...timed, start: { dateTime: "2026-09-24T13:00:00+09:00" } },
      rule(),
      context,
    );
    expect(fingerprintOf(moved)).not.toBe(fingerprintOf(a));
  });
});
