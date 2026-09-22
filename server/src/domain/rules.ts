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

export const allDaySourceHandlingSchema = z.enum(["fullDay", "skip"]);
export const visibilitySchema = z.enum(["private", "default"]);

const keywordList = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .default([]);

/** F3. フィルタ条件。条件は AND で評価する */
export const ruleFiltersSchema = z.object({
  /** 参加者が N 人以上の予定のみ（自分を含む）。null は条件なし */
  minAttendees: z.number().int().min(1).max(100).nullable().default(null),
  /** 会議リンクがある予定のみ */
  requireMeetLink: z.boolean().default(false),
  /** タイトルまたは説明にいずれかを含む予定を除外 */
  excludeKeywords: keywordList,
  /** 指定時、タイトルまたは説明にいずれかを含む予定のみ同期 */
  includeKeywords: keywordList,
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
  visibility: visibilitySchema.default("private"),
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
    | "out_of_office_not_available_for_personal";
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
