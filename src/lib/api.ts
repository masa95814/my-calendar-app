import { appEnv } from "../config/env";
import { auth } from "./firebase";

/** バックエンドが返す検証エラーの明細（`details`） */
export type ApiErrorDetail = {
  code: string;
  message: string;
  /** 形式エラーのとき、対象フィールドのパス（例: "output.kind"） */
  path?: string;
};

/** バックエンドが返すエラー。code はレスポンスの error フィールド */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: ApiErrorDetail[] = [],
    readonly extra: Record<string, unknown> = {},
  ) {
    super(`API error ${status}: ${code}`);
    this.name = "ApiError";
  }
}

export type CalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone?: string;
  backgroundColor?: string;
};

export type LinkedAccount = {
  id: string;
  email: string;
  hd?: string;
  type: "workspace" | "personal";
  status: "ok" | "reauth_required";
  scopes: string[];
  calendars: CalendarSummary[];
  linkedAt: string;
  updatedAt: string;
};

// 同期設定（server/src/domain/rules.ts と同じ形）
export type OutputKind = "outOfOffice" | "busy";
export type AutoDeclineMode =
  | "declineNone"
  | "declineOnlyNewConflictingInvitations"
  | "declineAllConflictingInvitations";
export type AllDaySourceHandling = "fullDay" | "skip";
export type Visibility = "public" | "private" | "default";

export type RuleFilters = {
  minAttendees: number | null;
  requireMeetLink: boolean;
  excludeKeywords: string[];
  includeKeywords: string[];
  /** タイトルにいずれかを含む予定は、参加者数・会議リンク・包含キーワードの条件を飛ばして同期する */
  alwaysIncludeKeywords: string[];
  excludeAllDay: boolean;
  excludeTransparent: boolean;
  excludeDeclined: boolean;
  includeTentative: boolean;
};

export type RuleOutput = {
  kind: OutputKind;
  title: string;
  copyDescription: boolean;
  copyLocation: boolean;
  visibility: Visibility;
  /** Google カレンダーの予定の色 ID（"1"〜"11"）。null は同期先カレンダーの既定の色 */
  colorId: string | null;
  /** ミラー予定の長さの上限（分）。null は上限なし */
  maxDurationMinutes: number | null;
  /** 長さの上限をかける予定のキーワード（タイトル）。空なら全部の予定 */
  maxDurationKeywords: string[];
  allDaySourceHandling: AllDaySourceHandling;
  autoDeclineMode: AutoDeclineMode;
  declineMessage: string;
};

/** 作成・更新時に送る形 */
export type RuleInput = {
  name?: string;
  enabled: boolean;
  source: { accountId: string; calendarIds: string[] };
  target: { accountId: string };
  windowDays: number;
  filters: RuleFilters;
  output: RuleOutput;
};

/** 保存済みの同期設定 */
export type SyncRule = Omit<RuleInput, "name"> & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
};

/** 同期の実行結果 */
export type SyncSummary = {
  calendars: number;
  processed: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
};

/** 統合カレンダー表示の 1 件（server/src/services/sync.ts の UnifiedEvent と同じ形） */
export type UnifiedEvent = {
  accountId: string;
  accountEmail: string;
  id: string;
  summary: string;
  /** dateTime（オフセット付き）または終日の date */
  start: string;
  end: string;
  allDay: boolean;
  eventType: string;
  isMirror: boolean;
  mirrorRuleId: string | null;
  hangoutLink: string | null;
};

