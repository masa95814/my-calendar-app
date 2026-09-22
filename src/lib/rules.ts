import type {
  AllDaySourceHandling,
  AutoDeclineMode,
  LinkedAccount,
  OutputKind,
  RuleInput,
  SyncRule,
  Visibility,
} from "./api";

// 同期設定の表示用ラベルと、フォームの初期値・変換

export const OUTPUT_KIND_LABELS: Record<OutputKind, string> = {
  outOfOffice: "不在",
  busy: "予定あり",
};

export const AUTO_DECLINE_LABELS: Record<AutoDeclineMode, string> = {
  declineNone: "辞退しない",
  declineOnlyNewConflictingInvitations: "新規の招待のみ辞退",
  declineAllConflictingInvitations: "既存も含めて全て辞退",
};

export const ALL_DAY_LABELS: Record<AllDaySourceHandling, string> = {
  fullDay: "0:00〜24:00 に変換",
  skip: "同期しない",
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "公開",
  private: "非公開",
  default: "カレンダーの既定",
};

export const WINDOW_DAYS_OPTIONS = [30, 60, 90] as const;

export const DEFAULT_DECLINE_MESSAGE = "別件の予定があるため参加できません。";

/** アカウントのメインカレンダー（無ければ先頭）の ID */
export function primaryCalendarIds(account: LinkedAccount): string[] {
  const primary = account.calendars.find((c) => c.primary);
  const first = primary ?? account.calendars[0];
  return first ? [first.id] : [];
}

/** 同期先の種別に応じた既定の出力種別（個人宛ては「不在」を作れない） */
export function defaultKindFor(target: LinkedAccount | undefined): OutputKind {
  return target?.type === "personal" ? "busy" : "outOfOffice";
}

/** 新規作成時の初期値 */
export function defaultRuleInput(
  source?: LinkedAccount,
  target?: LinkedAccount,
): RuleInput {
  const kind = defaultKindFor(target);
  return {
    enabled: true,
    source: {
      accountId: source?.id ?? "",
      calendarIds: source ? primaryCalendarIds(source) : [],
    },
    target: { accountId: target?.id ?? "" },
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
      kind,
      title: OUTPUT_KIND_LABELS[kind],
      copyDescription: false,
      copyLocation: false,
      visibility: "public",
      allDaySourceHandling: "fullDay",
      autoDeclineMode: "declineOnlyNewConflictingInvitations",
      declineMessage: DEFAULT_DECLINE_MESSAGE,
    },
  };
}

/** 保存済みの同期設定を編集フォームの入力に戻す */
export function ruleToInput(rule: SyncRule): RuleInput {
  return {
    name: rule.name,
    enabled: rule.enabled,
    source: { ...rule.source, calendarIds: [...rule.source.calendarIds] },
    target: { ...rule.target },
    windowDays: rule.windowDays,
    filters: {
      ...rule.filters,
      excludeKeywords: [...rule.filters.excludeKeywords],
      includeKeywords: [...rule.filters.includeKeywords],
    },
    output: { ...rule.output },
  };
}

/**
 * 逆方向（同期先 → 送信元）の設定を、同じフィルタ・出力設定で作る。
 * 送信元カレンダーは新しい送信元のメインカレンダー、種別は新しい同期先が個人なら「予定あり」に落とす。
 */
export function reverseRuleInput(
  input: RuleInput,
  accounts: readonly LinkedAccount[],
): RuleInput {
  const newSource = accounts.find((a) => a.id === input.target.accountId);
  const newTarget = accounts.find((a) => a.id === input.source.accountId);
  const kind: OutputKind =
    newTarget?.type === "personal" ? "busy" : input.output.kind;
  const titleWasDefault =
    input.output.title === OUTPUT_KIND_LABELS[input.output.kind];
  return {
    enabled: input.enabled,
    source: {
      accountId: input.target.accountId,
      calendarIds: newSource ? primaryCalendarIds(newSource) : [],
    },
    target: { accountId: input.source.accountId },
    windowDays: input.windowDays,
    filters: {
      ...input.filters,
      excludeKeywords: [...input.filters.excludeKeywords],
      includeKeywords: [...input.filters.includeKeywords],
    },
    output: {
      ...input.output,
      kind,
      title: titleWasDefault ? OUTPUT_KIND_LABELS[kind] : input.output.title,
    },
  };
}

/** 一覧に出す 1 行の要約 */
export function summarizeRule(rule: SyncRule): string {
  const parts: string[] = [OUTPUT_KIND_LABELS[rule.output.kind]];
  if (rule.filters.requireMeetLink) {
    parts.push("会議リンクのみ");
  }
  if (rule.filters.minAttendees !== null) {
    parts.push(`${rule.filters.minAttendees}人以上`);
  }
  if (rule.filters.excludeKeywords.length > 0) {
    parts.push(`除外キーワード ${rule.filters.excludeKeywords.length} 件`);
  }
  if (rule.filters.includeKeywords.length > 0) {
    parts.push(`包含キーワード ${rule.filters.includeKeywords.length} 件`);
  }
  parts.push(`${rule.windowDays} 日先まで`);
  return parts.join("・");
}

/** カンマ・改行区切りの文字列をキーワード配列にする */
export function parseKeywords(text: string): string[] {
  return text
    .split(/[,、\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type AccountPair = {
  key: string;
  a: LinkedAccount;
  b: LinkedAccount;
  /** a → b */
  ab?: SyncRule;
  /** b → a */
  ba?: SyncRule;
};

/**
 * アカウントの全組み合わせを作り、方向ごとの同期設定を割り当てる。
 * 未連携のアカウントを参照する設定は orphans に分ける。
 */
export function groupRulesByPair(
  rules: readonly SyncRule[],
  accounts: readonly LinkedAccount[],
): { pairs: AccountPair[]; orphans: SyncRule[] } {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const pairs: AccountPair[] = [];
  for (let i = 0; i < accounts.length; i++) {
    for (let j = i + 1; j < accounts.length; j++) {
      const a = accounts[i]!;
      const b = accounts[j]!;
      pairs.push({
        key: `${a.id}|${b.id}`,
        a,
        b,
        ab: rules.find(
          (r) => r.source.accountId === a.id && r.target.accountId === b.id,
        ),
        ba: rules.find(
          (r) => r.source.accountId === b.id && r.target.accountId === a.id,
        ),
      });
    }
  }
  const orphans = rules.filter(
    (r) => !byId.has(r.source.accountId) || !byId.has(r.target.accountId),
  );
  return { pairs, orphans };
}
