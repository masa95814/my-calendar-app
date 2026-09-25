import { accountName } from "./accounts";
import type {
  ApiError,
  LinkedAccount,
  RuleInput,
  StatusResponse,
  SyncRule,
  SyncSummary,
  UnifiedEvent,
} from "./api";
import { defaultRuleInput } from "./rules";

// 画面確認用のモック（EXPO_PUBLIC_MOCK=1 のときに本物の API の代わりに使う）。
// サーバーには一切つながず、見本のアカウント・同期設定・予定をメモリ上で持つ。
// 変更はこのタブの中だけで、再読み込みすると初期状態に戻る。
// プレビュー URL は誰でも開けるので、実在のメールアドレスや会社名は使わない。

type ApiErrorClass = new (
  status: number,
  code: string,
  details?: ApiError["details"],
) => ApiError;

const now = () => new Date().toISOString();

function makeAccount(
  id: string,
  email: string,
  label: string,
  type: LinkedAccount["type"],
): LinkedAccount {
  const hd = type === "workspace" ? email.split("@")[1] : undefined;
  return {
    id,
    email,
    ...(hd ? { hd } : {}),
    label,
    type,
    status: "ok",
    scopes: [],
    calendars: [
      {
        id: "primary",
        summary: email,
        primary: true,
        accessRole: "owner",
        timeZone: "Asia/Tokyo",
      },
    ],
    linkedAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

const ACCOUNTS: LinkedAccount[] = [
  makeAccount("acc-main", "me@example.com", "メイン", "personal"),
  makeAccount("acc-a", "me@company-a.example", "会社A", "workspace"),
  makeAccount("acc-b", "me@company-b.example", "会社B", "workspace"),
  makeAccount("acc-c", "me@company-c.example", "会社C", "workspace"),
];

/** 見本の同期設定（有効・無効・未設定・エラーが混ざるようにする） */
function initialRules(accounts: LinkedAccount[]): SyncRule[] {
  const byId = (id: string) => accounts.find((a) => a.id === id)!;
  const make = (
    id: string,
    sourceId: string,
    targetId: string,
    patch: (input: RuleInput) => RuleInput = (i) => i,
    extra: Partial<SyncRule> = {},
  ): SyncRule => {
    const input = patch(defaultRuleInput(byId(sourceId), byId(targetId)));
    return {
      ...input,
      id,
      name: `${accountName(byId(sourceId))} → ${accountName(byId(targetId))}`,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      lastSyncAt: now(),
      lastError: null,
      ...extra,
    };
  };
  const twoOrMore = (i: RuleInput): RuleInput => ({
    ...i,
    filters: { ...i.filters, minAttendees: 2 },
  });
  return [
    make("rule-a-main", "acc-a", "acc-main", (i) => ({
      ...twoOrMore(i),
      output: { ...i.output, title: "会社A", colorId: "11" },
    })),
    make("rule-a-b", "acc-a", "acc-b", (i) => ({
      ...twoOrMore(i),
      output: { ...i.output, title: "対応不可" },
    })),
    make(
      "rule-a-c",
      "acc-a",
      "acc-c",
      (i) => ({ ...twoOrMore(i), enabled: false }),
      { name: "会社A → 会社C（休止中）" },
    ),
    make("rule-b-main", "acc-b", "acc-main", (i) => ({
      ...twoOrMore(i),
      output: {
        ...i.output,
        title: "会社B",
        maxDurationMinutes: 30,
        maxDurationKeywords: ["定例"],
      },
    })),
    make("rule-b-a", "acc-b", "acc-a", twoOrMore),
    make(
      "rule-main-a",
      "acc-main",
      "acc-a",
      (i) => ({
        ...twoOrMore(i),
        filters: {
          ...i.filters,
          minAttendees: 2,
          alwaysIncludeKeywords: ["面談"],
        },
        output: { ...i.output, title: "ブロック" },
      }),
      { lastError: "同期先への反映に失敗: 見本のエラーです" },
    ),
    make("rule-c-main", "acc-c", "acc-main", twoOrMore),
  ];
}

/** 見本の予定。平日に各社の会議を置き、有効な同期設定のミラーも作る */
function buildEvents(
  from: Date,
  to: Date,
  accounts: LinkedAccount[],
  rules: SyncRule[],
): UnifiedEvent[] {
  const titles: Record<string, [number, number, string][]> = {
    "acc-a": [
      [10, 60, "定例ミーティング"],
      [14, 30, "顧客打ち合わせ"],
    ],
    "acc-b": [[11, 60, "開発定例"]],
    "acc-c": [[16, 30, "週次レビュー"]],
    "acc-main": [[19, 60, "面談"]],
  };
  const events: UnifiedEvent[] = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (; day < to; day.setDate(day.getDate() + 1)) {
    const weekday = day.getDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }
    for (const account of accounts) {
      for (const [hour, minutes, summary] of titles[account.id] ?? []) {
        const start = new Date(day);
        start.setHours(hour, 0, 0, 0);
        const end = new Date(start.getTime() + minutes * 60 * 1000);
        const id = `${account.id}-${start.toISOString()}`;
        events.push({
          accountId: account.id,
          accountEmail: account.email,
          id,
          summary,
          start: start.toISOString(),
          end: end.toISOString(),
          allDay: false,
          eventType: "default",
          isMirror: false,
          mirrorRuleId: null,
          hangoutLink: null,
        });
        for (const rule of rules) {
          if (!rule.enabled || rule.source.accountId !== account.id) {
            continue;
          }
          const target = accounts.find((a) => a.id === rule.target.accountId);
          if (!target) {
            continue;
          }
          const capped =
            rule.output.maxDurationMinutes &&
            (rule.output.maxDurationKeywords.length === 0 ||
              rule.output.maxDurationKeywords.some((k) => summary.includes(k)))
              ? Math.min(minutes, rule.output.maxDurationMinutes)
              : minutes;
          events.push({
            accountId: target.id,
            accountEmail: target.email,
            id: `${id}-${rule.id}`,
            summary: rule.output.title,
            start: start.toISOString(),
            end: new Date(start.getTime() + capped * 60 * 1000).toISOString(),
            allDay: false,
            eventType:
              rule.output.kind === "outOfOffice" ? "outOfOffice" : "default",
            isMirror: true,
            mirrorRuleId: rule.id,
            hangoutLink: null,
          });
        }
      }
    }
  }
  return events.filter((e) => new Date(e.end) > from && new Date(e.start) < to);
}

const summary = (processed: number): SyncSummary => ({
  calendars: 4,
  processed,
  created: 0,
  updated: 0,
  deleted: 0,
  skipped: processed,
  errors: [],
});

/** 本物の api と同じ形のモック。ApiError は循環 import を避けるため引数で受け取る */
export function createMockApi(ApiErrorImpl: ApiErrorClass) {
  let accounts = ACCOUNTS.map((a) => ({ ...a }));
  let rules = initialRules(accounts);
  const wait = <T>(value: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), 150));
  const findRule = (ruleId: string) => {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) {
      throw new ApiErrorImpl(404, "not_found");
    }
    return rule;
  };
  const toRule = (input: RuleInput, base: Partial<SyncRule>): SyncRule => {
    const source = accounts.find((a) => a.id === input.source.accountId);
    const target = accounts.find((a) => a.id === input.target.accountId);
    return {
      ...input,
      id: base.id ?? `rule-${Date.now()}`,
      name:
        input.name ??
        (source && target
          ? `${accountName(source)} → ${accountName(target)}`
          : "同期設定"),
      createdAt: base.createdAt ?? now(),
      updatedAt: now(),
      lastSyncAt: now(),
      lastError: null,
    };
  };

  return {
    me: () => wait({ uid: "mock", email: "me@example.com" }),
    listAccounts: () => wait({ accounts }),
    startLink: async (_returnTo: string): Promise<{ url: string }> => {
      throw new ApiErrorImpl(400, "mock_mode", [
        {
          code: "mock_mode",
          message: "モック表示ではアカウントを連携できません",
        },
      ]);
    },
    updateAccount: (accountId: string, input: { label: string | null }) => {
      accounts = accounts.map((a) =>
        a.id === accountId
          ? (({ label: _omit, ...rest }) =>
              input.label ? { ...rest, label: input.label } : rest)(a)
          : a,
      );
      return wait({ account: accounts.find((a) => a.id === accountId)! });
    },
    unlinkAccount: (accountId: string) => {
      accounts = accounts.filter((a) => a.id !== accountId);
      return wait(undefined as void);
    },
    listRules: () => wait({ rules }),
    createRule: async (input: RuleInput) => {
      if (
        rules.some(
          (r) =>
            r.source.accountId === input.source.accountId &&
            r.target.accountId === input.target.accountId,
        )
      ) {
        throw new ApiErrorImpl(409, "duplicate_rule");
      }
      const rule = toRule(input, {});
      rules = [...rules, rule];
      return wait({ rule });
    },
    updateRule: async (ruleId: string, input: RuleInput) => {
      const current = findRule(ruleId);
      const rule = toRule(input, current);
      rules = rules.map((r) => (r.id === ruleId ? rule : r));
      return wait({ rule });
    },
    deleteRule: async (ruleId: string) => {
      findRule(ruleId);
      rules = rules.filter((r) => r.id !== ruleId);
      return wait(undefined as void);
    },
    syncRule: async (ruleId: string) =>
      wait({ rule: findRule(ruleId), summary: summary(12) }),
    syncAll: () => wait({ summary: summary(48) }),
    listEvents: (from: Date, to: Date) =>
      wait({ events: buildEvents(from, to, accounts, rules), errors: [] }),
    status: (): Promise<StatusResponse> =>
      wait({
        now: now(),
        accounts: accounts.map(({ calendars, ...a }) => ({
          ...a,
          calendarCount: calendars.length,
        })),
        rules: rules.map((r) => ({
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          sourceAccountId: r.source.accountId,
          targetAccountId: r.target.accountId,
          lastSyncAt: r.lastSyncAt,
          lastError: r.lastError,
        })),
        syncStates: accounts.map((a) => ({
          accountId: a.id,
          calendarId: "primary",
          lastFullSyncAt: now(),
          lastIncrementalSyncAt: now(),
          watchActive: true,
          channelExpiresAt: null,
        })),
      }),
    testNotification: () => wait({ sent: true }),
    purgeMirrors: (_accountId: string) =>
      wait({ deletedEvents: 0, deletedRecords: 0 }),
  };
}
