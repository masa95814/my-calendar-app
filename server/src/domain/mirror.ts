import { createHash } from "node:crypto";

import type { CalendarEvent } from "../lib/calendar.js";
import type { LinkedAccount } from "../repositories/index.js";
import { isAllDay, MIRROR_KEYS } from "./filter.js";
import type { SyncRule } from "./rules.js";

// F4. 出力設定に従ってミラー予定（同期先に作る予定）を組み立てる

export type MirrorContext = {
  sourceAccount: LinkedAccount;
  sourceCalendarId: string;
  /** 終日の元予定を時間指定に変換するときのタイムゾーン */
  timeZone: string;
};

export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

/** 送信元カレンダーのタイムゾーン（無ければ既定） */
export function sourceTimeZone(
  account: LinkedAccount,
  calendarId: string,
): string {
  return (
    account.calendars.find((c) => c.id === calendarId)?.timeZone ??
    account.calendars.find((c) => c.primary)?.timeZone ??
    DEFAULT_TIME_ZONE
  );
}

export function buildMirrorEvent(
  event: CalendarEvent,
  rule: SyncRule,
  context: MirrorContext,
): CalendarEvent {
  const kind = rule.output.kind;
  const summary = rule.output.title
    .replaceAll("{title}", event.summary ?? "（タイトルなし）")
    .replaceAll("{account}", context.sourceAccount.email);

  let start: CalendarEvent["start"];
  let end: CalendarEvent["end"];
  if (isAllDay(event)) {
    if (kind === "outOfOffice") {
      // 「不在」は終日にできないため 0:00〜翌 0:00 の時間指定にする（end.date は翌日）
      start = {
        dateTime: `${event.start?.date}T00:00:00`,
        timeZone: context.timeZone,
      };
      end = {
        dateTime: `${event.end?.date}T00:00:00`,
        timeZone: context.timeZone,
      };
    } else {
      start = { date: event.start?.date ?? null };
      end = { date: event.end?.date ?? null };
    }
  } else {
    // dateTime にはオフセット（+09:00）が含まれるので、タイムゾーン名は写さない
    // （Google が元予定に付ける名前が Asia/Dili のように不自然なことがある）
    start = { dateTime: event.start?.dateTime ?? null };
    end = { dateTime: event.end?.dateTime ?? null };
  }

  const descriptionParts: string[] = [];
  if (rule.output.copyDescription && event.description) {
    descriptionParts.push(event.description);
  }
  if (rule.output.copyLocation && event.hangoutLink) {
    descriptionParts.push(event.hangoutLink);
  }

  const body: CalendarEvent = {
    summary,
    start,
    end,
    transparency: "opaque",
    ...(descriptionParts.length > 0
      ? { description: descriptionParts.join("\n\n") }
      : {}),
    ...(rule.output.copyLocation && event.location
      ? { location: event.location }
      : {}),
    ...(rule.output.visibility !== "default"
      ? { visibility: rule.output.visibility }
      : {}),
    ...(rule.output.colorId ? { colorId: rule.output.colorId } : {}),
    // ミラー予定で通知が鳴らないようにする
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        [MIRROR_KEYS.app]: "1",
        [MIRROR_KEYS.ruleId]: rule.id,
        [MIRROR_KEYS.sourceAccountId]: context.sourceAccount.id,
        [MIRROR_KEYS.sourceCalendarId]: context.sourceCalendarId,
        [MIRROR_KEYS.sourceEventId]: event.id ?? "",
      },
    },
  };

  if (kind === "outOfOffice") {
    body.eventType = "outOfOffice";
    body.outOfOfficeProperties = {
      autoDeclineMode: rule.output.autoDeclineMode,
      ...(rule.output.autoDeclineMode !== "declineNone" &&
      rule.output.declineMessage
        ? { declineMessage: rule.output.declineMessage }
        : {}),
    };
  }

  return body;
}

/** 更新が必要かを判定するための指紋。表示に関わる項目だけを含める */
export function fingerprintOf(body: CalendarEvent): string {
  const subset = {
    summary: body.summary ?? null,
    description: body.description ?? null,
    location: body.location ?? null,
    start: body.start ?? null,
    end: body.end ?? null,
    visibility: body.visibility ?? null,
    colorId: body.colorId ?? null,
    transparency: body.transparency ?? null,
    eventType: body.eventType ?? null,
    outOfOfficeProperties: body.outOfOfficeProperties ?? null,
  };
  return createHash("sha1").update(JSON.stringify(subset)).digest("hex");
}
