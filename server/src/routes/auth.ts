import { Hono } from "hono";

import type { Config } from "../config.js";
import type { TokenCipher } from "../lib/crypto.js";
import {
  hasCalendarScopes,
  LOGIN_SCOPES,
  type GoogleIdentity,
  type GoogleOAuth,
  type GoogleTokens,
} from "../lib/google.js";
import { logger } from "../lib/logger.js";
import { appendQuery, validateReturnUrl } from "../lib/url.js";
import type { OAuthState, Stores } from "../repositories/index.js";

/** Firebase Authentication のユーザー操作（テストで差し替える） */
export type FirebaseUserService = {
  /** uid のユーザーが無ければメールアドレス付きで作成する */
  ensureUser(uid: string, email: string): Promise<void>;
  /** アプリが signInWithCustomToken で使うカスタムトークンを発行する */
  createCustomToken(uid: string): Promise<string>;
};

export type AuthRouteDeps = {
  config: Config;
  google: GoogleOAuth;
  stores: Stores;
  firebase: FirebaseUserService;
  cipher: TokenCipher;
  now: () => Date;
  randomState: () => string;
};

/**
 * OAuth のルート。
 * - GET /auth/login/start     アプリへのログイン開始（Google → 本人確認 → Firebase カスタムトークン）
 * - GET /auth/google/callback Google からのコールバック（ログインとアカウント連携の両方）
 * アカウント連携の開始は認証付きの POST /api/accounts/link（routes/accounts.ts）
 */
export function authRoutes(deps: AuthRouteDeps) {
  const ownerEmails = new Set(deps.config.OWNER_EMAILS);
  const stateTtlMs = deps.config.OAUTH_STATE_TTL_SECONDS * 1000;
  const app = new Hono();

  app.get("/auth/login/start", async (c) => {
    const returnTo = validateReturnUrl(
      c.req.query("return_to"),
      deps.config.APP_RETURN_URL_PREFIXES,
    );
    if (!returnTo) {
      return c.json({ error: "invalid_return_to" }, 400);
    }
    const now = deps.now();
    const state = deps.randomState();
    await deps.stores.oauthStates.create({
      state,
      purpose: "login",
      returnTo,
      createdAt: now,
      expiresAt: new Date(now.getTime() + stateTtlMs),
    });
    return c.redirect(
      deps.google.authorizeUrl({ state, scopes: LOGIN_SCOPES, offline: false }),
    );
  });

  app.get("/auth/google/callback", async (c) => {
    const state = c.req.query("state");
    if (!state) {
      return c.text("state がありません", 400);
    }
    const saved = await deps.stores.oauthStates.consume(state);
    if (!saved) {
      return c.text(
        "このリンクは無効か、すでに使用済みです。アプリからやり直してください。",
        400,
      );
    }
    const backToApp = (params: Record<string, string>) =>
      c.redirect(appendQuery(saved.returnTo, params));

    if (saved.expiresAt.getTime() < deps.now().getTime()) {
      return backToApp({ error: "expired" });
    }
    const googleError = c.req.query("error");
    if (googleError) {
      return backToApp({ error: googleError });
    }
    const code = c.req.query("code");
    if (!code) {
      return backToApp({ error: "missing_code" });
    }

    try {
      const tokens = await deps.google.exchangeCode(code);
      if (!tokens.idToken) {
        return backToApp({ error: "missing_id_token" });
      }
      const identity = await deps.google.verifyIdToken(tokens.idToken);
      const result =
        saved.purpose === "login"
          ? await handleLogin(deps, ownerEmails, identity)
          : await handleLink(deps, saved, identity, tokens);
      return backToApp(result);
    } catch (error) {
      const code = classifyCallbackError(error);
      logger.error("OAuth コールバックの処理に失敗しました", {
        purpose: saved.purpose,
        code,
        error: String(error),
      });
      return backToApp({ error: code });
    }
  });

  return app;
}

/**
 * コールバック処理中の例外を、アプリ側で案内を出し分けられるエラーコードに分類する。
 * Google からのメッセージ文字列に依存するため、分類できないものは callback_failed にする。
 */
export function classifyCallbackError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /calendar/i.test(message) &&
    /has not been used in project|is disabled/i.test(message)
  ) {
    // GCP プロジェクトで Google Calendar API が有効化されていない
    return "calendar_api_disabled";
  }
  if (/invalid_grant/i.test(message)) {
    // 認可コードが期限切れ・使用済み、またはリダイレクト URI が一致しない
    return "invalid_grant";
  }
  if (/invalid_client|unauthorized_client/i.test(message)) {
    // クライアント ID / シークレットが正しくない
    return "invalid_client";
  }
  if (/redirect_uri_mismatch/i.test(message)) {
    return "redirect_uri_mismatch";
  }
  return "callback_failed";
}

async function handleLogin(
  deps: AuthRouteDeps,
  ownerEmails: Set<string>,
  identity: GoogleIdentity,
): Promise<Record<string, string>> {
  const email = identity.email.toLowerCase();
  if (!identity.emailVerified || !ownerEmails.has(email)) {
    logger.warn("許可されていないアカウントのログイン試行", { email });
    return { error: "not_allowed" };
  }
  // uid には Google の sub を使う（同じアカウントなら常に同じ値）
  const uid = identity.sub;
  await deps.firebase.ensureUser(uid, email);
  await deps.stores.users.recordLogin(uid, email, deps.now());
  const token = await deps.firebase.createCustomToken(uid);
  return { token };
}

async function handleLink(
  deps: AuthRouteDeps,
  saved: OAuthState,
  identity: GoogleIdentity,
  tokens: GoogleTokens,
): Promise<Record<string, string>> {
  if (!saved.uid) {
    return { error: "invalid_state" };
  }
  if (!tokens.refreshToken) {
    // prompt=consent を付けているので通常は返る。返らない場合は Google 側の同意画面をやり直してもらう
    return { error: "missing_refresh_token" };
  }
  if (!hasCalendarScopes(tokens.scope)) {
    // 同意画面でカレンダーの権限をオフにされた場合
    return { error: "insufficient_scope" };
  }

  const calendars = await deps.google.listCalendars(tokens.refreshToken);
  const now = deps.now();
  const existing = await deps.stores.accounts.get(saved.uid, identity.sub);
  await deps.stores.accounts.upsert(saved.uid, {
    id: identity.sub,
    email: identity.email.toLowerCase(),
    ...(identity.hd ? { hd: identity.hd } : {}),
    // hd（Workspace のドメイン）が付いていれば Workspace アカウント
    type: identity.hd ? "workspace" : "personal",
    refreshTokenEnc: deps.cipher.encrypt(tokens.refreshToken),
    scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    status: "ok",
    calendars,
    linkedAt: existing?.linkedAt ?? now,
    updatedAt: now,
  });
  logger.info("Google アカウントを連携しました", {
    uid: saved.uid,
    accountId: identity.sub,
    type: identity.hd ? "workspace" : "personal",
    calendarCount: calendars.length,
  });
  return { linked: identity.email.toLowerCase() };
}
