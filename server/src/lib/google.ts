import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";

/** アプリへのログイン用（本人確認だけなのでカレンダー権限は不要） */
export const LOGIN_SCOPES: readonly string[] = ["openid", "email", "profile"];

/** カレンダー連携用（予定の読み書きとカレンダー一覧） */
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_LIST_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const LINK_SCOPES: readonly string[] = [
  "openid",
  "email",
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_LIST_SCOPE,
];

export type GoogleIdentity = {
  /** Google アカウントの不変 ID */
  sub: string;
  email: string;
  emailVerified: boolean;
  /** Google Workspace のドメイン。個人アカウントでは undefined */
  hd?: string;
  name?: string;
};

export type GoogleTokens = {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  /** 実際に許可されたスコープ（スペース区切り） */
  scope?: string;
};

export type CalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone?: string;
  backgroundColor?: string;
};

export type AuthorizeUrlParams = {
  state: string;
  scopes: readonly string[];
  /** true ならリフレッシュトークンを要求する（アカウント連携用） */
  offline: boolean;
  loginHint?: string;
};

/** Google OAuth / Calendar API への依存をまとめたインターフェース。テストでは偽物に差し替える */
export interface GoogleOAuth {
  authorizeUrl(params: AuthorizeUrlParams): string;
  exchangeCode(code: string): Promise<GoogleTokens>;
  verifyIdToken(idToken: string): Promise<GoogleIdentity>;
  listCalendars(refreshToken: string): Promise<CalendarSummary[]>;
  revokeToken(token: string): Promise<void>;
}

export type GoogleOAuthOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function createGoogleOAuth(options: GoogleOAuthOptions): GoogleOAuth {
  const newClient = () =>
    new OAuth2Client({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: options.redirectUri,
    });

  return {
    authorizeUrl(params) {
      return newClient().generateAuthUrl({
        access_type: params.offline ? "offline" : "online",
        scope: [...params.scopes],
        state: params.state,
        // offline のときは consent を強制しないと 2 回目以降にリフレッシュトークンが返らない
        // ログインのときは 4 アカウントから選べるようにアカウント選択画面を出す
        prompt: params.offline ? "consent" : "select_account",
        // include_granted_scopes（以前に許可した権限の引き継ぎ）は付けない。OAuth 同意画面を「テスト」から
        // 「本番」に切り替えたあと、Workspace アカウントで Google の同意画面が 500 になったため（2026-09-23）
        ...(params.loginHint ? { login_hint: params.loginHint } : {}),
      });
    },

    async exchangeCode(code) {
      const { tokens } = await newClient().getToken(code);
      return {
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
        idToken: tokens.id_token ?? undefined,
        scope: tokens.scope ?? undefined,
      };
    },

    async verifyIdToken(idToken) {
      const ticket = await newClient().verifyIdToken({
        idToken,
        audience: options.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new Error("ID トークンに sub または email が含まれていません");
      }
      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified ?? false,
        hd: payload.hd ?? undefined,
        name: payload.name ?? undefined,
      };
    },

    async listCalendars(refreshToken) {
      const client = newClient();
      client.setCredentials({ refresh_token: refreshToken });
      const api = calendar({ version: "v3", auth: client });
      const response = await api.calendarList.list({
        minAccessRole: "writer",
        showHidden: false,
      });
      return (response.data.items ?? []).flatMap(toCalendarSummary);
    },

    async revokeToken(token) {
      await newClient().revokeToken(token);
    },
  };
}

function toCalendarSummary(
  item: calendar_v3.Schema$CalendarListEntry,
): CalendarSummary[] {
  if (!item.id) {
    return [];
  }
  return [
    {
      id: item.id,
      summary: item.summaryOverride ?? item.summary ?? item.id,
      primary: item.primary ?? false,
      accessRole: item.accessRole ?? "reader",
      timeZone: item.timeZone ?? undefined,
      backgroundColor: item.backgroundColor ?? undefined,
    },
  ];
}

/** 許可されたスコープ文字列にカレンダー連携に必要なスコープが揃っているか */
export function hasCalendarScopes(scope: string | undefined): boolean {
  const granted = new Set((scope ?? "").split(" ").filter(Boolean));
  return granted.has(CALENDAR_EVENTS_SCOPE) && granted.has(CALENDAR_LIST_SCOPE);
}