export type StatusResponse = {
  now: string;
  accounts: (Omit<LinkedAccount, "calendars"> & { calendarCount: number })[];
  rules: {
    id: string;
    name: string;
    enabled: boolean;
    sourceAccountId: string;
    targetAccountId: string;
    lastSyncAt: string | null;
    lastError: string | null;
  }[];
  syncStates: {
    accountId: string;
    calendarId: string;
    lastFullSyncAt: string | null;
    lastIncrementalSyncAt: string | null;
    watchActive: boolean;
    channelExpiresAt: string | null;
  }[];
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError(401, "not_signed_in");
  }
  const idToken = await user.getIdToken();
  const response = await fetch(`${appEnv.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    details?: ApiErrorDetail[];
    [key: string]: unknown;
  };
  if (!response.ok) {
    const { error, details, ...extra } = body;
    throw new ApiError(
      response.status,
      error ?? "unknown_error",
      Array.isArray(details) ? details : [],
      extra,
    );
  }
  return body as T;
}

export const api = {
  me: () => request<{ uid: string; email: string }>("/api/me"),

  listAccounts: () => request<{ accounts: LinkedAccount[] }>("/api/accounts"),

  /** 連携開始。返された url をブラウザで開く */
  startLink: (returnTo: string) =>
    request<{ url: string }>("/api/accounts/link", {
      method: "POST",
      body: JSON.stringify({ returnTo }),
    }),

  unlinkAccount: (accountId: string) =>
    request<void>(`/api/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    }),

  listRules: () => request<{ rules: SyncRule[] }>("/api/rules"),

  createRule: (input: RuleInput) =>
    request<{ rule: SyncRule }>("/api/rules", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateRule: (ruleId: string, input: RuleInput) =>
    request<{ rule: SyncRule }>(`/api/rules/${encodeURIComponent(ruleId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  deleteRule: (ruleId: string) =>
    request<void>(`/api/rules/${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
    }),

  /** 1 つの同期設定を手動で全件同期 */
  syncRule: (ruleId: string) =>
    request<{ rule: SyncRule; summary: SyncSummary }>(
      `/api/rules/${encodeURIComponent(ruleId)}/sync`,
      { method: "POST" },
    ),

  /** すべての同期設定を手動で全件同期 */
  syncAll: () =>
    request<{ summary: SyncSummary }>("/api/sync", { method: "POST" }),

  /** 統合カレンダー表示用の予定（期間は 62 日以内） */
  listEvents: (from: Date, to: Date) =>
    request<{ events: UnifiedEvent[]; errors: string[] }>(
      `/api/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    ),

  status: () => request<StatusResponse>("/api/status"),

  /** そのアカウントのミラー予定を対応表の有無に関わらず一括削除（復旧用） */
  purgeMirrors: (accountId: string) =>
    request<{ deletedEvents: number; deletedRecords: number }>(
      `/api/accounts/${encodeURIComponent(accountId)}/purge-mirrors`,
      { method: "POST" },
    ),
};

/** 同期結果を 1 行の文言にする */
export function describeSyncSummary(summary: SyncSummary): string {
  const parts = [
    `作成 ${summary.created}`,
    `更新 ${summary.updated}`,
    `削除 ${summary.deleted}`,
    `対象外 ${summary.skipped}`,
  ];
  const base = `${summary.processed} 件を処理（${parts.join("、")}）`;
  return summary.errors.length > 0
    ? `${base}\nエラー:\n${summary.errors.join("\n")}`
    : base;
}

/** ログイン開始 URL（認証不要。ブラウザで開く） */
export function loginStartUrl(returnTo: string): string {
  return `${appEnv.apiBaseUrl}/auth/login/start?return_to=${encodeURIComponent(returnTo)}`;
}

/** API エラーを利用者向けの文言にする */
export function describeApiError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.status === 401) {
      return "ログインの有効期限が切れました。ログインし直してください。";
    }
    if (caught.status === 403) {
      return "このアカウントはこのアプリの利用を許可されていません。";
    }
    if (caught.details.length > 0) {
      return caught.details.map((d) => d.message).join("\n");
    }
    return `サーバーエラー（${caught.status}: ${caught.code}）`;
  }
  if (caught instanceof Error) {
    return `サーバーに接続できません: ${caught.message}`;
  }
  return "不明なエラーが発生しました。";
}
