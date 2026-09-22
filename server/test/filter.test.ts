import { describe, expect, it } from "vitest";

import { evaluateEvent, hasConferenceLink } from "../src/domain/filter.js";
import type { SyncRule } from "../src/domain/rules.js";
import type { CalendarEvent } from "../src/lib/calendar.js";

const now = new Date("2026-09-23T00:00:00Z");

function rule(overrides: Partial<SyncRule> = {}): SyncRule {
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
      excludeAllDay: true,
      excludeTransparent: true,
      excludeDeclined: true,
      includeTentative: true,
    },
    output: {
      kind: "outOfOffice",
      title: "不在",
      copyDescription: false,
      copyLocation: false,
      visibility: "private",
      allDaySourceHandling: "fullDay",
      autoDeclineMode: "declineOnlyNewConflictingInvitations",
      declineMessage: "",
    },
    createdAt: now,
    updatedAt: now,
    lastSyncAt: null,
    lastError: null,
    ...overrides,
  };
}

function withFilters(filters: Partial<SyncRule["filters"]>): SyncRule {
  const base = rule();
  return { ...base, filters: { ...base.filters, ...filters } };
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    status: "confirmed",
    summary: "定例ミーティング",
    start: { dateTime: "2026-09-24T10:00:00+09:00" },
    end: { dateTime: "2026-09-24T11:00:00+09:00" },
    ...overrides,
  };
}

const reason = (e: CalendarEvent, r: SyncRule) => {
  const result = evaluateEvent(e, r, { now });
  return result.mirror ? "mirror" : result.reason;
};

describe("evaluateEvent", () => {
  it("通常の予定は同期する", () => {
    expect(reason(event(), rule())).toBe("mirror");
  });

  it("キャンセル・ミラー予定・時間を埋めない種類は同期しない", () => {
    expect(reason(event({ status: "cancelled" }), rule())).toBe("cancelled");
    expect(
      reason(
        event({ extendedProperties: { private: { mcaApp: "1" } } }),
        rule(),
      ),
    ).toBe("mirror");
    expect(reason(event({ eventType: "workingLocation" }), rule())).toBe(
      "event_type:workingLocation",
    );
    expect(reason(event({ eventType: "outOfOffice" }), rule())).toBe("mirror");
  });

  it("過去の予定と同期範囲の外は同期しない", () => {
    expect(
      reason(
        event({
          start: { dateTime: "2026-09-22T10:00:00Z" },
          end: { dateTime: "2026-09-22T11:00:00Z" },
        }),
        rule(),
      ),
    ).toBe("past");
    expect(
      reason(
        event({
          start: { dateTime: "2026-12-01T10:00:00Z" },
          end: { dateTime: "2026-12-01T11:00:00Z" },
        }),
        rule({ windowDays: 30 }),
      ),
    ).toBe("outside_window");
  });

  it("終日は既定で除外、許可しても出力設定が skip なら同期しない", () => {
    const allDay = event({
      start: { date: "2026-09-25" },
      end: { date: "2026-09-26" },
    });
    expect(reason(allDay, rule())).toBe("all_day");
    expect(reason(allDay, withFilters({ excludeAllDay: false }))).toBe(
      "mirror",
    );
    const skip = withFilters({ excludeAllDay: false });
    skip.output = { ...skip.output, allDaySourceHandling: "skip" };
    expect(reason(allDay, skip)).toBe("all_day_skip");
  });

  it("「予定なし」扱いの予定は既定で除外", () => {
    expect(reason(event({ transparency: "transparent" }), rule())).toBe(
      "transparent",
    );
    expect(
      reason(
        event({ transparency: "transparent" }),
        withFilters({ excludeTransparent: false }),
      ),
    ).toBe("mirror");
  });

  it("自分の返答状況で判定する", () => {
    const declined = event({
      attendees: [
        { email: "me@a", self: true, responseStatus: "declined" },
        { email: "x@a", responseStatus: "accepted" },
      ],
    });
    expect(reason(declined, rule())).toBe("declined");
    expect(reason(declined, withFilters({ excludeDeclined: false }))).toBe(
      "mirror",
    );

    const tentative = event({
      attendees: [{ email: "me@a", self: true, responseStatus: "needsAction" }],
    });
    expect(reason(tentative, rule())).toBe("mirror");
    expect(reason(tentative, withFilters({ includeTentative: false }))).toBe(
      "tentative",
    );
  });

  it("参加者数は会議室を除いて数え、参加者情報が無ければ 1 人", () => {
    const solo = event();
    expect(reason(solo, withFilters({ minAttendees: 2 }))).toBe("attendees");
    const meeting = event({
      attendees: [
        { email: "me@a", self: true, responseStatus: "accepted" },
        { email: "x@a", responseStatus: "accepted" },
        { email: "room@a", resource: true },
      ],
    });
    expect(reason(meeting, withFilters({ minAttendees: 2 }))).toBe("mirror");
    expect(reason(meeting, withFilters({ minAttendees: 3 }))).toBe("attendees");
  });

  it("会議リンクの有無", () => {
    expect(reason(event(), withFilters({ requireMeetLink: true }))).toBe(
      "no_conference_link",
    );
    expect(
      reason(
        event({ hangoutLink: "https://meet.google.com/abc-defg-hij" }),
        withFilters({ requireMeetLink: true }),
      ),
    ).toBe("mirror");
    expect(
      hasConferenceLink(event({ location: "https://zoom.us/j/123" })),
    ).toBe(true);
    expect(
      hasConferenceLink(
        event({
          conferenceData: {
            entryPoints: [
              { entryPointType: "video", uri: "https://meet.google.com/x" },
            ],
          },
        }),
      ),
    ).toBe(true);
    expect(hasConferenceLink(event({ location: "会議室 A" }))).toBe(false);
  });

  it("キーワードの除外と包含（大文字小文字を区別しない）", () => {
    expect(
      reason(
        event({ summary: "【仮】打ち合わせ" }),
        withFilters({ excludeKeywords: ["仮"] }),
      ),
    ).toBe("exclude_keyword");
    expect(
      reason(
        event({ description: "Zoom で実施" }),
        withFilters({ excludeKeywords: ["zoom"] }),
      ),
    ).toBe("exclude_keyword");
    expect(reason(event(), withFilters({ includeKeywords: ["顧客"] }))).toBe(
      "include_keyword",
    );
    expect(
      reason(
        event({ summary: "顧客訪問" }),
        withFilters({ includeKeywords: ["顧客"] }),
      ),
    ).toBe("mirror");
  });
});
