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
}

export type Stores = {
  oauthStates: OAuthStateStore;
  accounts: AccountStore;
  users: UserStore;
};
