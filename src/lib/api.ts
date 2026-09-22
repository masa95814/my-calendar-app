import { appEnv } from "../config/env";
import { auth } from "./firebase";

/** バックエンドが返すエラー。code はレスポンスの error フィールド */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
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
  };
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? "unknown_error");
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
};

/** ログイン開始 URL（認証不要。ブラウザで開く） */
export function loginStartUrl(returnTo: string): string {
  return `${appEnv.apiBaseUrl}/auth/login/start?return_to=${encodeURIComponent(returnTo)}`;
}
