import { z } from "zod";

import type { LinkedAccount } from "../repositories/index.js";

// 同期設定（docs/requirements-and-design.md の F2〜F4）の定義と検証

export const outputKindSchema = z.enum(["outOfOffice", "busy"]);
export type OutputKind = z.infer<typeof outputKindSchema>;

export const autoDeclineModeSchema = z.enum([
  "declineNone",
  "declineOnlyNewConflictingInvitations",
  "declineAllConflictingInvitations",
]);

/**
 * ミラー予定の色（Google カレンダーの予定の色 ID "1"〜"11"）。null は同期先カレンダーの既定の色
 * 1 ラベンダー / 2 セージ / 3 ブドウ / 4 フラミンゴ / 5 バナナ / 6 ミカン /
 * 7 ピーコック / 8 グラファイト / 9 ブルーベリー / 10 バジル / 11 トマト
 */
export const eventColorIdSchema = z.enum([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
]);

export const allDaySourceHandlingSchema = z.enum(["fullDay", "skip"]);
/** ミラー予定の公開設定（Google Calendar の visibility）。default は同期先カレンダーの既定に従う */
export const visibilitySchema = z.enum(["public", "private", "default"]);

const keywordList = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .default([]);

/** F3. フィルタ条件。条件は AND で評価する（alwaysIncludeKeywords だけは一部の条件を飛ばす例外） */
export const ruleFiltersSchema = z.object({
  /** 参加者が N 人以上の予定のみ（自分を含む）。null は条件なし */
  minAttendees: z.number().int().min(1).max(100).nullable().default(null),
  /** 会議リンクがある予定のみ */
  requireMeetLink: z.boolean().default(false),
  /** タイトルにいずれかを含む予定を除外（説明文は見ない） */
  excludeKeywords: keywordList,
  /** 指定時、タイトルまたは説明にいずれかを含む予定のみ同期 */
  includeKeywords: keywordList,
  /**
   * タイトルにいずれかを含む予定は、参加者数・会議リンク・包含キーワードの条件を満たさなくても同期する。
   * 除外キーワードや辞退済みなど、ほかの条件は優先する
   */
  alwaysIncludeKeywords: keywordList,
  excludeAllDay: z.boolean().default(true),
  /** 「予定なし」扱い（transparent）の予定を除外 */
  excludeTransparent: z.boolean().default(true),
  excludeDeclined: z.boolean().default(true),
  /** 未回答・仮承諾の予定を含める */
  includeTentative: z.boolean().default(true),
});
export type RuleFilters = z.infer<typeof ruleFiltersSchema>;

/** F4. 出力設定 */
export const ruleOutputSchema = z.object({
  kind: outputKindSchema,
  /** ミラー予定のタイトル。{title} {account} を使える。未指定なら種別に応じた既定値 */
  title: z.string().trim().min(1).max(200).optional(),
  copyDescription: z.boolean().default(false),
  copyLocation: z.boolean().default(false),
  visibility: visibilitySchema.default("public"),
  /** ミラー予定の色。null は同期先カレンダーの既定の色 */
  colorId: eventColorIdSchema.nullable().default(null),
  /**
   * ミラー予定の長さの上限（分）。元予定がこれより長ければ終了を「開始 + 上限」にする
   * （例: 1 時間で入っているが実際は 30 分で終わる定例）。終日の予定には使わない。null は上限なし
   */
  maxDurationMinutes: z
    .number()
    .int()
    .min(5)
    .max(1440)
    .nullable()
    .default(null),
  /**
   * 長さの上限をかける予定。タイトルにいずれかを含む予定だけに上限を使う（空なら全部の予定）。
   * 例: 「農活」なら「【農活】WEB・SF開発定例」だけを切り詰め、「SalesforceMTG」はそのままにする
   */
  maxDurationKeywords: keywordList,
  /**
   * タイトルにいずれかを含む予定は、もう一方の種別で作る（種別が「予定あり」なら「不在」、「不在」なら「予定あり」）。
   * 例: 種別は「予定あり」、「外出」を含む予定だけ「不在」。同期先が個人のときは使えない
   */
  alternateKindKeywords: keywordList,
  /** もう一方の種別で作るときの件名。{title} {account} を使える。null ならその種別の既定（「不在」「予定あり」） */
  alternateKindTitle: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .default(null),
  /** 終日の元予定を 0:00〜24:00 の時間指定に変換するか、同期しないか */
  allDaySourceHandling: allDaySourceHandlingSchema.default("fullDay"),
  /** 不在のみ有効 */
  autoDeclineMode: autoDeclineModeSchema.default(
    "declineOnlyNewConflictingInvitations",
  ),
  /** 不在のみ有効 */
  declineMessage: z
    .string()
    .trim()
    .max(500)
    .default("別件の予定があるため参加できません。"),
});
export type RuleOutput = z.infer<typeof ruleOutputSchema>;

