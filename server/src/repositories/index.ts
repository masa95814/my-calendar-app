import type { OutputKind, SyncRule } from "../domain/rules.js";
import type { CalendarSummary } from "../lib/google.js";

// Firestore への永続化を抽象化したインターフェース。
// テストではメモリ実装（test/helpers.ts）に差し替える。

export type OAuthPurpose = "login" | "link";

/** OAuth の state。CSRF 対策と、コールバック時に「誰の・何の」処理かを引くために使う。1 回使ったら削除する */
export type OAuthState = {
  state: string;
  purpose: OAuthPurpose;
  /** purpose が link のとき、連携先を保存するユーザーの uid */
  uid?: string;
  /** 完了後に戻るアプリの URL */
  returnTo: string;
  createdAt: Date;
  expiresAt: Date;
};

export interface OAuthStateStore {
  create(state: OAuthState): Promise<void>;
  /** state を取り出して同時に削除する（存在しなければ undefined） */
  consume(state: string): Promise<OAuthState | undefined>;
}

export type AccountType = "workspace" | "personal";
export type AccountStatus = "ok" | "reauth_required";

/** 連携した Google アカウント。id は Google の sub（アカウント固有の不変 ID） */
export type LinkedAccount = {
  id: string;
  email: string;
  /** Workspace のドメイン。個人アカウントでは undefined */
  hd?: string;
  /** 画面に出す呼び名（例: メイン、ギブリー）。未設定なら Workspace のドメインかメールアドレスから作る */
  label?: string;
  type: AccountType;
  /** 暗号化済みのリフレッシュトークン */
  refreshTokenEnc: string;
  scopes: string[];
  status: AccountStatus;
  calendars: CalendarSummary[];
  linkedAt: Date;
  updatedAt: Date;
};

/** API のレスポンスに出す形（トークンは含めない） */
export type PublicAccount = Omit<LinkedAccount, "refreshTokenEnc">;

export function toPublicAccount(account: LinkedAccount): PublicAccount {
  const { refreshTokenEnc: _omitted, ...rest } = account;
  return rest;
}

export interface AccountStore {
  list(uid: string): Promise<LinkedAccount[]>;
  get(uid: string, accountId: string): Promise<LinkedAccount | undefined>;
  upsert(uid: string, account: LinkedAccount): Promise<void>;
  delete(uid: string, accountId: string): Promise<void>;
}

export interface UserStore {
  /** ログインを記録する（初回はユーザーを作成する） */
  recordLogin(uid: string, email: string, at: Date): Promise<void>;
  /** 定期同期の対象となる全ユーザー */
  listUids(): Promise<string[]>;
}

/** 送信元カレンダーごとの同期状態（syncToken と watch チャネル） */
export type SyncState = {
  id: string;
  accountId: string;
  calendarId: string;
  syncToken: string | null;
  lastFullSyncAt: Date | null;
  lastIncrementalSyncAt: Date | null;
  channelId: string | null;
  resourceId: string | null;
  channelToken: string | null;
  channelExpiresAt: Date | null;
};

export function syncStateId(accountId: string, calendarId: string): string {
  return `${accountId}~${encodeURIComponent(calendarId)}`;
}

export interface SyncStateStore {
  get(uid: string, id: string): Promise<SyncState | undefined>;
  list(uid: string): Promise<SyncState[]>;
  upsert(uid: string, state: SyncState): Promise<void>;
  delete(uid: string, id: string): Promise<void>;
}

/** 元予定とミラー予定の対応表 */
export type MirrorRecord = {
  id: string;
  ruleId: string;
  sourceAccountId: string;
  sourceCalendarId: string;
  sourceEventId: string;
  targetAccountId: string;
  targetCalendarId: string;
  targetEventId: string;
  kind: OutputKind;
  fingerprint: string;
  /**
   * 元予定の終了時刻。同期範囲より前に終わった予定のミラーを、履歴として消さずに残す判定に使う。
   * この項目が追加される前の対応表は null（次に同期したときに埋まる）
   */
  sourceEndAt: Date | null;
  updatedAt: Date;
};

export function mirrorId(
  ruleId: string,
  sourceCalendarId: string,
  sourceEventId: string,
): string {
  return `${ruleId}~${encodeURIComponent(sourceCalendarId)}~${encodeURIComponent(sourceEventId)}`;
}

export interface MirrorStore {
  get(uid: string, id: string): Promise<MirrorRecord | undefined>;
  upsert(uid: string, record: MirrorRecord): Promise<void>;
  delete(uid: string, id: string): Promise<void>;
  listByRule(uid: string, ruleId: string): Promise<MirrorRecord[]>;
  listBySourceCalendar(
    uid: string,
    sourceAccountId: string,
    sourceCalendarId: string,
  ): Promise<MirrorRecord[]>;
  /** 送信元または同期先としてそのアカウントを使うもの */
  listByAccount(uid: string, accountId: string): Promise<MirrorRecord[]>;
}

/** events.watch のチャネル。通知の受け口でチャネル ID から引く */
export type WatchChannel = {
  id: string;
  uid: string;
  accountId: string;
  calendarId: string;
  resourceId: string;
  token: string;
  expiresAt: Date;
};

export interface ChannelStore {
  get(channelId: string): Promise<WatchChannel | undefined>;
  upsert(channel: WatchChannel): Promise<void>;
  delete(channelId: string): Promise<void>;
}

/** 予算アラートで、期間ごとに知らせた一番大きいしきい値（0.5 = 50%）を覚える（同じ通知を繰り返さない） */
export interface BudgetAlertStore {
  getNotifiedThreshold(key: string): Promise<number | undefined>;
  setNotifiedThreshold(key: string, threshold: number): Promise<void>;
}

export interface RuleStore {
  list(uid: string): Promise<SyncRule[]>;
  get(uid: string, ruleId: string): Promise<SyncRule | undefined>;
  /** 同じ送信元・同期先の組み合わせの同期設定を探す（重複防止） */
  findBySourceTarget(
    uid: string,
    sourceAccountId: string,
    targetAccountId: string,
  ): Promise<SyncRule | undefined>;
  create(uid: string, rule: SyncRule): Promise<void>;
  update(uid: string, rule: SyncRule): Promise<void>;
  delete(uid: string, ruleId: string): Promise<void>;
  /** アカウント連携解除時に、そのアカウントを使う同期設定を無効化する。無効化した件数を返す */
  disableForAccount(uid: string, accountId: string): Promise<number>;
}

export type Stores = {
  oauthStates: OAuthStateStore;
  accounts: AccountStore;
  users: UserStore;
  rules: RuleStore;
  syncStates: SyncStateStore;
  mirrors: MirrorStore;
  channels: ChannelStore;
  budgetAlerts: BudgetAlertStore;
};
