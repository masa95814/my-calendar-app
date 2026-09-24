import type { CalendarEvent } from "../lib/calendar.js";
import type { SyncRule } from "./rules.js";

// F3. フィルタ条件の評価。純粋関数にしてテストしやすくする

/** ミラー予定に埋め込む extendedProperties.private のキー */
export const MIRROR_KEYS = {
  app: "mcaApp",
  ruleId: "mcaRuleId",
  sourceAccountId: "mcaSourceAccountId",
  sourceCalendarId: "mcaSourceCalendarId",
  sourceEventId: "mcaSourceEventId",
} as const;

/** 本アプリが作成したミラー予定か（ミラーのミラーを防ぐ） */
export function isMirrorEvent(event: CalendarEvent): boolean {
  return event.extendedProperties?.private?.[MIRROR_KEYS.app] === "1";
}

export function isAllDay(event: CalendarEvent): boolean {
  return Boolean(event.start?.date) && !event.start?.dateTime;
}

/** 開始時刻。終日は UTC 0 時として扱う（同期範囲の判定用） */
export function eventStart(event: CalendarEvent): Date | undefined {
  return toDate(event.start);
}

export function eventEnd(event: CalendarEvent): Date | undefined {
  return toDate(event.end);
}

function toDate(
  edge: CalendarEvent["start"] | CalendarEvent["end"],
): Date | undefined {
  if (edge?.dateTime) {
    const d = new Date(edge.dateTime);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (edge?.date) {
    const d = new Date(`${edge.date}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/**
 * そのタイムゾーンでの今日の 0:00。同期範囲の始まりに使う
 * （今日すでに終わった予定も同期し、それより前のミラーは履歴として残す）
 */
export function startOfDayIn(now: Date, timeZone: string): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    // 不明なタイムゾーン名なら日本時間として扱う
    return startOfDayIn(now, "Asia/Tokyo");
  }
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = get("year");
  const month = get("month") - 1;
  const day = get("day");
  // 現地時刻を UTC とみなした値との差がオフセット
  const offset =
    Date.UTC(year, month, day, get("hour"), get("minute"), get("second")) -
    Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(year, month, day) - offset);
}

/** 時間を埋めない種類の予定は同期しない */
const SKIPPED_EVENT_TYPES = new Set([
  "workingLocation",
  "birthday",
  "fromGmail",
]);

const CONFERENCE_URL_PATTERN =
  /(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com)/i;

/** Google Meet や Zoom などの会議リンクがあるか */
export function hasConferenceLink(event: CalendarEvent): boolean {
  if (event.hangoutLink) {
    return true;
  }
  if (
    event.conferenceData?.entryPoints?.some(
      (entry) => entry.entryPointType === "video" && entry.uri,
    )
  ) {
    return true;
  }
  return CONFERENCE_URL_PATTERN.test(
    `${event.location ?? ""} ${event.description ?? ""}`,
  );
}

export type Evaluation =
  | { mirror: true }
  | {
      mirror: false;
      /** 同期しない理由（ログ・デバッグ用） */
      reason: string;
    };

/**
 * 元予定を同期設定のフィルタに通し、ミラーすべきかを判定する。
 * ミラーしない場合は既存のミラー予定を削除する対象になる。
 */
export function evaluateEvent(
  event: CalendarEvent,
  rule: SyncRule,
  context: {
    now: Date;
    /** 同期範囲の始まり（今日の 0:00）。これより前に終わった予定は past。未指定なら now */
    windowStart?: Date;
  },
): Evaluation {
  const no = (reason: string): Evaluation => ({ mirror: false, reason });

  if (event.status === "cancelled") {
    return no("cancelled");
  }
  if (isMirrorEvent(event)) {
    return no("mirror");
  }
  if (event.eventType && SKIPPED_EVENT_TYPES.has(event.eventType)) {
    return no(`event_type:${event.eventType}`);
  }

  const start = eventStart(event);
  const end = eventEnd(event);
  if (!start || !end) {
    return no("no_time");
  }
  const nowMs = context.now.getTime();
  if (end.getTime() <= (context.windowStart ?? context.now).getTime()) {
    return no("past");
  }
  if (start.getTime() >= nowMs + rule.windowDays * 24 * 60 * 60 * 1000) {
    return no("outside_window");
  }

  const allDay = isAllDay(event);
  if (allDay && rule.filters.excludeAllDay) {
    return no("all_day");
  }
  if (allDay && rule.output.allDaySourceHandling === "skip") {
    return no("all_day_skip");
  }
  if (rule.filters.excludeTransparent && event.transparency === "transparent") {
    return no("transparent");
  }

  // 除外キーワードと例外キーワードはタイトルだけで判定する。説明文まで見ると、会議リンク（Teams の …@thread.v2 など）や
  // 署名に含まれる文字で意図せず除外されてしまうため
  const title = (event.summary ?? "").toLowerCase();
  const titleHas = (keywords: string[]) =>
    keywords.some((keyword) => title.includes(keyword.toLowerCase()));
  // 例外キーワードに当たる予定は、参加者数・会議リンク・包含キーワードの条件を飛ばす（例: 1 人で入れた「面談」）
  const always = titleHas(rule.filters.alwaysIncludeKeywords ?? []);

  // 会議室などのリソースは参加者に数えない
  const attendees = (event.attendees ?? []).filter((a) => !a.resource);
  const self = attendees.find((a) => a.self);
  if (self) {
    if (rule.filters.excludeDeclined && self.responseStatus === "declined") {
      return no("declined");
    }
    if (
      !rule.filters.includeTentative &&
      (self.responseStatus === "needsAction" ||
        self.responseStatus === "tentative")
    ) {
      return no("tentative");
    }
  }
  if (!always && rule.filters.minAttendees !== null) {
    // 参加者情報が無い予定は自分ひとりの予定として数える
    const count = attendees.length > 0 ? attendees.length : 1;
    if (count < rule.filters.minAttendees) {
      return no("attendees");
    }
  }
  if (!always && rule.filters.requireMeetLink && !hasConferenceLink(event)) {
    return no("no_conference_link");
  }

  if (titleHas(rule.filters.excludeKeywords)) {
    return no("exclude_keyword");
  }
  const text = `${title}\n${event.description ?? ""}`.toLowerCase();
  if (
    !always &&
    rule.filters.includeKeywords.length > 0 &&
    !rule.filters.includeKeywords.some((keyword) =>
      text.includes(keyword.toLowerCase()),
    )
  ) {
    return no("include_keyword");
  }

  return { mirror: true };
}