/** API が受け取る同期設定の入力 */
export const ruleInputSchema = z.object({
  /** 未指定なら「送信元 → 同期先」のメールアドレスから作る */
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().default(true),
  source: z.object({
    accountId: z.string().min(1),
    calendarIds: z.array(z.string().min(1)).min(1).max(20),
  }),
  /** 同期先カレンダーはメインカレンダー固定（不在はメインにしか作れない） */
  target: z.object({
    accountId: z.string().min(1),
  }),
  /** 今日から何日先まで同期するか */
  windowDays: z.number().int().min(1).max(365).default(60),
  filters: ruleFiltersSchema.default({}),
  output: ruleOutputSchema,
});
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** 保存済みの同期設定 */
export type SyncRule = Omit<RuleInput, "name" | "output"> & {
  id: string;
  name: string;
  output: RuleOutput & { title: string };
  createdAt: Date;
  updatedAt: Date;
  lastSyncAt: Date | null;
  lastError: string | null;
};

export const DEFAULT_TITLES: Record<OutputKind, string> = {
  outOfOffice: "不在",
  busy: "予定あり",
};

export type RuleValidationError = {
  code:
    | "source_account_not_found"
    | "target_account_not_found"
    | "same_account"
    | "unknown_source_calendar"
    | "out_of_office_not_available_for_personal"
    | "alternate_kind_not_available_for_personal";
  message: string;
};

/**
 * 入力を連携アカウントと突き合わせて検証する。
 * zod で形式を検証したあとに呼ぶ。
 */
export function validateRuleAgainstAccounts(
  input: RuleInput,
  accounts: readonly LinkedAccount[],
): RuleValidationError[] {
  const errors: RuleValidationError[] = [];
  const source = accounts.find((a) => a.id === input.source.accountId);
  const target = accounts.find((a) => a.id === input.target.accountId);

  if (!source) {
    errors.push({
      code: "source_account_not_found",
      message: "送信元のアカウントが連携されていません",
    });
  }
  if (!target) {
    errors.push({
      code: "target_account_not_found",
      message: "同期先のアカウントが連携されていません",
    });
  }
  if (input.source.accountId === input.target.accountId) {
    errors.push({
      code: "same_account",
      message: "送信元と同期先に同じアカウントは指定できません",
    });
  }
  if (source) {
    const known = new Set(source.calendars.map((c) => c.id));
    const unknown = input.source.calendarIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      errors.push({
        code: "unknown_source_calendar",
        message: `送信元アカウントに存在しないカレンダーです: ${unknown.join(", ")}`,
      });
    }
  }
  if (
    target &&
    target.type === "personal" &&
    input.output.kind === "outOfOffice"
  ) {
    errors.push({
      code: "out_of_office_not_available_for_personal",
      message:
        "個人の Google アカウントには「不在」を作成できません。「予定あり」を選んでください",
    });
  }
  if (
    target &&
    target.type === "personal" &&
    input.output.alternateKindKeywords.length > 0
  ) {
    errors.push({
      code: "alternate_kind_not_available_for_personal",
      message:
        "個人の Google アカウントには「不在」を作成できないため、種別を切り替えるキーワードは使えません",
    });
  }
  return errors;
}

/** 入力に既定値（名前、タイトル）を補って保存用の形にする */
export function buildRule(
  input: RuleInput,
  accounts: readonly LinkedAccount[],
  existing:
    | Pick<SyncRule, "id" | "createdAt" | "lastSyncAt" | "lastError">
    | undefined,
  now: Date,
): SyncRule {
  const source = accounts.find((a) => a.id === input.source.accountId);
  const target = accounts.find((a) => a.id === input.target.accountId);
  const { name, output, ...rest } = input;
  return {
    ...rest,
    id: existing?.id ?? "",
    name: name ?? `${source?.email ?? "?"} → ${target?.email ?? "?"}`,
    output: { ...output, title: output.title ?? DEFAULT_TITLES[output.kind] },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSyncAt: existing?.lastSyncAt ?? null,
    lastError: existing?.lastError ?? null,
  };
}
